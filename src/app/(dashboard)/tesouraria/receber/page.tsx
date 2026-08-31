'use client';

import React, { useState } from 'react';
import { useRecebimentos } from './useRecebimentos';
import RecebimentosTable from './RecebimentosTable';
import NovoRecebimentoModal from './NovoRecebimentoModal';

export default function ContasReceberPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { isLoading, isSubmitting, recebimentos, formData, setFormData, criarRecebimento } = useRecebimentos();

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

      <RecebimentosTable recebimentos={recebimentos} isLoading={isLoading} />

      <NovoRecebimentoModal
        isOpen={isModalOpen}
        formData={formData}
        onChange={setFormData}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
      />
    </div>
  );
}
