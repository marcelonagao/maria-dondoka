'use client';

import { useEffect } from 'react';

export default function Home() {
  useEffect(() => {
    // E-mails de convite/redefinição de senha do Supabase caem aqui quando a Site URL
    // configurada no painel é o domínio raiz — o token vem no hash (#access_token=...),
    // que nunca chega ao servidor. Preserva o hash mandando pra tela que sabe processá-lo,
    // em vez de simplesmente ir pro login e perder o token no caminho.
    const hash = window.location.hash;
    if (hash.includes('access_token')) {
      window.location.replace(`/definir-senha${hash}`);
    } else {
      window.location.replace('/login');
    }
  }, []);

  return null;
}
