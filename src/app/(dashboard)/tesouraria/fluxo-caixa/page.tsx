'use client';

import React, { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';
import { supabase } from '../../../../lib/supabase';
import { formatCurrency } from '../../../../lib/format';
import { rotuloDoMes } from '../../../../lib/date';
import { useFluxoCaixa, DIAS_HISTORICO_VENDAS } from './useFluxoCaixa';

interface Franquia {
  id: string;
  name: string;
}

export default function FluxoCaixaPage() {
  const [isSocio, setIsSocio] = useState(false);
  const [franquias, setFranquias] = useState<Franquia[]>([]);
  const [franquiaSelecionada, setFranquiaSelecionada] = useState('');

  const { meses, isLoading, erro } = useFluxoCaixa(franquiaSelecionada || undefined);

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

  const dadosGrafico = meses.map((m) => ({ ...m, rotulo: rotuloDoMes(m.mes) }));

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-stone-800">Fluxo de Caixa</h1>
          <p className="text-stone-500 text-sm mt-1">
            Projeção dos próximos meses — entradas estimadas a partir das vendas, saídas a
            partir das contas a pagar e das recorrências.
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

      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800">
        <strong>Isto é uma projeção, não um extrato.</strong> As entradas são estimadas pela
        média de faturamento de cada dia da semana nos últimos {DIAS_HISTORICO_VENDAS} dias —
        não consideram sazonalidade (Natal, Dia das Mães) nem campanhas. As saídas somam as
        contas já lançadas com as recorrências ainda não geradas. Não há saldo bancário inicial:
        cada mês mostra o resultado dele, não o caixa acumulado.
      </div>

      {erro ? (
        <div className="bg-white border border-stone-200 rounded-xl p-6 text-center text-red-500 text-sm">{erro}</div>
      ) : isLoading ? (
        <div className="bg-white border border-stone-200 rounded-xl p-8 text-center text-stone-400 text-sm">
          Calculando projeção...
        </div>
      ) : (
        <>
          <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-4 sm:p-6">
            <h3 className="text-base font-medium text-stone-700 mb-4">Resultado por mês</h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={dadosGrafico} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
                <XAxis dataKey="rotulo" stroke="#a8a29e" fontSize={11} tickLine={false} />
                <Tooltip
                  formatter={(value) => formatCurrency(Number(value))}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e7e5e4' }}
                />
                <ReferenceLine y={0} stroke="#a8a29e" />
                <Bar dataKey="resultado" name="Resultado" radius={[4, 4, 0, 0]}>
                  {dadosGrafico.map((m) => (
                    <Cell key={m.mes} fill={m.resultado >= 0 ? '#059669' : '#ef4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden">
            <ul className="divide-y divide-stone-100">
              {meses.map((m) => (
                <li key={m.mes} className="px-4 sm:px-6 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium text-stone-700">
                      {rotuloDoMes(m.mes)}
                      {m.ehMesCorrente && (
                        <span className="ml-2 text-[11px] font-normal text-stone-400">
                          (mês corrente — só os dias que faltam)
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
                  <p className="text-[11px] text-stone-400 tabular-nums mt-1">
                    Entradas {formatCurrency(m.entradas)} · Saídas {formatCurrency(m.saidas)}
                    {m.saidasProjetadas > 0 && (
                      <> · sendo {formatCurrency(m.saidasProjetadas)} de recorrências ainda não lançadas</>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
