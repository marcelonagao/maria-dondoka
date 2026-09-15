'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { supabase } from '../../../lib/supabase';
import { formatCurrency } from '../../../lib/format';
import { hojeBrasilia, adicionarDias } from '../../../lib/date';
import { buscarTodosVendasItens } from '../../../lib/vendasItens';

type PeriodoPreset = 'hoje' | '7d' | '15d' | '30d' | 'custom';

interface Totais {
  vendasBrutas: number;
  unidades: number;
  quantidadeVendas: number;
  precoMedioUnidade: number;
  ticketMedio: number;
}

interface PontoDiario {
  data: string;
  faturamento: number;
}

interface ItemVenda {
  data_venda: string;
  venda_referencia: string;
  valor_total: number;
  quantidade: number;
  franchise_id: string;
}

const TOTAIS_VAZIOS: Totais = { vendasBrutas: 0, unidades: 0, quantidadeVendas: 0, precoMedioUnidade: 0, ticketMedio: 0 };

function diffDias(inicio: string, fim: string): number {
  const a = new Date(inicio + 'T00:00:00Z').getTime();
  const b = new Date(fim + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86400000) + 1;
}

// Período de comparação: mesma duração, imediatamente anterior ao selecionado (não a
// "semana passada" do calendário) — regra 4 da persona financeiro_senior.
function periodoAnterior(inicio: string, fim: string): { inicio: string; fim: string } {
  const dias = diffDias(inicio, fim);
  const anteriorFim = adicionarDias(inicio, -1);
  const anteriorInicio = adicionarDias(anteriorFim, -(dias - 1));
  return { inicio: anteriorInicio, fim: anteriorFim };
}

function calcularTotais(itens: ItemVenda[]): Totais {
  let vendasBrutas = 0;
  let unidades = 0;
  const vendasUnicas = new Set<string>();
  for (const item of itens) {
    vendasBrutas += Number(item.valor_total);
    unidades += Number(item.quantidade);
    vendasUnicas.add(item.venda_referencia);
  }
  const quantidadeVendas = vendasUnicas.size;
  return {
    vendasBrutas,
    unidades,
    quantidadeVendas,
    precoMedioUnidade: unidades > 0 ? vendasBrutas / unidades : 0,
    ticketMedio: quantidadeVendas > 0 ? vendasBrutas / quantidadeVendas : 0,
  };
}

// null = sem base de comparação significativa (período anterior zerado, atual não-zero) —
// mesmo critério de dre/page.tsx.
function variacaoPct(atual: number, anterior: number): number | null {
  if (anterior === 0) return atual === 0 ? 0 : null;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}

function VariacaoBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-stone-400 text-xs">novo</span>;
  const cor = pct >= 0 ? 'text-emerald-600' : 'text-rose-600';
  const seta = pct >= 0 ? '▲' : '▼';
  return (
    <span className={`text-xs font-medium tabular-nums ${cor}`}>
      {seta} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

const formatDataCurta = (isoDate: string) =>
  new Date(isoDate + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

export default function PainelVendas({ franchiseId }: { franchiseId?: string }) {
  const [preset, setPreset] = useState<PeriodoPreset>('7d');
  const [customInicio, setCustomInicio] = useState(adicionarDias(hojeBrasilia(), -6));
  const [customFim, setCustomFim] = useState(hojeBrasilia());
  const [comparar, setComparar] = useState(true);

  const [isLoading, setIsLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [totaisAtual, setTotaisAtual] = useState<Totais>(TOTAIS_VAZIOS);
  const [totaisAnterior, setTotaisAnterior] = useState<Totais>(TOTAIS_VAZIOS);
  const [pontosDiarios, setPontosDiarios] = useState<PontoDiario[]>([]);

  const { inicio, fim } = useMemo(() => {
    const hoje = hojeBrasilia();
    switch (preset) {
      case 'hoje':
        return { inicio: hoje, fim: hoje };
      case '7d':
        return { inicio: adicionarDias(hoje, -6), fim: hoje };
      case '15d':
        return { inicio: adicionarDias(hoje, -14), fim: hoje };
      case '30d':
        return { inicio: adicionarDias(hoje, -29), fim: hoje };
      case 'custom':
        return { inicio: customInicio, fim: customFim };
    }
  }, [preset, customInicio, customFim]);

  const anterior = useMemo(() => periodoAnterior(inicio, fim), [inicio, fim]);

  useEffect(() => {
    async function carregar() {
      try {
        setIsLoading(true);
        setErro(null);

        const campos = 'data_venda, venda_referencia, valor_total, quantidade, franchise_id';
        const [dadosAtual, dadosAnterior] = await Promise.all([
          buscarTodosVendasItens<ItemVenda>(supabase, campos, inicio, fim),
          comparar ? buscarTodosVendasItens<ItemVenda>(supabase, campos, anterior.inicio, anterior.fim) : Promise.resolve([]),
        ]);

        const filtrarFranquia = (itens: ItemVenda[]) =>
          franchiseId ? itens.filter((i) => i.franchise_id === franchiseId) : itens;

        const itensAtual = filtrarFranquia(dadosAtual);
        const itensAnterior = filtrarFranquia(dadosAnterior);

        setTotaisAtual(calcularTotais(itensAtual));
        setTotaisAnterior(comparar ? calcularTotais(itensAnterior) : TOTAIS_VAZIOS);

        const porDia = new Map<string, number>();
        for (const item of itensAtual) {
          porDia.set(item.data_venda, (porDia.get(item.data_venda) || 0) + Number(item.valor_total));
        }
        const pontos = Array.from(porDia.entries())
          .map(([data, faturamento]) => ({ data, faturamento }))
          .sort((a, b) => a.data.localeCompare(b.data));
        setPontosDiarios(pontos);
      } catch (err) {
        console.error('Erro ao carregar painel de vendas:', err);
        setErro('Não foi possível carregar os dados de vendas. Tente novamente.');
      } finally {
        setIsLoading(false);
      }
    }

    carregar();
  }, [inicio, fim, anterior.inicio, anterior.fim, comparar, franchiseId]);

  const mostrarGrafico = diffDias(inicio, fim) > 1;

  const presets: { valor: PeriodoPreset; rotulo: string }[] = [
    { valor: 'hoje', rotulo: 'Hoje' },
    { valor: '7d', rotulo: '7 dias' },
    { valor: '15d', rotulo: '15 dias' },
    { valor: '30d', rotulo: '30 dias' },
    { valor: 'custom', rotulo: 'Personalizado' },
  ];

  const kpis: { label: string; valor: string; variacao: number | null }[] = [
    { label: 'Vendas Brutas', valor: formatCurrency(totaisAtual.vendasBrutas), variacao: variacaoPct(totaisAtual.vendasBrutas, totaisAnterior.vendasBrutas) },
    { label: 'Unidades Vendidas', valor: totaisAtual.unidades.toLocaleString('pt-BR'), variacao: variacaoPct(totaisAtual.unidades, totaisAnterior.unidades) },
    { label: 'Preço Médio por Unidade', valor: formatCurrency(totaisAtual.precoMedioUnidade), variacao: variacaoPct(totaisAtual.precoMedioUnidade, totaisAnterior.precoMedioUnidade) },
    { label: 'Quantidade de Vendas', valor: totaisAtual.quantidadeVendas.toLocaleString('pt-BR'), variacao: variacaoPct(totaisAtual.quantidadeVendas, totaisAnterior.quantidadeVendas) },
    { label: 'Ticket Médio', valor: formatCurrency(totaisAtual.ticketMedio), variacao: variacaoPct(totaisAtual.ticketMedio, totaisAnterior.ticketMedio) },
  ];

  return (
    <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden">
      <div className="p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-200">
        <h3 className="text-base font-medium text-stone-700">Painel de Vendas</h3>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-stone-300 overflow-hidden">
            {presets.map((p) => (
              <button
                key={p.valor}
                onClick={() => setPreset(p.valor)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  preset === p.valor ? 'bg-stone-800 text-white' : 'bg-white text-stone-600 hover:bg-stone-50'
                }`}
              >
                {p.rotulo}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={customInicio}
                max={customFim}
                onChange={(e) => setCustomInicio(e.target.value)}
                className="px-2 py-1.5 border border-stone-300 rounded-lg text-xs text-stone-700 outline-none focus:ring-2 focus:ring-stone-400"
              />
              <span className="text-stone-400 text-xs">até</span>
              <input
                type="date"
                value={customFim}
                min={customInicio}
                max={hojeBrasilia()}
                onChange={(e) => setCustomFim(e.target.value)}
                className="px-2 py-1.5 border border-stone-300 rounded-lg text-xs text-stone-700 outline-none focus:ring-2 focus:ring-stone-400"
              />
            </div>
          )}
          <button
            onClick={() => setComparar((v) => !v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              comparar ? 'bg-stone-100 border-stone-300 text-stone-700' : 'bg-white border-stone-200 text-stone-400'
            }`}
          >
            {comparar ? '✓ ' : ''}Comparar com período anterior
          </button>
        </div>
      </div>

      {erro ? (
        <div className="p-6 text-center text-red-500 text-sm">{erro}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 divide-x divide-y sm:divide-y-0 divide-stone-200">
            {kpis.map((kpi) => (
              <div key={kpi.label} className="p-4">
                <p className="text-xs font-medium text-stone-500">{kpi.label}</p>
                {isLoading ? (
                  <div className="h-6 bg-stone-100 animate-pulse rounded w-2/3 mt-1.5"></div>
                ) : (
                  <>
                    <p className="text-lg font-semibold tabular-nums text-stone-800 mt-1">{kpi.valor}</p>
                    {comparar && <VariacaoBadge pct={kpi.variacao} />}
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="p-4 sm:p-6">
            {isLoading ? (
              <div className="min-h-[240px] flex items-center justify-center text-stone-400 text-sm">Carregando...</div>
            ) : !mostrarGrafico ? (
              <p className="text-stone-400 text-xs text-center py-8">
                Selecione um período com mais de 1 dia (7, 15, 30 dias ou personalizado) para ver a
                tendência diária — o PDV não registra hora da venda, só o dia.
              </p>
            ) : pontosDiarios.length === 0 ? (
              <p className="text-stone-400 text-xs text-center py-8">Nenhuma venda registrada nesse período.</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={pontosDiarios}>
                  <defs>
                    <linearGradient id="corFaturamento" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#059669" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
                  <XAxis dataKey="data" tickFormatter={formatDataCurta} stroke="#a8a29e" fontSize={12} />
                  <YAxis stroke="#a8a29e" fontSize={12} tickFormatter={(v) => formatCurrency(Number(v))} width={90} />
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} labelFormatter={(label) => formatDataCurta(String(label))} />
                  <Area type="monotone" dataKey="faturamento" name="Faturamento Bruto" stroke="#059669" strokeWidth={2} fill="url(#corFaturamento)" dot={{ r: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </>
      )}
    </div>
  );
}
