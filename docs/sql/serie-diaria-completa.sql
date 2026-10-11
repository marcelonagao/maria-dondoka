-- resumo_vendas: cada dia da série ganha quantidade de vendas, CMV, impostos e lojas com venda.
--
-- Motivo: o Painel de Vendas passou a agrupar a série em semana e mês (src/lib/serieVendas.ts).
-- A tabela mês a mês precisa de ticket, margem e número de lojas por mês, e o navegador só
-- consegue isso se cada dia trouxer as partes da conta. Sem RPC nova: são ~370 linhas por ano.
--
-- Mudança aditiva: totais e por_franquia iguais, e os campos antigos da série (data,
-- faturamento) continuam. A tela publicada hoje segue funcionando se este SQL rodar antes do
-- deploy.
--
-- "lojas" = lojas com venda > 0 naquele dia. Loja que abre no meio do ano aparece aqui, para
-- não ser lida como crescimento das que já existiam.
--
-- ANTES de rodar, confira se o corpo no ar é o mesmo de docs/sql/rollup-resumo-vendas.sql:
--   select pg_get_functiondef('public.resumo_vendas'::regproc);
-- Se for diferente, pare e mande o resultado — este arquivo substitui a função inteira.

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

  select coalesce(jsonb_agg(jsonb_build_object(
           'data', d.dia, 'faturamento', d.total,
           'quantidade_vendas', d.vendas, 'cmv', d.cmv, 'impostos', d.impostos, 'lojas', d.lojas
         ) order by d.dia), '[]'::jsonb)
  into v_serie
  from (
    select r.data_venda as dia,
           sum(r.vendas_brutas) as total,
           sum(r.quantidade_vendas) as vendas,
           sum(r.cmv) as cmv,
           sum(r.impostos) as impostos,
           count(distinct r.franchise_id) filter (where r.vendas_brutas > 0) as lojas
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
-- Conferência — esperado: dias > 0, serie = totais em faturamento, vendas e CMV
-- (as três colunas "confere_*" = true) e lojas_max entre 8 e 9.
-- ---------------------------------------------------------------------------
with r as (select public.resumo_vendas(null, date '2026-01-01', current_date) as j),
s as (select jsonb_array_elements(j -> 'serie_diaria') as p from r)
select
  (select count(*) from s) as dias,
  (select sum((p ->> 'faturamento')::numeric) from s) = (select (j -> 'totais' ->> 'vendas_brutas')::numeric from r) as confere_faturamento,
  (select sum((p ->> 'quantidade_vendas')::numeric) from s) = (select (j -> 'totais' ->> 'quantidade_vendas')::numeric from r) as confere_vendas,
  (select sum((p ->> 'cmv')::numeric) from s) = (select (j -> 'totais' ->> 'cmv')::numeric from r) as confere_cmv,
  (select max((p ->> 'lojas')::int) from s) as lojas_max;
