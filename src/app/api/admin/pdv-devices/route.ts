import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomBytes, createHash } from 'crypto';
import { z } from 'zod';
import { getPerfilAutenticado } from '../../../../lib/server-auth';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
);

// Confirma quem está pedindo, usando a sessão real do usuário (respeita RLS).
// franchise_id vindo do client só é aceito depois de checado em resolverFranchiseId.
async function getAdminProfile() {
  const perfil = await getPerfilAutenticado();
  if (!perfil || perfil.role !== 'admin') return null;
  return {
    franchise_id: perfil.franchiseId,
    role: perfil.role,
    telasPermitidas: perfil.telasPermitidas,
    escopo: perfil.escopo,
  };
}

// franchise_id explícito só é aceito quando o pedido vier autorizado por um dos dois
// caminhos existentes: sócio (escopo todas_franquias, mesmo padrão do Dashboard/DRE) ou
// o fluxo de onboarding de franquia nova (telas_permitidas de franquias, já usado em
// franquias/route.ts). Nunca confia no valor do client sem essa checagem.
function resolverFranchiseId(
  profile: NonNullable<Awaited<ReturnType<typeof getAdminProfile>>>,
  franchiseIdSolicitado: string | null | undefined
): string | null {
  if (!franchiseIdSolicitado) return profile.franchise_id;
  const autorizado = profile.escopo === 'todas_franquias' || profile.telasPermitidas.includes('franquias');
  return autorizado ? franchiseIdSolicitado : null;
}

export async function GET(request: Request) {
  const profile = await getAdminProfile();
  if (!profile) {
    return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 401 });
  }

  const franchiseIdSolicitado = new URL(request.url).searchParams.get('franchise_id');
  const franchiseId = resolverFranchiseId(profile, franchiseIdSolicitado);
  if (!franchiseId) return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 403 });

  const { data, error } = await supabaseAdmin
    .from('pdv_devices')
    .select('id, device_label, is_active, last_sync_at, created_at')
    .eq('franchise_id', franchiseId)
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

  // franchise_id explícito cobre dois fluxos: onboarding (Matriz cria o dispositivo em
  // nome de franquia recém-criada, checado por acesso à tela /franquias) e sócio
  // gerenciando dispositivos de outra franquia pelo seletor em /configuracoes (checado
  // por escopo, mesmo padrão do Dashboard/DRE) — ver resolverFranchiseId.
  const franchiseId = resolverFranchiseId(profile, parsed.data.franchise_id);
  if (!franchiseId) return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 403 });

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
  franchise_id: z.string().uuid().optional(),
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

  const franchiseId = resolverFranchiseId(profile, parsed.data.franchise_id);
  if (!franchiseId) return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 403 });

  const atualizacao: Record<string, unknown> = {};
  if (parsed.data.is_active !== undefined) atualizacao.is_active = parsed.data.is_active;
  if (parsed.data.device_label !== undefined) atualizacao.device_label = parsed.data.device_label;

  const { error } = await supabaseAdmin
    .from('pdv_devices')
    .update(atualizacao)
    .eq('id', parsed.data.id)
    .eq('franchise_id', franchiseId); // trava: só mexe em dispositivo da franquia autorizada

  if (error) {
    return NextResponse.json({ error: 'ERRO_INTERNO' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

const DeleteSchema = z.object({
  id: z.string().uuid(),
  franchise_id: z.string().uuid().optional(),
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

  const franchiseId = resolverFranchiseId(profile, parsed.data.franchise_id);
  if (!franchiseId) return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 403 });

  const { error } = await supabaseAdmin
    .from('pdv_devices')
    .delete()
    .eq('id', parsed.data.id)
    .eq('franchise_id', franchiseId); // trava: só mexe em dispositivo da franquia autorizada

  if (error) {
    // 23503 = violação de FK — dispositivo já tem fechamentos/movimentações/vendas registradas.
    if (error.code === '23503') {
      return NextResponse.json({ error: 'EM_USO' }, { status: 409 });
    }
    return NextResponse.json({ error: 'ERRO_INTERNO' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}