'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import FluxoCaixaChart from './FluxoCaixaChart';

export default function DashboardPage() {
  const [metricas, setMetricas] = useState({ aReceber: 0, aPagar: 0, saldo: 0 });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function carregarDashboard() {
      try {
        setIsLoading(true);
        
        // Busca simultânea das duas tabelas no Supabase (apenas os pendentes)
        const [reqReceber, reqPagar] = await Promise.all([
          supabase.from('accounts_receivable').select('net_amount').eq('status', 'pendente'),
          supabase.from('accounts_payable').select('amount').eq('status', 'pendente')
        ]);

        if (reqReceber.error) throw reqReceber.error;
        if (reqPagar.error) throw reqPagar.error;

        // Soma os totais
        const totalReceber = reqReceber.data.reduce((acc, item) => acc + Number(item.net_amount), 0);
        const totalPagar = reqPagar.data.reduce((acc, item) => acc + Number(item.amount), 0);
        const saldoProjetado = totalReceber - totalPagar;

        setMetricas({ aReceber: totalReceber, aPagar: totalPagar, saldo: saldoProjetado });
      } catch (error) {
        console.error('Erro ao carregar métricas:', error);
      } finally {
        setIsLoading(false);
      }
    }

    carregarDashboard();
  }, []);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-stone-800">Visão Geral</h1>
        <p className="text-stone-500 text-sm mt-1">Acompanhe a saúde financeira da sua franquia.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Card Contas a Receber */}
        <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm flex flex-col justify-center">
          <div className="flex items-center gap-2 text-emerald-600 mb-2">
            <span className="text-xl">📈</span>
            <span className="font-medium text-sm uppercase tracking-wider">A Receber (Pendente)</span>
          </div>
          {isLoading ? (
            <div className="h-8 bg-stone-100 animate-pulse rounded w-1/2"></div>
          ) : (
            <span className="text-3xl font-bold text-stone-800">{formatCurrency(metricas.aReceber)}</span>
          )}
        </div>

        {/* Card Contas a Pagar */}
        <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm flex flex-col justify-center">
          <div className="flex items-center gap-2 text-red-500 mb-2">
            <span className="text-xl">📉</span>
            <span className="font-medium text-sm uppercase tracking-wider">A Pagar (Pendente)</span>
          </div>
          {isLoading ? (
            <div className="h-8 bg-stone-100 animate-pulse rounded w-1/2"></div>
          ) : (
            <span className="text-3xl font-bold text-stone-800">{formatCurrency(metricas.aPagar)}</span>
          )}
        </div>

        {/* Card Saldo Projetado */}
        <div className="bg-stone-900 p-6 rounded-xl border border-stone-800 shadow-sm flex flex-col justify-center text-white">
          <div className="flex items-center gap-2 text-amber-400 mb-2">
            <span className="text-xl">💰</span>
            <span className="font-medium text-sm uppercase tracking-wider">Saldo Projetado</span>
          </div>
          {isLoading ? (
            <div className="h-8 bg-stone-800 animate-pulse rounded w-1/2"></div>
          ) : (
            <span className="text-3xl font-bold">{formatCurrency(metricas.saldo)}</span>
          )}
        </div>
      </div>

      <div className="mt-8">
        <FluxoCaixaChart />
      </div>
    </div>
  );
}