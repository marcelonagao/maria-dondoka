-- Resumo diário de vendas por franquia + resumo_vendas passa a ler dele.
--
-- Motivo: resumo_vendas somava vendas_itens item a item a cada abertura do painel. Depois do
-- backfill "sd ins:" (18/09/2026, +30% de linhas) passou a levar 3–8s mesmo SEM RLS, e
-- estourou o statement_timeout de 8s (57014) no navegador. Aqui o painel lê uma linha por
-- loja por dia (~240 para 30 dias) em vez de ~40 mil itens.
--
-- Mesmo padrão de vendas_por_linha_dia, que resolveu o card de categorias: tabela + RLS
-- copiada de vendas_itens + recálculo da fatia (franquia, dia) a cada sync.
--
-- Rode o arquivo INTEIRO de uma vez. A ordem importa: a resumo_vendas nova só é criada no
-- fim, depois de a tabela estar preenchida — senão o painel mostraria zero no intervalo.

-- ---------------------------------------------------------------------------
-- 1. Tabela
-- ---------------------------------------------------------------------------

create table if not exists public.vendas_resumo_dia (
  franchise_id uuid not null references public.franchises(id) on delete cascade,
  data_venda date not null,
  vendas_brutas numeric not null default 0,
  unidades numeric not null default 0,
  -- Vendas distintas NAQUELE dia e loja. Somável entre dias e lojas: o número da venda é
  -- sequencial por loja, então uma venda nunca aparece em dois dias nem em duas lojas.
  quantidade_vendas integer not null default 0,
  cmv numeric not null default 0,
  impostos numeric not null default 0,
  atualizado_em timestamptz not null default now(),
  primary key (franchise_id, data_venda)
);

-- Mesmo índice do resumo por categoria: o recorte consolidado (todas as franquias) filtra
-- só por período.
create index if not exists idx_vendas_resumo_dia_data
  on public.vendas_resumo_dia (data_venda, franchise_id);

-- ---------------------------------------------------------------------------
-- 2. RLS — cópia literal do par que protege vendas_itens e vendas_por_linha_dia
-- ---------------------------------------------------------------------------

alter table public.vendas_resumo_dia enable row level security;

drop policy if exists vendas_resumo_dia_select_own on public.vendas_resumo_dia;
create policy vendas_resumo_dia_select_own
  on public.vendas_resumo_dia
  for select
  using (franchise_id = get_current_franchise_id());

drop policy if exists vendas_resumo_dia_select_role on public.vendas_resumo_dia;
create policy vendas_resumo_dia_select_role
  on public.vendas_resumo_dia
  for select
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

-- Só SELECT para o navegador; quem escreve é o sync, com service_role.
grant select on public.vendas_resumo_dia to authenticated;
grant all on public.vendas_resumo_dia to service_role;

-- ---------------------------------------------------------------------------
-- 3. O recálculo que o sync já chama passa a atualizar as duas tabelas
-- ---------------------------------------------------------------------------

-- O webhook /api/pdv/sync chama atualizar_resumo_linha_dia depois de gravar os itens.
-- Estender a mesma função (em vez de criar outra) evita mexer no webhook e no PHP das lojas.
-- O nome ficou mais estreito que o conteúdo — trocar exigiria deploy coordenado.
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
  -- Resumo por categoria (inalterado).
  delete from vendas_por_linha_dia
  where franchise_id = p_franchise_id
    and data_venda = p_data;

  insert into vendas_por_linha_dia (
    franchise_id, data_venda, produto_linha, receita, unidades, produtos, atualizado_em
  )
  select
    vi.franchise_id,
    vi.data_venda,
    coalesce(vi.produto_linha, 'SEM CATEGORIA'),
    sum(vi.valor_total),
    sum(vi.quantidade),
    count(distinct vi.produto_codigo_pdv),
    now()
  from vendas_itens vi
  where vi.franchise_id = p_franchise_id
    and vi.data_venda = p_data
  group by vi.franchise_id, vi.data_venda, coalesce(vi.produto_linha, 'SEM CATEGORIA');

  get diagnostics v_linhas = row_count;

  -- Resumo diário do painel de vendas. Mesmas fórmulas da resumo_vendas antiga.
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

-- ---------------------------------------------------------------------------
-- 4. Backfill do histórico — uma passada só
-- ---------------------------------------------------------------------------

insert into public.vendas_resumo_dia (
  franchise_id, data_venda, vendas_brutas, unidades, quantidade_vendas, cmv, impostos
)
select
  vi.franchise_id,
  vi.data_venda,
  coalesce(sum(vi.valor_total), 0),
  coalesce(sum(vi.quantidade), 0),
  count(distinct vi.venda_referencia),
  coalesce(sum(vi.quantidade * vi.custo_unitario), 0),
  coalesce(sum(vi.valor_total * coalesce(vi.aliquota_icm, 0) / 100), 0)
from vendas_itens vi
group by vi.franchise_id, vi.data_venda
on conflict (franchise_id, data_venda) do update
  set vendas_brutas = excluded.vendas_brutas,
      unidades = excluded.unidades,
      quantidade_vendas = excluded.quantidade_vendas,
      cmv = excluded.cmv,
      impostos = excluded.impostos,
      atualizado_em = now();

analyze public.vendas_resumo_dia;

-- ---------------------------------------------------------------------------
-- 5. resumo_vendas passa a ler o resumo
-- ---------------------------------------------------------------------------

-- Mesma assinatura e mesmo formato de resposta: o painel (PainelVendas.tsx) não muda.
-- Sai o bloco top_produtos — nenhuma tela o lê desde que o card de categorias substituiu o
-- ranking antigo, e era a parte mais cara (agrupava todos os itens do período por nome).
--
-- Única diferença possível nos números: quantidade_vendas no consolidado. A versão antiga
-- fazia count(distinct venda_referencia) misturando as lojas, e o mesmo número de venda em
-- duas lojas contava uma vez só. Somando por loja/dia, cada venda conta — o número novo é o
-- correto e pode sair um pouco maior.
create or replace function public.resumo_vendas(p_franchise_id uuid, p_data_inicio date, p_data_fim date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $function$
declare
  v_totais jsonb; v_serie jsonb; v_por_franquia jsonb;
begin
  select jsonb_build_object(
    'vendas_brutas', coalesce(sum(r.vendas_brutas), 0),
    'unidades', coalesce(sum(r.unidades), 0),
    'quantidade_vendas', coalesce(sum(r.quantidade_vendas), 0),
    'cmv', coalesce(sum(r.cmv), 0),
    'impostos', coalesce(sum(r.impostos), 0)
  ) into v_totais
  from vendas_resumo_dia r
  where r.data_venda between p_data_inicio and p_data_fim
    and (p_franchise_id is null or r.franchise_id = p_franchise_id);

  select coalesce(jsonb_agg(jsonb_build_object('data', d.dia, 'faturamento', d.total)
                            order by d.dia), '[]'::jsonb)
  into v_serie
  from (
    select r.data_venda as dia, sum(r.vendas_brutas) as total
    from vendas_resumo_dia r
    where r.data_venda between p_data_inicio and p_data_fim
      and (p_franchise_id is null or r.franchise_id = p_franchise_id)
    group by r.data_venda
  ) d;

  -- Ignora p_franchise_id de propósito: esta lista serve pra comparar lojas entre si.
  select coalesce(jsonb_agg(jsonb_build_object(
           'franchise_id', f.franchise_id, 'vendas_brutas', f.total,
           'quantidade_vendas', f.vendas,
           'ticket_medio', case when f.vendas > 0 then f.total / f.vendas else 0 end
         ) order by f.total desc), '[]'::jsonb)
  into v_por_franquia
  from (
    select r.franchise_id, sum(r.vendas_brutas) as total,
           sum(r.quantidade_vendas) as vendas
    from vendas_resumo_dia r
    where r.data_venda between p_data_inicio and p_data_fim
    group by r.franchise_id
  ) f;

  return jsonb_build_object('totais', v_totais, 'serie_diaria', v_serie,
                            'por_franquia', v_por_franquia);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Conferência — deve mostrar ~8 lojas e datas de janeiro até hoje
-- ---------------------------------------------------------------------------

select count(*) as linhas, count(distinct franchise_id) as lojas,
       min(data_venda) as primeiro_dia, max(data_venda) as ultimo_dia
from public.vendas_resumo_dia;
