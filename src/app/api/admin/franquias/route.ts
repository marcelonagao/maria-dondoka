import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getPerfilAutenticado } from '../../../../lib/server-auth';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
);

const CriarFranquiaSchema = z.object({
  nome: z.string().min(2),
  email_admin: z.string().email(),
});

export async function POST(request: Request) {
  const perfil = await getPerfilAutenticado();
  if (!perfil) return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 401 });

  if (!perfil.telasPermitidas.includes('franquias')) {
    return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 403 });
  }

  const parsed = CriarFranquiaSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'DADOS_INVALIDOS', detalhe: parsed.error.flatten() }, { status: 400 });
  }
  const { nome, email_admin } = parsed.data;

  const { data: franquia, error: franquiaError } = await supabaseAdmin
    .from('franchises')
    .insert({ name: nome })
    .select('id')
    .single();
  if (franquiaError) {
    return NextResponse.json({ error: 'ERRO_CRIAR_FRANQUIA', detalhe: franquiaError.message }, { status: 500 });
  }

  const redirectTo = `${new URL(request.url).origin}/definir-senha`;
  const { data: convite, error: conviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email_admin, { redirectTo });
  if (conviteError || !convite.user) {
    // Reverte a franquia se o convite falhar, pra não deixar registro órfão.
    const { error: rollbackError } = await supabaseAdmin.from('franchises').delete().eq('id', franquia.id);
    if (rollbackError) {
      console.error('Falha ao reverter franquia após convite falhar:', rollbackError, { franchiseId: franquia.id });
    }
    return NextResponse.json({ error: 'ERRO_CONVIDAR_ADMIN', detalhe: conviteError?.message }, { status: 500 });
  }

  const { error: profileError } = await supabaseAdmin
    .from('profiles')
    .insert({ id: convite.user.id, franchise_id: franquia.id, role: 'admin' });
  if (profileError) {
    // Reverte franquia e usuário já convidado — sem perfil ele não conseguiria logar
    // mesmo assim, então não faz sentido deixar nenhum dos dois pra trás.
    const [{ error: rollbackFranquiaError }, { error: rollbackUserError }] = await Promise.all([
      supabaseAdmin.from('franchises').delete().eq('id', franquia.id),
      supabaseAdmin.auth.admin.deleteUser(convite.user.id),
    ]);
    if (rollbackFranquiaError) {
      console.error('Falha ao reverter franquia após erro ao vincular perfil:', rollbackFranquiaError, { franchiseId: franquia.id });
    }
    if (rollbackUserError) {
      console.error('Falha ao reverter usuário convidado após erro ao vincular perfil:', rollbackUserError, { userId: convite.user.id });
    }
    return NextResponse.json({ error: 'ERRO_VINCULAR_PERFIL', detalhe: profileError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, franchise_id: franquia.id });
}