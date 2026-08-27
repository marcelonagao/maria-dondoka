'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase'; // Se continuar dando erro de import, mude para '../../../lib/supabase'

export default function LoginPage() {
const [email, setEmail] = useState('');
const [password, setPassword] = useState('');
const [loading, setLoading] = useState(false);
const [error, setError] = useState<string | null>(null);
const [success, setSuccess] = useState<string | null>(null);
const router = useRouter();

const handleLogin = async (e: React.FormEvent) => {
e.preventDefault();
setLoading(true);
setError(null);
setSuccess(null);

try {
  const { data, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError) {
    throw signInError;
  }

  if (data.user) {
    setSuccess('Login realizado com sucesso! Redirecionando...');
    setTimeout(() => {
      router.push('/dashboard'); 
    }, 1500);
  }
} catch (error: unknown) {
  // Tratamento seguro para TypeScript
  const err = error as Error;
  setError(err.message || 'Erro ao realizar login. Verifique suas credenciais.');
} finally {
  setLoading(false);
}


};

return (


  {/* Container Principal */}
  <div className="flex w-full max-w-4xl bg-white rounded-3xl shadow-2xl overflow-hidden min-h-[500px]">
    
    {/* Lado Esquerdo - Imagem e Branding (Oculto em telas pequenas) */}
    <div className="hidden md:flex flex-col justify-between w-1/2 bg-stone-900 text-stone-100 p-12 relative overflow-hidden">
      
      {/* Fundo Decorativo usando Style inline (Mais seguro no React) */}
      <div 
        className="absolute inset-0 opacity-20 bg-cover bg-center mix-blend-overlay"
        style={{ backgroundImage: "url('https://images.unsplash.com/photo-1594035910387-fea47794261f?q=80&w=1200&auto=format&fit=crop')" }}
      ></div>
      <div className="absolute inset-0 bg-stone-900/60"></div>
      
      <div className="relative z-10">
        <h1 className="text-3xl font-serif tracking-tight">
          Maria<span className="text-amber-400">Dondoka</span>
        </h1>
        <p className="mt-4 text-sm text-stone-400 max-w-xs">
          Gestão inteligente e multi-franquias para a sua rede.
        </p>
      </div>
      
      <div className="relative z-10">
        <p className="text-xs text-stone-500">
          &copy; 2026 MariaDondoka. Todos os direitos reservados.
        </p>
      </div>
    </div>

    {/* Lado Direito - Formulário */}
    <div className="w-full md:w-1/2 p-8 md:p-12 flex flex-col justify-center bg-white">
      <div className="max-w-md w-full mx-auto">
        <h2 className="text-2xl font-bold mb-2 text-stone-800">Bem-vindo de volta</h2>
        <p className="text-stone-500 text-sm mb-8">Insira suas credenciais para acessar o painel.</p>

        {/* Alertas de Erro/Sucesso */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-sm rounded-r-md">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 p-3 bg-green-50 border-l-4 border-green-500 text-green-700 text-sm rounded-r-md">
            {success}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1" htmlFor="email">
              E-mail Profissional
            </label>
            <input
              id="email"
              type="email"
              required
              placeholder="gerente@franquia.com.br"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-stone-200 focus:ring-2 focus:ring-amber-400 focus:border-amber-400 transition-colors bg-stone-50 text-stone-800 outline-none"
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="block text-sm font-medium text-stone-700" htmlFor="password">
                Senha
              </label>
              <a href="/recuperar-senha" className="text-xs text-amber-600 hover:text-amber-700 font-medium transition-colors">
                Esqueceu a senha?
              </a>
            </div>
            <input
              id="password"
              type="password"
              required
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-stone-200 focus:ring-2 focus:ring-amber-400 focus:border-amber-400 transition-colors bg-stone-50 text-stone-800 outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-stone-900 hover:bg-stone-800 text-white font-medium py-3 px-4 rounded-lg transition-all duration-200 flex justify-center items-center mt-6 disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {loading ? (
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              'Entrar no Sistema'
            )}
          </button>
        </form>

        <div className="mt-8 text-center">
          <p className="text-xs text-stone-500">
            Acesso restrito a colaboradores autorizados.
          </p>
        </div>
      </div>
    </div>
  </div>
</div>


);
}