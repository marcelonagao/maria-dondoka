'use client';

import React, { useState } from 'react';
// Substitua o import abaixo pelo caminho correto do seu arquivo Supabase local
// import { supabase } from '@/lib/supabase';
import { createClient } from '@supabase/supabase-js';

// Cliente instanciado diretamente aqui para garantir que o StackBlitz não falhe caso o import falhe
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      setSuccessMsg('Login realizado com sucesso! Redirecionando...');
      // Lógica futura de redirecionamento: router.push('/dashboard')
    } catch (error: unknown) {
      // Tipagem segura do TypeScript para o catch
      if (error instanceof Error) {
        setErrorMsg(error.message);
      } else {
        setErrorMsg('Ocorreu um erro inesperado ao fazer login.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-100 flex items-center justify-center p-4 font-sans">
      <div className="flex w-full max-w-4xl bg-white rounded-3xl shadow-2xl overflow-hidden min-h-[500px]">
        
        {/* Lado Esquerdo - Branding Oculto em Mobile */}
        <div className="hidden md:flex flex-col justify-between w-1/2 bg-stone-900 text-stone-100 p-12 relative">
          {/* Fundo Decorativo */}
          <div 
            className="absolute inset-0 opacity-20 bg-cover bg-center"
            style={{ backgroundImage: "url('https://images.unsplash.com/photo-1594035910387-bea474f40f67?q=80&w=1000&auto=format&fit=crop')" }}
          ></div>
          <div className="absolute inset-0 bg-stone-900/60"></div>
          
          <div className="relative z-10">
            <h1 className="text-3xl font-serif tracking-tight">Maria<span className="text-amber-400">Dondoka</span></h1>
            <p className="mt-4 text-sm text-stone-400 max-w-xs">
              Gestão inteligente e multi-franquias para a sua rede.
            </p>
          </div>
          
          <div className="relative z-10 text-xs text-stone-500">
            &copy; {new Date().getFullYear()} Maria Dondoka. Todos os direitos reservados.
          </div>
        </div>

        {/* Lado Direito - Formulário */}
        <div className="w-full md:w-1/2 p-8 md:p-12 flex flex-col justify-center">
          <div className="max-w-sm w-full mx-auto">
            <h2 className="text-2xl font-semibold text-stone-800 mb-2">Acesse sua conta</h2>
            <p className="text-sm text-stone-500 mb-8">Insira suas credenciais para acessar o painel da franquia.</p>

            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1" htmlFor="email">
                  E-mail
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  disabled={loading}
                  className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 focus:border-amber-400 outline-none transition-all disabled:opacity-50 disabled:bg-stone-100 text-stone-800"
                  placeholder="admin@loja1.com.br"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1" htmlFor="password">
                  Senha
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  disabled={loading}
                  className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 focus:border-amber-400 outline-none transition-all disabled:opacity-50 disabled:bg-stone-100 text-stone-800"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="flex items-center text-sm text-stone-600">
                  <input type="checkbox" className="mr-2 rounded text-amber-500 focus:ring-amber-400" />
                  Lembrar de mim
                </label>
                <a href="/recuperar-senha" className="text-sm text-amber-600 hover:text-amber-700 font-medium transition-colors">
                  Esqueceu a senha?
                </a>
              </div>

              {/* Acessibilidade: role="alert" para leitores de tela */}
              {errorMsg && (
                <div role="alert" className="p-3 text-sm text-red-600 bg-red-50 rounded-lg border border-red-100">
                  {errorMsg}
                </div>
              )}
              
              {successMsg && (
                <div role="alert" className="p-3 text-sm text-green-600 bg-green-50 rounded-lg border border-green-100">
                  {successMsg}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-stone-900 hover:bg-stone-800 text-white font-medium py-2.5 rounded-lg transition-colors flex justify-center items-center disabled:opacity-70"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Autenticando...
                  </span>
                ) : (
                  'Entrar no Sistema'
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}