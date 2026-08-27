'use client';

import React from 'react';

export default function DashboardPage() {
  const kpis = [
    { title: 'Vendas Hoje', value: 'R$ 4.250,00', trend: '+12%', isPositive: true },
    { title: 'Contas a Receber', value: 'R$ 12.400,00', trend: 'Previsto (7 dias)', isPositive: true },
    { title: 'Contas a Pagar', value: 'R$ 3.150,00', trend: 'Vence hoje', isPositive: false },
    { title: 'Saldo Projetado', value: 'R$ 9.250,00', trend: 'Mês atual', isPositive: true },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-stone-800">Visão Geral</h1>
        <p className="text-stone-500 text-sm mt-1">Acompanhe o desempenho financeiro da sua loja.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {kpis.map((kpi, index) => (
          <div key={index} className="bg-white p-6 rounded-2xl border border-stone-100 shadow-sm">
            <h3 className="text-stone-500 text-sm font-medium">{kpi.title}</h3>
            <p className="text-2xl font-bold text-stone-800 mt-2">{kpi.value}</p>
            <div className="mt-2 flex items-center gap-2">
              <span className={`text-xs font-medium px-2 py-1 rounded-md ${
                kpi.isPositive ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
              }`}>
                {kpi.trend}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white p-6 rounded-2xl border border-stone-100 shadow-sm min-h-[300px] flex items-center justify-center">
        <p className="text-stone-400">O gráfico de fluxo de caixa será renderizado aqui.</p>
      </div>
    </div>
  );
}