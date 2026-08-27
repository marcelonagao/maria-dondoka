'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      // Se o login for bem-sucedido, manda para o dashboard
      router.push('/dashboard');
    } catch (err: any) {
      console.error('Erro de login:', err.message);
      setError('E-mail ou senha inválidos. Verifique suas credenciais.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl overflow-hidden border border-stone-200">
        <div className="p-8 text-center bg-stone-900 border-b border-stone-800">
          <h1 className="text-3xl font-serif tracking-tight text-white">
            Maria<span className="text-amber-400">Dondoka</span>
          </h1>
          <p className="text-stone-400 text-sm mt-2">
            Gestão inteligente multi-franquias
          </p>
        </div>

        <div className="p-8">
          <h2 className="text-xl font-semibold text-stone-800 mb-6 text-center">
            Acesso ao Painel da Franquia
          </h2>

          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100 text-center">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">
                E-mail
              </label>
              <input
                type="email"
                required
                className="w-full px-4 py-3 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none transition-all"
                placeholder="admin@loja1.com.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">
                Senha
              </label>
              <input
                type="password"
                required
                className="w-full px-4 py-3 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none transition-all"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 px-4 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-medium transition-colors disabled:opacity-70 flex justify-center items-center mt-2"
            >
              {isLoading ? 'Autenticando...' : 'Entrar no Sistema'}
            </button>
          </form>
        </div>
        
        <div className="p-4 bg-stone-50 border-t border-stone-100 text-center">
          <p className="text-xs text-stone-500">
            &copy; 2026 Maria Dondoka. Todos os direitos reservados.
          </p>
        </div>
      </div>
    </div>
  );
}