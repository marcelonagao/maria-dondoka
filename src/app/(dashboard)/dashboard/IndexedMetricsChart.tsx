'use client';

import React, { useState, useEffect } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { supabase } from '../../../lib/supabase';
import { hojeBrasilia } from '../../../lib/date';
import { buscarTodosVendasItens } from '../../../lib/vendasItens';

interface PontoIndexado {
  data: string;
  faturamento: number;
  ticketMedio: number;
  margemBrutaPct: number;
}

const formatDataCurta = (isoDate: string) =>
  new Date(isoDate + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

function ultimos30DiasDesde(): string {
  const hoje = hojeBrasilia();
  const desdeDate = new Date(hoje + 'T00:00:00Z');
  desdeDate.setUTCDate(desdeDate.getUTCDate() - 30);
  return desdeDate.toISOString().slice(0, 10);
}

export default function IndexedMetricsChart() {
  const [pontos, setPontos] = useState<PontoIndexado[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    async function carregar() {
      try {
        setIsLoading(true);
        setErro(null);

        const desde = ultimos30DiasDesde();

        const data = await buscarTodosVendasItens<{ data_venda: string; venda_referencia: string; valor_total: number; quantidade: number; custo_unitario: number; aliquota_icm: number | null }>(
          supabase,
          'data_venda, venda_referencia, valor_total, quantidade, custo_unitario, aliquota_icm',
          desde
        );

        const porDia = new Map<string, { faturamento: number; cmv: number; impostos: number; vendas: Set<string> }>();
        for (const item of data || []) {
          const atual = porDia.get(item.data_venda) || { faturamento: 0, cmv: 0, impostos: 0, vendas: new Set<string>() };
          atual.faturamento += Number(item.valor_total);
          atual.cmv += Number(item.quantidade) * Number(item.custo_unitario);
          atual.impostos += Number(item.valor_total) * (Number(item.aliquota_icm) || 0) / 100;
          atual.vendas.add(item.venda_referencia);
          porDia.set(item.data_venda, atual);
        }

        const diasOrdenados = Array.from(porDia.keys()).sort();
        const indiceBase = diasOrdenados.findIndex((d) => porDia.get(d)!.faturamento > 0);

        if (indiceBase === -1) {
          setPontos([]);
          return;
        }

        const base = porDia.get(diasOrdenados[indiceBase])!;
        const baseFaturamento = base.faturamento;
        const baseTicketMedio = base.vendas.size > 0 ? base.faturamento / base.vendas.size : 0;
        const baseMargemPct = base.faturamento > 0 ? (base.faturamento - base.cmv - base.impostos) / base.faturamento * 100 : 0;

        const pontosCalculados = diasOrdenados.slice(indiceBase).map((data) => {
          const d = porDia.get(data)!;
          const faturamento = d.faturamento;
          const ticketMedio = d.vendas.size > 0 ? d.faturamento / d.vendas.size : 0;
          const margemPct = d.faturamento > 0 ? (d.faturamento - d.cmv - d.impostos) / d.faturamento * 100 : 0;

          return {
            data,
            faturamento: baseFaturamento > 0 ? (faturamento / baseFaturamento) * 100 : 0,
            ticketMedio: baseTicketMedio > 0 ? (ticketMedio / baseTicketMedio) * 100 : 0,
            margemBrutaPct: baseMargemPct !== 0 ? (margemPct / baseMargemPct) * 100 : 0,
          };
        });

        setPontos(pontosCalculados);
      } catch (err) {
        console.error('Erro ao carregar métricas indexadas:', err);
        setErro('Não foi possível carregar o gráfico. Tente novamente.');
      } finally {
        setIsLoading(false);
      }
    }

    carregar();
  }, []);

  if (isLoading) {
    return (
      <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-6 min-h-[300px] flex items-center justify-center">
        <div className="text-stone-400 text-sm">Carregando métricas indexadas...</div>
      </div>
    );
  }

  if (erro) {
    return (
      <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-6 min-h-[300px] flex items-center justify-center">
        <p className="text-red-500 text-sm">{erro}</p>
      </div>
    );
  }

  if (pontos.length === 0) {
    return (
      <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-6 min-h-[300px] flex flex-col items-center justify-center gap-2">
        <p className="text-stone-400 text-sm">Nenhuma venda registrada nos últimos 30 dias.</p>
        <p className="text-stone-300 text-xs">Os dados aparecem aqui assim que o PDV sincronizar vendas granulares.</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-6">
      <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wider mb-1">
        Faturamento, Ticket Médio e Margem Bruta % (indexado, base 100)
      </h3>
      <p className="text-xs text-stone-400 mb-4">
        Todas as franquias somadas. Base 100 = primeiro dia com venda registrada no período.
      </p>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={pontos}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
          <XAxis dataKey="data" tickFormatter={formatDataCurta} stroke="#a8a29e" fontSize={12} />
          <YAxis stroke="#a8a29e" fontSize={12} tickFormatter={(v) => `${v}`} />
          <Tooltip
            formatter={(value) => `${Number(value).toFixed(1)}`}
            labelFormatter={(label) => formatDataCurta(String(label))}
          />
          <Legend />
          <Line type="monotone" dataKey="faturamento" name="Faturamento" stroke="#059669" strokeWidth={2} dot={{ r: 2 }} />
          <Line type="monotone" dataKey="ticketMedio" name="Ticket Médio" stroke="#d97706" strokeWidth={2} dot={{ r: 2 }} />
          <Line type="monotone" dataKey="margemBrutaPct" name="Margem Bruta %" stroke="#6366f1" strokeWidth={2} dot={{ r: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
