'use client';

import React from 'react';

interface RecebimentoFormData {
  descricao: string;
  origem: string;
  previsao: string;
  valorBruto: string;
  taxa: string;
}

interface NovoRecebimentoModalProps {
  isOpen: boolean;
  formData: RecebimentoFormData;
  onChange: (formData: RecebimentoFormData) => void;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  isSubmitting: boolean;
}

export default function NovoRecebimentoModal({
  isOpen,
  formData,
  onChange,
  onClose,
  onSubmit,
  isSubmitting,
}: NovoRecebimentoModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="flex justify-between items-center p-6 border-b border-stone-100">
          <h2 className="text-lg font-semibold text-stone-800">Lançar Recebimento</h2>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600">✕</button>
        </div>

        <form onSubmit={onSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Descrição</label>
            <input
              type="text"
              required
              className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
              value={formData.descricao}
              onChange={e => onChange({ ...formData, descricao: e.target.value })}
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
                onChange={e => onChange({ ...formData, valorBruto: e.target.value })}
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
                onChange={e => onChange({ ...formData, taxa: e.target.value })}
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
                onChange={e => onChange({ ...formData, origem: e.target.value })}
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
                onChange={e => onChange({ ...formData, previsao: e.target.value })}
              />
            </div>
          </div>

          <div className="pt-4 flex gap-3">
            <button
              type="button"
              onClick={onClose}
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
  );
}
