'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '../../../../lib/supabase';
import { formatCurrency } from '../../../../lib/format';
import Combobox, { ComboboxOption } from '../../../../components/Combobox';

interface Recorrente {
  id: string;
  franchise_id: string;
  descricao: string;
  plano_conta_id: string;
  fornecedor_id: string | null;
  valor_referencia: number;
  dia_vencimento: number;
  frequencia: 'mensal' | 'trimestral' | 'semestral' | 'anual';
  mes_referencia: number | null;
  is_active: boolean;
  plano_contas: { nome: string } | null;
}

interface CategoriaContas {
  id: string;
  nome: string;
  categoria_pai_id: string | null;
}

interface Fornecedor {
  id: string;
  nome: string;
  franchise_id: string | null;
}

const FREQUENCIAS: { value: Recorrente['frequencia']; label: string }[] = [
  { value: 'mensal', label: 'Mensal' },
  { value: 'trimestral', label: 'Trimestral' },
  { value: 'semestral', label: 'Semestral' },
  { value: 'anual', label: 'Anual' },
];

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const FORM_INICIAL = {
  descricao: '',
  planoContaId: '',
  fornecedorId: '',
  valorReferencia: '',
  diaVencimento: '',
  frequencia: 'mensal' as Recorrente['frequencia'],
  mesReferencia: '',
};

export default function RecorrentesPage() {
  const [recorrentes, setRecorrentes] = useState<Recorrente[]>([]);
  const [planoContas, setPlanoContas] = useState<CategoriaContas[]>([]);
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [minhaFranchiseId, setMinhaFranchiseId] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editando, setEditando] = useState<Recorrente | null>(null);
  const [formData, setFormData] = useState(FORM_INICIAL);

  const fetchRecorrentes = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('despesas_recorrentes')
        .select('*, plano_contas(nome)')
        .order('descricao', { ascending: true });
      if (error) throw error;
      setRecorrentes((data as any) || []);
    } catch (error) {
      console.error('Erro ao buscar despesas recorrentes:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchPlanoContas = async () => {
    const { data, error } = await supabase
      .from('plano_contas')
      .select('id, nome, categoria_pai_id')
      .eq('is_active', true)
      .in('tipo', ['despesa', 'custo'])
      .order('ordem', { ascending: true });
    if (error) { console.error('Erro ao buscar plano de contas:', error); return; }
    setPlanoContas(data || []);
  };

  const fetchFornecedores = async () => {
    const { data, error } = await supabase
      .from('fornecedores')
      .select('id, nome, franchise_id')
      .eq('is_active', true)
      .order('nome', { ascending: true });
    if (error) { console.error('Erro ao buscar fornecedores:', error); return; }
    setFornecedores(data || []);
  };

  const fetchPerfil = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from('profiles').select('franchise_id').eq('id', user.id).maybeSingle();
    setMinhaFranchiseId(data?.franchise_id || '');
  };

  useEffect(() => {
    fetchPerfil();
    fetchPlanoContas();
    fetchFornecedores();
    fetchRecorrentes();
  }, []);

  const categoriaOptions: ComboboxOption[] = planoContas
    .filter((c) => !c.categoria_pai_id)
    .flatMap((pai) => {
      const filhos = planoContas.filter((c) => c.categoria_pai_id === pai.id);
      return filhos.length > 0
        ? filhos.map((filho) => ({ value: filho.id, label: `${pai.nome} › ${filho.nome}` }))
        : [{ value: pai.id, label: pai.nome }];
    });

  const fornecedorOptions: ComboboxOption[] = fornecedores
    .filter((f) => f.franchise_id === null || f.franchise_id === minhaFranchiseId)
    .map((f) => ({ value: f.id, label: f.nome }));

  const fecharModal = () => {
    setIsModalOpen(false);
    setEditando(null);
    setFormData(FORM_INICIAL);
  };

  const abrirNova = () => {
    fecharModal();
    setIsModalOpen(true);
  };

  const abrirEdicao = (r: Recorrente) => {
    setEditando(r);
    setFormData({
      descricao: r.descricao,
      planoContaId: r.plano_conta_id,
      fornecedorId: r.fornecedor_id || '',
      valorReferencia: String(r.valor_referencia),
      diaVencimento: String(r.dia_vencimento),
      frequencia: r.frequencia,
      mesReferencia: r.mes_referencia ? String(r.mes_referencia) : '',
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (!formData.planoContaId) throw new Error('Selecione uma categoria.');
      const dia = parseInt(formData.diaVencimento, 10);
      if (!dia || dia < 1 || dia > 31) throw new Error('Dia de vencimento inválido.');
      if (formData.frequencia !== 'mensal' && !formData.mesReferencia) {
        throw new Error('Selecione o mês de referência.');
      }

      const dados: Record<string, unknown> = {
        descricao: formData.descricao,
        plano_conta_id: formData.planoContaId,
        fornecedor_id: formData.fornecedorId || null,
        valor_referencia: parseFloat(formData.valorReferencia),
        dia_vencimento: dia,
        frequencia: formData.frequencia,
        mes_referencia: formData.frequencia !== 'mensal' ? parseInt(formData.mesReferencia, 10) : null,
      };

      if (editando) {
        const { error } = await supabase.from('despesas_recorrentes').update(dados).eq('id', editando.id);
        if (error) throw error;
      } else {
        dados.franchise_id = minhaFranchiseId;
        const { error } = await supabase.from('despesas_recorrentes').insert([dados]);
        if (error) throw error;
      }

      await fetchRecorrentes();
      fecharModal();
    } catch (error) {
      console.error('Erro ao salvar despesa recorrente:', error);
      alert(error instanceof Error ? error.message : 'Erro ao salvar no banco. Verifique o console.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAlternarAtivo = async (r: Recorrente) => {
    try {
      const { error } = await supabase.from('despesas_recorrentes').update({ is_active: !r.is_active }).eq('id', r.id);
      if (error) throw error;
      await fetchRecorrentes();
    } catch (error) {
      console.error('Erro ao pausar/reativar recorrente:', error);
      alert('Erro ao atualizar. Verifique o console.');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/tesouraria/pagar" className="text-sm font-medium text-amber-600 hover:text-amber-700">
          ← Voltar para Contas a Pagar
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-stone-800">Despesas Recorrentes</h1>
          <p className="text-stone-500 text-sm mt-1">Lançamentos gerados automaticamente 2 dias antes do vencimento.</p>
        </div>
        <button
          onClick={abrirNova}
          className="bg-stone-900 hover:bg-stone-800 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
        >
          <span>+</span> Nova Recorrente
        </button>
      </div>

      <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden min-h-[200px]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-stone-600">
            <thead className="bg-stone-50 border-b border-stone-200 text-stone-500 uppercase text-xs font-medium">
              <tr>
                <th className="px-6 py-4">Descrição</th>
                <th className="px-6 py-4">Categoria</th>
                <th className="px-6 py-4">Valor de referência</th>
                <th className="px-6 py-4">Vencimento</th>
                <th className="px-6 py-4">Frequência</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {isLoading ? (
                <tr><td colSpan={7} className="px-6 py-8 text-center text-stone-400">Carregando...</td></tr>
              ) : recorrentes.length === 0 ? (
                <tr><td colSpan={7} className="px-6 py-8 text-center text-stone-400">Nenhuma despesa recorrente cadastrada ainda.</td></tr>
              ) : (
                recorrentes.map((r) => (
                  <tr key={r.id} className="hover:bg-stone-50/50 transition-colors">
                    <td className="px-6 py-4 font-medium text-stone-800">🔁 {r.descricao}</td>
                    <td className="px-6 py-4">{r.plano_contas?.nome || '—'}</td>
                    <td className="px-6 py-4">{formatCurrency(r.valor_referencia)}</td>
                    <td className="px-6 py-4">Dia {r.dia_vencimento}</td>
                    <td className="px-6 py-4 capitalize">{r.frequencia}</td>
                    <td className="px-6 py-4">
                      {r.is_active ? (
                        <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-medium rounded-md">Ativa</span>
                      ) : (
                        <span className="px-2.5 py-1 bg-stone-100 text-stone-500 text-xs font-medium rounded-md">Pausada</span>
                      )}
                    </td>
                    <td className="px-6 py-4 space-x-1">
                      <button onClick={() => abrirEdicao(r)} className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors text-stone-500 hover:bg-stone-100">
                        Editar
                      </button>
                      <button
                        onClick={() => handleAlternarAtivo(r)}
                        className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${r.is_active ? 'text-red-600 hover:bg-red-50' : 'text-emerald-600 hover:bg-emerald-50'}`}
                      >
                        {r.is_active ? 'Pausar' : 'Reativar'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center p-6 border-b border-stone-100">
              <h2 className="text-lg font-semibold text-stone-800">
                {editando ? 'Editar Recorrente' : 'Nova Despesa Recorrente'}
              </h2>
              <button onClick={fecharModal} className="text-stone-400 hover:text-stone-600">✕</button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Descrição</label>
                <input
                  type="text"
                  required
                  className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                  placeholder="Ex: Aluguel"
                  value={formData.descricao}
                  onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Categoria</label>
                <Combobox
                  required
                  placeholder="Digite para buscar..."
                  value={formData.planoContaId}
                  onChange={(v) => setFormData({ ...formData, planoContaId: v })}
                  options={categoriaOptions}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Fornecedor (opcional)</label>
                <Combobox
                  placeholder="Digite para buscar..."
                  value={formData.fornecedorId}
                  onChange={(v) => setFormData({ ...formData, fornecedorId: v })}
                  options={fornecedorOptions}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Valor de referência (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                    value={formData.valorReferencia}
                    onChange={(e) => setFormData({ ...formData, valorReferencia: e.target.value })}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Dia do vencimento</label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    required
                    className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                    value={formData.diaVencimento}
                    onChange={(e) => setFormData({ ...formData, diaVencimento: e.target.value })}
                    placeholder="Ex: 10"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Frequência</label>
                  <select
                    className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none bg-white text-stone-700"
                    value={formData.frequencia}
                    onChange={(e) => setFormData({ ...formData, frequencia: e.target.value as Recorrente['frequencia'], mesReferencia: '' })}
                  >
                    {FREQUENCIAS.map((f) => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </select>
                </div>
                {formData.frequencia !== 'mensal' && (
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1">Mês de referência</label>
                    <select
                      required
                      className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none bg-white text-stone-700"
                      value={formData.mesReferencia}
                      onChange={(e) => setFormData({ ...formData, mesReferencia: e.target.value })}
                    >
                      <option value="">Selecione...</option>
                      {MESES.map((nome, i) => (
                        <option key={i + 1} value={i + 1}>{nome}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="pt-4 flex gap-3">
                <button type="button" onClick={fecharModal} className="flex-1 px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg font-medium transition-colors">
                  Cancelar
                </button>
                <button type="submit" disabled={isSubmitting} className="flex-1 px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-medium transition-colors disabled:opacity-70 flex justify-center items-center">
                  {isSubmitting ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
