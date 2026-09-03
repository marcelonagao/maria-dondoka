'use client';

import { useEffect } from 'react';

export default function Home() {
  useEffect(() => {
    // E-mails de convite/redefinição de senha do Supabase caem aqui quando a Site URL
    // configurada no painel é o domínio raiz — o token vem no hash (#access_token=..., fluxo
    // antigo) ou numa query "?code=..." (fluxo PKCE, padrão do @supabase/ssr usado neste
    // projeto). Nenhum dos dois chega ao servidor de graça (query chega, mas o middleware
    // não trata token de auth) — preserva os dois formatos mandando pra tela que sabe
    // processá-los, em vez de simplesmente ir pro login e perder o token no caminho.
    const hash = window.location.hash;
    const temCode = new URL(window.location.href).searchParams.has('code');
    if (hash.includes('access_token')) {
      window.location.replace(`/definir-senha${hash}`);
    } else if (temCode) {
      window.location.replace(`/definir-senha${window.location.search}`);
    } else {
      window.location.replace('/login');
    }
  }, []);

  return null;
}
