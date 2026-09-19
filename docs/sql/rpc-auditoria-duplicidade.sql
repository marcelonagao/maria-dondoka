-- Vigia de duplicidade de vendas_itens: contagem feita no banco.
--
-- O cron /api/cron/auditoria-duplicidade lia as linhas para contar no servidor, mas o
-- Supabase devolve no máximo 1000 por consulta — o vigia via ~2% da janela de 7 dias
-- (~40 mil linhas). Paginar levou ~24s, lento demais para um cron. Aqui o banco faz a conta
-- e devolve só os dias suspeitos (normalmente nenhum).
--
-- Mesmo padrão de atualizar_resumo_linha_dia: security invoker, search_path fixo, execute
-- para service_role (quem chama é o cron).

create or replace function auditar_duplicidade_vendas_itens(p_desde date)
returns table (franchise_id uuid, data_venda date, total bigint, distintos bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select v.franchise_id, v.data_venda, count(*) as total, count(distinct v.origem_id) as distintos
  from vendas_itens v
  where v.data_venda >= p_desde
  group by v.franchise_id, v.data_venda
  -- Dia sem nenhum origem_id é dado anterior à correção do upsert: não dá para avaliar.
  having count(v.origem_id) > 0
     and count(*) > count(distinct v.origem_id);
$$;

grant execute on function auditar_duplicidade_vendas_itens(date) to service_role;

-- 1. Conferência: deve voltar VAZIO (a constraint única já impede duplicata).
select * from auditar_duplicidade_vendas_itens(current_date - 7);

-- 2. Tempo: rode separado e me mande o resultado. Precisa ficar bem abaixo de 1 segundo.
-- explain (analyze, buffers)
-- select v.franchise_id, v.data_venda, count(*), count(distinct v.origem_id)
-- from vendas_itens v
-- where v.data_venda >= current_date - 7
-- group by v.franchise_id, v.data_venda;
