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

const ConferenciaSchema = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  forma_pagamento: z.enum(FORMAS_PAGAMENTO),
  valor_comprovante: z.number(),
});

export async function POST(request: Request) {
  const perfil = await getPerfilAutenticado();
  if (!perfil) return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 401 });

  const parsed = ConferenciaSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'DADOS_INVALIDOS', detalhe: parsed.error.flatten() }, { status: 400 });
  }
  const { data, forma_pagamento, valor_comprovante } = parsed.data;

  // Recalcula o esperado no servidor, no momento do envio — nunca confia em valor vindo do
  // cliente (mesmo padrão de /api/fechamentos/contagem). É o bruto agregado da forma no
  // dia, todos os usuários — mesma pergunta que o resumo do topo de /vendas responde.
  const { data: linhas, error: linhasError } = await supabaseAdmin
    .from('vendas_diarias_formas_pagamento')
    .select('valor')
    .eq('franchise_id', perfil.franchiseId)
    .eq('data_venda', data)
    .eq('forma_pagamento', forma_pagamento);
  if (linhasError) return NextResponse.json({ error: 'ERRO_INTERNO', detalhe: linhasError.message }, { status: 500 });

  const valorEsperado = (linhas || []).reduce((acc, l) => acc + Number(l.valor), 0);
  const diferenca = valor_comprovante - valorEsperado;

  const { error } = await supabaseAdmin.from('conferencia_maquininha').insert({
    franchise_id: perfil.franchiseId,
    data,
    forma_pagamento,
    valor_esperado: valorEsperado,
    valor_comprovante,
    diferenca,
    conferido_por: perfil.userId,
  });
  if (error) return NextResponse.json({ error: 'ERRO_INTERNO', detalhe: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, valor_esperado: valorEsperado, diferenca });
}
