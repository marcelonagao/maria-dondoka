import type { MetadataRoute } from 'next';

// Manifesto do app instalável (PWA). Sem ele, o Android escolhia o ícone por conta própria e o
// colocava sobre fundo branco. O iPhone não lê este arquivo — usa src/app/apple-touch-icon.png
// e as metas appleWebApp do layout.
//
// display 'standalone' (09/10/2026, pedido do usuário): abre como aplicativo em tela cheia,
// sem barra de endereço. Antes era 'browser'. Junto com o service worker em public/sw.js,
// é o que torna o app instalável.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Maria Dondoka',
    short_name: 'Maria Dondoka',
    description: 'Gestão inteligente e multi-franquias',
    lang: 'pt-BR',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#000000',
    theme_color: '#000000',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Com margem: o Android recorta este num círculo, e o anel da logo encosta na borda
      // da versão 'any'.
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
