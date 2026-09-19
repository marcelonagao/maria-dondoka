-- Detalhe de produtos por categoria (top_produtos_da_linha): índice que o filtro consegue
-- usar + correção do agrupamento entre lojas.
--
-- 1. LENTIDÃO. O filtro é coalesce(produto_linha, 'SEM CATEGORIA') = p_linha. Sem índice
--    sobre ESSA expressão, o banco lia todos os itens do período (197 mil em 30 dias, todas
--    as categorias) e descartava 68% depois — 2,4 dos 2,7s do plano de 19/09, e 57014 no
--    cache frio. O índice criado em 17/09 era sobre a coluna pura (produto_linha); o Postgres
--    só usa índice quando a expressão bate exatamente, por isso foi "ignorado" — não era
--    contenção de CPU, como o comentário antigo da função dizia.
--
-- 2. AGRUPAMENTO. O primeiro nível agrupava só por produto_codigo_pdv, mas o código é de
--    cada loja: no consolidado, dois produtos diferentes com o mesmo código em lojas
--    diferentes viravam um (min(rotulo) ficava com a receita dos dois e o outro sumia do
--    ranking). Agora é loja + código, e o mesmo produto em várias lojas se junta no segundo
--    nível, pelo nome.
--
-- Rode às madrugadas ou com as lojas fechadas: criar o índice trava gravações em
-- vendas_itens por alguns segundos.

create index if not exists idx_vendas_itens_linha_coalesce_data
  on public.vendas_itens ((coalesce(produto_linha, 'SEM CATEGORIA')), data_venda);

analyze public.vendas_itens;

create or replace function top_produtos_da_linha(
  p_linha text,
  p_franchise_id uuid default null,
  p_data_inicio date default null,
  p_data_fim date default null,
  p_limite int default 10
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select
      coalesce(
        nullif(btrim(vi.produto_nome), ''),
        nullif(btrim(vi.produto_sku), ''),
        vi.produto_codigo_pdv
      ) as rotulo,
      vi.franchise_id,
      vi.produto_codigo_pdv,
      vi.valor_total,
      vi.quantidade
    from vendas_itens vi
    where vi.data_venda between p_data_inicio and p_data_fim
      and (p_franchise_id is null or vi.franchise_id = p_franchise_id)
      -- Escrito exatamente como o índice idx_vendas_itens_linha_coalesce_data. Mudar a
      -- expressão aqui (ou lá) volta a varrer todas as categorias do período.
      and coalesce(vi.produto_linha, 'SEM CATEGORIA') = p_linha
  ),
  -- Primeiro nível: loja + código. Código do PDV é de cada loja — agrupar só por ele
  -- misturava produtos diferentes entre lojas no consolidado.
  --
  -- min(rotulo) porque o mesmo código pode ter rótulos diferentes entre linhas antigas e
  -- novas: antes do backfill, a venda sem produto_nome caía no SKU ou no código.
  por_codigo as (
    select
      franchise_id,
      produto_codigo_pdv,
      min(rotulo) as rotulo,
      sum(valor_total) as receita,
      sum(quantidade) as unidades
    from base
    group by franchise_id, produto_codigo_pdv
  ),
  -- Segundo nível: pelo nome. Junta o mesmo produto vendido em várias lojas e códigos
  -- distintos com o mesmo nome (reposição com cadastro novo).
  por_rotulo as (
    select rotulo, sum(receita) as receita, sum(unidades) as unidades
    from por_codigo
    group by rotulo
  )
  select jsonb_build_object(
    -- Produtos por nome: a tela diz "N produtos no período", e o mesmo perfume em 8 lojas é
    -- um produto, não 8.
    'produtos_distintos', (select count(*) from por_rotulo),
    'itens', coalesce(
      (
        select jsonb_agg(to_jsonb(x) order by x.receita desc)
        from (select * from por_rotulo order by receita desc limit p_limite) x
      ),
      '[]'::jsonb
    )
  );
$$;

-- Conferência: a mesma consulta de dentro da função, com valores fixos (explain de uma
-- chamada de função não mostra o plano interno). Deve aparecer
-- "idx_vendas_itens_linha_coalesce_data" e bem menos que 197 mil linhas lidas.
-- Me mande a saída inteira.
explain (analyze, buffers)
select vi.franchise_id, vi.produto_codigo_pdv, sum(vi.valor_total), sum(vi.quantidade)
from vendas_itens vi
where vi.data_venda between '2026-08-20' and '2026-09-18'
  and coalesce(vi.produto_linha, 'SEM CATEGORIA') = 'MAQUIAGEM'
group by vi.franchise_id, vi.produto_codigo_pdv;
