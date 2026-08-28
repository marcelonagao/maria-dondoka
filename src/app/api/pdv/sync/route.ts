import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { z } from 'zod';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
);

const FechamentoSchema = z.object({
  id: z.string().min(1),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dinheiro: z.number().nonnegative().default(0),
  cartao: z.number().nonnegative().default(0),
  pix: z.number().nonnegative().default(0),
  esperado: z.number().nonnegative().default(0),
  contado: z.number().nonnegative().default(0),
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
      .select('franchise_id, secret, is_active')
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

    const parsed = FechamentoSchema.safeParse(JSON.parse(rawBody));
    if (!parsed.success) {
      console.error(`[pdv-sync:${requestId}]