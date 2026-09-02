'use client';

import React, { useState } from 'react';
import { gerarScriptPhpPorUsuario } from '../../../lib/gerarScriptPhp';

interface FranquiaCriada {
  id: string;
  nome: string;
}

interface CredenciaisGeradas {
  token: string;
  secret: string;
}

export default function FranquiasPage() {
  const [nome, setNome] = useState('');
  const [emailAdmin, setEmailAdmin] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);
  const [franquiaCriada, setFranquiaCriada] = useState<FranquiaCriada | null>(null);

  const [nomeBancoDados, setNomeBancoDados] = useState('');
  const [isGerandoCredencial, setIsGerandoCredencial] = useState(false);
  const [erroCredencial, setErroCredencial] = useState<string | null>(null);
  const [credenciais, setCredenciais] = useState<CredenciaisGeradas | null>(null);
  const [confirmouCopia, setConfirmouCopia] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setMensagem(null);
    try {
      const res = await fetch('/api/admin/franquias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, email_admin: emailAdmin }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMensagem({ tipo: 'erro', texto: json.detalhe || json.error || 'Falha ao criar franquia.' });
        return;
      }
      setMensagem({ tipo: 'sucesso', texto: `Franquia criada. Convite enviado para ${emailAdmin}.` });
      setFranquiaCriada({ id: json.franchise_id, nome });
      setNome('');
      setEmailAdmin('');
    } catch (err) {
      console.error(err);
      setMensagem({ tipo: 'erro', texto: 'Erro inesperado. Verifique o console.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGerarCredencial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!franquiaCriada) return;
    setIsGerandoCredencial(true);
    setErroCredencial(null);
    try {
      const res = await fetch('/api/admin/pdv-devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_label: franquiaCriada.nome, franchise_id: franquiaCriada.id }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErroCredencial(json.detalhe || json.error || 'Falha ao gerar credencial.');
        return;
      }
      setCredenciais({ token: json.token, secret: json.secret });
      setConfirmouCopia(false);
    } catch (err) {
      console.error(err);
      setErroCredencial('Erro inesperado. Verifique o console.');
    } finally {
      setIsGerandoCredencial(false);
    }
  };

  const scriptPhp = credenciais
    ? gerarScriptPhpPorUsuario({
        webhookUrl: `${window.location.origin}/api/pdv/sync`,
        token: credenciais.token,
        secret: credenciais.secret,
        dbName: nomeBancoDados || 'SEU_BANCO_DE_DADOS',
      })
    : '';

  const handleCopiarScript = async () => {
    try {
      await navigator.clipboard.writeText(scriptPhp);
    } catch (err) {
      console.error('Erro ao copiar:', err);
    }
  };

  const handleNovaFranquia = () => {
    setFranquiaCriada(null);
    setMensagem(null);
    setNomeBancoDados('');
    setCredenciais(null);
    setConfirmouCopia(false);
    setErroCredencial(null);
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-stone-800">Nova Franquia</h1>
        <p className="text-stone-500 text-sm mt-1">Cadastre uma unidade nova e convide o administrador dela por e-mail.</p>
      </div>

      {!franquiaCriada ? (
        <form onSubmit={handleSubmit} className="bg-white border border-stone-200 rounded-xl shadow-sm p-6 space-y-4 max-w-md">
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Nome da franquia</label>
            <input
              type="text" required
              className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
              placeholder="Ex: Loja Filial - São Sebastião"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">E-mail do administrador</label>
            <input
              type="email" required
              className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
              placeholder="admin@novaloja.com.br"
              value={emailAdmin}
              onChange={(e) => setEmailAdmin(e.target.value)}
            />
          </div>

          {mensagem && (
            <p className={`text-sm p-3 rounded-lg ${mensagem.tipo === 'sucesso' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
              {mensagem.texto}
            </p>
          )}

          <button
            type="submit" disabled={isSubmitting}
            className="w-full py-2.5 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-medium transition-colors disabled:opacity-70"
          >
            {isSubmitting ? 'Criando...' : 'Criar Franquia e Convidar Admin'}
          </button>
        </form>
      ) : (
        <div className="space-y-6">
          <p className="text-sm p-3 rounded-lg bg-emerald-50 text-emerald-700">{mensagem?.texto}</p>

          <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-stone-800">Sincronização do PDV — {franquiaCriada.nome}</h2>
              <p className="text-stone-500 text-sm mt-1">
                Gere a credencial e o script PHP prontos pra enviar ao fornecedor do PDV desta franquia.
              </p>
            </div>

            {!credenciais ? (
              <form onSubmit={handleGerarCredencial} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Nome do banco de dados no fornecedor</label>
                  <input
                    type="text" required
                    className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                    placeholder="Ex: brXXXXX"
                    value={nomeBancoDados}
                    onChange={(e) => setNomeBancoDados(e.target.value)}
                  />
                  <p className="text-xs text-stone-400 mt-1">Só aparece no script gerado abaixo — não é usado tecnicamente por nós.</p>
                </div>
                {erroCredencial && (
                  <p className="text-sm p-3 rounded-lg bg-red-50 text-red-600">{erroCredencial}</p>
                )}
                <button
                  type="submit" disabled={isGerandoCredencial}
                  className="w-full py-2.5 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-medium transition-colors disabled:opacity-70"
                >
                  {isGerandoCredencial ? 'Gerando...' : 'Gerar credencial de sincronização'}
                </button>
              </form>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  Copie este script agora e envie ao fornecedor. Por segurança, o token e o secret não serão exibidos novamente.
                </p>
                <div className="relative">
                  <pre className="bg-stone-900 text-stone-100 text-xs rounded-lg p-4 overflow-x-auto max-h-96 overflow-y-auto">
                    {scriptPhp}
                  </pre>
                  <button
                    type="button"
                    onClick={handleCopiarScript}
                    className="absolute top-3 right-3 px-3 py-1.5 bg-stone-700 hover:bg-stone-600 text-white text-xs font-medium rounded-lg transition-colors"
                  >
                    Copiar
                  </button>
                </div>
                <label className="flex items-center gap-2 text-sm text-stone-600">
                  <input
                    type="checkbox"
                    checked={confirmouCopia}
                    onChange={(e) => setConfirmouCopia(e.target.checked)}
                    className="rounded border-stone-300"
                  />
                  Já copiei o script para um local seguro
                </label>
                <button
                  type="button"
                  onClick={handleNovaFranquia}
                  disabled={!confirmouCopia}
                  className="w-full px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Concluir e cadastrar outra franquia
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
