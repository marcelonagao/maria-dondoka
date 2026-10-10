-- acompanhamento_metas passa a devolver as vendas por dia da semana (últimas 8 semanas).
--
-- Motivo: a projeção de /metas tratava todos os dias iguais. Loja que vende bem mais no sábado
-- fecha o mês projetado errado conforme sobram mais ou menos sábados. A tela precisa do "formato
-- da semana" de cada loja; a regra (fatores, quando usar, quando cair no plano) mora em
-- src/lib/metas.ts. Aqui só saem os números crus.
--
-- Janela de 56 dias (8 semanas completas) ANTES de hoje: 30 dias dariam ~4 amostras por dia da
-- semana, e uma semana atípica mexeria demais no perfil.
-- soma_por_dia_semana[1..7] = domingo..sábado (extract(dow) 0..6, deslocado +1 porque array
-- do Postgres começa em 1). Dia sem venda conta zero: loja fechada no domingo tem perfil baixo.
--
-- O tipo de retorno muda, então a função antiga é removida antes. Rode o arquivo inteiro.

drop function if exists public.acompanhamento_metas(date, date);

create or replace function public.acompanhamento_metas(p_mes date, p_hoje date)
returns table (
  franchise_id uuid,
  franchise_nome text,
  meta numeric,
  super_meta numeric,
  realizado_mes numeric,
  realizado_hoje numeric,
  soma_janela numeric,
  primeira_venda date,
  soma_por_dia_semana numeric[]
)
language sql
stable
as $$
  select
    f.id,
    f.name::text,
    m.meta,
    m.super_meta,
    coalesce(sum(v.vendas_brutas) filter (
      where v.data_venda >= p_mes
        and v.data_venda < (p_mes + interval '1 month')::date
        and v.data_venda <= p_hoje
    ), 0),
    coalesce(sum(v.vendas_brutas) filter (where v.data_venda = p_hoje), 0),
    -- Janela do nível: 30 dias corridos ANTES de hoje (hoje é dia parcial).
    coalesce(sum(v.vendas_brutas) filter (
      where v.data_venda >= p_hoje - 30 and v.data_venda < p_hoje
    ), 0),
    min(v.data_venda),
    array[
      coalesce(sum(v.vendas_brutas) filter (where extract(dow from v.data_venda) = 0 and v.data_venda >= p_hoje - 56 and v.data_venda < p_hoje), 0),
      coalesce(sum(v.vendas_brutas) filter (where extract(dow from v.data_venda) = 1 and v.data_venda >= p_hoje - 56 and v.data_venda < p_hoje), 0),
      coalesce(sum(v.vendas_brutas) filter (where extract(dow from v.data_venda) = 2 and v.data_venda >= p_hoje - 56 and v.data_venda < p_hoje), 0),
      coalesce(sum(v.vendas_brutas) filter (where extract(dow from v.data_venda) = 3 and v.data_venda >= p_hoje - 56 and v.data_venda < p_hoje), 0),
      coalesce(sum(v.vendas_brutas) filter (where extract(dow from v.data_venda) = 4 and v.data_venda >= p_hoje - 56 and v.data_venda < p_hoje), 0),
      coalesce(sum(v.vendas_brutas) filter (where extract(dow from v.data_venda) = 5 and v.data_venda >= p_hoje - 56 and v.data_venda < p_hoje), 0),
      coalesce(sum(v.vendas_brutas) filter (where extract(dow from v.data_venda) = 6 and v.data_venda >= p_hoje - 56 and v.data_venda < p_hoje), 0)
    ]::numeric[]
  from franchises f
  left join metas_vendas_mes m on m.franchise_id = f.id and m.mes = p_mes
  left join vendas_resumo_dia v on v.franchise_id = f.id
  where f.is_active
  group by f.id, f.name, m.meta, m.super_meta
  order by f.name;
$$;

grant execute on function public.acompanhamento_metas(date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Conferência — a soma dos 7 dias da semana deve ser igual à soma direta da tabela (56 dias)
-- ---------------------------------------------------------------------------
-- Esperado: diferenca = 0. (No SQL Editor a RLS pode zerar os dois lados; nesse caso confira no app.)
select
  (select coalesce(sum(x), 0) from acompanhamento_metas(date_trunc('month', current_date)::date, current_date) a,
          unnest(a.soma_por_dia_semana) x) as soma_funcao,
  (select coalesce(sum(v.vendas_brutas), 0)
     from vendas_resumo_dia v
     join franchises f on f.id = v.franchise_id and f.is_active
    where v.data_venda >= current_date - 56 and v.data_venda < current_date) as soma_tabela;
