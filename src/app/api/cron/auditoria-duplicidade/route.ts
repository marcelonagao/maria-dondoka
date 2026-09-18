import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'crypto';
import { adicionarDias, hojeBrasilia } from '../../../../lib/date';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
);

function safeCompare(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// Linha devolvida por auditar_duplicidade_vendas_itens. count() do Postgres chega como
// bigint — o PostgREST pode entregar como número ou string, daí o Number() no uso.
interface DiaSuspeito {
  franchise_id: string;
  data_venda: string;
  total: number | string;
  distintos: number | string;
}

// Faixa aceita para itens ÷ caixa por loja/dia. Medido depois da correção "sd ins:"
// (18/09/2026): 93–105%. Abaixo de 100% é normal — o caixa inclui suprimento de troco, que
// não é venda.
const CONFERENCIA_MIN = 0.9;
const CONFERENCIA_MAX = 1.1;
// Dia de caixa pequeno (inauguração, domingo fraco) oscila demais em percentual para o
// alerta dizer alguma coisa.
const CONFERENCIA_CAIXA_MINIMO = 500;

// Supabase devolve no máximo 1000 linhas por consulta, sem erro — ler tudo exige paginar.
async function lerPaginado<T>(
  consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const todas: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await consulta(de, de + 999);
    if (error) throw new Error(error.message);
    todas.push(...(data || []));
    if (!data || data.length < 1000) return todas;
  }
}

// Conferência diária: soma dos itens de venda contra a soma das formas de pagamento, por
// loja e dia. Existe porque o sync identifica venda pelo TEXTO do histórico no PDV — e o PDV
// grava a mesma venda com mais de um prefixo ("Saida vd:" e "sd ins:Saida vd:"). Um
// prefixo não previsto deixou 16–72% dos itens de fora por meses sem ninguém notar. Se o
// PDV passar a gravar um terceiro, é aqui que aparece: itens bem abaixo do caixa.
//
// Nunca lança: falha aqui não pode impedir a auditoria de duplicidade que roda em seguida.
async function conferirItensContraCaixa(): Promise<{ alertas_criados: string[]; erros: string[] }> {
  const alertasCriados: string[] = [];
  const erros: string[] = [];
  // Até ontem (horário de Brasília): o dia corrente ainda está recebendo sync.
  const ate = adicionarDias(hojeBrasilia(), -1);
  const desde = adicionarDias(ate, -6);

  try {
    const [itens, formas] = await Promise.all([
      lerPaginado((de, fim) =>
        supabaseAdmin
          .from('vendas_por_linha_dia')
          .select('franchise_id, data_venda, receita')
          .gte('data_venda', desde)
          .lte('data_venda', ate)
          .order('franchise_id')
          .order('data_venda')
          .order('produto_linha')
          .range(de, fim)
      ),
      lerPaginado((de, fim) =>
        supabaseAdmin
          .from('vendas_diarias_formas_pagamento')
          .select('franchise_id, data_venda, valor')
          .gte('data_venda', desde)
          .lte('data_venda', ate)
          .order('id')
          .range(de, fim)
      ),
    ]);

    const totais = new Map<string, { itens: number; caixa: number }>();
    const somar = (chave: string, campo: 'itens' | 'caixa', valor: number) => {
      const total = totais.get(chave) || { itens: 0, caixa: 0 };
      total[campo] += valor;
      totais.set(chave, total);
    };
    for (const linha of itens) somar(`${linha.franchise_id}::${linha.data_venda}`, 'itens', Number(linha.receita));
    for (const linha of formas) somar(`${linha.franchise_id}::${linha.data_venda}`, 'caixa', Number(linha.valor));

    for (const [chave, total] of Array.from(totais.entries())) {
      if (total.caixa < CONFERENCIA_CAIXA_MINIMO) continue;
      const razao = total.itens / total.caixa;
      if (razao >= CONFERENCIA_MIN && razao <= CONFERENCIA_MAX) continue;

      const [franchiseId, dataReferencia] = chave.split('::');
      try {
        // Mesmo dedupe da duplicidade: a janela de 7 dias reavalia o mesmo dia várias vezes.
        const { data: existente, error: existenteError } = await supabaseAdmin
          .from('alertas_sistema')
          .select('id')
          .eq('tipo', 'itens_divergem_caixa')
          .eq('franchise_id', franchiseId)
          .eq('data_referencia', dataReferencia)
          .maybeSingle();
        if (existenteError) throw new Error(existenteError.message);
        if (existente) continue;

        const percentual = Math.round(razao * 100);
        const causaProvavel =
          razao < CONFERENCIA_MIN
            ? 'Há venda no caixa sem os itens correspondentes — possível formato novo de lançamento no PDV (prefixo no histórico) ou falha no sync de itens.'
            : 'Há itens sem pagamento correspondente — possível falha no sync das formas de pagamento.';
        const { error: insertError } = await supabaseAdmin.from('alertas_sistema').insert({
          tipo: 'itens_divergem_caixa',
          franchise_id: franchiseId,
          data_referencia: dataReferencia,
          detalhe: `Itens de venda somam ${percentual}% do caixa do dia (normal: entre 90% e 110%). ${causaProvavel}`,
        });
        if (insertError) throw new Error(insertError.message);
        alertasCriados.push(`${franchiseId} — ${dataReferencia}`);
      } catch (err) {
        const mensagem = err instanceof Error ? err.message : String(err);
        console.error(`Erro ao registrar alerta de conferência itens × caixa ${chave}:`, mensagem);
        erros.push(`${chave}: ${mensagem}`);
      }
    }
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err);
    console.error('Erro ao ler dados da conferência itens × caixa:', mensagem);
    erros.push(`leitura: ${mensagem}`);
  }

  return { alertas_criados: alertasCriados, erros };
}

// Cinto e suspensório: a constraint única (franchise_id, origem_id) em vendas_itens já
// bloqueia duplicação estruturalmente — isso aqui é só pra pegar se algo escapar dela no
// futuro (schema novo sem grant, upsert virando insert por engano numa refatoração).
export async function GET(request: Request) {
  const auth = request.headers.get('authorization') || '';
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeCompare(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 401 });
  }

  // Roda neste mesmo cron, não num próprio: o vercel.json já tem 2 crons, e o limite do
  // plano Hobby para crons nativos derruba o deploy se for ultrapassado.
  const conferencia = await conferirItensContraCaixa();

  const hoje = new Date();
  hoje.setUTCHours(0, 0, 0, 0);
  const seteDiasAtras = new Date(hoje);
  seteDiasAtras.setUTCDate(seteDiasAtras.getUTCDate() - 7);
  const desde = seteDiasAtras.toISOString().slice(0, 10);

  // Contagem feita no banco (função auditar_duplicidade_vendas_itens), que devolve só os dias
  // suspeitos. Ler as linhas para contar aqui esbarrava no limite de 1000 linhas por consulta
  // do Supabase — o vigia via ~2% da janela — e paginar ~40 mil linhas levava ~24s.
  // Dia sem nenhum origem_id (dado anterior à correção do upsert) já sai filtrado lá.
  const { data: suspeitos, error } = await supabaseAdmin.rpc('auditar_duplicidade_vendas_itens', {
    p_desde: desde,
  });
  if (error) {
    return NextResponse.json(
      { error: 'ERRO_INTERNO', detalhe: error.message, conferencia_itens_caixa: conferencia },
      { status: 500 }
    );
  }

  const alertasCriados: string[] = [];
  const erros: string[] = [];

  for (const suspeito of (suspeitos || []) as DiaSuspeito[]) {
    const franchiseId = suspeito.franchise_id;
    const dataReferencia = suspeito.data_venda;
    const chave = `${franchiseId}::${dataReferencia}`;
    const fator = Number(suspeito.total) / Number(suspeito.distintos);

    try {
      // Dedupe: já existe QUALQUER alerta (resolvido ou não) pra essa franquia/dia? A
      // janela de 7 dias reprocessa o mesmo dia repetidas vezes — sem isso, recriaria o
      // alerta todo dia enquanto a data ainda estiver dentro da janela.
      const { data: existente, error: existenteError } = await supabaseAdmin
        .from('alertas_sistema')
        .select('id')
        .eq('tipo', 'duplicidade_vendas_itens')
        .eq('franchise_id', franchiseId)
        .eq('data_referencia', dataReferencia)
        .maybeSingle();
      if (existenteError) throw new Error(existenteError.message);
      if (existente) continue;

      const { error: insertError } = await supabaseAdmin.from('alertas_sistema').insert({
        tipo: 'duplicidade_vendas_itens',
        franchise_id: franchiseId,
        data_referencia: dataReferencia,
        detalhe: `${suspeito.total} linha(s) em vendas_itens, ${suspeito.distintos} origem_id distinto(s) (fator ${fator.toFixed(2)}).`,
      });
      if (insertError) throw new Error(insertError.message);
      alertasCriados.push(`${franchiseId} — ${dataReferencia}`);
    } catch (err) {
      const mensagem = err instanceof Error ? err.message : String(err);
      console.error(`Erro ao processar alerta de duplicidade ${chave}:`, mensagem);
      erros.push(`${chave}: ${mensagem}`);
    }
  }

  return NextResponse.json({ ok: true, alertas_criados: alertasCriados, erros, conferencia_itens_caixa: conferencia });
}
