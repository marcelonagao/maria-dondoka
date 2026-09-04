'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '../../../../lib/supabase';
import { formatCurrency } from '../../../../lib/format';

interface Funcionario {
  id: string;
  franchise_id: string | null;
  nome: string;
  ativo: boolean;
  codigo_folha: string | null;
  cbo: string | null;
  cargo: string | null;
  admissao: string | null;
  salario_base: number | null;
  franchises: { name: string } | null;
}

interface HistoricoItem {
  id: string;
  valor_liquido: number;
  inss_empregado: number | null;
  fgts_mes: number | null;
  folha_pagamento_competencias: { competencia: string } | null;
}

export default function FuncionariosDpPage() {
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editando, setEditando] = useState<Funcionario | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [funcionarioDetalhe, setFuncionarioDetalhe] = useState<Funcionario | null>(null);
  const [historico, setHistorico] = useState<HistoricoItem[]>([]);
  const [isLoadingHistorico, setIsLoadingHistorico] = useState(false);

  const fetchFuncionarios = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('funcionarios')
        .select('id, franchise_id, nome, ativo, codigo_folha, cbo, cargo, admissao, salario_base, franchises(name)')
        .order('nome');
      if (error) throw error;
      setFuncionarios((data as any) || []);
    } catch (error) {
      console.error('Erro ao buscar funcionários:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchFuncionarios();
  }, []);

  const abrirEdicao = (f: Funcionario) => setEditando({ ...f });

  const salvarEdicao = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editando) return;
    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('funcionarios')
        .update({
          nome: editando.nome,
          cargo: editando.cargo,
          cbo: editando.cbo,
          admissao: editando.admissao,
          salario_base: editando.salario_base,
        })
        .eq('id', editando.id);
      if (error) throw error;
      await fetchFuncionarios();
      setEditando(null);
    } catch (error) {
      console.error('Erro ao salvar funcionário:', error);
      alert('Erro ao salvar. Verifique o console.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const abrirDetalhe = async (f: Funcionario) => {
    setFuncionarioDetalhe(f);
    setIsLoadingHistorico(true);
    try {
      const { data, error } = await supabase
        .from('folha_pagamento_itens')
        .select('id, valor_liquido, inss_empregado, fgts_mes, folha_pagamento_competencias(competencia)')
        .eq('funcionario_id', f.id)
        .order('id', { ascending: false });
      if (error) throw error;
      setHistorico((data as any) || []);
    } catch (error) {
      console.error('Erro ao buscar histórico:', error);
    } finally {
      setIsLoadingHistorico(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dp" className="text-sm font-medium text-amber-600 hover:text-amber-700">
          ← Voltar para DP
        </Link>
      </div>

      <h1 className="text-2xl font-semibold text-stone-800">Funcionários</h1>

      <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden min-h-[200px]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-stone-600">
            <thead className="bg-stone-50 border-b border-stone-200 text-stone-500 uppercase text-xs font-medium">
              <tr>
                <th className="px-6 py-4">Nome</th>
                <th className="px-6 py-4">Franquia</th>
                <th className="px-6 py-4">Cargo</th>
                <th className="px-6 py-4">Admissão</th>
                <th className="px-6 py-4">Salário Base</th>
                <th className="px-6 py-4">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {isLoading ? (
                <tr><td colSpan={6} className="px-6 py-8 text-center text-stone-400">Carregando...</td></tr>
              ) : funcionarios.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-8 text-center text-stone-400">Nenhum funcionário cadastrado ainda.</td></tr>
              ) : (
                funcionarios.map((f) => (
                  <tr key={f.id} className="hover:bg-stone-50/50 transition-colors">
                    <td className="px-6 py-4 font-medium text-stone-800">{f.nome}</td>
                    <td className="px-6 py-4">{f.franchises?.name || '—'}</td>
                    <td className="px-6 py-4">{f.cargo || '—'}</td>
                    <td className="px-6 py-4">{f.admissao ? new Date(f.admissao + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}</td>
                    <td className="px-6 py-4">{f.salario_base != null ? formatCurrency(f.salario_base) : '—'}</td>
                    <td className="px-6 py-4 space-x-1">
                      <button onClick={() => abrirDetalhe(f)} className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors text-stone-500 hover:bg-stone-100">
                        Histórico
                      </button>
                      <button onClick={() => abrirEdicao(f)} className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors text-amber-600 hover:bg-amber-50">
                        Editar
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex justify-between items-center p-6 border-b border-stone-100">
              <h2 className="text-lg font-semibold text-stone-800">Editar Funcionário</h2>
              <button onClick={() => setEditando(null)} className="text-stone-400 hover:text-stone-600">✕</button>
            </div>
            <form onSubmit={salvarEdicao} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Nome</label>
                <input required className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none" value={editando.nome} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Cargo</label>
                  <input className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none" value={editando.cargo || ''} onChange={(e) => setEditando({ ...editando, cargo: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">CBO</label>
                  <input className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none" value={editando.cbo || ''} onChange={(e) => setEditando({ ...editando, cbo: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Admissão</label>
                  <input type="date" className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none" value={editando.admissao || ''} onChange={(e) => setEditando({ ...editando, admissao: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Salário Base (R$)</label>
                  <input type="number" step="0.01" className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none" value={editando.salario_base ?? ''} onChange={(e) => setEditando({ ...editando, salario_base: parseFloat(e.target.value) || null })} />
                </div>
              </div>
              <div className="pt-2 flex gap-3">
                <button type="button" onClick={() => setEditando(null)} className="flex-1 px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg font-medium transition-colors">
                  Cancelar
                </button>
                <button type="submit" disabled={isSubmitting} className="flex-1 px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-medium transition-colors disabled:opacity-70">
                  {isSubmitting ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {funcionarioDetalhe && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center p-6 border-b border-stone-100">
              <h2 className="text-lg font-semibold text-stone-800">Histórico — {funcionarioDetalhe.nome}</h2>
              <button onClick={() => setFuncionarioDetalhe(null)} className="text-stone-400 hover:text-stone-600">✕</button>
            </div>
            <div className="p-6">
              {isLoadingHistorico ? (
                <p className="text-sm text-stone-400">Carregando...</p>
              ) : historico.length === 0 ? (
                <p className="text-sm text-stone-400">Nenhum lançamento de folha ainda.</p>
              ) : (
                <table className="w-full text-left text-sm text-stone-600">
                  <thead className="text-stone-500 uppercase text-xs font-medium">
                    <tr>
                      <th className="py-2">Competência</th>
                      <th className="py-2">Líquido</th>
                      <th className="py-2">INSS</th>
                      <th className="py-2">FGTS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {historico.map((h) => (
                      <tr key={h.id}>
                        <td className="py-2">{h.folha_pagamento_competencias?.competencia?.slice(0, 7) || '—'}</td>
                        <td className="py-2">{formatCurrency(h.valor_liquido)}</td>
                        <td className="py-2">{h.inss_empregado != null ? formatCurrency(h.inss_empregado) : '—'}</td>
                        <td className="py-2">{h.fgts_mes != null ? formatCurrency(h.fgts_mes) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
