-- ============================================================================
-- get_current_franchise_id: VOLATILE -> STABLE
-- ============================================================================
-- Rodado em 06/10/2026.
--
-- A função estava sem marcação de volatilidade, o que no Postgres significa VOLATILE: "pode
-- devolver resultado diferente a cada chamada, nunca reaproveite". Ela é o predicado das
-- policies `_select_own` de vendas_itens, produtos, vendas_por_linha_dia e companhia — e por
-- isso era executada UMA VEZ POR LINHA avaliada, cada execução fazendo a sua própria consulta
-- em `profiles`.
--
-- Como aparece: a mesma consulta roda em milissegundos com service_role (que não passa pela
-- RLS) e estoura o statement_timeout de 8s (57014) no navegador. Foi o que derrubou a tela de
-- produtos numa categoria de 19 produtos sem nenhuma venda no período — volume não salvava
-- ninguém, porque o custo era do número de linhas avaliadas pela policy, não do resultado.
--
-- STABLE diz que o valor não muda dentro da mesma consulta, o que já era verdade: ele depende
-- só de auth.uid(). Com isso o planejador calcula uma vez e consegue usar índice na comparação.
--
-- Sem `set search_path` de propósito: essa cláusula impede o planejador de embutir a função na
-- consulta, e é justamente o inlining que a reduz a uma avaliação só.
--
-- Vale para o app inteiro — toda leitura filtrada por franquia passa por aqui.
-- ============================================================================

create or replace function public.get_current_franchise_id()
returns uuid
language sql
stable
as $function$
  select franchise_id from public.profiles where id = auth.uid();
$function$;

-- Conferência: volatilidade tem de vir 's'.
select proname, provolatile as volatilidade, prosecdef as security_definer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'get_current_franchise_id';
