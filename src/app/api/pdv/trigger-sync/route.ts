import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getPerfilAutenticado } from '../../../../lib/server-auth';
import { LOJAS_DIRETAS, sincronizarLoja } from '../../../../lib/lojasDiretas';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
);

export async function POST(request: Request) {
  const perfil = await getPerfilAutenticado();
  if (!perfil) return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 401 });

  // Loja1/Loja4 não têm script PHP nem sync_url — sincronizam direto via mysql2, mesma
  // lógica do cron (src/lib/lojasDiretas.ts), só disparada na hora em vez de agendada.
  const lojaDireta = LOJAS_DIRETAS.find((l) => l.franchiseId === perfil.franchiseId);
  if (lojaDireta) {
    try {
      const origin = new URL(request.url).origin;
      const resultado = await sincronizarLoja(lojaDireta, origin);
      const resposta = `Sincronizado: ${resultado.formas} forma(s) de pagamento, ${resultado.retiradas} retirada(s), ${resultado.itens} item(ns) de venda (${resultado.data}).`;
      return NextResponse.json({ ok: true, status: 200, resposta });
    } catch (err: any) {
      console.error('Erro ao sincronizar loja direta:', err);
      return NextResponse.json({ error: 'FALHA_AO_SINCRONIZAR', detalhe: err?.message || 'Não foi possível sincronizar agora.' }, { status: 502 });
    }
  }

  const { data: franquia, error } = await supabaseAdmin
    .from('franchises')
    .select('sync_url')
    .eq('id', perfil.franchiseId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: 'ERRO_INTERNO' }, { status: 500 });
  if (!franquia?.sync_url) {
    return NextResponse.json({ error: 'URL_NAO_CONFIGURADA', detalhe: 'Configure a URL de sincronização em Configurações.' }, { status: 400 });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20_000);

    const res = await fetch(franquia.sync_url, { signal: controller.signal });
    clearTimeout(timeoutId);

    const texto = await res.text();
    return NextResponse.json({ ok: res.ok, status: res.status, resposta: texto });
  } catch (err: any) {
    console.error('Erro ao disparar sincronização do PDV:', err);
    const motivo = err?.name === 'AbortError' ? 'A loja não respondeu a tempo.' : 'Não foi possível contatar a URL configurada.';
    return NextResponse.json({ error: 'FALHA_AO_SINCRONIZAR', detalhe: motivo }, { status: 502 });
  }
}
