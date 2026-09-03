'use client';

import React from 'react';
import { hojeBrasilia } from '../lib/date';

export interface DadosPagamento {
  paidAt: string;
  valorJuros: string;
  valorMulta: string;
  comprovanteFile: File | null;
}

interface PaymentSettlementFieldsProps {
  dueDate: string;
  value: DadosPagamento;
  onChange: (value: DadosPagamento) => void;
  comprovanteUrlExistente?: string | null;
  onVerComprovanteExistente?: () => void;
}

export default function PaymentSettlementFields({
  dueDate,
  value,
  onChange,
  comprovanteUrlExistente,
  onVerComprovanteExistente,
}: PaymentSettlementFieldsProps) {
  const pagoAposVencimento = !!dueDate && !!value.paidAt && value.paidAt > dueDate;

  return (
    <div className="space-y-4 p-4 bg-stone-50 rounded-lg border border-stone-200">
      <div>
        <label className="block text-sm font-medium text-stone-700 mb-1">Data do pagamento</label>
        <input
          type="date"
          required
          max={hojeBrasilia()}
          className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none text-stone-700"
          value={value.paidAt}
          onChange={(e) => onChange({ ...value, paidAt: e.target.value })}
        />
      </div>

      {pagoAposVencimento && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-amber-700">Pago após o vencimento</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Juros (R$)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                value={value.valorJuros}
                onChange={(e) => onChange({ ...value, valorJuros: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Multa (R$)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                value={value.valorMulta}
                onChange={(e) => onChange({ ...value, valorMulta: e.target.value })}
                placeholder="0.00"
              />
            </div>
          </div>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-stone-700 mb-1">Comprovante de pagamento</label>
        {comprovanteUrlExistente && (
          <button
            type="button"
            onClick={onVerComprovanteExistente}
            className="text-xs font-medium text-amber-600 hover:text-amber-700 mb-2 block"
          >
            Ver comprovante atual
          </button>
        )}
        <input
          type="file"
          accept=".pdf,image/*"
          className="w-full text-sm text-stone-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-stone-100 file:text-stone-700 file:text-sm file:font-medium hover:file:bg-stone-200"
          onChange={(e) => onChange({ ...value, comprovanteFile: e.target.files?.[0] || null })}
        />
        {comprovanteUrlExistente && (
          <p className="text-xs text-stone-400 mt-1">Selecionar um novo arquivo substitui o comprovante atual.</p>
        )}
      </div>
    </div>
  );
}
