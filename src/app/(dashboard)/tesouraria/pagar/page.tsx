'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '../../../../lib/supabase';
import { hojeBrasilia, dataParaTimestampBrasilia } from '../../../../lib/date';

interface Despesa {
  id: string;
  description: string;
  due_date: string;
  amount: number;
  status: string;
  plano_conta_id: string | null;
  franchise_id: string;
  plano_contas: { nome: string } | null;
  franchises: { name: string } | null;
}

interface CategoriaContas {
  id: string;
  nome: string;
  categoria_pai_id: string | null;
}

interface Franquia {
  id: string;
  name: string;
}

export default function ContasPagarPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [despesas, setDespesas] = useState<Despesa[]>([]);
  const [planoContas, setPlanoContas] = useState<CategoriaContas[]>([]);
  const [podeLancarParaOutras, setPodeLancarParaOutras] = useState(false);
  const [franquias, setFranquias] = useState<Franquia[]>([]);
  const [marcandoPagoId, setMarcandoPagoId] = useState<string | null>(null);
  const [contaParaPagar, setContaParaPagar] = useState<Despesa | null>(null);
  const [dataPagamento, setDataPagamento] = useState(hojeBrasilia());

  const [formData, setFormData] = useState({
    description: '',
    categoriaPaiId: '',
    subcategoriaId: '',
    due_date: '',
    amount: '',
    franchiseId: '',
  });

  const fetchDespesas = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('accounts_payable')
        .select('*, plano_contas(nome), franchises(name)')
        .order('due_date', { ascending: true });

      if (error) throw error;
      setDespesas((data as any) || []);
    } catch (error) {
      console.error('Erro ao buscar contas a pagar:', error);
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

  const fetchPerfil = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase
      .from('profiles')
      .select('pode_lancar_para_outras_franquias')
      .eq('id', user.id)
      .maybeSingle();
    if (error) { console.error('Erro ao buscar perfil:', error); return; }
    const pode = !!data?.pode_lancar_para_outras_franquias;
    setPodeLancarParaOutras(pode);
    if (pode) {
      const { data: franquiasData, error: franquiasError } = await supabase
        .from('franchises')
        .select('id, name')
        .order('name', { ascending: true });
      if (franquiasError) { console.error('Erro ao buscar franquias:', franquiasError); return; }
      setFranquias(franquiasData || []);
    }
  };

  useEffect(() => {
    fetchPerfil();
    fetchPlanoContas();
    fetchDespesas();
  }, []);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  const getStatusBadge = (status: string) => {
    const badges: Record<string, JSX.Element> = {
      pendente: <span className="px-2.5 py-1 bg-amber-50 text-amber-700 text-xs font-medium rounded-md">Pendente</span>,
      pago: <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-medium rounded-md">Pago</span>,
    };
    return badges[status] || <span className="px-2.5 py-1 bg-stone-100 text-stone-600 text-xs font-medium rounded-md">{status}</span>;
  };

  const categoriasPai = planoContas.filter((c) => !c.categoria_pai_id);
  const subcategoriasDaSelecionada = planoContas.filter((c) => c.categoria_pai_id === formData.categoriaPaiId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const planoContaIdFinal = subcategoriasDaSelecionada.length > 0 ? formData.subcategoriaId : formData.categoriaPaiId;
      if (!planoContaIdFinal) throw new Error('Selecione uma categoria.');

      const novaConta: Record<string, unknown> = {
        description: formData.description,
        plano_conta_id: planoContaIdFinal,
        due_date: formData.due_date,
        amount: parseFloat(formData.amount),
        status: 'pendente',
      };
      if (podeLancarParaOutras) {
        if (!formData.franchiseId) throw new Error('Selecione a franquia.');
        novaConta.franchise_id = formData.franchiseId;
      }

      const { error } = await supabase.from('accounts_payable').insert([novaConta]);

      if (error) throw error;

      await fetchDespesas();

      setIsModalOpen(false);
      setFormData({ description: '', categoriaPaiId: '', subcategoriaId: '', due_date: '', amount: '', franchiseId: '' });
    } catch (error) {
      console.error('Erro ao salvar despesa:', error);
      alert('Erro ao salvar no banco. Verifique o console.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const abrirMarcarComoPago = (despesa: Despesa) => {
    setContaParaPagar(despesa);
    setDataPagamento(hojeBrasilia());
  };

  const confirmarMarcarComoPago = async () => {
    if (!contaParaPagar) return;
    setMarcandoPagoId(contaParaPagar.id);
    try {
      const { error } = await supabase
        .from('accounts_payable')
        .update({ status: 'pago', paid_at: dataParaTimestampBrasilia(dataPagamento) })
        .eq('id', contaParaPagar.id);
      if (error) throw error;
      await fetchDespesas();
      setContaParaPagar(null);
    } catch (error) {
      console.error('Erro ao marcar como pago:', error);
      alert('Erro ao atualizar. Verifique o console.');
    } finally {
      setMarcandoPagoId(null);
    }
  };

  return (
    <div className="space-y-6 relative">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-stone-800">Contas a Pagar</h1>
          <p className="text-stone-500 text-sm mt-1">
            {podeLancarParaOutras ? 'Gerencie as despesas e obrigações de todas as franquias.' : 'Gerencie as despesas e obrigações da sua franquia.'}
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-stone-900 hover:bg-stone-800 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
        >
          <span>+</span> Nova Despesa
        </button>
      </div>

      <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden min-h-[300px]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-stone-600">
            <thead className="bg-stone-50 border-b border-stone-200 text-stone-500 uppercase text-xs font-medium">
              <tr>
                <th className="px-6 py-4">Descrição</th>
                {podeLancarParaOutras && <th className="px-6 py-4">Franquia</th>}
                <th className="px-6 py-4">Categoria</th>
                <th className="px-6 py-4">Vencimento</th>
                <th className="px-6 py-4">Valor</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {isLoading ? (
                <tr>
                  <td colSpan={podeLancarParaOutras ? 7 : 6} className="px-6 py-8 text-center text-stone-400">
                    Carregando dados do Supabase...
                  </td>
                </tr>
              ) : despesas.length === 0 ? (
                <tr>
                  <td colSpan={podeLancarParaOutras ? 7 : 6} className="px-6 py-8 text-center text-stone-400">
                    Nenhuma conta a pagar encontrada.
                  </td>
                </tr>
              ) : (
                despesas.map((despesa) => (
                  <tr key={despesa.id} className="hover:bg-stone-50/50 transition-colors">
                    <td className="px-6 py-4 font-medium text-stone-800">{despesa.description}</td>
                    {podeLancarParaOutras && <td className="px-6 py-4">{despesa.franchises?.name || '—'}</td>}
                    <td className="px-6 py-4">{despesa.plano_contas?.nome || '—'}</td>
                    <td className="px-6 py-4">{new Date(despesa.due_date + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                    <td className="px-6 py-4 font-medium text-red-600">{formatCurrency(despesa.amount)}</td>
                    <td className="px-6 py-4">{getStatusBadge(despesa.status)}</td>
                    <td className="px-6 py-4">
                      {despesa.status === 'pendente' && (
                        <button
                          onClick={() => abrirMarcarComoPago(despesa)}
                          disabled={marcandoPagoId === despesa.id}
                          className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
                        >
                          {marcandoPagoId === despesa.id ? 'Salvando...' : 'Marcar como pago'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de Nova Despesa */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex justify-between items-center p-6 border-b border-stone-100">
              <h2 className="text-lg font-semibold text-stone-800">Lançar Nova Despesa</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-stone-400 hover:text-stone-600">✕</button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {podeLancarParaOutras && (
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Franquia</label>
                  <select
                    required
                    className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none bg-white text-stone-700"
                    value={formData.franchiseId}
                    onChange={e => setFormData({ ...formData, franchiseId: e.target.value })}
                  >
                    <option value="">Selecione...</option>
                    {franquias.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Descrição</label>
                <input
                  type="text"
                  required
                  className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                  value={formData.description}
                  onChange={e => setFormData({...formData, description: e.target.value})}
                  placeholder="Ex: Conta de Internet"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Valor (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                    value={formData.amount}
                    onChange={e => setFormData({...formData, amount: e.target.value})}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Vencimento</label>
                  <input
                    type="date"
                    required
                    className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none text-stone-700"
                    value={formData.due_date}
                    onChange={e => setFormData({...formData, due_date: e.target.value})}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Categoria</label>
                  <select
                    required
                    className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none bg-white text-stone-700"
                    value={formData.categoriaPaiId}
                    onChange={e => setFormData({ ...formData, categoriaPaiId: e.target.value, subcategoriaId: '' })}
                  >
                    <option value="">Selecione...</option>
                    {categoriasPai.map((c) => (
                      <option key={c.id} value={c.id}>{c.nome}</option>
                    ))}
                  </select>
                </div>
                {subcategoriasDaSelecionada.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1">Subcategoria</label>
                    <select
                      required
                      className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none bg-white text-stone-700"
                      value={formData.subcategoriaId}
                      onChange={e => setFormData({ ...formData, subcategoriaId: e.target.value })}
                    >
                      <option value="">Selecione...</option>
                      {subcategoriasDaSelecionada.map((s) => (
                        <option key={s.id} value={s.id}>{s.nome}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg font-medium transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-medium transition-colors disabled:opacity-70 flex justify-center items-center"
                >
                  {isSubmitting ? 'Salvando...' : 'Salvar Despesa'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Marcar como Pago */}
      {contaParaPagar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="flex justify-between items-center p-6 border-b border-stone-100">
              <h2 className="text-lg font-semibold text-stone-800">Marcar como pago</h2>
              <button onClick={() => setContaParaPagar(null)} className="text-stone-400 hover:text-stone-600">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-stone-600">{contaParaPagar.description} — {formatCurrency(contaParaPagar.amount)}</p>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Data do pagamento</label>
                <input
                  type="date"
                  required
                  max={hojeBrasilia()}
                  className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none text-stone-700"
                  value={dataPagamento}
                  onChange={e => setDataPagamento(e.target.value)}
                />
              </div>
              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setContaParaPagar(null)}
                  className="flex-1 px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg font-medium transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmarMarcarComoPago}
                  disabled={marcandoPagoId === contaParaPagar.id}
                  className="flex-1 px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-medium transition-colors disabled:opacity-70 flex justify-center items-center"
                >
                  {marcandoPagoId === contaParaPagar.id ? 'Salvando...' : 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
