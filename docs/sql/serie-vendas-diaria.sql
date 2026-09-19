-- serie_vendas_diaria (fluxo de caixa) passa a ler vendas_resumo_dia.
--
-- A versão antiga somava vendas_itens item a item: 90 dias (o que a tela pede) são ~600 mil
-- linhas e estourava o statement_timeout de 8s (57014) mesmo sem RLS, depois do backfill
-- "sd ins:" de 18/09/2026. Mesma assinatura, mesmo retorno e mesmas fórmulas —
-- vendas_brutas = sum(valor_total) e cmv = sum(quantidade * custo_unitario), por loja/dia,
-- somados aqui por dia. Conferido em 19/09: 7 dias idênticos, dia a dia, antes da troca.

create or replace function public.serie_vendas_diaria(p_franchise_id uuid, p_data_inicio date, p_data_fim date)
returns table(data date, faturamento numeric, cmv numeric)
language sql
stable
security invoker
set search_path = public
as $function$
  select r.data_venda,
         sum(r.vendas_brutas)::numeric,
         sum(r.cmv)::numeric
  from vendas_resumo_dia r
  where r.data_venda between p_data_inicio and p_data_fim
    and (p_franchise_id is null or r.franchise_id = p_franchise_id)
  group by r.data_venda
  order by r.data_venda;
$function$;
