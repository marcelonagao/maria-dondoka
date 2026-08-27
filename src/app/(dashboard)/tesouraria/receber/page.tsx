'use client';

import React, { useState } from 'react';

export default function ContasReceberPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Estado do formulário
  const [formData, setFormData] = useState({
    descricao: '',
    origem: 'Maquininha (Stone)',
    previsao: '',
    valorBruto: '',
    taxa: '0'
  });

  // Dados simulados (Mock) com datas próximas ao contexto atual
  const [recebimentos, setRecebimentos] = useState([
    { id: 1, descricao: 'Repasse Lote #442', origem: 'Maquininha (Stone)', previsao: '2026-08-28', valorBruto: 3250.00, taxa: 65.00, valorLiquido: 3185.00, status: 'pendente' },
    { id: 2, descricao: 'Venda PDV #1092', origem: 'Pix', previsao: '2026-08-27', valorBruto: 450.00, taxa: 0.00, valorLiquido: 450.00, status: 'recebido' },
    { id: 3, descricao: 'Repasse Ifood Semanal', origem: 'Plataforma (Ifood)', previsao: '2026-08-25', valorBruto: 1200.00, taxa: 144.00, valorLiquido: 1056.00, status: 'atrasado' },
  ]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  const getStatusBadge = (status: string) => {
    const badges: Record<string, JSX.Element> = {
      pendente: <span className="px-2.5 py-1 bg-amber-50 text-amber-700 text-xs font-medium rounded-md">A Receber</span>,
      atrasado: <span className="px-2.5 py-1 bg-red-50 text-red-700 text-xs font-medium rounded-md">Atrasado</span>,
      recebido: <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-medium rounded-md">Recebido</span>,
    };
    return badges[status] || null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const bruto = parseFloat(formData.valorBruto);
      const taxaPercentual = parseFloat(formData.taxa);
      const valorDesconto = bruto * (taxaPercentual / 100);
      const liquido = bruto - valorDesconto;

      // Simulação de salvamento no Supabase
      const novoRecebimento = {
        id: Math.random(),
        descricao: formData.descricao,
        origem: formData.origem,
        previsao: formData.previsao,
        valorBruto: bruto,
        taxa: valorDesconto,
        valorLiquido: liquido,
        status: 'pendente'
      };
      
      setRecebimentos([novoRecebimento, ...recebimentos]);
      setIsModalOpen(false);
      setFormData({ descricao: '', origem: 'Maquininha (Stone)', previsao: '', valorBruto: '', taxa: '0' });
    } catch (error) {
      console.error('Erro ao salvar recebimento:', error);
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

      <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden">
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
              {recebimentos.map((item) => (
                <tr key={item.id} className="hover:bg-stone-50/50 transition-colors">
                  <td className="px-6 py-4 font-medium text-stone-800">{item.descricao}</td>
                  <td className="px-6 py-4">{item.origem}</td>
                  <td className="px-6 py-4">{new Date(item.previsao + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                  <td className="px-6 py-4 text-stone-500">{formatCurrency(item.valorBruto)}</td>
                  <td className="px-6 py-4 text-red-500">- {formatCurrency(item.taxa)}</td>
                  <td className="px-6 py-4 font-semibold text-emerald-600">{formatCurrency(item.valorLiquido)}</td>
                  <td className="px-6 py-4">{getStatusBadge(item.status)}</td>
                </tr>
              ))}
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
              <button onClick={() => setIsModalOpen(false)} className="text-stone-400 hover:text-stone-600">
                ✕
              </button>
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

              {/* Pré-visualização do cálculo (Opcional para UX) */}
              {formData.valorBruto && (
                <div className="p-3 bg-stone-50 border border-stone-200 rounded-lg flex justify-between items-center text-sm">
                  <span className="text-stone-500">Valor Líquido Projetado:</span>
                  <span className="font-bold text-emerald-600">
                    {formatCurrency(
                      parseFloat(formData.valorBruto) - (parseFloat(formData.valorBruto) * (parseFloat(formData.taxa || '0') / 100))
                    )}
                  </span>
                </div>
              )}

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
                  className="flex-1 px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-medium transition-colors disabled:opacity-70"
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