'use client';

import React from 'react';
import { formatCurrency } from '../../../../lib/format';
import type { Recebimento } from './types';

function getStatusBadge(status: string) {
  const badges: Record<string, JSX.Element> = {
    pendente: <span className="px-2.5 py-1 bg-amber-50 text-amber-700 text-xs font-medium rounded-md">A Receber</span>,
    atrasado: <span className="px-2.5 py-1 bg-red-50 text-red-700 text-xs font-medium rounded-md">Atrasado</span>,
    recebido: <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-medium rounded-md">Recebido</span>,
  };
  return badges[status] || <span className="px-2.5 py-1 bg-stone-100 text-stone-600 text-xs font-medium rounded-md">{status}</span>;
}

interface RecebimentosTableProps {
  recebimentos: Recebimento[];
  isLoading: boolean;
  marcandoRecebidoId: string | null;
  onMarcarComoRecebido: (item: Recebimento) => void;
  onExcluir: (item: Recebimento) => void;
}

export default function RecebimentosTable({ recebimentos, isLoading, marcandoRecebidoId, onMarcarComoRecebido, onExcluir }: RecebimentosTableProps) {
  return (
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
              <th className="px-6 py-4">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {isLoading ? (
              <tr>
                <td colSpan={8} className="px-6 py-8 text-center text-stone-400">
                  Carregando dados do Supabase...
                </td>
              </tr>
            ) : recebimentos.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-8 text-center text-stone-400">
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
                  <td className="px-6 py-4">
                    {item.status === 'pendente' && (
                      <>
                        <button
                          onClick={() => onMarcarComoRecebido(item)}
                          disabled={marcandoRecebidoId === item.id}
                          className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
                        >
                          {marcandoRecebidoId === item.id ? 'Salvando...' : 'Marcar como recebido'}
                        </button>
                        <button
                          onClick={() => onExcluir(item)}
                          className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors text-stone-400 hover:bg-red-50 hover:text-red-600"
                        >
                          Excluir
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
