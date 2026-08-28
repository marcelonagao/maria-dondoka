'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

interface PontoFluxo {
  data: string;
  entradas: number;
  saidas: number;
}

interface Discrepancia {
  data: string;
  diferenca: number;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const formatDataCurta = (isoDate: string) =>
  new Date(isoDate + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

export default function FluxoCaixaChart() {
  const [pontos, setPontos] = useState<PontoFluxo[]>([]);
  const [discrepancias, setDiscrepancias] = useState<Discrepancia[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    async function carregar() {
      try {
        setIsLoading(true);
        setErro(null);

        const desde = new Date();
        desde.setDate(desde.getDate() - 30);
        const desdeISO = desde.toISOString().slice(0, 10);

        const [fechamentosRes, pagarRes] = await Promise.all([
          supabase
            .from('fechamentos_caixa')
            .select('data_fechamento, valor_vendas_dinheiro, valor_vendas_cartao, valor_vendas_pix, valor_esperado, valor_contado')
            .gte('data_fechamento', desdeISO)
            .order('data_fechamento', { ascending: true }),
          supabase
            .from('accounts_payable')
            .select('due_date, amount, status')
            .eq('status', 'pago')
            .gte('due_date', desdeISO),
        ]);

        if (fechamentosRes.error) throw fechamentosRes.error;
        if (pagarRes.error) throw pagarRes.error;

        // Agrega entradas por dia (soma dos PDVs, caso haja mais de um por franquia)
        const entradasPorDia = new Map<string, number>();
        const discrepanciaPorDia = new Map<string, number>();

        for (const f of fechamentosRes.data || []) {
          const entrada = Number(f.valor_vendas_dinheiro) + Number(f.valor_vendas_cartao) + Number(f.valor_vendas_pix);
          entradasPorDia.set(f.data_fechamento, (entradasPorDia.get(f.data_fechamento) || 0) + entrada);

          const diff = Number(f.valor_contado) - Number(f.valor_esperado);
          discrepanciaPorDia.set(f.data_fechamento, (discrepanciaPorDia.get(f.data_fechamento) || 0) + diff);
        }

        const saidasPorDia = new Map<string, number>();
        for (const p of pagarRes.data || []) {
          saidasPorDia.set(p.due_date, (saidasPorDia.get(p.due_date) || 0) + Number(p.amount));
        }

        const todasAsDatas = new Set(
            Array.from(entradasPorDia.keys()).concat(Array.from(saidasPorDia.keys()))
          );
        const pontosOrdenados = Array.from(todasAsDatas)
          .sort()
          .map((data) => ({
            data,
            entradas: entradasPorDia.get(data) || 0,
            saidas: saidasPorDia.get(data) || 0,
          }));

        const discrepanciasOrdenadas = Array.from(discrepanciaPorDia.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([data, diferenca]) => ({ data, diferenca }));

        setPontos(pontosOrdenados);
        setDiscrepancias(discrepanciasOrdenadas);
      } catch (err) {
        console.error('Erro ao carregar fluxo de caixa:', err);
        setErro('Não foi possível carregar o gráfico. Tente novamente.');
      } finally {
        setIsLoading(false);
      }
    }

    carregar();
  }, []);

  const totalDiscrepancia = discrepancias.reduce((acc, d) => acc + d.diferenca, 0);
  const temFalta = totalDiscrepancia < -0.01;
  const temSobra = totalDiscrepancia > 0.01;

  if (isLoading) {
    return (
      <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-6 min-h-[300px] flex items-center justify-center">
        <div className="text-stone-400 text-sm">Carregando fluxo de caixa...</div>
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
        <p className="text-stone-400 text-sm">Nenhum fechamento de caixa nos últimos 30 dias.</p>
        <p className="text-stone-300 text-xs">Os dados aparecem aqui assim que o PDV sincronizar.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-6">
        <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wider mb-4">
          Entradas vs Saídas (últimos 30 dias)
        </h3>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={pontos}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
            <XAxis dataKey="data" tickFormatter={formatDataCurta} stroke="#a8a29e" fontSize={12} />
            <YAxis
              stroke="#a8a29e"
              fontSize={12}
              tickFormatter={(v) => `R$ ${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip
  formatter={(value) => formatCurrency(Number(value))}
  labelFormatter={(label) => formatDataCurta(String(label))}
/>
            <Legend />
            <Bar dataKey="entradas" name="Entradas" fill="#059669" radius={[4, 4, 0, 0]} />
            <Bar dataKey="saidas" name="Saídas" fill="#ef4444" radius={[4, 4, 0, 0]} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wider">
            Diferença de Caixa (contado vs. esperado)
          </h3>
          {(temFalta || temSobra) && (
            <span
              className={`px-2.5 py-1 text-xs font-medium rounded-md ${
                temFalta ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'
              }`}
            >
              {temFalta ? 'Falta acumulada' : 'Sobra acumulada'}: {formatCurrency(Math.abs(totalDiscrepancia))}
            </span>
          )}
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={discrepancias}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
            <XAxis dataKey="data" tickFormatter={formatDataCurta} stroke="#a8a29e" fontSize={12} />
            <YAxis stroke="#a8a29e" fontSize={12} tickFormatter={(v) => formatCurrency(v)} width={90} />
            <Tooltip formatter={(value) => formatCurrency(Number(value))} labelFormatter={formatDataCurta} />
            <Line
              type="monotone"
              dataKey="diferenca"
              name="Diferença"
              stroke="#d97706"
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
        <p className="text-xs text-stone-400 mt-3">
          Valores negativos indicam falta no caixa (contado abaixo do esperado); positivos indicam sobra.
        </p>
      </div>
    </div>
  );
}