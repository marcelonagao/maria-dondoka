import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getPerfilAutenticado } from '../../../../lib/server-auth';
import { FORMAS_PAGAMENTO } from '../../../../lib/formasPagamento';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
);

// Uma linha por fita (comprovante físico) — pode haver mais de uma maquininha/caixa no
// mesmo dia/forma. Diferença é calculada em runtime no GET (soma de todas as fitas),
// não guardada aqui, pra não precisar de agregado sobrescrito.
const CriarSchema = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  forma_pagamento: z.enum(FORMAS_PAGAMENTO),
  rotulo: z.string().trim().max(80).optional(),
  valor_comprovante: z.number(),
});

export async function POST(request: Request) {
  const perfil = await getPerfilAutenticado();
  if (!perfil) return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 401 });

  const parsed = CriarSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'DADOS_INVALIDOS', detalhe: parsed.error.flatten() }, { status: 400 });
  }
  const { data, forma_pagamento, rotulo, valor_comprovante } = parsed.data;

  const { data: nova, error } = await supabaseAdmin
    .from('conferencia_maquininha')
    .insert({
      franchise_id: perfil.franchiseId,
      data,
      forma_pagamento,
      rotulo: rotulo || null,
      valor_comprovante,
      conferido_por: perfil.userId,
    })
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: 'ERRO_INTERNO', detalhe: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, id: nova.id });
}

const EditarSchema = z.object({
  id: z.string().uuid(),
  rotulo: z.string().trim().max(80).optional(),
  valor_comprovante: z.number(),
});

export async function PATCH(request: Request) {
  const perfil = await getPerfilAutenticado();
  if (!perfil) return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 401 });

  const parsed = EditarSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'DADOS_INVALIDOS', detalhe: parsed.error.flatten() }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('conferencia_maquininha')
    .update({ rotulo: parsed.data.rotulo || null, valor_comprovante: parsed.data.valor_comprovante })
    .eq('id', parsed.data.id)
    .eq('franchise_id', perfil.franchiseId); // trava: só edita fita da própria franquia

  if (error) return NextResponse.json({ error: 'ERRO_INTERNO', detalhe: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

const ExcluirSchema = z.object({
  id: z.string().uuid(),
});

export async function DELETE(request: Request) {
  const perfil = await getPerfilAutenticado();
  if (!perfil) return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 401 });

  const parsed = ExcluirSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'DADOS_INVALIDOS', detalhe: parsed.error.flatten() }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('conferencia_maquininha')
    .delete()
    .eq('id', parsed.data.id)
    .eq('franchise_id', perfil.franchiseId); // trava: só exclui fita da própria franquia

  if (error) return NextResponse.json({ error: 'ERRO_INTERNO', detalhe: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
