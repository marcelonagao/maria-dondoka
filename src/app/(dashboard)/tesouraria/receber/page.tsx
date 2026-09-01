'use client';

import React, { useState } from 'react';
import { useRecebimentos } from './useRecebimentos';
import RecebimentosTable from './RecebimentosTable';
import NovoRecebimentoModal from './NovoRecebimentoModal';
import { formatCurrency } from '../../../../lib/format';
import { hojeBrasilia } from '../../../../lib/date';

export default function ContasReceberPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const {
    isLoading, isSubmitting, recebimentos, formData, setFormData, criarRecebimento,
    marcandoRecebidoId, recebimentoParaMarcar, dataRecebimento, setDataRecebimento,
    abrirMarcarComoRecebido, confirmarMarcarComoRecebido, fecharMarcarComoRecebido,
  } = useRecebimentos();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sucesso = await criarRecebimento();
    if (sucesso) setIsModalOpen(false);
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

      <RecebimentosTable
        recebimentos={recebimentos}
        isLoading={isLoading}
        marcandoRecebidoId={marcandoRecebidoId}
        onMarcarComoRecebido={abrirMarcarComoRecebido}
      />

      <NovoRecebimentoModal
        isOpen={isModalOpen}
        formData={formData}
        onChange={setFormData}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
      />

      {recebimentoParaMarcar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="flex justify-between items-center p-6 border-b border-stone-100">
              <h2 className="text-lg font-semibold text-stone-800">Marcar como recebido</h2>
              <button onClick={fecharMarcarComoRecebido} className="text-stone-400 hover:text-stone-600">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-stone-600">{recebimentoParaMarcar.description} — {formatCurrency(recebimentoParaMarcar.net_amount)}</p>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Data do recebimento</label>
                <input
                  type="date"
                  required
                  max={hojeBrasilia()}
                  className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none text-stone-700"
                  value={dataRecebimento}
                  onChange={e => setDataRecebimento(e.target.value)}
                />
              </div>
              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={fecharMarcarComoRecebido}
                  className="flex-1 px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg font-medium transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmarMarcarComoRecebido}
                  disabled={marcandoRecebidoId === recebimentoParaMarcar.id}
                  className="flex-1 px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-medium transition-colors disabled:opacity-70 flex justify-center items-center"
                >
                  {marcandoRecebidoId === recebimentoParaMarcar.id ? 'Salvando...' : 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
