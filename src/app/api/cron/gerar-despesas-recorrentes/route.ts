import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'crypto';

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

interface DespesaRecorrente {
  id: string;
  franchise_id: string;
  descricao: string;
  plano_conta_id: string;
  fornecedor_id: string | null;
  valor_referencia: number;
  dia_vencimento: number;
  frequencia: 'mensal' | 'trimestral' | 'semestral' | 'anual';
  mes_referencia: number | null;
  ultima_geracao_periodo: string | null;
}

function mesesPorFrequencia(freq: string): number {
  const mapa: Record<string, number> = { mensal: 1, trimestral: 3, semestral: 6, anual: 12 };
  return mapa[freq] || 1;
}

// Pra mensal, o mês-base é o mês corrente; pra trimestral/semestral/anual, é o
// mes_referencia cadastrado (ex: IPVA anual vencendo sempre em janeiro = mes_referencia 1).
// Anda em blocos de N meses a partir daí até achar a primeira ocorrência >= hoje — funciona
// igual pras 4 frequências, sem precisar de lógica separada por caso.
function calcularProximoVencimento(r: DespesaRecorrente, hoje: Date): string {
  const passo = mesesPorFrequencia(r.frequencia);
  const mesBase = r.frequencia === 'mensal' ? hoje.getUTCMonth() + 1 : (r.mes_referencia || 1);
  let candidato = new Date(Date.UTC(hoje.getUTCFullYear(), mesBase - 1, r.dia_vencimento));
  while (candidato < hoje) {
    candidato = new Date(Date.UTC(candidato.getUTCFullYear(), candidato.getUTCMonth() + passo, r.dia_vencimento));
  }
  return candidato.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') || '';
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeCompare(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 401 });
  }

  const hoje = new Date();
  hoje.setUTCHours(0, 0, 0, 0);
  const daquiA2Dias = new Date(hoje);
  daquiA2Dias.setUTCDate(daquiA2Dias.getUTCDate() + 2);

  const { data: recorrentes, error } = await supabaseAdmin
    .from('despesas_recorrentes')
    .select('*')
    .eq('is_active', true);

  if (error) {
    return NextResponse.json({ error: 'ERRO_INTERNO', detalhe: error.message }, { status: 500 });
  }

  const gerados: string[] = [];
  const erros: string[] = [];

  for (const r of (recorrentes || []) as DespesaRecorrente[]) {
    try {
      const proximoVencimento = calcularProximoVencimento(r, hoje);

      // Idempotência: se a última geração já cobriu esse vencimento, ou ainda não entrou
      // na janela de 2 dias antes, não faz nada — permite rodar o cron mais de uma vez no
      // mesmo dia sem duplicar lançamento.
      if (proximoVencimento === r.ultima_geracao_periodo) continue;
      if (new Date(`${proximoVencimento}T00:00:00Z`) > daquiA2Dias) continue;

      // Herda o valor do último lançamento gerado por essa recorrência; fallback pro valor
      // de referência cadastrado só na primeira geração (ainda não existe lançamento anterior).
      const { data: ultimoLancamento } = await supabaseAdmin
        .from('accounts_payable')
        .select('amount')
        .eq('despesa_recorrente_id', r.id)
        .order('due_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      const valor = ultimoLancamento?.amount ?? r.valor_referencia;

      const { error: insertError } = await supabaseAdmin.from('accounts_payable').insert({
        description: r.descricao,
        plano_conta_id: r.plano_conta_id,
        fornecedor_id: r.fornecedor_id,
        due_date: proximoVencimento,
        amount: valor,
        status: 'pendente',
        franchise_id: r.franchise_id,
        despesa_recorrente_id: r.id,
      });
      if (insertError) throw new Error(insertError.message);

      const { error: updateError } = await supabaseAdmin
        .from('despesas_recorrentes')
        .update({ ultima_geracao_periodo: proximoVencimento })
        .eq('id', r.id);
      if (updateError) throw new Error(updateError.message);

      gerados.push(`${r.descricao} (${proximoVencimento})`);
    } catch (err) {
      const mensagem = err instanceof Error ? err.message : String(err);
      console.error(`Erro ao gerar recorrente ${r.id}:`, mensagem);
      erros.push(`${r.descricao}: ${mensagem}`);
    }
  }

  return NextResponse.json({ ok: true, gerados, erros });
}
