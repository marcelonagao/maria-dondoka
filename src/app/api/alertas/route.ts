import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getPerfilAutenticado } from '../../../lib/server-auth';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
);

export async function GET() {
  const perfil = await getPerfilAutenticado();
  if (!perfil) return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 401 });

  // Alertas de sistema (ex: duplicidade) são visão de dono do negócio, mesmo padrão de
  // escopo do Dashboard/DRE — quem não vê todas as franquias não precisa ver isso.
  if (perfil.escopo !== 'todas_franquias') {
    return NextResponse.json({ alertas: [] });
  }

  const { data: alertas, error } = await supabaseAdmin
    .from('alertas_sistema')
    .select('id, tipo, data_referencia, detalhe, criado_em, franchises(name)')
    .eq('resolvido', false)
    .order('criado_em', { ascending: false });

  if (error) return NextResponse.json({ error: 'ERRO_INTERNO', detalhe: error.message }, { status: 500 });

  return NextResponse.json({
    alertas: (alertas || []).map((a: any) => ({
      id: a.id,
      tipo: a.tipo,
      franquia_nome: a.franchises?.name || null,
      data_referencia: a.data_referencia,
      detalhe: a.detalhe,
      criado_em: a.criado_em,
    })),
  });
}
