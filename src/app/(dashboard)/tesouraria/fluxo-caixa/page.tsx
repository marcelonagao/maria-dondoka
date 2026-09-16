'use client';

import React, { useState, useEffect } from 'react';
import {
  BarChart, Bar, Cell, XAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { supabase } from '../../../../lib/supabase';
import { formatCurrency } from '../../../../lib/format';
import { rotuloDoMes } from '../../../../lib/date';
import { useFluxoCaixa, useProjecao, DIAS_HISTORICO_VENDAS } from './useFluxoCaixa';

interface Franquia {
  id: string;
  name: string;
}

// Paleta do DRE (petróleo), não a cor da marca: o #EC008C é reservado à logo e ao
// número-herói de cada tela por decisão registrada no CLAUDE.md do projeto.
const COR_CUSTO = '#1B4B54';
const COR_SOBRA = '#059669';
const COR_DEFICIT = '#B04A3E';

export default function FluxoCaixaPage() {
  const [isSocio, setIsSocio] = useState(false);
  const [franquias, setFranquias] = useState<Franquia[]>([]);
  const [franquiaSelecionada, setFranquiaSelecionada] = useState('');
  const [mesAberto, setMesAberto] = useState<string | null>(null);
  const [percentualCmvTexto, setPercentualCmvTexto] = useState<string | null>(null);

  const { dados, isLoading, erro, percentualCmvApurado } = useFluxoCaixa(franquiaSelecionada || undefined);

  // Enquanto o usuário não mexe no campo, vale o percentual apurado do histórico.
  const percentualCmv =
    percentualCmvTexto === null ? percentualCmvApurado : parseFloat(percentualCmvTexto) || 0;
  const meses = useProjecao(dados, percentualCmv);

  useEffect(() => {
    async function carregarEscopo() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: perfil } = await supabase
          .from('profiles')
          .select('roles(escopo)')
          .eq('id', user.id)
          .maybeSingle();
        const papel = perfil?.roles as unknown as { escopo: string } | null;
        const socio = papel?.escopo === 'todas_franquias';
        setIsSocio(socio);
        if (socio) {
          const { data } = await supabase
            .from('franchises')
            .select('id, name')
            .eq('is_active', true)
            .order('name', { ascending: true });
          setFranquias(data || []);
        }
      } catch (err) {
        console.error('Erro ao carregar escopo:', err);
      }
    }
    carregarEscopo();
  }, []);

  // Barra empilhada: a altura total é a entrada do mês, dividida entre o que vai para
  // custo e o que sobra. Resultado negativo desce abaixo do zero, que é a leitura certa —
  // a conta não fecha dentro da receita do mês.
  const dadosGrafico = meses.map((m) => ({
    rotulo: rotuloDoMes(m.mes),
    Custo: m.saidas,
    Sobra: m.resultado,
  }));

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-stone-800">Fluxo de Caixa</h1>
          <p className="text-stone-500 text-sm mt-1">
            Projeção dos próximos meses, com as saídas separadas por grupo de contas.
          </p>
        </div>
        {isSocio && (
          <select
            className="w-full sm:w-auto px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 outline-none bg-white text-stone-700 text-sm"
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

      <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <label className="text-sm text-stone-700 font-medium">Custo da mercadoria</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="0.1"
            min="0"
            max="100"
            className="w-24 px-3 py-2 border border-stone-300 rounded-lg text-sm text-stone-700 outline-none focus:ring-2 focus:ring-stone-400 tabular-nums"
            value={percentualCmvTexto ?? percentualCmvApurado.toFixed(1)}
            onChange={(e) => setPercentualCmvTexto(e.target.value)}
          />
          <span className="text-sm text-stone-500">% da venda</span>
        </div>
        <p className="text-xs text-stone-400 sm:ml-auto">
          Real apurado nos últimos {DIAS_HISTORICO_VENDAS} dias:{' '}
          <strong className="text-stone-600">{percentualCmvApurado.toFixed(1)}%</strong>
          {percentualCmvTexto !== null && (
            <button
              type="button"
              onClick={() => setPercentualCmvTexto(null)}
              className="ml-2 text-stone-500 underline hover:text-stone-700"
            >
              usar o real
            </button>
          )}
        </p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800 space-y-1">
        <p>
          <strong>Isto é uma projeção, não um extrato.</strong> São estimados: a compra de
          mercadoria à vista (percentual acima sobre a venda projetada, descontando os boletos já
          lançados), a folha dos meses que ainda não a têm lançada, e as recorrências que o
          sistema ainda não gerou. O resto vem de contas já lançadas.
        </p>
        <p>
          Não estão modelados: sazonalidade (Natal, Dia das Mães), prazo e taxa de recebimento de
          cartão — a entrada projetada é a venda bruta, que cai no caixa depois e com desconto —
          e o saldo em conta, que o sistema não conhece. Cada mês mostra o resultado dele, não o
          caixa acumulado.
        </p>
      </div>

      {erro ? (
        <div className="bg-white border border-stone-200 rounded-xl p-6 text-center text-red-500 text-sm">{erro}</div>
      ) : isLoading ? (
        <div className="bg-white border border-stone-200 rounded-xl p-8 text-center text-stone-400 text-sm">
          Calculando projeção...
        </div>
      ) : (
        <>
          <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-4 sm:p-6 [&_.recharts-surface]:outline-none">
            <h3 className="text-base font-medium text-stone-700">Para onde vai a receita</h3>
            <p className="text-xs text-stone-400 mb-4">
              Cada barra é a entrada projetada do mês, dividida entre custo e sobra.
            </p>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={dadosGrafico} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
                <XAxis dataKey="rotulo" stroke="#a8a29e" fontSize={11} tickLine={false} />
                <Tooltip
                  formatter={(value) => formatCurrency(Number(value))}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e7e5e4' }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={0} stroke="#a8a29e" />
                <Bar dataKey="Custo" stackId="mes" fill={COR_CUSTO} />
                <Bar dataKey="Sobra" stackId="mes" radius={[4, 4, 0, 0]}>
                  {dadosGrafico.map((d) => (
                    <Cell key={d.rotulo} fill={d.Sobra >= 0 ? COR_SOBRA : COR_DEFICIT} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden">
            <ul className="divide-y divide-stone-100">
              {meses.map((m) => {
                const aberto = mesAberto === m.mes;
                return (
                  <li key={m.mes}>
                    <button
                      onClick={() => setMesAberto(aberto ? null : m.mes)}
                      className="w-full text-left px-4 sm:px-6 py-3 hover:bg-stone-50 transition-colors"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm font-medium text-stone-700">
                          <span className="text-stone-400 mr-1.5">{aberto ? '▾' : '▸'}</span>
                          {rotuloDoMes(m.mes)}
                          {m.ehMesCorrente && (
                            <span className="ml-2 text-[11px] font-normal text-stone-400">
                              (realizado no mês + projeção dos dias que faltam)
                            </span>
                          )}
                        </span>
                        <span
                          className={`text-sm font-semibold tabular-nums shrink-0 ${
                            m.resultado >= 0 ? 'text-emerald-700' : 'text-red-600'
                          }`}
                        >
                          {formatCurrency(m.resultado)}
                        </span>
                      </div>
                      <p className="text-[11px] text-stone-400 tabular-nums mt-1 pl-4">
                        Entradas {formatCurrency(m.entradas)} · Saídas {formatCurrency(m.saidas)}
                      </p>
                    </button>

                    {aberto && (
                      <div className="bg-stone-50 border-t border-stone-100 px-4 sm:px-6 py-3">
                        {m.grupos.length === 0 ? (
                          <p className="text-xs text-stone-400">Nenhuma saída prevista neste mês.</p>
                        ) : (
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-stone-500">
                                <th className="text-left font-medium pb-2">Grupo de contas</th>
                                <th className="text-right font-medium pb-2">Lançado</th>
                                <th className="text-right font-medium pb-2">Estimado</th>
                                <th className="text-right font-medium pb-2">Total</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-stone-200">
                              {m.grupos.map((g) => (
                                <tr key={g.raizId}>
                                  <td className="py-2 pr-2 text-stone-700">
                                    {g.nome}
                                    {g.origemEstimativa && (
                                      <span className="block text-[10px] text-stone-400">
                                        estimado: {g.origemEstimativa}
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2 text-right tabular-nums text-stone-700">
                                    {formatCurrency(g.lancado)}
                                  </td>
                                  <td className="py-2 text-right tabular-nums text-amber-700">
                                    {g.estimado > 0 ? formatCurrency(g.estimado) : '—'}
                                  </td>
                                  <td className="py-2 text-right tabular-nums font-semibold text-stone-800">
                                    {formatCurrency(g.total)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
