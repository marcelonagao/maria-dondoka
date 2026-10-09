'use client';

import { useEffect } from 'react';

// Registra o service worker só no navegador e só em produção: em `npm run dev` ele atrapalharia
// o hot reload.
export default function RegistrarServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('Falha ao registrar o service worker:', err);
    });
  }, []);

  return null;
}
