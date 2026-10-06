-- ============================================================================
-- Catálogo do PDV em `produtos` + margens por categoria
-- ============================================================================
-- Rodar inteiro, de uma vez, depois de `rollup-resumo-vendas.sql`.
--
-- Por quê: a suspeita é de custo inflado no PDV, e hoje não dá para conferir — o app só
-- conhece o custo do que foi vendido. Medido na Loja4 em 05/10/2026:
--   · o custo que chega nas vendas é o campo `custo` do cadastro (24.287 de 24.324 itens
--     vendidos desde 01/09 batem com ele); `cmedio` está zerado em 19.604 de 19.617 produtos;
--   · o preço de venda é o campo `preço` (bate com 19.536 itens); `promoção` está zerada;
--   · 1.207 produtos (6%) têm custo >= preço — a evidência mais direta do problema.
--
-- A tabela `public.produtos` já existia, vazia (uma linha de teste), com os campos certos e
-- `unique (franchise_id, sku)`. Aqui ela recebe o cadastro das lojas.
--
-- `sku` guarda o CÓDIGO do PDV, não a referência: a referência é o código de barras e se
-- repete (19.565 distintas em 19.617 produtos, uma delas 5 vezes), o que estouraria a
-- constraint única que já existe. De quebra, o código é o que `vendas_itens.produto_codigo_pdv`
-- guarda, então a junção entre cadastro e venda fica exata.
-- ============================================================================

do $$
begin
  if to_regclass('public.produtos') is null then
    raise exception 'Banco errado: "%" não tem a tabela produtos.', current_database();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Campos que faltam no cadastro
-- ---------------------------------------------------------------------------

alter table public.produtos
  -- Código de barras (a `referencia` do PDV). Sem unique de propósito: ele se repete, e
  -- repetição aqui é achado para a equipe conferir, não erro a bloquear.
  add column if not exists codigo_barras text,
  add column if not exists atualizado_em timestamptz;

comment on column public.produtos.sku is
  'Código do produto no PDV (produtos.codigo). Casa com vendas_itens.produto_codigo_pdv.';
comment on column public.produtos.codigo_barras is
  'referencia do PDV (EAN). Pode repetir entre produtos da mesma loja.';

-- A tela filtra por loja e categoria; sem isto, cada abertura varre o cadastro inteiro.
create index if not exists idx_produtos_franquia_categoria
  on public.produtos (franchise_id, categoria);

-- ---------------------------------------------------------------------------
-- 2. RLS: faltava o dono enxergar as outras lojas
-- ---------------------------------------------------------------------------
-- Hoje só existe `produtos_select_own` (franquia própria). Sem o par abaixo, quem tem escopo
-- de todas as franquias não vê o cadastro de ninguém além da sua — e a tela nasce vazia para
-- exatamente quem vai usá-la. O predicado é cópia literal do que já protege vendas_itens e
-- vendas_por_linha_dia; divergir criaria duas regras para o mesmo dado.
drop policy if exists produtos_select_role on public.produtos;
create policy produtos_select_role
  on public.produtos
  for select
  to authenticated
  using (
    exists (
      select 1
      from profiles p
      join roles r on r.id = p.role_id
      where p.id = auth.uid()
        and r.escopo = 'todas_franquias'
        and 'dre' = any (r.telas_permitidas)
    )
  );

-- Escrita continua como estava (as policies `_insert_own` e `_update_own` seguem de pé), mas
-- quem alimenta a tabela é a carga do PDV, com service_role. Edição manual na tela saiu: seria
-- sobrescrita na carga seguinte.
grant select, insert, update, delete on public.produtos to service_role;

-- ---------------------------------------------------------------------------
-- 3. CMV no resumo por categoria
-- ---------------------------------------------------------------------------
-- Sem isto, a margem realizada por categoria exigiria varrer vendas_itens na tela — o caminho
-- que já estourou o timeout de 8s no dashboard, no fluxo de caixa e no DRE.

alter table public.vendas_por_linha_dia
  add column if not exists cmv numeric not null default 0;

-- Mesma função que o webhook /api/pdv/sync já chama depois de gravar os itens. Muda só o
-- bloco do resumo por categoria, que passa a gravar o CMV junto.
create or replace function atualizar_resumo_linha_dia(
  p_franchise_id uuid,
  p_data date
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_linhas integer;
begin
  -- Resumo por categoria, agora com CMV (mesma fórmula do DRE: quantidade × custo unitário).
  delete from vendas_por_linha_dia
  where franchise_id = p_franchise_id
    and data_venda = p_data;

  insert into vendas_por_linha_dia (
    franchise_id, data_venda, produto_linha, receita, unidades, produtos, cmv, atualizado_em
  )
  select
    vi.franchise_id,
    vi.data_venda,
    coalesce(vi.produto_linha, 'SEM CATEGORIA'),
    sum(vi.valor_total),
    sum(vi.quantidade),
    count(distinct vi.produto_codigo_pdv),
    coalesce(sum(vi.quantidade * vi.custo_unitario), 0),
    now()
  from vendas_itens vi
  where vi.franchise_id = p_franchise_id
    and vi.data_venda = p_data
  group by vi.franchise_id, vi.data_venda, coalesce(vi.produto_linha, 'SEM CATEGORIA');

  get diagnostics v_linhas = row_count;

  -- Resumo diário do painel de vendas (inalterado).
  delete from vendas_resumo_dia
  where franchise_id = p_franchise_id
    and data_venda = p_data;

  insert into vendas_resumo_dia (
    franchise_id, data_venda, vendas_brutas, unidades, quantidade_vendas, cmv, impostos, atualizado_em
  )
  select
    vi.franchise_id,
    vi.data_venda,
    coalesce(sum(vi.valor_total), 0),
    coalesce(sum(vi.quantidade), 0),
    count(distinct vi.venda_referencia),
    coalesce(sum(vi.quantidade * vi.custo_unitario), 0),
    coalesce(sum(vi.valor_total * coalesce(vi.aliquota_icm, 0) / 100), 0),
    now()
  from vendas_itens vi
  where vi.franchise_id = p_franchise_id
    and vi.data_venda = p_data
  group by vi.franchise_id, vi.data_venda;

  return v_linhas;
end;
$$;

grant execute on function atualizar_resumo_linha_dia(uuid, date) to service_role;

-- O backfill do CMV no histórico NÃO fica aqui. Numa tacada só, ele varre as ~1,3 milhão de
-- linhas de vendas_itens e estoura o tempo limite do SQL Editor (medido em 05/10/2026).
-- Ele é feito fora, chamando `atualizar_resumo_linha_dia` uma vez por loja e dia —
-- `scratch/backfill-cmv-categoria.mjs`. Cada chamada mexe num dia de uma loja, e a função é
-- a mesma que o sync usa, então não há segunda fórmula para divergir.

-- ---------------------------------------------------------------------------
-- 4. Margem por categoria
-- ---------------------------------------------------------------------------
-- Junta as duas visões: o cadastro (todo produto, inclusive o que nunca vendeu) e o realizado
-- do período (vendas_por_linha_dia). `full join` porque categoria pode existir num lado só:
-- produto cadastrado e nunca vendido, ou venda de produto que saiu do cadastro.
--
-- A margem de cadastro é (Σ preço − Σ custo) ÷ Σ preço dos produtos da categoria: cada produto
-- pesa igual, porque a pergunta aqui é "o cadastro está coerente?", não "quanto isso rendeu".
create or replace function margem_categorias(
  p_franchise_id uuid,
  p_data_inicio date default null,
  p_data_fim date default null
)
returns table (
  categoria text,
  produtos integer,
  anomalias integer,
  margem_cadastro_pct numeric,
  receita numeric,
  cmv numeric,
  margem_realizada_pct numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with cadastro as (
    select
      coalesce(nullif(btrim(p.categoria), ''), 'SEM CATEGORIA') as categoria,
      count(*)::int as produtos,
      -- Anomalia = o que não pode ser verdade: custo a partir do preço, ou custo ausente.
      count(*) filter (
        where coalesce(p.preco_custo, 0) <= 0
           or (coalesce(p.preco_venda, 0) > 0 and p.preco_custo >= p.preco_venda)
      )::int as anomalias,
      sum(coalesce(p.preco_venda, 0)) as preco_total,
      sum(coalesce(p.preco_custo, 0)) as custo_total
    from produtos p
    where p.franchise_id = p_franchise_id
    group by 1
  ),
  vendido as (
    select
      v.produto_linha as categoria,
      sum(v.receita) as receita,
      sum(v.cmv) as cmv
    from vendas_por_linha_dia v
    where v.franchise_id = p_franchise_id
      and (p_data_inicio is null or v.data_venda >= p_data_inicio)
      and (p_data_fim is null or v.data_venda <= p_data_fim)
    group by 1
  )
  select
    coalesce(c.categoria, v.categoria) as categoria,
    coalesce(c.produtos, 0) as produtos,
    coalesce(c.anomalias, 0) as anomalias,
    case when coalesce(c.preco_total, 0) > 0
         then round(((c.preco_total - c.custo_total) / c.preco_total) * 100, 1) end as margem_cadastro_pct,
    coalesce(v.receita, 0) as receita,
    coalesce(v.cmv, 0) as cmv,
    case when coalesce(v.receita, 0) > 0
         then round(((v.receita - v.cmv) / v.receita) * 100, 1) end as margem_realizada_pct
  from cadastro c
  full join vendido v on v.categoria = c.categoria
  order by margem_cadastro_pct desc nulls last;
$$;

-- ---------------------------------------------------------------------------
-- 5. Produtos de uma categoria
-- ---------------------------------------------------------------------------
-- Uma categoria por vez, de propósito: o filtro em vendas_itens é escrito EXATAMENTE como a
-- expressão do índice `idx_vendas_itens_linha_coalesce_data`, e é isso que mantém a consulta
-- abaixo de um segundo. Mudar a expressão aqui volta a varrer o período inteiro.
-- `p_ordem` decide o que vai no topo, e isso TEM de ser decidido aqui: a maior categoria tem
-- 8.621 produtos, então ordenar no navegador depois do limite mostraria o topo da ordem
-- errada. Ordem padrão: margem realizada — foi o que a tela mostrava antes, ordenada pela
-- margem de cadastro, que jogava para cima produto que nunca vendeu e tinha preço digitado
-- errado (05/10/2026: "Necessaire 6", custo R$ 6,39 e preço R$ 5.405,00, no primeiro lugar).
drop function if exists margem_produtos(uuid, text, date, date, int);
create or replace function margem_produtos(
  p_franchise_id uuid,
  p_categoria text,
  p_data_inicio date default null,
  p_data_fim date default null,
  p_limite int default 200,
  p_ordem text default 'realizada'
)
returns table (
  sku text,
  nome text,
  codigo_barras text,
  preco_custo numeric,
  preco_venda numeric,
  margem_cadastro_pct numeric,
  estoque numeric,
  unidades numeric,
  receita numeric,
  margem_realizada_pct numeric,
  alerta text
)
language sql
stable
security invoker
set search_path = public
as $$
  with vendido as (
    select
      vi.produto_codigo_pdv as sku,
      sum(vi.quantidade) as unidades,
      sum(vi.valor_total) as receita,
      sum(vi.quantidade * vi.custo_unitario) as cmv
    from vendas_itens vi
    where vi.franchise_id = p_franchise_id
      and coalesce(vi.produto_linha, 'SEM CATEGORIA') = p_categoria
      and (p_data_inicio is null or vi.data_venda >= p_data_inicio)
      and (p_data_fim is null or vi.data_venda <= p_data_fim)
    group by 1
  )
  select
    p.sku,
    p.nome,
    p.codigo_barras,
    p.preco_custo,
    p.preco_venda,
    case when coalesce(p.preco_venda, 0) > 0
         then round(((p.preco_venda - coalesce(p.preco_custo, 0)) / p.preco_venda) * 100, 1) end as margem_cadastro_pct,
    p.estoque_atual as estoque,
    coalesce(v.unidades, 0) as unidades,
    coalesce(v.receita, 0) as receita,
    case when coalesce(v.receita, 0) > 0
         then round(((v.receita - v.cmv) / v.receita) * 100, 1) end as margem_realizada_pct,
    case
      when coalesce(p.preco_venda, 0) <= 0 then 'sem preço'
      when coalesce(p.preco_custo, 0) <= 0 then 'sem custo'
      when p.preco_custo >= p.preco_venda then 'custo maior ou igual ao preço'
    end as alerta
  from produtos p
  left join vendido v on v.sku = p.sku
  where p.franchise_id = p_franchise_id
    and coalesce(nullif(btrim(p.categoria), ''), 'SEM CATEGORIA') = p_categoria
  order by
    -- Só um dos três critérios fica valendo; os outros viram NULL em todas as linhas e não
    -- mexem na ordem. Produto sem venda cai para o fim nos dois primeiros modos.
    case when p_ordem = 'faturamento' then coalesce(v.receita, 0) end desc nulls last,
    case when p_ordem = 'realizada' and coalesce(v.receita, 0) > 0
         then (v.receita - v.cmv) / v.receita end desc nulls last,
    case when p_ordem = 'cadastro' and coalesce(p.preco_venda, 0) > 0
         then (p.preco_venda - coalesce(p.preco_custo, 0)) / p.preco_venda end desc nulls last,
    p.nome
  limit p_limite;
$$;

grant execute on function margem_categorias(uuid, date, date) to authenticated;
grant execute on function margem_produtos(uuid, text, date, date, int, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Conferência
-- ---------------------------------------------------------------------------
-- Esperado agora: cadastro ainda com 1 linha (a de teste) e CMV ainda zerado — a carga do
-- catálogo e o backfill do CMV vêm depois, por script. O que tem de estar de pé aqui são as
-- 2 policies de leitura e as duas funções.
select
  (select count(*) from public.produtos)                                        as produtos_no_cadastro,
  (select count(*) from public.vendas_por_linha_dia where cmv > 0)              as dias_categoria_com_cmv,
  (select count(*) from public.vendas_por_linha_dia)                            as dias_categoria_total,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'produtos' and cmd = 'SELECT')  as policies_de_leitura,
  to_regprocedure('public.margem_categorias(uuid,date,date)')                   as fn_categorias,
  to_regprocedure('public.margem_produtos(uuid,text,date,date,int)')            as fn_produtos;
