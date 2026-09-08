import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getPerfilAutenticado } from '../../../../lib/server-auth';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
);

const ConciliarSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
});

export async function POST(request: Request) {
  const perfil = await getPerfilAutenticado();
  if (!perfil) return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 401 });

  const parsed = ConciliarSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'DADOS_INVALIDOS', detalhe: parsed.error.flatten() }, { status: 400 });
  }

  // Conciliação de cartão/pix é independente de fechamento de dinheiro (decisão de
  // escopo) — não seta fechamento_id, só quem/quando. franchise_id e conciliado_em is
  // null nas condições travam contra IDs de outra franquia ou já conciliados (idempotente
  // a um duplo clique, não sobrescreve o conciliador original).
  const { data, error } = await supabaseAdmin
    .from('vendas_transacoes_pagamento')
    .update({ conciliado_por: perfil.userId, conciliado_em: new Date().toISOString() })
    .in('id', parsed.data.ids)
    .eq('franchise_id', perfil.franchiseId)
    .is('conciliado_em', null)
    .select('id');

  if (error) return NextResponse.json({ error: 'ERRO_INTERNO', detalhe: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, conciliadas: data?.length || 0 });
}
