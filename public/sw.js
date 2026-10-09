// Service worker do app instalável.
//
// De propósito NÃO guarda páginas nem respostas de API: o sistema é multi-franquia e cada
// resposta traz dado financeiro de um tenant. Cache aqui poderia mostrar a tela de uma
// franquia/usuário a outro no mesmo aparelho, e dado de venda ficaria velho sem aviso.
// O único conteúdo guardado é a página estática de "sem conexão".
const CACHE = 'maria-dondoka-offline-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE_URL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((chaves) => Promise.all(chaves.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Só navegação de página cai no fallback; todo o resto (API, _next, Supabase) vai direto à rede.
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(OFFLINE_URL))
  );
});
