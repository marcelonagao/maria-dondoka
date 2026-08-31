'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import FluxoCaixaChart from '../dashboard/FluxoCaixaChart';

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

interface Franquia {
  id: string;
  name: string;
}

interface Metricas {
  aReceber: number;
  aPagar: number;
}

export default function ConsolidadoPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSocio, setIsSocio] = useState(false);
  const [franquias, setFranquias] = useState<Franquia[]>([]);
  const [metricasPorFranquia, setMetricasPorFranquia] = useState<Record<string, Metricas>>({});
  const [franquiaSelecionada, setFranquiaSelecionada] = useState<string>('');

  useEffect(() => {
    async function carregar() {
      try {
        setIsLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: perfil } = await supabase
          .from('profiles')
          .select('is_socio')
          .eq('id', user.id)
          .maybeSingle();

        if (!perfil?.is_socio) {
          setIsSocio(false);
          return;
        }
        setIsSocio(true);

        const [franquiasRes, receberRes, pagarRes] = await Promise.all([
          supabase.from('franchises').select('id, name').order('name', { ascending: true }),
          supabase.from('accounts_receivable').select('franchise_id, net_amount').eq('status', 'pendente'),
          supabase.from('accounts_payable').select('franchise_id, amount').eq('status', 'pendente'),
        ]);

        if (franquiasRes.error) throw franquiasRes.error;
        if (receberRes.error) throw receberRes.error;
        if (pagarRes.error) throw pagarRes.error;

        const porFranquia: Record<string, Metricas> = {};
        for (const f of franquiasRes.data || []) {
          porFranquia[f.id] = { aReceber: 0, aPagar: 0 };
        }
        for (const r of receberRes.data || []) {
          porFranquia[r.franchise_id] ||= { aReceber: 0, aPagar: 0 };
          porFranquia[r.franchise_id].aReceber += Number(r.net_amount);
        }
        for (const p of pagarRes.data || []) {
          porFranquia[p.franchise_id] ||= { aReceber: 0, aPagar: 0 };
          porFranquia[p.franchise_id].aPagar += Number(p.amount);
        }

        setFranquias(franquiasRes.data || []);
        setMetricasPorFranquia(porFranquia);
      } catch (error) {
        console.error('Erro ao carregar visão consolidada:', error);
      } finally {
        setIsLoading(false);
      }
    }

    carregar();
  }, []);

  if (isLoading) {
    return <div className="text-stone-400 text-sm">Carregando visão consolidada...</div>;
  }

  if (!isSocio) {
    return (
      <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-8 text-center">
        <p className="text-stone-500">Esta área é exclusiva para sócios.</p>
      </div>
    );
  }

  const franquiasParaTotal = franquiaSelecionada
    ? franquias.filter((f) => f.id === franquiaSelecionada)
    : franquias;

  const totais = franquiasParaTotal.reduce(
    (acc, f) => {
      const m = metricasPorFranquia[f.id] || { aReceber: 0, aPagar: 0 };
      return { aReceber: acc.aReceber + m.aReceber, aPagar: acc.aPagar + m.aPagar };
    },
    { aReceber: 0, aPagar: 0 }
  );
  const saldoTotal = totais.aReceber - totais.aPagar;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-stone-800">Visão Consolidada</h1>
          <p className="text-stone-500 text-sm mt-1">Acompanhe os números de todas as franquias.</p>
        </div>
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
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm flex flex-col justify-center">
          <div className="flex items-center gap-2 text-emerald-600 mb-2">
            <span className="text-xl">📈</span>
            <span className="font-medium text-sm uppercase tracking-wider">A Receber (Pendente)</span>
          </div>
          <span className="text-3xl font-bold text-stone-800">{formatCurrency(totais.aReceber)}</span>
        </div>

        <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm flex flex-col justify-center">
          <div className="flex items-center gap-2 text-red-500 mb-2">
            <span className="text-xl">📉</span>
            <span className="font-medium text-sm uppercase tracking-wider">A Pagar (Pendente)</span>
          </div>
          <span className="text-3xl font-bold text-stone-800">{formatCurrency(totais.aPagar)}</span>
        </div>

        <div className="bg-stone-900 p-6 rounded-xl border border-stone-800 shadow-sm flex flex-col justify-center text-white">
          <div className="flex items-center gap-2 text-amber-400 mb-2">
            <span className="text-xl">💰</span>
            <span className="font-medium text-sm uppercase tracking-wider">Saldo Projetado</span>
          </div>
          <span className="text-3xl font-bold">{formatCurrency(saldoTotal)}</span>
        </div>
      </div>

      <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-stone-600">
            <thead className="bg-stone-50 border-b border-stone-200 text-stone-500 uppercase text-xs font-medium">
              <tr>
                <th className="px-6 py-4">Franquia</th>
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
                    <td className="px-6 py-4 font-medium text-stone-800">{f.name}</td>
                    <td className="px-6 py-4 text-emerald-600">{formatCurrency(m.aReceber)}</td>
                    <td className="px-6 py-4 text-red-500">{formatCurrency(m.aPagar)}</td>
                    <td className="px-6 py-4 font-semibold">{formatCurrency(m.aReceber - m.aPagar)}</td>
                  </tr>
                );
              })}
              <tr className="bg-stone-50 font-semibold text-stone-800">
                <td className="px-6 py-4">Total</td>
                <td className="px-6 py-4">{formatCurrency(franquias.reduce((acc, f) => acc + (metricasPorFranquia[f.id]?.aReceber || 0), 0))}</td>
                <td className="px-6 py-4">{formatCurrency(franquias.reduce((acc, f) => acc + (metricasPorFranquia[f.id]?.aPagar || 0), 0))}</td>
                <td className="px-6 py-4">{formatCurrency(franquias.reduce((acc, f) => acc + ((metricasPorFranquia[f.id]?.aReceber || 0) - (metricasPorFranquia[f.id]?.aPagar || 0)), 0))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <FluxoCaixaChart franchiseId={franquiaSelecionada || undefined} />
    </div>
  );
}
