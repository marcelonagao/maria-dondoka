import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export interface PerfilAutenticado {
  userId: string;
  franchiseId: string;
  role: string;
  telasPermitidas: string[];
  escopo: 'todas_franquias' | 'propria_franquia' | null;
  podeLancarDespesasOutrasFranquias: boolean;
}

export async function getPerfilAutenticado(): Promise<PerfilAutenticado | null> {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() { /* leitura apenas; refresh de sessão fica a cargo do middleware */ },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('franchise_id, role, roles(escopo, telas_permitidas, pode_lancar_despesas_outras_franquias)')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) return null;
  const papel = profile.roles as unknown as {
    escopo: 'todas_franquias' | 'propria_franquia';
    telas_permitidas: string[];
    pode_lancar_despesas_outras_franquias: boolean;
  } | null;

  return {
    userId: user.id,
    franchiseId: profile.franchise_id,
    role: profile.role,
    telasPermitidas: papel?.telas_permitidas || [],
    escopo: papel?.escopo || null,
    podeLancarDespesasOutrasFranquias: !!papel?.pode_lancar_despesas_outras_franquias,
  };
}
