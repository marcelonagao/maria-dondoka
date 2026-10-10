-- Meta e super meta de vendas por loja e por mês + leitura do acompanhamento.
--
-- Motivo: a gestão precisa comparar, no mês, o realizado × projeção × meta × super meta de cada
-- loja (tela /metas). Meta é uma por loja por mês; novo mês começa copiando o anterior (feito na
-- tela, não aqui).
--
-- Decisões:
--  * O realizado vem de vendas_resumo_dia (uma linha por loja/dia), nunca de vendas_itens: o
--    navegador morre em 8 s no Supabase e a mesma tabela alimenta o Painel de Vendas, então os
--    números batem.
--  * acompanhamento_metas devolve números CRUS. A regra de projeção mora em src/lib/metas.ts
--    (função pura, conferível sem navegador), não aqui.
--  * Escrita só pela salvar_metas_mes (security definer, guarda na 1ª linha): a tabela não tem
--    policy de INSERT/UPDATE para o navegador.
--  * "Hoje" chega por parâmetro, calculado em America/Sao_Paulo no cliente (src/lib/date.ts);
--    current_date do banco é UTC e viraria o dia às 21h de Brasília.
--
-- Rode o arquivo INTEIRO de uma vez. Depois, rode à parte o passo de dados do fim do arquivo
-- (libera a tela 'metas' nos papéis).

-- ---------------------------------------------------------------------------
-- 1. Tabela
-- ---------------------------------------------------------------------------

create table if not exists public.metas_vendas_mes (
  franchise_id uuid not null references public.franchises(id) on delete cascade,
  -- Sempre o dia 1 do mês.
  mes date not null check (mes = date_trunc('month', mes)::date),
  meta numeric not null check (meta > 0),
  super_meta numeric not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid,
  primary key (franchise_id, mes),
  check (super_meta >= meta)
);

-- ---------------------------------------------------------------------------
-- 2. RLS — mesmo par de vendas_resumo_dia (própria franquia + sócio com a tela liberada)
-- ---------------------------------------------------------------------------

alter table public.metas_vendas_mes enable row level security;

drop policy if exists metas_vendas_mes_select_own on public.metas_vendas_mes;
create policy metas_vendas_mes_select_own
  on public.metas_vendas_mes
  for select
  using (franchise_id = get_current_franchise_id());

drop policy if exists metas_vendas_mes_select_role on public.metas_vendas_mes;
create policy metas_vendas_mes_select_role
  on public.metas_vendas_mes
  for select
  using (
    exists (
      select 1
      from profiles p
      join roles r on r.id = p.role_id
      where p.id = auth.uid()
        and r.escopo = 'todas_franquias'
        and 'metas' = any (r.telas_permitidas)
    )
  );

grant select on public.metas_vendas_mes to authenticated;
grant all on public.metas_vendas_mes to service_role;

-- ---------------------------------------------------------------------------
-- 3. Gravação: só sócio com a tela 'metas'
-- ---------------------------------------------------------------------------
-- p_metas: [{"franchise_id": "...", "meta": 240000, "super_meta": 280000}, ...]
-- Item com meta nula/vazia remove a meta daquela loja no mês.

create or replace function public.salvar_metas_mes(p_mes date, p_metas jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_meta numeric;
  v_super numeric;
  v_franquia uuid;
  v_gravadas integer := 0;
begin
  if not exists (
    select 1
    from profiles p
    join roles r on r.id = p.role_id
    where p.id = auth.uid()
      and r.escopo = 'todas_franquias'
      and 'metas' = any (r.telas_permitidas)
  ) then
    raise exception 'Sem permissão para cadastrar metas' using errcode = '42501';
  end if;

  if p_mes is null or p_mes <> date_trunc('month', p_mes)::date then
    raise exception 'p_mes deve ser o primeiro dia do mês (recebido: %)', p_mes;
  end if;
  if p_metas is null or jsonb_typeof(p_metas) <> 'array' then
    raise exception 'p_metas deve ser uma lista';
  end if;

  for v_item in select * from jsonb_array_elements(p_metas) loop
    v_franquia := (v_item ->> 'franchise_id')::uuid;
    v_meta := nullif(v_item ->> 'meta', '')::numeric;
    v_super := nullif(v_item ->> 'super_meta', '')::numeric;

    if not exists (select 1 from franchises where id = v_franquia) then
      raise exception 'Franquia inexistente: %', v_franquia;
    end if;

    if v_meta is null then
      delete from metas_vendas_mes where franchise_id = v_franquia and mes = p_mes;
    else
      if v_meta <= 0 then
        raise exception 'Meta deve ser maior que zero (franquia %)', v_franquia;
      end if;
      -- Super meta em branco = igual à meta (não há super meta separada).
      v_super := coalesce(v_super, v_meta);
      if v_super < v_meta then
        raise exception 'Super meta menor que a meta (franquia %)', v_franquia;
      end if;

      insert into metas_vendas_mes (franchise_id, mes, meta, super_meta, atualizado_em, atualizado_por)
      values (v_franquia, p_mes, v_meta, v_super, now(), auth.uid())
      on conflict (franchise_id, mes) do update
        set meta = excluded.meta,
            super_meta = excluded.super_meta,
            atualizado_em = now(),
            atualizado_por = auth.uid();
    end if;
    v_gravadas := v_gravadas + 1;
  end loop;

  return v_gravadas;
end;
$$;

revoke all on function public.salvar_metas_mes(date, jsonb) from public, anon;
grant execute on function public.salvar_metas_mes(date, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Leitura: números crus por loja ativa (a RLS filtra o que cada usuário enxerga)
-- ---------------------------------------------------------------------------
-- security invoker (padrão): vendas_resumo_dia, metas_vendas_mes e franchises passam pela RLS
-- de quem chama. Gerente só recebe a própria loja.

create or replace function public.acompanhamento_metas(p_mes date, p_hoje date)
returns table (
  franchise_id uuid,
  franchise_nome text,
  meta numeric,
  super_meta numeric,
  realizado_mes numeric,
  realizado_hoje numeric,
  soma_janela numeric,
  primeira_venda date
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
    -- Janela: 30 dias corridos ANTES de hoje (hoje é dia parcial e puxaria a média para baixo).
    coalesce(sum(v.vendas_brutas) filter (
      where v.data_venda >= p_hoje - 30 and v.data_venda < p_hoje
    ), 0),
    min(v.data_venda)
  from franchises f
  left join metas_vendas_mes m on m.franchise_id = f.id and m.mes = p_mes
  left join vendas_resumo_dia v on v.franchise_id = f.id
  where f.is_active
  group by f.id, f.name, m.meta, m.super_meta
  order by f.name;
$$;

grant execute on function public.acompanhamento_metas(date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Conferência — rode depois do arquivo, como sócio ou no SQL Editor
-- ---------------------------------------------------------------------------
-- Esperado: lojas_ativas = número de franquias ativas (9 menos a de teste, se inativa);
-- soma_funcao = soma_tabela (a função não pode perder nem duplicar venda).
-- No SQL Editor auth.uid() é nulo, então a RLS de franchises/vendas pode devolver 0 linhas:
-- nesse caso confira pelo app, logado como sócio.
select
  (select count(*) from franchises where is_active) as lojas_ativas,
  (select count(*) from acompanhamento_metas(date_trunc('month', current_date)::date, current_date)) as linhas_funcao,
  (select coalesce(sum(realizado_mes), 0)
     from acompanhamento_metas(date_trunc('month', current_date)::date, current_date)) as soma_funcao,
  (select coalesce(sum(v.vendas_brutas), 0)
     from vendas_resumo_dia v
     join franchises f on f.id = v.franchise_id and f.is_active
    where v.data_venda >= date_trunc('month', current_date)::date
      and v.data_venda <= current_date) as soma_tabela;

-- ---------------------------------------------------------------------------
-- 6. PASSO DE DADOS (rodar à parte): liberar a tela 'metas'
-- ---------------------------------------------------------------------------
-- Papéis que já veem o dashboard passam a ver /metas. Gerente continua só com a própria loja
-- (RLS); só sócio grava (guarda da salvar_metas_mes). Sócio precisa também de 'dre' para a
-- RLS de vendas_resumo_dia — os sócios atuais já têm.
--
-- update roles
--    set telas_permitidas = array_append(telas_permitidas, 'metas')
--  where ('dashboard' = any (telas_permitidas) or 'dash_simplificado' = any (telas_permitidas))
--    and not 'metas' = any (telas_permitidas);
-- (O papel "Loja" não tem 'dashboard', só 'dash_simplificado' — por isso o segundo critério.
--  "Administrativo" não tem nenhum dos dois e fica de fora de propósito.)
--
-- Conferência: select nome, escopo, telas_permitidas from roles;  -- 'metas' em todos os papéis com dashboard
