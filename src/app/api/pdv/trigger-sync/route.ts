import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getPerfilAutenticado } from '../../../../lib/server-auth';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
);

export async function POST() {
  const perfil = await getPerfilAutenticado();
  if (!perfil) return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 401 });

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
