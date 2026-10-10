import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
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

const ResolverAlertaSchema = z.object({
  id: z.union([z.string().min(1), z.number()]),
});

// Marca um alerta como resolvido. Só mexe em `resolvido`: quem confere o dado (DRE, caixa) é
// o gestor, e o alerta some da tela mas continua na tabela para consulta.
export async function PATCH(request: Request) {
  const perfil = await getPerfilAutenticado();
  if (!perfil) return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 401 });

  // Mesmo escopo da leitura acima: quem não vê os alertas também não os resolve.
  if (perfil.escopo !== 'todas_franquias') {
    return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 403 });
  }

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: 'DADOS_INVALIDOS' }, { status: 400 });
  }
  const parsed = ResolverAlertaSchema.safeParse(corpo);
  if (!parsed.success) {
    return NextResponse.json({ error: 'DADOS_INVALIDOS', detalhe: parsed.error.flatten() }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('alertas_sistema')
    .update({ resolvido: true })
    .eq('id', parsed.data.id)
    .eq('resolvido', false)
    .select('id');

  if (error) {
    console.error('Falha ao resolver alerta:', error.message, { alertaId: parsed.data.id });
    return NextResponse.json({ error: 'ERRO_INTERNO', detalhe: error.message }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'ALERTA_NAO_ENCONTRADO' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
