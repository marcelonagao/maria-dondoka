'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

// Tipagem para o TypeScript não reclamar
interface Despesa {
  id: string;
  description: string;
  category: string;
  due_date: string;
  amount: number;
  status: string;
}

export default function ContasPagarPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [despesas, setDespesas] = useState<Despesa[]>([]);
  
  const [formData, setFormData] = useState({
    description: '',
    category: 'Infraestrutura',
    due_date: '',
    amount: ''
  });

  // Função que busca as despesas no Supabase ao carregar a página
  const fetchDespesas = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('accounts_payable')
        .select('*')
        .order('due_date', { ascending: true }); // Ordena pela data mais próxima

      if (error) throw error;
      setDespesas(data || []);
    } catch (error) {
      console.error('Erro ao buscar contas a pagar:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
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

  // Função que envia o dado pro Supabase
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const { error } = await supabase.from('accounts_payable').insert([{
        description: formData.description,
        category: formData.category,
        due_date: formData.due_date,
        amount: parseFloat(formData.amount),
        status: 'pendente'
      }]);

      if (error) throw error;

      // Recarrega a lista do banco após inserir
      await fetchDespesas();
      
      // Limpa e fecha o modal
      setIsModalOpen(false);
      setFormData({ description: '', category: 'Infraestrutura', due_date: '', amount: '' });
    } catch (error) {
      console.error('Erro ao salvar despesa:', error);
      alert('Erro ao salvar no banco. Verifique o console.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 relative">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-stone-800">Contas a Pagar</h1>
          <p className="text-stone-500 text-sm mt-1">Gerencie as despesas e obrigações da sua franquia.</p>
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
                <th className="px-6 py-4">Categoria</th>
                <th className="px-6 py-4">Vencimento</th>
                <th className="px-6 py-4">Valor</th>
                <th className="px-6 py-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-stone-400">
                    Carregando dados do Supabase...
                  </td>
                </tr>
              ) : despesas.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-stone-400">
                    Nenhuma conta a pagar encontrada.
                  </td>
                </tr>
              ) : (
                despesas.map((despesa) => (
                  <tr key={despesa.id} className="hover:bg-stone-50/50 transition-colors">
                    <td className="px-6 py-4 font-medium text-stone-800">{despesa.description}</td>
                    <td className="px-6 py-4">{despesa.category}</td>
                    <td className="px-6 py-4">{new Date(despesa.due_date + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                    <td className="px-6 py-4 font-medium text-red-600">{formatCurrency(despesa.amount)}</td>
                    <td className="px-6 py-4">{getStatusBadge(despesa.status)}</td>
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

              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Categoria</label>
                <select 
                  className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none bg-white text-stone-700"
                  value={formData.category}
                  onChange={e => setFormData({...formData, category: e.target.value})}
                >
                  <option value="Infraestrutura">Infraestrutura</option>
                  <option value="Estoque">Estoque</option>
                  <option value="Impostos">Impostos</option>
                  <option value="Marketing">Marketing</option>
                </select>
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
    </div>
  );
}