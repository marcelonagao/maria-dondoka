'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, CartesianGrid, Tooltip, ResponsiveContainer,
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
  margemBrutaPct: number;
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
  custo_unitario: number;
  aliquota_icm: number | null;
  franchise_id: string;
}

const TOTAIS_VAZIOS: Totais = {
  vendasBrutas: 0, unidades: 0, quantidadeVendas: 0, precoMedioUnidade: 0, ticketMedio: 0, margemBrutaPct: 0,
};

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
  let cmv = 0;
  let impostos = 0;
  const vendasUnicas = new Set<string>();
  for (const item of itens) {
    vendasBrutas += Number(item.valor_total);
    unidades += Number(item.quantidade);
    cmv += Number(item.quantidade) * Number(item.custo_unitario);
    impostos += (Number(item.valor_total) * (Number(item.aliquota_icm) || 0)) / 100;
    vendasUnicas.add(item.venda_referencia);
  }
  const quantidadeVendas = vendasUnicas.size;
  return {
    vendasBrutas,
    unidades,
    quantidadeVendas,
    precoMedioUnidade: unidades > 0 ? vendasBrutas / unidades : 0,
    ticketMedio: quantidadeVendas > 0 ? vendasBrutas / quantidadeVendas : 0,
    // Margem em valor absoluto (%), nunca indexada — indexar percentual contra a base de
    // outro período estoura quando a base fica perto de zero.
    margemBrutaPct: vendasBrutas > 0 ? ((vendasBrutas - cmv - impostos) / vendasBrutas) * 100 : 0,
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

interface Franquia {
  id: string;
  name: string;
}

export default function PainelVendas({
  franchiseId,
  franquias = [],
  onSelecionarFranquia,
}: {
  franchiseId?: string;
  franquias?: Franquia[];
  onSelecionarFranquia?: (id: string) => void;
}) {
  const [preset, setPreset] = useState<PeriodoPreset>('7d');
  const [customInicio, setCustomInicio] = useState(adicionarDias(hojeBrasilia(), -6));
  const [customFim, setCustomFim] = useState(hojeBrasilia());
  const [comparar, setComparar] = useState(true);

  const [isLoading, setIsLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [totaisAtual, setTotaisAtual] = useState<Totais>(TOTAIS_VAZIOS);
  const [totaisAnterior, setTotaisAnterior] = useState<Totais>(TOTAIS_VAZIOS);
  const [pontosDiarios, setPontosDiarios] = useState<PontoDiario[]>([]);
  const [totaisPorFranquia, setTotaisPorFranquia] = useState<Record<string, Totais>>({});

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

        const campos = 'data_venda, venda_referencia, valor_total, quantidade, custo_unitario, aliquota_icm, franchise_id';
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

        // Comparativo entre lojas usa sempre TODAS as franquias visíveis (não o recorte do
        // filtro) — o filtro serve pra olhar uma loja a fundo, a tabela pra comparar.
        const porFranquia: Record<string, ItemVenda[]> = {};
        for (const item of dadosAtual) {
          (porFranquia[item.franchise_id] ||= []).push(item);
        }
        setTotaisPorFranquia(
          Object.fromEntries(Object.entries(porFranquia).map(([id, itens]) => [id, calcularTotais(itens)]))
        );
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

  const franquiasOrdenadas = useMemo(
    () =>
      franquias
        .map((f) => ({ id: f.id, nome: f.name, totais: totaisPorFranquia[f.id] || TOTAIS_VAZIOS }))
        .sort((a, b) => b.totais.vendasBrutas - a.totais.vendasBrutas),
    [franquias, totaisPorFranquia]
  );

  const presets: { valor: PeriodoPreset; rotulo: string }[] = [
    { valor: 'hoje', rotulo: 'Hoje' },
    { valor: '7d', rotulo: '7 dias' },
    { valor: '15d', rotulo: '15 dias' },
    { valor: '30d', rotulo: '30 dias' },
    { valor: 'custom', rotulo: 'Personalizado' },
  ];

  const kpis: { label: string; valor: string; variacao: number | null }[] = [
    { label: 'Vendas Brutas', valor: formatCurrency(totaisAtual.vendasBrutas), variacao: variacaoPct(totaisAtual.vendasBrutas, totaisAnterior.vendasBrutas) },
    { label: 'Qtd. de Vendas', valor: totaisAtual.quantidadeVendas.toLocaleString('pt-BR'), variacao: variacaoPct(totaisAtual.quantidadeVendas, totaisAnterior.quantidadeVendas) },
    { label: 'Ticket Médio', valor: formatCurrency(totaisAtual.ticketMedio), variacao: variacaoPct(totaisAtual.ticketMedio, totaisAnterior.ticketMedio) },
    { label: 'Unidades Vendidas', valor: totaisAtual.unidades.toLocaleString('pt-BR'), variacao: variacaoPct(totaisAtual.unidades, totaisAnterior.unidades) },
    { label: 'Preço Médio/Un.', valor: formatCurrency(totaisAtual.precoMedioUnidade), variacao: variacaoPct(totaisAtual.precoMedioUnidade, totaisAnterior.precoMedioUnidade) },
    { label: 'Margem Bruta', valor: `${totaisAtual.margemBrutaPct.toFixed(1)}%`, variacao: variacaoPct(totaisAtual.margemBrutaPct, totaisAnterior.margemBrutaPct) },
  ];

  return (
    <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden">
      <div className="p-4 sm:p-6 space-y-3 border-b border-stone-200">
        <h3 className="text-base font-medium text-stone-700">Painel de Vendas</h3>

        {/* Chips ocupam a largura toda no celular (grid), viram inline no desktop. */}
        <div className="grid grid-cols-5 sm:inline-grid sm:grid-flow-col rounded-lg border border-stone-300 overflow-hidden">
          {presets.map((p) => (
            <button
              key={p.valor}
              onClick={() => setPreset(p.valor)}
              className={`px-2 sm:px-3 py-2 text-[11px] sm:text-xs font-medium leading-tight transition-colors border-r border-stone-200 last:border-r-0 ${
                preset === p.valor ? 'bg-stone-800 text-white' : 'bg-white text-stone-600'
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
              className="flex-1 min-w-0 px-2 py-1.5 border border-stone-300 rounded-lg text-xs text-stone-700 outline-none focus:ring-2 focus:ring-stone-400"
            />
            <span className="text-stone-400 text-xs shrink-0">até</span>
            <input
              type="date"
              value={customFim}
              min={customInicio}
              max={hojeBrasilia()}
              onChange={(e) => setCustomFim(e.target.value)}
              className="flex-1 min-w-0 px-2 py-1.5 border border-stone-300 rounded-lg text-xs text-stone-700 outline-none focus:ring-2 focus:ring-stone-400"
            />
          </div>
        )}

        <button
          onClick={() => setComparar((v) => !v)}
          className={`w-full sm:w-auto px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
            comparar ? 'bg-stone-100 border-stone-300 text-stone-700' : 'bg-white border-stone-200 text-stone-400'
          }`}
        >
          {comparar ? '✓ ' : ''}Comparar com período anterior
        </button>
      </div>

      {erro ? (
        <div className="p-6 text-center text-red-500 text-sm">{erro}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-x divide-y lg:divide-y-0 divide-stone-200">
            {kpis.map((kpi) => (
              <div key={kpi.label} className="p-3 sm:p-4">
                <p className="text-[11px] sm:text-xs font-medium text-stone-500 leading-tight">{kpi.label}</p>
                {isLoading ? (
                  <div className="h-6 bg-stone-100 animate-pulse rounded w-2/3 mt-1.5"></div>
                ) : (
                  <>
                    <p className="text-base sm:text-lg font-semibold tabular-nums text-stone-800 mt-1 truncate">{kpi.valor}</p>
                    {comparar && <VariacaoBadge pct={kpi.variacao} />}
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Sem eixo Y: num card de ~340px no celular ele comia quase 1/3 da largura útil.
              A escala vem do tooltip e do KPI "Vendas Brutas" logo acima. */}
          <div className="py-4 pr-3 pl-0 sm:p-6 [&_.recharts-surface]:outline-none">
            {isLoading ? (
              <div className="min-h-[220px] flex items-center justify-center text-stone-400 text-sm">Carregando...</div>
            ) : !mostrarGrafico ? (
              <p className="text-stone-400 text-xs text-center py-8 px-4">
                Selecione um período com mais de 1 dia (7, 15, 30 dias ou personalizado) para ver a
                tendência diária — o PDV não registra hora da venda, só o dia.
              </p>
            ) : pontosDiarios.length === 0 ? (
              <p className="text-stone-400 text-xs text-center py-8 px-4">Nenhuma venda registrada nesse período.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={pontosDiarios} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                  <defs>
                    <linearGradient id="corFaturamento" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#059669" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
                  <XAxis
                    dataKey="data"
                    tickFormatter={formatDataCurta}
                    stroke="#a8a29e"
                    fontSize={11}
                    tickLine={false}
                    minTickGap={24}
                  />
                  <Tooltip
                    formatter={(value) => formatCurrency(Number(value))}
                    labelFormatter={(label) => formatDataCurta(String(label))}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e7e5e4' }}
                  />
                  <Area type="monotone" dataKey="faturamento" name="Faturamento" stroke="#059669" strokeWidth={2} fill="url(#corFaturamento)" dot={false} activeDot={{ r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Comparativo por loja em linhas, não tabela de 4 colunas: no celular a tabela
              antiga só cabia com scroll horizontal. */}
          {franquiasOrdenadas.length > 0 && (
            <div className="border-t border-stone-200">
              <p className="px-4 sm:px-6 pt-4 pb-2 text-xs font-medium text-stone-500">
                Vendas por franquia no período
              </p>
              <ul className="divide-y divide-stone-100">
                {franquiasOrdenadas.map((f) => {
                  const selecionada = f.id === franchiseId;
                  return (
                    <li key={f.id}>
                      <button
                        onClick={() => onSelecionarFranquia?.(selecionada ? '' : f.id)}
                        className={`w-full text-left px-4 sm:px-6 py-2.5 transition-colors ${
                          selecionada ? 'bg-stone-50 border-l-2 border-stone-800' : 'hover:bg-stone-50'
                        }`}
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-sm text-stone-700 truncate">{f.nome}</span>
                          <span className="text-sm font-semibold tabular-nums text-stone-800 shrink-0">
                            {formatCurrency(f.totais.vendasBrutas)}
                          </span>
                        </div>
                        <p className="text-[11px] text-stone-400 tabular-nums mt-0.5">
                          {f.totais.quantidadeVendas.toLocaleString('pt-BR')} vendas · ticket{' '}
                          {formatCurrency(f.totais.ticketMedio)}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
