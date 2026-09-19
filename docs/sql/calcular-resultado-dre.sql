-- calcular_resultado_dre: receita, deduções, CMV e quantidade de vendas passam a vir de
-- vendas_resumo_dia.
--
-- A versão antiga somava vendas_itens item a item e estourava o statement_timeout de 8s
-- (57014) até para um mês só, depois do backfill "sd ins:" de 18/09/2026 (+30% de linhas).
-- A página do DRE chama a função 10 vezes em paralelo (período atual, anterior e uma por
-- franquia).
--
-- Fórmulas idênticas — vendas_resumo_dia é montada com as mesmas expressões:
--   receita_bruta = sum(valor_total)
--   deducoes      = sum(valor_total * coalesce(aliquota_icm, 0) / 100)
--   custos        = sum(quantidade * custo_unitario)
-- A parte de despesas (accounts_payable por paid_at + categoria_raiz) não muda.
--
-- Única diferença: quantidade_vendas no consolidado (todas as franquias). A versão antiga
-- fazia count(distinct venda_referencia) misturando lojas, e o mesmo número de venda em duas
-- lojas contava uma vez só; agora soma por loja/dia (mesma correção feita em resumo_vendas).
--
-- security invoker explícito: a RLS de vendas_resumo_dia (cópia da de vendas_itens) continua
-- filtrando as franquias. Nunca chamar com service_role a partir da tela.

create or replace function public.calcular_resultado_dre(p_franchise_id uuid, p_data_inicio date, p_data_fim date)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_receita_bruta numeric := 0;
  v_deducoes numeric := 0;
  v_custos numeric := 0;
  v_quantidade_vendas integer := 0;
  v_despesas jsonb;
  v_despesas_total numeric := 0;
begin
  select
    coalesce(sum(r.vendas_brutas), 0),
    coalesce(sum(r.impostos), 0),
    coalesce(sum(r.cmv), 0),
    coalesce(sum(r.quantidade_vendas), 0)
  into v_receita_bruta, v_deducoes, v_custos, v_quantidade_vendas
  from vendas_resumo_dia r
  where r.data_venda between p_data_inicio and p_data_fim
    and (p_franchise_id is null or r.franchise_id = p_franchise_id);

  select coalesce(jsonb_agg(jsonb_build_object('categoria_id', grp.categoria_raiz_id, 'categoria', pai.nome, 'valor', grp.total) order by grp.total desc), '[]'::jsonb),
         coalesce(sum(grp.total), 0)
  into v_despesas, v_despesas_total
  from (
    select categoria_raiz(pc.id) as categoria_raiz_id, sum(ap.amount) as total
    from accounts_payable ap
    join plano_contas pc on pc.id = ap.plano_conta_id
    where ap.paid_at is not null
      and ap.paid_at >= p_data_inicio
      and ap.paid_at < (p_data_fim + interval '1 day')
      and pc.tipo = 'despesa'
      and (p_franchise_id is null or ap.franchise_id = p_franchise_id)
    group by categoria_raiz(pc.id)
  ) grp
  join plano_contas pai on pai.id = grp.categoria_raiz_id;

  return jsonb_build_object(
    'receita_bruta', v_receita_bruta,
    'deducoes', v_deducoes,
    'receita_liquida', v_receita_bruta - v_deducoes,
    'custos', v_custos,
    'lucro_bruto', v_receita_bruta - v_deducoes - v_custos,
    'despesas_por_categoria', v_despesas,
    'despesas_total', v_despesas_total,
    'resultado_liquido', v_receita_bruta - v_deducoes - v_custos - v_despesas_total,
    'quantidade_vendas', v_quantidade_vendas,
    'ticket_medio', case when v_quantidade_vendas > 0 then v_receita_bruta / v_quantidade_vendas else 0 end
  );
end;
$function$;
