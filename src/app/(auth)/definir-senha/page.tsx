'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';

export default function DefinirSenhaPage() {
  const [senha, setSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessaoValida, setSessaoValida] = useState<boolean | null>(null); // null = ainda verificando
  const router = useRouter();

  useEffect(() => {
    // @supabase/ssr (usado neste projeto pro middleware baseado em cookies) configura o
    // client com flowType 'pkce' por padrão — com isso, a detecção automática de sessão
    // via hash da URL (#access_token=..., formato que o Supabase Auth ainda usa pra
    // convite/recuperação de senha neste projeto) fica desligada, e o client nunca
    // estabelece sessão sozinho. Por isso lê os tokens manualmente e chama setSession
    // explicitamente, cobrindo os dois formatos possíveis (hash antigo e PKCE/?code=).
    async function verificar() {
      const hashParams = new URLSearchParams(window.location.hash.slice(1));
      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');
      const code = new URL(window.location.href).searchParams.get('code');

      if (accessToken && refreshToken) {
        const { data, error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (data.session) { setSessaoValida(true); return; }
        if (error) console.error('Erro ao estabelecer sessão (hash):', error.message);
      } else if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (data.session) { setSessaoValida(true); return; }
        if (error) console.error('Erro ao trocar código por sessão:', error.message);
      }

      // Fallback: sessão já existente (ex: usuário recarregou a página depois de já ter
      // processado o link uma vez).
      const { data } = await supabase.auth.getSession();
      setSessaoValida(!!data.session);
    }

    verificar();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (senha.length < 6) {
      setError('A senha precisa ter pelo menos 6 caracteres.');
      return;
    }
    if (senha !== confirmarSenha) {
      setError('As senhas não coincidem.');
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: senha });
      if (error) throw error;
      router.push('/dashboard');
    } catch (err: any) {
      console.error('Erro ao definir senha:', err.message);
      setError('Não foi possível definir a senha. Tente novamente.');
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
            Defina sua senha
          </h2>

          {sessaoValida === null && (
            <p className="text-sm text-stone-500 text-center">Verificando seu link...</p>
          )}

          {sessaoValida === false && (
            <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100 text-center">
              Link inválido ou expirado. Peça um novo convite ou uma nova redefinição de senha.
            </div>
          )}

          {sessaoValida === true && (
            <>
              {error && (
                <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100 text-center">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">
                    Nova senha
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    className="w-full px-4 py-3 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none transition-all"
                    placeholder="••••••••"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">
                    Confirmar senha
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    className="w-full px-4 py-3 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none transition-all"
                    placeholder="••••••••"
                    value={confirmarSenha}
                    onChange={(e) => setConfirmarSenha(e.target.value)}
                  />
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3 px-4 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-medium transition-colors disabled:opacity-70 flex justify-center items-center mt-2"
                >
                  {isLoading ? 'Salvando...' : 'Definir senha e entrar'}
                </button>
              </form>
            </>
          )}
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
