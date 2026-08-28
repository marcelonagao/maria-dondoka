'use client';

import React, { useState } from 'react';

export default function FranquiasPage() {
  const [nome, setNome] = useState('');
  const [emailAdmin, setEmailAdmin] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);

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
      setNome('');
      setEmailAdmin('');
    } catch (err) {
      console.error(err);
      setMensagem({ tipo: 'erro', texto: 'Erro inesperado. Verifique o console.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-stone-800">Nova Franquia</h1>
        <p className="text-stone-500 text-sm mt-1">Cadastre uma unidade nova e convide o administrador dela por e-mail.</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white border border-stone-200 rounded-xl shadow-sm p-6 space-y-4">
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
    </div>
  );
}