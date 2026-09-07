'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '../../../lib/supabase';
import { mesAtualBrasilia, intervaloDoMes, intervaloDoTrimestre, intervaloDoAno } from '../../../lib/date';

// Paleta exclusiva desta tela (não usa amber/emerald/rose do resto do app) — via classes
// Tailwind arbitrárias, sem mexer em tailwind.config.ts. Ajustável se o hex final mudar.
const ACCENT = '#1B4B54';
const NEGATIVO = '#B04A3E';

// 6 categorias-pai reais de despesa, reorganizadas no plano_contas pra consolidar tudo
// nessas raízes (confirmado por query direta — não são um subconjunto arbitrário).
const CATEGORIAS_DESPESA = [
  { id: '4a87fce5-cc45-4890-9891-d2dceee1b6ee', nome: 'Despesas com Pessoal' },
  { id: 'ca2797d7-73af-4b76-962d-c9b1ad0524aa', nome: 'Despesas Administrativas' },
  { id: 'e3eb3868-cd57-4414-8343-7d1cc0bcfb82', nome: 'Despesas Comerciais' },
  { id: '175f9ea8-647a-4ed4-af46-633d273c226d', nome: 'Impostos e Taxas' },
  { id: 'd773b6a5-e011-433d-b250-8dec499daf5a', nome: 'Despesas Financeiras' },
  { id: '1ecc8adc-6233-478b-adef-7163cf19a5fa', nome: 'Despesas Diversas' },
] as const;
const CATEGORIA_IMPOSTOS_ID = '175f9ea8-647a-4ed4-af46-633d273c226d';

type Granularidade = 'mes' | 'trimestre' | 'ano';

interface Franquia {
  id: string;
  name: string;
}

interface DespesaCategoria {
  categoria_id: string;
  categoria: string;
  valor: number;
}

interface ResultadoDRE {
  receita_bruta: number;
  deducoes: number;
  receita_liquida: number;
  custos: number;
  lucro_bruto: number;
  despesas_por_categoria: DespesaCategoria[];
  despesas_total: number;
  resultado_liquido: number;
  quantidade_vendas: number;
  ticket_medio: number;
}

interface ItemDrillDown {
  id: string;
  description: string;
  amount: number;
  paid_at: string;
  franchises: { name: string } | null;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const formatNumero = (value: number) =>
  value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function valorCategoria(resultado: ResultadoDRE | null, categoriaId: string): number {
  return resultado?.despesas_por_categoria.find((d) => d.categoria_id === categoriaId)?.valor || 0;
}

// null = sem base de comparação significativa (período anterior zerado, atual não-zero).
function variacaoPct(atual: number, anterior: number): number | null {
  if (anterior === 0) return atual === 0 ? 0 : null;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}

function VariacaoBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-stone-400 text-xs">novo</span>;
  const cor = pct >= 0 ? ACCENT : NEGATIVO;
  const seta = pct >= 0 ? '▲' : '▼';
  return (
    <span className="text-xs font-medium tabular-nums" style={{ color: cor }}>
      {seta} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function mesAnterior(mesAno: string): string {
  const [ano, mes] = mesAno.split('-').map(Number);
  const d = new Date(ano, mes - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function DrePage() {
  const [isLoading, setIsLoading] = useState(true);
  const [isExportando, setIsExportando] = useState(false);
  const [podeVerVariasFranquias, setPodeVerVariasFranquias] = useState(false);
  const [franquias, setFranquias] = useState<Franquia[]>([]);
  const [franquiaSelecionada, setFranquiaSelecionada] = useState('');

  const [granularidade, setGranularidade] = useState<Granularidade>('mes');
  const [mesSelecionado, setMesSelecionado] = useState(mesAtualBrasilia());
  const anoAtual = Number(mesAtualBrasilia().slice(0, 4));
  const [anoSelecionado, setAnoSelecionado] = useState(anoAtual);
  const [trimestreSelecionado, setTrimestreSelecionado] = useState<1 | 2 | 3 | 4>(
    (Math.floor((Number(mesAtualBrasilia().slice(5, 7)) - 1) / 3) + 1) as 1 | 2 | 3 | 4
  );

  const [resultadoAtual, setResultadoAtual] = useState<ResultadoDRE | null>(null);
  const [resultadoAnterior, setResultadoAnterior] = useState<ResultadoDRE | null>(null);
  const [resultadosPorFranquia, setResultadosPorFranquia] = useState<Map<string, ResultadoDRE>>(new Map());

  const [categoriaAberta, setCategoriaAberta] = useState<{ id: string; nome: string } | null>(null);
  const [itensDrillDown, setItensDrillDown] = useState<ItemDrillDown[]>([]);
  const [carregandoDrillDown, setCarregandoDrillDown] = useState(false);

  const periodoAtual = useMemo(() => {
    if (granularidade === 'mes') return intervaloDoMes(mesSelecionado);
    if (granularidade === 'trimestre') return intervaloDoTrimestre(anoSelecionado, trimestreSelecionado);
    return intervaloDoAno(anoSelecionado);
  }, [granularidade, mesSelecionado, anoSelecionado, trimestreSelecionado]);

  const periodoAnterior = useMemo(() => {
    if (granularidade === 'mes') return intervaloDoMes(mesAnterior(mesSelecionado));
    if (granularidade === 'trimestre') {
      return trimestreSelecionado === 1
        ? intervaloDoTrimestre(anoSelecionado - 1, 4)
        : intervaloDoTrimestre(anoSelecionado, (trimestreSelecionado - 1) as 1 | 2 | 3);
    }
    return intervaloDoAno(anoSelecionado - 1);
  }, [granularidade, mesSelecionado, anoSelecionado, trimestreSelecionado]);

  useEffect(() => {
    async function carregar() {
      try {
        setIsLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: perfil } = await supabase
          .from('profiles')
          .select('roles(escopo)')
          .eq('id', user.id)
          .maybeSingle();

        const papel = perfil?.roles as unknown as { escopo: string } | null;
        const podeVerVarias = papel?.escopo === 'todas_franquias';
        setPodeVerVariasFranquias(podeVerVarias);

        let franquiasAtivas: Franquia[] = [];
        if (podeVerVarias) {
          const { data: franquiasData } = await supabase.from('franchises').select('id, name').order('name', { ascending: true });
          franquiasAtivas = franquiasData || [];
          setFranquias(franquiasAtivas);
        }

        const franchiseIdParam = franquiaSelecionada || null;

        const [atualRes, anteriorRes] = await Promise.all([
          supabase.rpc('calcular_resultado_dre', {
            p_franchise_id: franchiseIdParam,
            p_data_inicio: periodoAtual.inicio,
            p_data_fim: periodoAtual.fim,
          }),
          supabase.rpc('calcular_resultado_dre', {
            p_franchise_id: franchiseIdParam,
            p_data_inicio: periodoAnterior.inicio,
            p_data_fim: periodoAnterior.fim,
          }),
        ]);

        if (atualRes.error) throw atualRes.error;
        if (anteriorRes.error) throw anteriorRes.error;
        setResultadoAtual(atualRes.data as ResultadoDRE);
        setResultadoAnterior(anteriorRes.data as ResultadoDRE);

        if (podeVerVarias && franquiasAtivas.length > 0) {
          const porFranquiaRes = await Promise.all(
            franquiasAtivas.map((f) =>
              supabase
                .rpc('calcular_resultado_dre', {
                  p_franchise_id: f.id,
                  p_data_inicio: periodoAtual.inicio,
                  p_data_fim: periodoAtual.fim,
                })
                .then((res) => ({ franchiseId: f.id, data: res.data as ResultadoDRE | null, error: res.error }))
            )
          );
          const mapa = new Map<string, ResultadoDRE>();
          for (const r of porFranquiaRes) {
            if (!r.error && r.data) mapa.set(r.franchiseId, r.data);
          }
          setResultadosPorFranquia(mapa);
        } else {
          setResultadosPorFranquia(new Map());
        }
      } catch (error) {
        console.error('Erro ao carregar DRE:', error);
      } finally {
        setIsLoading(false);
      }
    }

    carregar();
  }, [franquiaSelecionada, periodoAtual, periodoAnterior]);

  const abrirDrillDown = useCallback(
    async (categoria: { id: string; nome: string }) => {
      setCategoriaAberta(categoria);
      setCarregandoDrillDown(true);
      try {
        // Mesma lógica de categoria_raiz() do SQL, refeita aqui em JS — sobe a árvore de
        // plano_contas até achar a raiz (categoria_pai_id null), pra cada conta usada nos
        // lançamentos. Evita criar mais uma função no banco só pra filtrar no client.
        const [planoContasRes, itensRes] = await Promise.all([
          supabase.from('plano_contas').select('id, categoria_pai_id'),
          (() => {
            let query = supabase
              .from('accounts_payable')
              .select('id, description, amount, paid_at, plano_conta_id, franchises(name)')
              .not('paid_at', 'is', null)
              .gte('paid_at', periodoAtual.inicio)
              .lte('paid_at', periodoAtual.fim + 'T23:59:59')
              .order('paid_at', { ascending: false });
            if (franquiaSelecionada) query = query.eq('franchise_id', franquiaSelecionada);
            return query;
          })(),
        ]);
        if (planoContasRes.error) throw planoContasRes.error;
        if (itensRes.error) throw itensRes.error;

        const paiPorConta = new Map<string, string | null>(
          (planoContasRes.data || []).map((c) => [c.id, c.categoria_pai_id])
        );
        const resolverRaiz = (contaId: string | null): string | null => {
          let atual = contaId;
          const visitados = new Set<string>();
          while (atual && !visitados.has(atual)) {
            visitados.add(atual);
            const pai = paiPorConta.get(atual);
            if (!pai) return atual;
            atual = pai;
          }
          return atual;
        };

        const itensFiltrados = (itensRes.data || []).filter(
          (item: any) => resolverRaiz(item.plano_conta_id) === categoria.id
        );
        setItensDrillDown(itensFiltrados as unknown as ItemDrillDown[]);
      } catch (error) {
        console.error('Erro ao abrir detalhamento:', error);
        setItensDrillDown([]);
      } finally {
        setCarregandoDrillDown(false);
      }
    },
    [periodoAtual, franquiaSelecionada]
  );

  const exportarExcel = async () => {
    setIsExportando(true);
    try {
      const res = await fetch('/api/dre/exportar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          franchiseId: franquiaSelecionada || null,
          dataInicio: periodoAtual.inicio,
          dataFim: periodoAtual.fim,
        }),
      });
      if (!res.ok) throw new Error('Falha ao exportar.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `DRE_${periodoAtual.inicio}_a_${periodoAtual.fim}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Erro ao exportar Excel:', error);
      alert('Erro ao exportar. Verifique o console.');
    } finally {
      setIsExportando(false);
    }
  };

  const resultadoLiquido = resultadoAtual?.resultado_liquido ?? 0;
  const variacaoResultado = variacaoPct(resultadoLiquido, resultadoAnterior?.resultado_liquido ?? 0);
  const impostosAtual = valorCategoria(resultadoAtual, CATEGORIA_IMPOSTOS_ID);

  const franquiasOrdenadas = useMemo(() => {
    return Array.from(resultadosPorFranquia.entries())
      .map(([id, r]) => ({
        id,
        nome: franquias.find((f) => f.id === id)?.name || id,
        resultado: r.resultado_liquido,
        margem: r.receita_bruta > 0 ? (r.resultado_liquido / r.receita_bruta) * 100 : 0,
      }))
      .sort((a, b) => b.resultado - a.resultado);
  }, [resultadosPorFranquia, franquias]);

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-stone-800">DRE</h1>
          <p className="text-stone-500 text-sm mt-1">
            DRE gerencial (regime de caixa) — não substitui o DRE contábil oficial.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 outline-none bg-white text-stone-700 text-sm"
            value={granularidade}
            onChange={(e) => setGranularidade(e.target.value as Granularidade)}
          >
            <option value="mes">Mês</option>
            <option value="trimestre">Trimestre</option>
            <option value="ano">Ano</option>
          </select>

          {granularidade === 'mes' && (
            <input
              type="month"
              value={mesSelecionado}
              onChange={(e) => setMesSelecionado(e.target.value)}
              className="px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 outline-none text-stone-700 text-sm"
            />
          )}
          {granularidade === 'trimestre' && (
            <>
              <select
                className="px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 outline-none bg-white text-stone-700 text-sm"
                value={trimestreSelecionado}
                onChange={(e) => setTrimestreSelecionado(Number(e.target.value) as 1 | 2 | 3 | 4)}
              >
                <option value={1}>T1</option>
                <option value={2}>T2</option>
                <option value={3}>T3</option>
                <option value={4}>T4</option>
              </select>
              <select
                className="px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 outline-none bg-white text-stone-700 text-sm"
                value={anoSelecionado}
                onChange={(e) => setAnoSelecionado(Number(e.target.value))}
              >
                {[anoAtual, anoAtual - 1, anoAtual - 2].map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </>
          )}
          {granularidade === 'ano' && (
            <select
              className="px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 outline-none bg-white text-stone-700 text-sm"
              value={anoSelecionado}
              onChange={(e) => setAnoSelecionado(Number(e.target.value))}
            >
              {[anoAtual, anoAtual - 1, anoAtual - 2].map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          )}

          {podeVerVariasFranquias && (
            <select
              className="px-3 py-2 rounded-lg outline-none text-sm border"
              style={
                franquiaSelecionada
                  ? { background: ACCENT, color: 'white', borderColor: ACCENT }
                  : { background: 'white', color: '#44403c', borderColor: '#d6d3d1' }
              }
              value={franquiaSelecionada}
              onChange={(e) => setFranquiaSelecionada(e.target.value)}
            >
              <option value="">Todas as franquias</option>
              {franquias.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          )}

          <button
            onClick={exportarExcel}
            disabled={isExportando || isLoading}
            className="px-3 py-2 border border-stone-300 rounded-lg text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
          >
            {isExportando ? 'Exportando...' : 'Exportar Excel'}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-stone-400 text-sm">Carregando...</div>
      ) : (
        <>
          {/* Hero — Resultado Líquido */}
          <div className="bg-white border border-stone-200 p-6">
            <p className="text-sm font-medium text-stone-500">Resultado Líquido</p>
            <div className="flex items-baseline gap-3 mt-1">
              <p className="text-4xl sm:text-5xl font-bold tabular-nums tracking-tight" style={{ color: resultadoLiquido >= 0 ? '#1c1917' : NEGATIVO }}>
                {formatCurrency(resultadoLiquido)}
              </p>
              <VariacaoBadge pct={variacaoResultado} />
            </div>
          </div>

          {/* Faixa de KPIs */}
          <div className="bg-white border border-stone-200 grid grid-cols-2 sm:grid-cols-5 divide-x divide-y sm:divide-y-0 divide-stone-200">
            <div className="p-4">
              <p className="text-xs font-medium text-stone-500">Faturamento Bruto</p>
              <p className="text-lg font-semibold tabular-nums text-stone-800 mt-1">{formatCurrency(resultadoAtual?.receita_bruta ?? 0)}</p>
            </div>
            <div className="p-4">
              <p className="text-xs font-medium text-stone-500">Quantidade de Vendas</p>
              <p className="text-lg font-semibold tabular-nums text-stone-800 mt-1">{resultadoAtual?.quantidade_vendas ?? 0}</p>
            </div>
            <div className="p-4">
              <p className="text-xs font-medium text-stone-500">Ticket Médio</p>
              <p className="text-lg font-semibold tabular-nums text-stone-800 mt-1">{formatCurrency(resultadoAtual?.ticket_medio ?? 0)}</p>
            </div>
            <div className="p-4">
              <p className="text-xs font-medium text-stone-500">Custo (CMV)</p>
              <p className="text-lg font-semibold tabular-nums text-stone-800 mt-1">{formatCurrency(resultadoAtual?.custos ?? 0)}</p>
            </div>
            <div className="p-4">
              <p className="text-xs font-medium text-stone-500">Impostos</p>
              <p className="text-lg font-semibold tabular-nums text-stone-800 mt-1">{formatCurrency(impostosAtual)}</p>
              <p className="text-xs text-stone-400 mt-0.5">DAS, ISS e tributos pagos via Contas a Pagar</p>
            </div>
          </div>

          {/* Tabela de DRE */}
          <div className="bg-white border border-stone-200">
            <table className="w-full text-left text-sm">
              <tbody>
                <LinhaDRE
                  label="Receita Bruta"
                  atual={resultadoAtual?.receita_bruta ?? 0}
                  anterior={resultadoAnterior?.receita_bruta ?? 0}
                />
                <LinhaDRE
                  label="(–) Deduções"
                  sub="ICM sobre vendas (calculado por produto)"
                  atual={resultadoAtual?.deducoes ?? 0}
                  anterior={resultadoAnterior?.deducoes ?? 0}
                  negativo
                />
                <LinhaDRE
                  label="= Receita Líquida"
                  atual={resultadoAtual?.receita_liquida ?? 0}
                  anterior={resultadoAnterior?.receita_liquida ?? 0}
                  destaque
                />
                <LinhaDRE
                  label="(–) Custos (CMV)"
                  atual={resultadoAtual?.custos ?? 0}
                  anterior={resultadoAnterior?.custos ?? 0}
                  negativo
                />
                <LinhaDRE
                  label="= Lucro Bruto"
                  atual={resultadoAtual?.lucro_bruto ?? 0}
                  anterior={resultadoAnterior?.lucro_bruto ?? 0}
                  destaque
                />
                <LinhaDRE
                  label="(–) Despesas Operacionais"
                  atual={resultadoAtual?.despesas_total ?? 0}
                  anterior={resultadoAnterior?.despesas_total ?? 0}
                  negativo
                />
                {CATEGORIAS_DESPESA.map((cat) => (
                  <tr
                    key={cat.id}
                    className="hover:bg-stone-50 cursor-pointer transition-colors"
                    onClick={() => abrirDrillDown(cat)}
                  >
                    <td className="pl-10 pr-6 py-1.5 text-stone-500">
                      {cat.nome}
                      {cat.id === CATEGORIA_IMPOSTOS_ID && (
                        <span className="block text-xs text-stone-400">DAS, ISS e tributos pagos via Contas a Pagar</span>
                      )}
                    </td>
                    <td className="px-6 py-1.5 text-right text-stone-500 tabular-nums">
                      {formatNumero(valorCategoria(resultadoAtual, cat.id))}
                    </td>
                    <td className="px-6 py-1.5 text-right">
                      <VariacaoBadge pct={variacaoPct(valorCategoria(resultadoAtual, cat.id), valorCategoria(resultadoAnterior, cat.id))} />
                    </td>
                  </tr>
                ))}
                <tr style={{ borderTop: `2px solid ${ACCENT}` }}>
                  <td className="px-6 py-3 font-semibold text-lg text-stone-900">= Resultado Líquido</td>
                  <td className="px-6 py-3 text-right font-semibold text-lg tabular-nums" style={{ color: resultadoLiquido >= 0 ? '#1c1917' : NEGATIVO }}>
                    {formatNumero(resultadoLiquido)}
                  </td>
                  <td className="px-6 py-3 text-right">
                    <VariacaoBadge pct={variacaoResultado} />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Detalhamento por franquia */}
          {podeVerVariasFranquias && franquiasOrdenadas.length > 0 && (
            <div className="bg-white border border-stone-200">
              <div className="px-6 py-3 border-b border-stone-200">
                <h3 className="text-sm font-medium text-stone-700">Detalhamento por franquia</h3>
              </div>
              <div>
                {franquiasOrdenadas.map((f) => {
                  const atual = f.id === franquiaSelecionada;
                  return (
                    <div
                      key={f.id}
                      onClick={() => !atual && setFranquiaSelecionada(f.id)}
                      className={`flex items-center justify-between px-6 py-2 border-b border-stone-100 last:border-b-0 ${atual ? '' : 'cursor-pointer hover:bg-stone-50'}`}
                      style={atual ? { borderLeft: `3px solid ${ACCENT}`, background: `${ACCENT}0D` } : undefined}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-stone-700">{f.nome}</span>
                        {atual && (
                          <span
                            className="text-xs font-medium px-2 py-0.5 rounded"
                            style={{ background: ACCENT, color: 'white' }}
                          >
                            ATUAL
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-sm tabular-nums">
                        <span style={{ color: f.resultado >= 0 ? '#1c1917' : NEGATIVO }}>{formatCurrency(f.resultado)}</span>
                        <span className="text-stone-400 w-16 text-right">{f.margem.toFixed(1)}%</span>
                        {!atual && <span className="text-stone-300">›</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      <div>
        <Link href="/dre/margem-marcas" className="text-sm font-medium text-stone-600 hover:text-stone-800">
          Ver Top 10 Marcas por Margem Bruta →
        </Link>
      </div>

      {/* Modal de drill-down */}
      {categoriaAberta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50" onClick={() => setCategoriaAberta(null)}>
          <div className="bg-white w-full max-w-2xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center p-4 border-b border-stone-200 sticky top-0 bg-white">
              <h2 className="text-sm font-semibold text-stone-800">{categoriaAberta.nome}</h2>
              <button onClick={() => setCategoriaAberta(null)} className="text-stone-400 hover:text-stone-600">✕</button>
            </div>
            <div className="divide-y divide-stone-100">
              {carregandoDrillDown ? (
                <p className="p-4 text-sm text-stone-400">Carregando...</p>
              ) : itensDrillDown.length === 0 ? (
                <p className="p-4 text-sm text-stone-400">Nenhum lançamento nesta categoria no período.</p>
              ) : (
                itensDrillDown.map((item) => (
                  <div key={item.id} className="flex items-center justify-between px-4 py-2 text-sm">
                    <div>
                      <p className="text-stone-700">{item.description}</p>
                      <p className="text-xs text-stone-400">
                        {new Date(item.paid_at).toLocaleDateString('pt-BR')}
                        {item.franchises?.name && ` • ${item.franchises.name}`}
                      </p>
                    </div>
                    <span className="tabular-nums font-medium text-stone-700">{formatCurrency(item.amount)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LinhaDRE({
  label,
  sub,
  atual,
  anterior,
  negativo,
  destaque,
}: {
  label: string;
  sub?: string;
  atual: number;
  anterior: number;
  negativo?: boolean;
  destaque?: boolean;
}) {
  return (
    <tr className={destaque ? 'bg-stone-50' : ''}>
      <td className={`px-6 py-1.5 ${destaque ? 'font-semibold text-stone-800' : 'text-stone-600'}`}>
        {label}
        {sub && <span className="block text-xs text-stone-400 font-normal">{sub}</span>}
      </td>
      <td className={`px-6 py-1.5 text-right tabular-nums ${destaque ? 'font-semibold text-stone-800' : negativo ? '' : 'text-stone-600'}`} style={negativo && !destaque ? { color: NEGATIVO } : undefined}>
        {formatNumero(atual)}
      </td>
      <td className="px-6 py-1.5 text-right">
        <VariacaoBadge pct={variacaoPct(atual, anterior)} />
      </td>
    </tr>
  );
}
