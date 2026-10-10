-- Histórico de metas por mês: meta, super meta e realizado de cada loja nos últimos N meses.
--
-- Motivo: /metas mostra um mês por vez; para ver se a loja bate a meta com regularidade (ou só
-- no mês bom) era preciso navegar mês a mês. Uma consulta devolve a grade inteira.
--
-- Mesma fonte do realizado de acompanhamento_metas (vendas_resumo_dia.vendas_brutas), então o
-- número de um mês fechado aqui é igual ao da tela daquele mês. security invoker: a RLS de
-- franchises, metas_vendas_mes e vendas_resumo_dia filtra o tenant (gerente recebe só a loja dele).
-- p_meses é limitado a 24 para a consulta nunca crescer sem controle.
--
-- Rode o arquivo inteiro. Sem passo de dados: a tela 'metas' já está liberada.

create or replace function public.historico_metas(p_mes_fim date, p_meses integer)
returns table (
  franchise_id uuid,
  franchise_nome text,
  mes date,
  meta numeric,
  super_meta numeric,
  realizado numeric
)
language sql
stable
as $$
  select
    f.id,
    f.name::text,
    g.mes,
    m.meta,
    m.super_meta,
    coalesce(sum(v.vendas_brutas), 0)
  from franchises f
  cross join (
    select (date_trunc('month', p_mes_fim) - make_interval(months => i))::date as mes
    from generate_series(0, least(greatest(p_meses, 1), 24) - 1) as i
  ) g
  left join metas_vendas_mes m on m.franchise_id = f.id and m.mes = g.mes
  left join vendas_resumo_dia v
    on v.franchise_id = f.id
   and v.data_venda >= g.mes
   and v.data_venda < (g.mes + interval '1 month')::date
  where f.is_active
  group by f.id, f.name, g.mes, m.meta, m.super_meta
  order by f.name, g.mes;
$$;

grant execute on function public.historico_metas(date, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Conferência — o realizado de um mês fechado deve ser igual à soma direta da tabela
-- ---------------------------------------------------------------------------
-- Esperado: soma_funcao = soma_tabela (mês anterior ao atual). Linhas = lojas ativas × 3 meses.
-- (No SQL Editor a RLS pode zerar os dois lados; nesse caso confira no app.)
select
  (select count(*) from historico_metas((date_trunc('month', current_date) - interval '1 month')::date, 3)) as linhas,
  (select coalesce(sum(realizado), 0)
     from historico_metas((date_trunc('month', current_date) - interval '1 month')::date, 1)) as soma_funcao,
  (select coalesce(sum(v.vendas_brutas), 0)
     from vendas_resumo_dia v
     join franchises f on f.id = v.franchise_id and f.is_active
    where v.data_venda >= (date_trunc('month', current_date) - interval '1 month')::date
      and v.data_venda < date_trunc('month', current_date)::date) as soma_tabela;
