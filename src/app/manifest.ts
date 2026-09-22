import type { MetadataRoute } from 'next';

// Manifesto do app adicionado à tela inicial no Android. Sem ele, o Android escolhia o ícone
// por conta própria e o colocava sobre fundo branco. O iPhone não lê este arquivo — usa
// src/app/apple-touch-icon.png.
//
// display 'browser' mantém o comportamento de antes: o atalho abre no navegador, com barra de
// endereço. 'standalone' abriria como aplicativo em tela cheia — mudança de uso, não de ícone.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Maria Dondoka',
    short_name: 'Maria Dondoka',
    start_url: '/',
    display: 'browser',
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
