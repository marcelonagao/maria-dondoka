import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export interface PerfilAutenticado {
  userId: string;
  franchiseId: string;
  role: string;
  isSocio: boolean;
  podeLancarParaOutras: boolean;
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
    .select('franchise_id, role, is_socio, pode_lancar_para_outras_franquias')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) return null;
  return {
    userId: user.id,
    franchiseId: profile.franchise_id,
    role: profile.role,
    isSocio: !!profile.is_socio,
    podeLancarParaOutras: !!profile.pode_lancar_para_outras_franquias,
  };
}