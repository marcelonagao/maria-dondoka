import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { FORMAS_PAGAMENTO } from '../../../../lib/formasPagamento';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
);

const RetiradaSchema = z.object({
  origem_id: z.string().min(1),
  valor: z.number().positive(),
  motivo: z.string().min(1),
  usuario: z.string().min(1),
  criado_em: z.string().optional(),
});

const FormaPagamentoValorSchema = z.object({
  usuario: z.string().min(1),
  forma_pagamento: z.enum(FORMAS_PAGAMENTO),
  valor: z.number().nonnegative(),
});

const VendasDiariasSchema = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  formas: z.array(FormaPagamentoValorSchema).min(1),
  retiradas: z.array(RetiradaSchema).default([]),
});

function sha256Hex(input: string) {
  return createHash('sha256').update(input).digest('hex');
}

function safeCompare(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();

  try {
    const pdvToken = request.headers.get('x-pdv-token');
    const signature = request.headers.get('x-pdv-signature');
    const timestamp = request.headers.get('x-pdv-timestamp');

    if (!pdvToken || !signature || !timestamp) {
      return NextResponse.json({ error: 'REQUISICAO_INCOMPLETA' }, { status: 401 });
    }

    const ts = Number(timestamp);
    if (!ts || Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
      return NextResponse.json({ error: 'TIMESTAMP_INVALIDO' }, { status: 401 });
    }

    const rawBody = await request.text();

    const { data: device, error: deviceError } = await supabaseAdmin
      .from('pdv_devices')
      .select('id, franchise_id, secret, is_active')
      .eq('token_hash', sha256Hex(pdvToken))
      .maybeSingle();

      if (deviceError || !device || !device.is_active) {
        console.error(`[pdv-sync:${requestId}] token não reconhecido`);
        return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 401 });
      }

    const expectedSignature = createHmac('sha256', device.secret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');

    if (!safeCompare(signature, expectedSignature)) {
      console.error(`[pdv-sync:${requestId}] assinatura inválida, franchise=${device.franchise_id}`);
      return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 401 });
    }

    const parsed = VendasDiariasSchema.safeParse(JSON.parse(rawBody));
    if (!parsed.success) {
      console.error(`[pdv-sync:${requestId}] payload inválido:`, parsed.error.flatten());
      return NextResponse.json({ error: 'PAYLOAD_INVALIDO' }, { status: 400 });
    }
    const vendas = parsed.data;

    // Substitui o acumulado do dia (não incrementa) — o PDV reporta o total
    // recalculado a cada ciclo, então reenviar o mesmo valor é inofensivo.
    const atualizadoEm = new Date().toISOString();
    const { error: upsertError } = await supabaseAdmin
      .from('vendas_diarias_formas_pagamento')
      .upsert(
        vendas.formas.map((f) => ({
          franchise_id: device.franchise_id,
          pdv_device_id: device.id,
          usuario: f.usuario,
          data_venda: vendas.data,
          forma_pagamento: f.forma_pagamento,
          valor: f.valor,
          atualizado_em: atualizadoEm,
        })),
        { onConflict: 'franchise_id, usuario, data_venda, forma_pagamento' }
      );

    if (upsertError) {
      console.error(`[pdv-sync:${requestId}] erro de gravação:`, upsertError.message);
      return NextResponse.json({ error: 'FALHA_INTERNA' }, { status: 500 });
    }

    // Retiradas vêm como eventos discretos do sistema de origem (não um total
    // recalculado como as vendas), então dedupe por origem_id — reenviar a
    // mesma retirada em ciclos futuros é ignorado silenciosamente.
    if (vendas.retiradas.length > 0) {
      const { error: retiradasError } = await supabaseAdmin
        .from('movimentacoes_caixa')
        .upsert(
          vendas.retiradas.map((r) => ({
            franchise_id: device.franchise_id,
            pdv_device_id: device.id,
            usuario: r.usuario,
            tipo: 'sangria',
            valor: r.valor,
            motivo: r.motivo,
            origem_id: r.origem_id,
            ...(r.criado_em ? { criado_em: r.criado_em } : {}),
          })),
          { onConflict: 'pdv_device_id, origem_id', ignoreDuplicates: true }
        );

      if (retiradasError) {
        console.error(`[pdv-sync:${requestId}] erro ao gravar retiradas:`, retiradasError.message);
      }
    }

    await supabaseAdmin
      .from('pdv_devices')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('id', device.id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[pdv-sync:${requestId}] erro não tratado:`, err);
    return NextResponse.json({ error: 'FALHA_INTERNA' }, { status: 500 });
  }
}
