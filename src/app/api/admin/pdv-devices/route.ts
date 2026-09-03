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
    .select('franchise_id, role, is_socio, pode_lancar_para_outras_franquias')
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
  franchise_id: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  const parsed = CreateDeviceSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'DADOS_INVALIDOS', detalhe: parsed.error.flatten() }, { status: 400 });
  }

  const profile = await getAdminProfile();
  if (!profile) return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 401 });

  // Fluxo de onboarding: Matriz cria o dispositivo em nome de uma franquia recém-criada,
  // que ela mesma não pertence — só permitido pra quem pode lançar/atuar por outras franquias.
  let franchiseId: string;
  if (parsed.data.franchise_id) {
    if (!profile.is_socio && !profile.pode_lancar_para_outras_franquias) {
      return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 403 });
    }
    franchiseId = parsed.data.franchise_id;
  } else {
    franchiseId = profile.franchise_id;
  }

  const token = randomBytes(24).toString('hex');
  const secret = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');

  const { data, error } = await supabaseAdmin
    .from('pdv_devices')
    .insert({
      franchise_id: franchiseId,
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

const PatchSchema = z.object({
  id: z.string().uuid(),
  is_active: z.boolean().optional(),
  device_label: z.string().min(2, 'Nome muito curto').max(80).optional(),
}).refine((data) => data.is_active !== undefined || data.device_label !== undefined, {
  message: 'Informe is_active ou device_label.',
});

export async function PATCH(request: Request) {
  const profile = await getAdminProfile();
  if (!profile) {
    return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 401 });
  }

  const parsed = PatchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'DADOS_INVALIDOS' }, { status: 400 });
  }

  const atualizacao: Record<string, unknown> = {};
  if (parsed.data.is_active !== undefined) atualizacao.is_active = parsed.data.is_active;
  if (parsed.data.device_label !== undefined) atualizacao.device_label = parsed.data.device_label;

  const { error } = await supabaseAdmin
    .from('pdv_devices')
    .update(atualizacao)
    .eq('id', parsed.data.id)
    .eq('franchise_id', profile.franchise_id); // trava: só mexe em dispositivo da própria franquia

  if (error) {
    return NextResponse.json({ error: 'ERRO_INTERNO' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

const DeleteSchema = z.object({
  id: z.string().uuid(),
});

export async function DELETE(request: Request) {
  const profile = await getAdminProfile();
  if (!profile) {
    return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 401 });
  }

  const parsed = DeleteSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'DADOS_INVALIDOS' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('pdv_devices')
    .delete()
    .eq('id', parsed.data.id)
    .eq('franchise_id', profile.franchise_id); // trava: só mexe em dispositivo da própria franquia

  if (error) {
    // 23503 = violação de FK — dispositivo já tem fechamentos/movimentações/vendas registradas.
    if (error.code === '23503') {
      return NextResponse.json({ error: 'EM_USO' }, { status: 409 });
    }
    return NextResponse.json({ error: 'ERRO_INTERNO' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}