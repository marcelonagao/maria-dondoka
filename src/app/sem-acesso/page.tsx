'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';

export default function SemAcessoPage() {
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      router.push('/login');
    } catch (error) {
      console.error('Erro ao sair:', error);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl overflow-hidden border border-stone-200">
        <div className="p-8 text-center bg-stone-900 border-b border-stone-800">
          <h1 className="text-3xl font-serif tracking-tight text-white">
            Maria<span className="text-amber-400">Dondoka</span>
          </h1>
        </div>

        <div className="p-8 text-center space-y-4">
          <h2 className="text-xl font-semibold text-stone-800">Sem acesso</h2>
          <p className="text-stone-500 text-sm">
            Seu usuário ainda não tem um papel atribuído no sistema. Fale com o
            administrador da sua franquia para liberar seu acesso.
          </p>
          <button
            onClick={handleLogout}
            className="mt-4 w-full py-3 px-4 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg font-medium transition-colors"
          >
            Sair do sistema
          </button>
        </div>
      </div>
    </div>
  );
}
