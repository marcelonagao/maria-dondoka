-- Dias em que cada loja abre, para a "meta de hoje" da tela /metas.
--
-- Motivo: a tela passa a dizer quanto cada loja precisa vender HOJE, pesando o dia da semana e
-- pulando os dias em que ela fecha. Algumas lojas fecham domingo: sem saber disso, a meta que
-- falta é dividida também pelos domingos restantes e o número de hoje sai baixo demais.
-- A regra fica em src/lib/metas.ts (diasAbertosPelasVendas / diasAbertosDoAjuste); o banco só
-- devolve números crus e guarda o ajuste.
--
-- Decisões:
--  * Os dias abertos são DEDUZIDOS das vendas: acompanhamento_metas devolve, para cada dia da
--    semana, quantos dias da janela de 8 semanas (a mesma de soma_por_dia_semana) tiveram venda.
--    Aberto = teve venda em pelo menos metade das vezes que o dia apareceu (decisão do app).
--  * A dedução erra quando o mês foge do padrão ("em dezembro abre domingo"), então a meta do mês
--    ganha um ajuste opcional: metas_vendas_mes.dias_abertos, smallint[] com 0 = domingo (mesma
--    convenção de extract(dow)). null = deduzir pelas vendas. O ajuste vive na linha da meta
--    porque é decidido junto com ela, mês a mês; meta apagada leva o ajuste junto.
--  * salvar_metas_mes mantém assinatura, guarda e regras de meta/super/sonhos (cópia integral de
--    docs/sql/metas-sonhos.sql). Item SEM a chave "dias_abertos" mantém o valor gravado (app
--    antigo aberto não apaga o ajuste, mesmo padrão de meta_sonhos); chave com null ou lista
--    vazia grava null; lista é validada (inteiros 0..6) e gravada sem repetição, em ordem —
--    a constraint barra o resto, mas a função devolve mensagem legível citando a loja.
--  * acompanhamento_metas ganha dias_com_venda_por_dia_semana e dias_abertos no FIM do retorno.
--    O tipo de retorno muda, então a função é removida e recriada (cópia integral de
--    docs/sql/metas-sonhos.sql + as duas colunas). Função recriada ganha EXECUTE para PUBLIC por
--    padrão; aqui fecha ao anon de novo.
--  * De carona: historico_metas (docs/sql/metas-historico.sql) só tinha o grant, sem revoke —
--    o anon conseguia chamar. Fecha aqui.
--  * Rodar ANTES do deploy. A leitura tolera qualquer ordem (o app trata as duas colunas como
--    opcionais: banco antigo = todos os dias abertos), mas a gravação não: a salvar_metas_mes
--    antiga ignora a chave "dias_abertos" em silêncio, e o ajuste feito no editor novo some sem
--    erro.
--
-- Pré-requisito: docs/sql/metas-sonhos.sql já rodado (usa a coluna meta_sonhos).
-- Rode o arquivo INTEIRO de uma vez. Depois, rode os selects de conferência do fim (cada um é
-- um statement separado: conferir no mesmo statement que altera não enxerga a alteração).

-- ---------------------------------------------------------------------------
-- 1. Coluna e constraint
-- ---------------------------------------------------------------------------

alter table public.metas_vendas_mes add column if not exists dias_abertos smallint[];

alter table public.metas_vendas_mes drop constraint if exists metas_vendas_mes_dias_abertos_check;
alter table public.metas_vendas_mes
  add constraint metas_vendas_mes_dias_abertos_check
  check (
    dias_abertos is null
    or (cardinality(dias_abertos) between 1 and 7
        and dias_abertos <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[])
  );

-- ---------------------------------------------------------------------------
-- 2. Gravação: só sócio com a tela 'metas'
-- ---------------------------------------------------------------------------
-- p_metas: [{"franchise_id": "...", "meta": 240000, "super_meta": 280000, "meta_sonhos": 320000,
--            "dias_abertos": [1, 2, 3, 4, 5, 6]}, ...]
-- Item com meta nula/vazia remove a meta daquela loja no mês (e o ajuste de dias junto).
-- "meta_sonhos" vazio/nulo = sem meta dos sonhos; chave ausente = mantém a gravada.
-- "dias_abertos" null ou [] = deduzir pelas vendas; chave ausente = mantém o gravado.

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
  v_dias_json jsonb;
  v_dias smallint[];
  v_franquia uuid;
  v_nome text;
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

    -- Mesma checagem de antes; o nome fica guardado para a mensagem de erro dos dias abertos.
    select f.name into v_nome from franchises f where f.id = v_franquia;
    if not found then
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

      -- Chave ausente: app antigo, que não conhece o ajuste de dias — preserva o gravado.
      if v_item ? 'dias_abertos' then
        v_dias_json := v_item -> 'dias_abertos';
        if jsonb_typeof(v_dias_json) = 'null' then
          v_dias := null;
        elsif jsonb_typeof(v_dias_json) <> 'array' then
          raise exception 'Dias abertos da loja % devem ser uma lista de dias da semana', v_nome;
        elsif jsonb_array_length(v_dias_json) = 0 then
          -- Lista vazia não é "loja fechada o mês todo": é "sem ajuste", volta a deduzir.
          v_dias := null;
        else
          -- O case garante que só número chega ao cast (o "or" do SQL não garante ordem).
          -- "in (0..6)" compara por valor: 1.0 passa como 1, 1.5 e 7 são recusados.
          if exists (
            select 1
              from jsonb_array_elements(v_dias_json) e
             where case when jsonb_typeof(e) <> 'number' then true
                        else e::numeric not in (0, 1, 2, 3, 4, 5, 6) end
          ) then
            raise exception 'Dias abertos inválidos para a loja %: use inteiros de 0 (domingo) a 6 (sábado)', v_nome;
          end if;
          -- Normalizado (sem repetição, em ordem) para o mesmo ajuste ter sempre a mesma forma.
          select array_agg(s.d order by s.d) into v_dias
            from (select distinct (e::numeric)::smallint as d
                    from jsonb_array_elements(v_dias_json) e) s;
        end if;
      else
        v_dias := null;
        select m.dias_abertos into v_dias
          from metas_vendas_mes m
         where m.franchise_id = v_franquia and m.mes = p_mes;
      end if;

      insert into metas_vendas_mes (franchise_id, mes, meta, super_meta, meta_sonhos, dias_abertos, atualizado_em, atualizado_por)
      values (v_franquia, p_mes, v_meta, v_super, v_sonhos, v_dias, now(), auth.uid())
      on conflict (franchise_id, mes) do update
        set meta = excluded.meta,
            super_meta = excluded.super_meta,
            meta_sonhos = excluded.meta_sonhos,
            dias_abertos = excluded.dias_abertos,
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
-- 3. Leitura: acompanhamento_metas com os dias abertos (tipo de retorno muda → drop + create)
-- ---------------------------------------------------------------------------
-- security invoker (padrão): vendas_resumo_dia, metas_vendas_mes e franchises passam pela RLS
-- de quem chama. Gerente só recebe a própria loja.
-- soma_por_dia_semana[1..7] e dias_com_venda_por_dia_semana[1..7] = domingo..sábado, janela de
-- 56 dias antes de hoje (ver docs/sql/metas-dia-semana.sql). 56 dias = 8 de cada dia da semana,
-- então cada contador vai de 0 a 8.
-- count(*) conta dias e não linhas repetidas porque vendas_resumo_dia tem primary key
-- (franchise_id, data_venda): uma linha por loja/dia (docs/sql/rollup-resumo-vendas.sql).
-- "vendas_brutas > 0": linha zerada (dia sem venda que o rollup gravou) não conta como aberto.

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
  soma_por_dia_semana numeric[],
  dias_com_venda_por_dia_semana integer[],
  dias_abertos smallint[]
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
    ]::numeric[],
    -- Loja sem venda nenhuma: o left join traz uma linha com v nulo, o filtro a descarta e o
    -- count dá 0 (count nunca é nulo, não precisa de coalesce).
    array[
      count(*) filter (where extract(dow from v.data_venda) = 0 and v.data_venda >= p_hoje - 56 and v.data_venda < p_hoje and v.vendas_brutas > 0),
      count(*) filter (where extract(dow from v.data_venda) = 1 and v.data_venda >= p_hoje - 56 and v.data_venda < p_hoje and v.vendas_brutas > 0),
      count(*) filter (where extract(dow from v.data_venda) = 2 and v.data_venda >= p_hoje - 56 and v.data_venda < p_hoje and v.vendas_brutas > 0),
      count(*) filter (where extract(dow from v.data_venda) = 3 and v.data_venda >= p_hoje - 56 and v.data_venda < p_hoje and v.vendas_brutas > 0),
      count(*) filter (where extract(dow from v.data_venda) = 4 and v.data_venda >= p_hoje - 56 and v.data_venda < p_hoje and v.vendas_brutas > 0),
      count(*) filter (where extract(dow from v.data_venda) = 5 and v.data_venda >= p_hoje - 56 and v.data_venda < p_hoje and v.vendas_brutas > 0),
      count(*) filter (where extract(dow from v.data_venda) = 6 and v.data_venda >= p_hoje - 56 and v.data_venda < p_hoje and v.vendas_brutas > 0)
    ]::integer[],
    m.dias_abertos
  from franchises f
  left join metas_vendas_mes m on m.franchise_id = f.id and m.mes = p_mes
  left join vendas_resumo_dia v on v.franchise_id = f.id
  where f.is_active
  group by f.id, f.name, m.meta, m.super_meta, m.meta_sonhos, m.dias_abertos
  order by f.name;
$$;

revoke all on function public.acompanhamento_metas(date, date) from public, anon;
grant execute on function public.acompanhamento_metas(date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Pendência: historico_metas aberto ao anon (só tinha o grant)
-- ---------------------------------------------------------------------------

revoke all on function public.historico_metas(date, integer) from public, anon;
grant execute on function public.historico_metas(date, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Conferência — rode depois do arquivo, cada select à parte
-- ---------------------------------------------------------------------------
-- No SQL Editor auth.uid() é nulo, então a RLS de franchises/vendas pode devolver 0 linhas nas
-- conferências que chamam acompanhamento_metas (5.4 e 5.5): nesse caso confira pelo app,
-- logado como sócio.

-- 5.1 Coluna. Esperado: 1 linha, data_type = 'ARRAY', udt_name = '_int2',
-- tipo = 'smallint[]', is_nullable = 'YES'.
select c.column_name, c.data_type, c.udt_name,
       format_type(a.atttypid, a.atttypmod) as tipo,
       c.is_nullable
  from information_schema.columns c
  join pg_attribute a
    on a.attrelid = 'public.metas_vendas_mes'::regclass
   and a.attname = c.column_name
 where c.table_schema = 'public'
   and c.table_name = 'metas_vendas_mes'
   and c.column_name = 'dias_abertos';

-- 5.2 Constraint. Esperado: 1 linha; aceita_nulo, limita_tamanho e limita_dias = true.
-- A definicao vem reescrita pelo Postgres, algo como
-- 'CHECK (((dias_abertos IS NULL) OR ((cardinality(dias_abertos) >= 1) AND
--  (cardinality(dias_abertos) <= 7) AND (dias_abertos <@ ARRAY[0, 1, 2, 3, 4, 5, 6] ...))))'
-- (os números podem vir como '0'::smallint; o "between" vira >= e <=). Confira a definicao a
-- olho: o lado direito do <@ tem de ser exatamente os dias 0 a 6.
select conname,
       pg_get_constraintdef(oid) as definicao,
       pg_get_constraintdef(oid) like '%dias_abertos IS NULL%' as aceita_nulo,
       pg_get_constraintdef(oid) like '%cardinality(dias_abertos) >= 1%'
         and pg_get_constraintdef(oid) like '%cardinality(dias_abertos) <= 7%' as limita_tamanho,
       pg_get_constraintdef(oid) like '%dias_abertos <@ %' as limita_dias
  from pg_constraint
 where conrelid = 'public.metas_vendas_mes'::regclass
   and conname = 'metas_vendas_mes_dias_abertos_check';

-- 5.3 Retorno da função. Esperado: colunas_novas_no_fim = true (as duas novas, nesta ordem,
-- logo depois de soma_por_dia_semana e por último), volatilidade = 's' (stable),
-- security_definer = false (continua invoker: a RLS de quem chama filtra a loja).
select
  pg_get_function_result(p.oid) like
    '%soma_por_dia_semana numeric[], dias_com_venda_por_dia_semana integer[], dias_abertos smallint[])'
    as colunas_novas_no_fim,
  p.provolatile as volatilidade,
  p.prosecdef as security_definer,
  pg_get_function_result(p.oid) as retorno
  from pg_proc p
 where p.oid = 'public.acompanhamento_metas(date,date)'::regprocedure;

-- 5.4 Mesmos números de antes (docs/sql/metas-sonhos.sql, 4.4). Esperado:
-- linhas_funcao = lojas_ativas; soma_funcao = soma_tabela (a função não pode perder nem
-- duplicar venda — o join não mudou, só ganhou colunas); ajustes_funcao = ajustes_tabela
-- (hoje 0 até alguém gravar ajuste de dias pelo editor).
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
  (select count(dias_abertos)
     from acompanhamento_metas(date_trunc('month', current_date)::date, current_date)) as ajustes_funcao,
  (select count(m.dias_abertos)
     from metas_vendas_mes m
     join franchises f on f.id = m.franchise_id and f.is_active
    where m.mes = date_trunc('month', current_date)::date) as ajustes_tabela;

-- 5.5 Por loja: contadores e o que a regra deduz. Usa "hoje" de Brasília, como o app.
-- Repete a regra de src/lib/metas.ts (diasAbertosPelasVendas): ocorrências = quantas vezes o
-- dia apareceu entre max(primeira venda, hoje − 56) e ontem; aberto = dias com venda × 2 ≥
-- ocorrências; dia sem ocorrência (loja nova) ou loja sem venda nenhuma = aberto.
-- Esperado:
--  * contadores_ok = true em todas as linhas (7 posições, cada uma entre 0 e 8);
--  * loja que abre todo dia: contadores 8 (7 se caiu feriado) e abertos_pelas_vendas =
--    'seg, ter, qua, qui, sex, sáb, dom';
--  * loja que fecha domingo: dom perto de 0, 'dom' fora de abertos_pelas_vendas e pct_domingo
--    perto de 0. Bata a lista com o que você sabe de cada loja; se alguma divergir, é caso de
--    ajuste do mês no editor (ou de rever a regra).
--  * ajuste_do_mes = null em todas até alguém gravar ajuste.
with p as (
  select (now() at time zone 'America/Sao_Paulo')::date as hoje
),
a as (
  select p.hoje,
         f.franchise_nome,
         f.primeira_venda,
         f.soma_por_dia_semana as soma,
         f.dias_com_venda_por_dia_semana as cv,
         f.dias_abertos
    from p
    cross join lateral public.acompanhamento_metas(date_trunc('month', p.hoje)::date, p.hoje) f
)
select
  a.franchise_nome as loja,
  a.cv[2] as seg, a.cv[3] as ter, a.cv[4] as qua, a.cv[5] as qui,
  a.cv[6] as sex, a.cv[7] as sab, a.cv[1] as dom,
  (cardinality(a.cv) = 7 and 0 <= all (a.cv) and 8 >= all (a.cv)) as contadores_ok,
  ded.abertos as abertos_pelas_vendas,
  a.dias_abertos as ajuste_do_mes,
  round(100 * a.soma[1] / nullif((select sum(x) from unnest(a.soma) x), 0), 1) as pct_domingo
from a
cross join lateral (
  -- Semana começando na segunda, como a tela descreve ("seg a sáb").
  select string_agg(n.nome, ', ' order by n.ordem) as abertos
    from (values (1, 'seg', 1), (2, 'ter', 2), (3, 'qua', 3), (4, 'qui', 4),
                 (5, 'sex', 5), (6, 'sáb', 6), (0, 'dom', 7)) n(dow, nome, ordem)
    cross join lateral (
      -- Aritmética de date (date + inteiro), não generate_series de timestamp: assim o dia da
      -- semana não depende do fuso da sessão.
      select count(*) as ocorrencias
        from generate_series(0, (a.hoje - 1) - greatest(a.primeira_venda, a.hoje - 56)) i
       where extract(dow from greatest(a.primeira_venda, a.hoje - 56) + i) = n.dow
    ) o
   where a.primeira_venda is null
      or o.ocorrencias = 0
      or a.cv[n.dow + 1] * 2 >= o.ocorrencias
) ded
order by a.franchise_nome;

-- 5.6 Fechadas ao anon. Esperado: as três colunas anon_* = false e as três autenticado_* = true.
select
  has_function_privilege('anon', 'public.acompanhamento_metas(date,date)', 'execute') as anon_acompanhamento,
  has_function_privilege('anon', 'public.salvar_metas_mes(date,jsonb)', 'execute') as anon_salvar,
  has_function_privilege('anon', 'public.historico_metas(date,integer)', 'execute') as anon_historico,
  has_function_privilege('authenticated', 'public.acompanhamento_metas(date,date)', 'execute') as autenticado_acompanhamento,
  has_function_privilege('authenticated', 'public.salvar_metas_mes(date,jsonb)', 'execute') as autenticado_salvar,
  has_function_privilege('authenticated', 'public.historico_metas(date,integer)', 'execute') as autenticado_historico;
