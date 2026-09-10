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

interface Grupo {
  total: number;
  origens: Set<string>;
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

  const hoje = new Date();
  hoje.setUTCHours(0, 0, 0, 0);
  const seteDiasAtras = new Date(hoje);
  seteDiasAtras.setUTCDate(seteDiasAtras.getUTCDate() - 7);
  const desde = seteDiasAtras.toISOString().slice(0, 10);

  const { data: linhas, error } = await supabaseAdmin
    .from('vendas_itens')
    .select('franchise_id, data_venda, origem_id')
    .gte('data_venda', desde);
  if (error) {
    return NextResponse.json({ error: 'ERRO_INTERNO', detalhe: error.message }, { status: 500 });
  }

  const grupos = new Map<string, Grupo>();
  for (const linha of linhas || []) {
    const chave = `${linha.franchise_id}::${linha.data_venda}`;
    const grupo = grupos.get(chave) || { total: 0, origens: new Set<string>() };
    grupo.total += 1;
    if (linha.origem_id) grupo.origens.add(linha.origem_id);
    grupos.set(chave, grupo);
  }

  const alertasCriados: string[] = [];
  const erros: string[] = [];

  for (const [chave, grupo] of Array.from(grupos.entries())) {
    // Sem nenhum origem_id no grupo inteiro — dado anterior à correção (ou loja PHP ainda
    // sem origem_id), não dá pra avaliar duplicidade por esse método. Não é caso de alerta.
    if (grupo.origens.size === 0) continue;

    const fator = grupo.total / grupo.origens.size;
    if (fator <= 1.0) continue;

    const [franchiseId, dataReferencia] = chave.split('::');

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
        detalhe: `${grupo.total} linha(s) em vendas_itens, ${grupo.origens.size} origem_id distinto(s) (fator ${fator.toFixed(2)}).`,
      });
      if (insertError) throw new Error(insertError.message);
      alertasCriados.push(`${franchiseId} — ${dataReferencia}`);
    } catch (err) {
      const mensagem = err instanceof Error ? err.message : String(err);
      console.error(`Erro ao processar alerta de duplicidade ${chave}:`, mensagem);
      erros.push(`${chave}: ${mensagem}`);
    }
  }

  return NextResponse.json({ ok: true, alertas_criados: alertasCriados, erros });
}
