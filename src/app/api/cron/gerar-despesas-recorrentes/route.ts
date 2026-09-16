import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'crypto';
import { calcularProximoVencimento } from '../../../../lib/recorrencia';

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

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') || '';
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeCompare(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 401 });
  }

  const hoje = new Date();
  hoje.setUTCHours(0, 0, 0, 0);
  // Antecedência da geração. Com 2 dias, o aluguel de outubro só virava conta a pagar no fim
  // de setembro: quem paga não enxergava o compromisso, ele existia apenas na projeção do
  // fluxo de caixa. Com 30, a recorrência fica materializada com cerca de um mês de folga.
  //
  // Não gera duas ocorrências de enfiada: ultima_geracao_periodo guarda o vencimento gerado e
  // calcularProximoVencimento devolve esse mesmo vencimento enquanto ele não passar, então o
  // teto continua sendo uma ocorrência à frente por recorrência.
  const DIAS_ANTECEDENCIA = 30;
  const limiteGeracao = new Date(hoje);
  limiteGeracao.setUTCDate(limiteGeracao.getUTCDate() + DIAS_ANTECEDENCIA);

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

      // Idempotência: se a última geração já cobriu esse vencimento, ou ele ainda está além
      // da janela de antecedência, não faz nada — permite rodar o cron mais de uma vez no
      // mesmo dia sem duplicar lançamento.
      if (proximoVencimento === r.ultima_geracao_periodo) continue;
      if (new Date(`${proximoVencimento}T00:00:00Z`) > limiteGeracao) continue;

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
