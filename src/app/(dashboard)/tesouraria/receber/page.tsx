'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '../../../../lib/supabase';

// Tipagem para o TypeScript
interface Recebimento {
  id: string;
  description: string;
  origin: string;
  expected_date: string;
  gross_amount: number;
  fee_amount: number;
  net_amount: number;
  status: string;
}

export default function ContasReceberPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [recebimentos, setRecebimentos] = useState<Recebimento[]>([]);
  
  const [formData, setFormData] = useState({
    descricao: '',
    origem: 'Maquininha (Stone)',
    previsao: '',
    valorBruto: '',
    taxa: '0'
  });

  // Função para buscar os recebimentos do Supabase
  const fetchRecebimentos = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('accounts_receivable')
        .select('*')
        .order('expected_date', { ascending: true });

      if (error) throw error;
      setRecebimentos(data || []);
    } catch (error) {
      console.error('Erro ao buscar contas a receber:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRecebimentos();
  }, []);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  const getStatusBadge = (status: string) => {
    const badges: Record<string, JSX.Element> = {
      pendente: <span className="px-2.5 py-1 bg-amber-50 text-amber-700 text-xs font-medium rounded-md">A Receber</span>,
      atrasado: <span className="px-2.5 py-1 bg-red-50 text-red-700 text-xs font-medium rounded-md">Atrasado</span>,
      recebido: <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-medium rounded-md">Recebido</span>,
    };
    return badges[status] || <span className="px-2.5 py-1 bg-stone-100 text-stone-600 text-xs font-medium rounded-md">{status}</span>;
  };

  // Função para salvar no Supabase
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // Regra de Negócio: Calcula desconto e líquido antes de salvar
      const bruto = parseFloat(formData.valorBruto);
      const taxaPercentual = parseFloat(formData.taxa);
      const valorDesconto = bruto * (taxaPercentual / 100);
      const liquido = bruto - valorDesconto;

      const { error } = await supabase.from('accounts_receivable').insert([{
        description: formData.descricao,
        origin: formData.origem,
        expected_date: formData.previsao,
        gross_amount: bruto,
        fee_amount: valorDesconto,
        net_amount: liquido,
        status: 'pendente'
      }]);

      if (error) throw error;

      // Recarrega a tabela após salvar
      await fetchRecebimentos();
      
      setIsModalOpen(false);
      setFormData({ descricao: '', origem: 'Maquininha (Stone)', previsao: '', valorBruto: '', taxa: '0' });
    } catch (error) {
      console.error('Erro ao salvar recebimento:', error);
      alert('Erro ao salvar no banco. Verifique o console.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 relative">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-stone-800">Contas a Receber</h1>
          <p className="text-stone-500 text-sm mt-1">Acompanhe repasses, previsões e faturamentos da loja.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-stone-900 hover:bg-stone-800 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
        >
          <span>+</span> Novo Recebimento
        </button>
      </div>

      <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden min-h-[300px]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-stone-600">
            <thead className="bg-stone-50 border-b border-stone-200 text-stone-500 uppercase text-xs font-medium">
              <tr>
                <th className="px-6 py-4">Descrição</th>
                <th className="px-6 py-4">Origem</th>
                <th className="px-6 py-4">Previsão</th>
                <th className="px-6 py-4">Bruto</th>
                <th className="px-6 py-4">Taxa/Desc.</th>
                <th className="px-6 py-4">Líquido</th>
                <th className="px-6 py-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-stone-400">
                    Carregando dados do Supabase...
                  </td>
                </tr>
              ) : recebimentos.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-stone-400">
                    Nenhum recebimento encontrado.
                  </td>
                </tr>
              ) : (
                recebimentos.map((item) => (
                  <tr key={item.id} className="hover:bg-stone-50/50 transition-colors">
                    <td className="px-6 py-4 font-medium text-stone-800">{item.description}</td>
                    <td className="px-6 py-4">{item.origin}</td>
                    <td className="px-6 py-4">{new Date(item.expected_date + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                    <td className="px-6 py-4 text-stone-500">{formatCurrency(item.gross_amount)}</td>
                    <td className="px-6 py-4 text-red-500">- {formatCurrency(item.fee_amount)}</td>
                    <td className="px-6 py-4 font-semibold text-emerald-600">{formatCurrency(item.net_amount)}</td>
                    <td className="px-6 py-4">{getStatusBadge(item.status)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de Novo Recebimento */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex justify-between items-center p-6 border-b border-stone-100">
              <h2 className="text-lg font-semibold text-stone-800">Lançar Recebimento</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-stone-400 hover:text-stone-600">✕</button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Descrição</label>
                <input 
                  type="text" 
                  required 
                  className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                  value={formData.descricao}
                  onChange={e => setFormData({...formData, descricao: e.target.value})}
                  placeholder="Ex: Venda Corporativa"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Valor Bruto (R$)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    required 
                    className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                    value={formData.valorBruto}
                    onChange={e => setFormData({...formData, valorBruto: e.target.value})}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Taxa (%)</label>
                  <input 
                    type="number"
                    step="0.01"
                    className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                    value={formData.taxa}
                    onChange={e => setFormData({...formData, taxa: e.target.value})}
                    placeholder="Ex: 2.5"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Origem</label>
                  <select 
                    className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none bg-white text-stone-700"
                    value={formData.origem}
                    onChange={e => setFormData({...formData, origem: e.target.value})}
                  >
                    <option value="Maquininha (Stone)">Maquininha (Stone)</option>
                    <option value="Maquininha (Cielo)">Maquininha (Cielo)</option>
                    <option value="Pix">Pix / Transferência</option>
                    <option value="Plataforma (Ifood)">Plataforma (Ifood)</option>
                    <option value="Dinheiro">Dinheiro Físico</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Previsão</label>
                  <input 
                    type="date" 
                    required 
                    className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none text-stone-700"
                    value={formData.previsao}
                    onChange={e => setFormData({...formData, previsao: e.target.value})}
                  />
                </div>
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