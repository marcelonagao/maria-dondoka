'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import { formatCurrency } from '../../../lib/format';
import FluxoCaixaChart from './FluxoCaixaChart';
import IndexedMetricsChart from './IndexedMetricsChart';

interface Franquia {
  id: string;
  name: string;
}

interface Metricas {
  aReceber: number;
  aPagar: number;
}

export default function DashboardPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSocio, setIsSocio] = useState(false);
  const [franquias, setFranquias] = useState<Franquia[]>([]);
  const [metricasPorFranquia, setMetricasPorFranquia] = useState<Record<string, Metricas>>({});
  const [franquiaSelecionada, setFranquiaSelecionada] = useState<string>('');

  useEffect(() => {
    async function carregarDashboard() {
      try {
        setIsLoading(true);

        // Checagem de escopo e os dados da própria franquia disparam juntos —
        // a RLS já escopa o resultado de accounts_receivable/payable corretamente
        // pra qualquer usuário, independente do papel, sem precisar saber isso antes.
        const [perfilRes, reqReceber, reqPagar] = await Promise.all([
          (async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return null;
            const { data } = await supabase.from('profiles').select('roles(escopo)').eq('id', user.id).maybeSingle();
            return data;
          })(),
          supabase.from('accounts_receivable').select('franchise_id, net_amount').eq('status', 'pendente'),
          supabase.from('accounts_payable').select('franchise_id, amount').eq('status', 'pendente'),
        ]);

        if (reqReceber.error) throw reqReceber.error;
        if (reqPagar.error) throw reqPagar.error;

        // Leitura pura (sem escrita) — só escopo importa, mesmo padrão do DRE.
        const papel = perfilRes?.roles as unknown as { escopo: string } | null;
        const socio = papel?.escopo === 'todas_franquias';
        setIsSocio(socio);

        const porFranquia: Record<string, Metricas> = {};
        for (const r of reqReceber.data || []) {
          porFranquia[r.franchise_id] ||= { aReceber: 0, aPagar: 0 };
          porFranquia[r.franchise_id].aReceber += Number(r.net_amount);
        }
        for (const p of reqPagar.data || []) {
          porFranquia[p.franchise_id] ||= { aReceber: 0, aPagar: 0 };
          porFranquia[p.franchise_id].aPagar += Number(p.amount);
        }

        if (socio) {
          const { data: franquiasData, error: franquiasError } = await supabase
            .from('franchises')
            .select('id, name')
            .order('name', { ascending: true });
          if (franquiasError) throw franquiasError;
          setFranquias(franquiasData || []);
        } else {
          // Não-sócio: RLS só devolve a própria franquia, então o agrupamento
          // acima já tem no máximo 1 entrada. Não precisamos do nome dela pra nada.
          setFranquias([]);
        }

        setMetricasPorFranquia(porFranquia);
      } catch (error) {
        console.error('Erro ao carregar métricas:', error);
      } finally {
        setIsLoading(false);
      }
    }

    carregarDashboard();
  }, []);

  const franquiasParaTotal = isSocio && franquiaSelecionada
    ? franquias.filter((f) => f.id === franquiaSelecionada)
    : franquias;

  const chavesParaTotal = isSocio
    ? franquiasParaTotal.map((f) => f.id)
    : Object.keys(metricasPorFranquia);

  const totais = chavesParaTotal.reduce(
    (acc, id) => {
      const m = metricasPorFranquia[id] || { aReceber: 0, aPagar: 0 };
      return { aReceber: acc.aReceber + m.aReceber, aPagar: acc.aPagar + m.aPagar };
    },
    { aReceber: 0, aPagar: 0 }
  );
  const saldoTotal = totais.aReceber - totais.aPagar;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-stone-800">Visão Geral</h1>
          <p className="text-stone-500 text-sm mt-1">
            {isSocio ? 'Acompanhe os números de todas as franquias.' : 'Acompanhe a saúde financeira da sua franquia.'}
          </p>
        </div>
        {isSocio && (
          <select
            className="px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none bg-white text-stone-700 text-sm"
            value={franquiaSelecionada}
            onChange={(e) => setFranquiaSelecionada(e.target.value)}
          >
            <option value="">Todas as franquias</option>
            {franquias.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm flex flex-col justify-center">
          <div className="flex items-center gap-2 text-emerald-600 mb-2">
            <span className="text-xl">📈</span>
            <span className="font-medium text-sm uppercase tracking-wider">A Receber (Pendente)</span>
          </div>
          {isLoading ? (
            <div className="h-8 bg-stone-100 animate-pulse rounded w-1/2"></div>
          ) : (
            <span className="text-3xl font-bold text-stone-800">{formatCurrency(totais.aReceber)}</span>
          )}
        </div>

        <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm flex flex-col justify-center">
          <div className="flex items-center gap-2 text-red-500 mb-2">
            <span className="text-xl">📉</span>
            <span className="font-medium text-sm uppercase tracking-wider">A Pagar (Pendente)</span>
          </div>
          {isLoading ? (
            <div className="h-8 bg-stone-100 animate-pulse rounded w-1/2"></div>
          ) : (
            <span className="text-3xl font-bold text-stone-800">{formatCurrency(totais.aPagar)}</span>
          )}
        </div>

        <div className="bg-stone-900 p-6 rounded-xl border border-stone-800 shadow-sm flex flex-col justify-center text-white">
          <div className="flex items-center gap-2 text-amber-400 mb-2">
            <span className="text-xl">💰</span>
            <span className="font-medium text-sm uppercase tracking-wider">Saldo Projetado</span>
          </div>
          {isLoading ? (
            <div className="h-8 bg-stone-800 animate-pulse rounded w-1/2"></div>
          ) : (
            <span className="text-3xl font-bold">{formatCurrency(saldoTotal)}</span>
          )}
        </div>
      </div>

      {isSocio && !isLoading && (
        <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-stone-600">
              <thead className="bg-stone-50 border-b border-stone-200 text-stone-500 uppercase text-xs font-medium">
                <tr>
                  <th className="sticky left-0 z-10 bg-stone-50 px-6 py-4">Franquia</th>
                  <th className="px-6 py-4">A Receber</th>
                  <th className="px-6 py-4">A Pagar</th>
                  <th className="px-6 py-4">Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {franquias.map((f) => {
                  const m = metricasPorFranquia[f.id] || { aReceber: 0, aPagar: 0 };
                  return (
                    <tr key={f.id} className="hover:bg-stone-50/50 transition-colors">
                      <td className="sticky left-0 z-10 bg-white px-6 py-4 font-medium text-stone-800">{f.name}</td>
                      <td className="px-6 py-4 text-emerald-600">{formatCurrency(m.aReceber)}</td>
                      <td className="px-6 py-4 text-red-500">{formatCurrency(m.aPagar)}</td>
                      <td className="px-6 py-4 font-semibold">{formatCurrency(m.aReceber - m.aPagar)}</td>
                    </tr>
                  );
                })}
                <tr className="bg-stone-50 font-semibold text-stone-800">
                  <td className="sticky left-0 z-10 bg-stone-50 px-6 py-4">Total</td>
                  <td className="px-6 py-4">{formatCurrency(franquias.reduce((acc, f) => acc + (metricasPorFranquia[f.id]?.aReceber || 0), 0))}</td>
                  <td className="px-6 py-4">{formatCurrency(franquias.reduce((acc, f) => acc + (metricasPorFranquia[f.id]?.aPagar || 0), 0))}</td>
                  <td className="px-6 py-4">{formatCurrency(franquias.reduce((acc, f) => acc + ((metricasPorFranquia[f.id]?.aReceber || 0) - (metricasPorFranquia[f.id]?.aPagar || 0)), 0))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-8">
        {isSocio && !franquiaSelecionada ? (
          <IndexedMetricsChart />
        ) : (
          <FluxoCaixaChart franchiseId={isSocio ? (franquiaSelecionada || undefined) : undefined} />
        )}
      </div>
    </div>
  );
}
