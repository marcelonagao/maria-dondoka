import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getPerfilAutenticado } from '../../../../lib/server-auth';
import { LOJAS_DIRETAS, sincronizarLoja } from '../../../../lib/lojasDiretas';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
);

// Orçamento por loja. O plano Hobby da Vercel corta a função em 10s, e as 8 lojas rodam em
// paralelo — então cada uma tem ~7s antes de ser abortada. Loja que não responde a tempo
// não é falha: o script PHP continua rodando do lado dele e o dado entra pelo webhook
// alguns segundos depois. A resposta diferencia os dois casos pra UI não mentir.
const ORCAMENTO_MS = 7_000;

export async function POST(request: Request) {
  const perfil = await getPerfilAutenticado();
  if (!perfil) return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 401 });
  if (perfil.escopo !== 'todas_franquias') {
    return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 403 });
  }

  const origin = new URL(request.url).origin;

  const { data: franquias, error } = await supabaseAdmin
    .from('franchises')
    .select('id, name, sync_url')
    .eq('is_active', true);
  if (error) {
    console.error('Erro ao listar franquias para sincronizar:', error);
    return NextResponse.json({ error: 'ERRO_INTERNO' }, { status: 500 });
  }

  const tarefas = (franquias || []).map(async (franquia) => {
    const direta = LOJAS_DIRETAS.find((l) => l.franchiseId === franquia.id);

    if (direta) {
      try {
        const resultado = await sincronizarLoja(direta, origin);
        return { loja: franquia.name, status: 'sincronizada' as const, itens: resultado.itens };
      } catch (err: any) {
        console.error(`Erro ao sincronizar ${franquia.name}:`, err);
        return { loja: franquia.name, status: 'falhou' as const, detalhe: err?.message };
      }
    }

    if (!franquia.sync_url) {
      return { loja: franquia.name, status: 'sem_url' as const };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), ORCAMENTO_MS);
      const res = await fetch(franquia.sync_url, { signal: controller.signal });
      clearTimeout(timeoutId);
      return res.ok
        ? { loja: franquia.name, status: 'sincronizada' as const }
        : { loja: franquia.name, status: 'falhou' as const, detalhe: `HTTP ${res.status}` };
    } catch (err: any) {
      // Abort é o caso normal de loja lenta, não erro — o PHP segue rodando lá.
      if (err?.name === 'AbortError') {
        return { loja: franquia.name, status: 'em_andamento' as const };
      }
      console.error(`Erro ao disparar sync de ${franquia.name}:`, err);
      return { loja: franquia.name, status: 'falhou' as const, detalhe: 'Não foi possível contatar a loja.' };
    }
  });

  const resultados = (await Promise.allSettled(tarefas)).map((r) =>
    r.status === 'fulfilled' ? r.value : { loja: '?', status: 'falhou' as const }
  );

  return NextResponse.json({ ok: true, resultados });
}
