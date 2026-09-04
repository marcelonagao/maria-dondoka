import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const ROTA_PARA_TELA: Record<string, string> = {
  '/dashboard': 'dashboard',
  '/tesouraria': 'tesouraria',
  '/vendas': 'vendas_pdv',
  '/produtos': 'produtos',
  '/dre': 'dre',
  '/dp': 'dp',
  '/configuracoes': 'configuracoes',
  '/franquias': 'franquias',
};

// Rota conhecida de cada tela — usada como destino quando o usuário tenta acessar uma
// tela sem permissão, mandando pra primeira tela que o papel dele realmente tem.
const TELA_PARA_ROTA: Record<string, string> = {
  dashboard: '/dashboard',
  tesouraria: '/tesouraria/pagar',
  vendas_pdv: '/vendas',
  produtos: '/produtos',
  dre: '/dre',
  dp: '/dp',
  configuracoes: '/configuracoes',
  franquias: '/franquias',
};

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: request.headers } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANTE: getUser() valida o token com o servidor Supabase.
  // Não trocar por getSession(), que só lê o cookie sem validar.
  const { data: { user } } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname.startsWith('/login');
  const isProtectedRoute =
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/tesouraria') ||
    pathname.startsWith('/vendas') ||
    pathname.startsWith('/configuracoes') ||
    pathname.startsWith('/consolidado') ||
    pathname.startsWith('/produtos') ||
    pathname.startsWith('/dre') ||
    pathname.startsWith('/dp') ||
    pathname.startsWith('/franquias') ||
    pathname.startsWith('/sem-acesso');

  if (!user && isProtectedRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  // Gate por tela: cada rota protegida exige que o papel do usuário tenha a tela
  // correspondente em telas_permitidas. Roda a cada request — dá pra otimizar depois
  // cacheando numa claim do JWT, não precisa resolver isso agora.
  if (user && isProtectedRoute) {
    const telaDaRota = Object.entries(ROTA_PARA_TELA).find(([prefixo]) => pathname.startsWith(prefixo))?.[1];

    if (telaDaRota) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('roles(telas_permitidas)')
        .eq('id', user.id)
        .maybeSingle();
      const papel = profile?.roles as unknown as { telas_permitidas: string[] } | null;
      const telasPermitidas = papel?.telas_permitidas || [];

      if (!telasPermitidas.includes(telaDaRota)) {
        const url = request.nextUrl.clone();
        // Papel sem nenhuma tela conhecida (ex: role_id ainda não atribuído) — manda pra
        // /sem-acesso em vez de /dashboard, que causaria loop (também estaria bloqueado).
        const primeiraTelaComRota = telasPermitidas.find((t) => TELA_PARA_ROTA[t]);
        url.pathname = primeiraTelaComRota ? TELA_PARA_ROTA[primeiraTelaComRota] : '/sem-acesso';
        return NextResponse.redirect(url);
      }
    }
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/pdv|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
