-- Terceiro nível de meta por loja/mês: "Meta dos Sonhos".
--
-- Motivo: além de meta e super meta, a gestão quer um alvo de esticar em algumas lojas, para
-- mostrar na tela /metas quanto falta para ele. É opcional: nulo = loja sem meta dos sonhos.
--
-- Decisões:
--  * Ordem obrigatória meta <= super_meta <= meta_sonhos. A tabela garante por constraint
--    (meta_sonhos nulo passa); a salvar_metas_mes valida antes, para devolver mensagem legível
--    em vez do erro cru da constraint.
--  * salvar_metas_mes mantém assinatura, guarda e validações. Item SEM a chave "meta_sonhos"
--    mantém o valor que já estava gravado (navegador com a versão antiga do app aberta não
--    apaga a meta dos sonhos sem querer); chave presente com valor vazio/nulo grava nulo.
--    Meta nula continua apagando a linha inteira (inclusive a meta dos sonhos).
--  * acompanhamento_metas ganha a coluna meta_sonhos logo depois de super_meta. O tipo de
--    retorno muda, então a função é removida e recriada (cópia integral da versão de
--    docs/sql/metas-dia-semana.sql + a coluna nova). Função recriada ganha EXECUTE para PUBLIC
--    por padrão; aqui fecha ao anon, como as demais RPCs do projeto.
--  * A regra de projeção continua em src/lib/metas.ts; esta RPC só devolve números crus.
--
-- Rode o arquivo INTEIRO de uma vez. Depois, rode os selects de conferência do fim (cada um é
-- um statement separado: conferir no mesmo statement que altera não enxerga a alteração).

-- ---------------------------------------------------------------------------
-- 1. Coluna e constraint
-- ---------------------------------------------------------------------------

alter table public.metas_vendas_mes add column if not exists meta_sonhos numeric;

alter table public.metas_vendas_mes drop constraint if exists metas_vendas_mes_meta_sonhos_check;
alter table public.metas_vendas_mes
  add constraint metas_vendas_mes_meta_sonhos_check
  check (meta_sonhos is null or meta_sonhos >= super_meta);

-- ---------------------------------------------------------------------------
-- 2. Gravação: só sócio com a tela 'metas'
-- ---------------------------------------------------------------------------
-- p_metas: [{"franchise_id": "...", "meta": 240000, "super_meta": 280000, "meta_sonhos": 320000}, ...]
-- Item com meta nula/vazia remove a meta daquela loja no mês.
-- "meta_sonhos" vazio/nulo = sem meta dos sonhos; chave ausente = mantém a gravada.

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
  v_sonhos numeric;
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

      -- Chave ausente: app antigo, que não conhece a meta dos sonhos — preserva a gravada.
      if v_item ? 'meta_sonhos' then
        v_sonhos := nullif(v_item ->> 'meta_sonhos', '')::numeric;
      else
        v_sonhos := null;
        select m.meta_sonhos into v_sonhos
          from metas_vendas_mes m
         where m.franchise_id = v_franquia and m.mes = p_mes;
      end if;
      if v_sonhos is not null and v_sonhos < v_super then
        raise exception 'Meta dos sonhos menor que a super meta (franquia %)', v_franquia;
      end if;

      insert into metas_vendas_mes (franchise_id, mes, meta, super_meta, meta_sonhos, atualizado_em, atualizado_por)
      values (v_franquia, p_mes, v_meta, v_super, v_sonhos, now(), auth.uid())
      on conflict (franchise_id, mes) do update
        set meta = excluded.meta,
            super_meta = excluded.super_meta,
            meta_sonhos = excluded.meta_sonhos,
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
-- 3. Leitura: acompanhamento_metas com meta_sonhos (tipo de retorno muda → drop + create)
-- ---------------------------------------------------------------------------
-- security invoker (padrão): vendas_resumo_dia, metas_vendas_mes e franchises passam pela RLS
-- de quem chama. Gerente só recebe a própria loja.
-- soma_por_dia_semana[1..7] = domingo..sábado, janela de 56 dias antes de hoje
-- (ver docs/sql/metas-dia-semana.sql).

drop function if exists public.acompanhamento_metas(date, date);

create or replace function public.acompanhamento_metas(p_mes date, p_hoje date)
returns table (
  franchise_id uuid,
  franchise_nome text,
  meta numeric,
  super_meta numeric,
  meta_sonhos numeric,
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
    m.meta_sonhos,
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
  group by f.id, f.name, m.meta, m.super_meta, m.meta_sonhos
  order by f.name;
$$;

revoke all on function public.acompanhamento_metas(date, date) from public, anon;
grant execute on function public.acompanhamento_metas(date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Conferência — rode depois do arquivo, cada select à parte
-- ---------------------------------------------------------------------------

-- 4.1 Coluna. Esperado: 1 linha, data_type = 'numeric', is_nullable = 'YES'.
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'metas_vendas_mes'
   and column_name = 'meta_sonhos';

-- 4.2 Constraint. Esperado: 1 linha,
-- definicao = 'CHECK (((meta_sonhos IS NULL) OR (meta_sonhos >= super_meta)))'.
select conname, pg_get_constraintdef(oid) as definicao
  from pg_constraint
 where conrelid = 'public.metas_vendas_mes'::regclass
   and conname = 'metas_vendas_mes_meta_sonhos_check';

-- 4.3 Retorno da função. Esperado: tem_meta_sonhos = true e ordem_ok = true
-- (meta_sonhos logo depois de super_meta).
select
  pg_get_function_result('public.acompanhamento_metas(date,date)'::regprocedure) like '%meta_sonhos numeric%' as tem_meta_sonhos,
  position('super_meta numeric, meta_sonhos numeric'
           in pg_get_function_result('public.acompanhamento_metas(date,date)'::regprocedure)) > 0 as ordem_ok;

-- 4.4 Linhas e soma. Esperado: linhas_funcao = lojas_ativas (9 menos a de teste, se inativa);
-- soma_funcao = soma_tabela (a função não pode perder nem duplicar venda);
-- sonhos_funcao = sonhos_tabela (hoje 0 até alguém cadastrar meta dos sonhos).
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
      and v.data_venda <= current_date) as soma_tabela,
  (select count(meta_sonhos)
     from acompanhamento_metas(date_trunc('month', current_date)::date, current_date)) as sonhos_funcao,
  (select count(m.meta_sonhos)
     from metas_vendas_mes m
     join franchises f on f.id = m.franchise_id and f.is_active
    where m.mes = date_trunc('month', current_date)::date) as sonhos_tabela;

-- 4.5 Fechadas ao anon. Esperado: as duas colunas = false.
select
  has_function_privilege('anon', 'public.acompanhamento_metas(date,date)', 'execute') as anon_acompanhamento,
  has_function_privilege('anon', 'public.salvar_metas_mes(date,jsonb)', 'execute') as anon_salvar;
