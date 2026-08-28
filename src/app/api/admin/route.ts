import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { randomBytes, createHash } from 'crypto';
import { z } from 'zod';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
);

// Confirma quem está pedindo, usando a sessão real do usuário (respeita RLS).
// Nunca confiar em franchise_id vindo do corpo da requisição.
async function getAdminProfile() {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() { /* somente leitura aqui, refresh de sessão fica a cargo do middleware */ },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('franchise_id, role')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile || profile.role !== 'admin') return null;
  return profile;
}

export async function GET() {
  const profile = await getAdminProfile();
  if (!profile) {
    return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from('pdv_devices')
    .select('id, device_label, is_active, last_sync_at, created_at')
    .eq('franchise_id', profile.franchise_id)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: 'ERRO_INTERNO' }, { status: 500 });
  }
  return NextResponse.json({ devices: data });
}

const CreateDeviceSchema = z.object({
  device_label: z.string().min(2, 'Nome muito curto').max(80),
});

export async function POST(request: Request) {
  const profile = await getAdminProfile();
  if (!profile) {
    return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 401 });
  }

  const parsed = CreateDeviceSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'DADOS_INVALIDOS', detalhe: parsed.error.flatten() }, { status: 400 });
  }

  const token = randomBytes(24).toString('hex');
  const secret = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');

  const { data, error } = await supabaseAdmin
    .from('pdv_devices')
    .insert({
      franchise_id: profile.franchise_id,
      device_label: parsed.data.device_label,
      token_hash: tokenHash,
      secret,
    })
    .select('id')
    .single();

  if (error) {
    return NextResponse.json({ error: 'ERRO_INTERNO' }, { status: 500 });
  }

  // Única vez que token/secret trafegam em texto puro para o cliente.
  return NextResponse.json({ id: data.id, token, secret });
}

const RevokeSchema = z.object({
  id: z.string().uuid(),
  is_active: z.boolean(),
});

export async function PATCH(request: Request) {
  const profile = await getAdminProfile();
  if (!profile) {
    return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 401 });
  }

  const parsed = RevokeSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'DADOS_INVALIDOS' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('pdv_devices')
    .update({ is_active: parsed.data.is_active })
    .eq('id', parsed.data.id)
    .eq('franchise_id', profile.franchise_id); // trava: só mexe em dispositivo da própria franquia

  if (error) {
    return NextResponse.json({ error: 'ERRO_INTERNO' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}