'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { supabase } from '../../../../lib/supabase';
import { mesAtualBrasilia, intervaloDoMes } from '../../../../lib/date';

interface Franquia {
  id: string;
  name: string;
}

interface LinhaMarca {
  marca: string;
  receita: number;
  cmv: number;
  margem: number;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

export default function MargemMarcasPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [podeVerVariasFranquias, setPodeVerVariasFranquias] = useState(false);
  const [franquias, setFranquias] = useState<Franquia[]>([]);
  const [franquiaSelecionada, setFranquiaSelecionada] = useState('');
  const [mesSelecionado, setMesSelecionado] = useState(mesAtualBrasilia());
  const [topMarcas, setTopMarcas] = useState<LinhaMarca[]>([]);

  useEffect(() => {
    async function carregar() {
      try {
        setIsLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: perfil } = await supabase
          .from('profiles')
          .select('is_socio, pode_lancar_para_outras_franquias')
          .eq('id', user.id)
          .maybeSingle();

        const podeVerVarias = !!perfil?.is_socio || !!perfil?.pode_lancar_para_outras_franquias;
        setPodeVerVariasFranquias(podeVerVarias);

        if (podeVerVarias) {
          const { data: franquiasData } = await supabase.from('franchises').select('id, name').order('name', { ascending: true });
          setFranquias(franquiasData || []);
        }

        const { inicio, fim } = intervaloDoMes(mesSelecionado);

        let query = supabase
          .from('vendas_itens')
          .select('marca, valor_total, quantidade, custo_unitario, franchise_id')
          .gte('data_venda', inicio)
          .lte('data_venda', fim);

        if (franquiaSelecionada) {
          query = query.eq('franchise_id', franquiaSelecionada);
        }

        const { data, error } = await query;
        if (error) throw error;

        const porMarca = new Map<string, { receita: number; cmv: number }>();
        for (const item of data || []) {
          if (!item.marca) continue;
          const atual = porMarca.get(item.marca) || { receita: 0, cmv: 0 };
          atual.receita += Number(item.valor_total);
          atual.cmv += Number(item.quantidade) * Number(item.custo_unitario);
          porMarca.set(item.marca, atual);
        }

        const ranking = Array.from(porMarca.entries())
          .map(([marca, v]) => ({ marca, receita: v.receita, cmv: v.cmv, margem: v.receita - v.cmv }))
          .sort((a, b) => b.margem - a.margem)
          .slice(0, 10);

        setTopMarcas(ranking);
      } catch (error) {
        console.error('Erro ao carregar margem por marca:', error);
      } finally {
        setIsLoading(false);
      }
    }

    carregar();
  }, [mesSelecionado, franquiaSelecionada]);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dre" className="text-sm font-medium text-amber-600 hover:text-amber-700">
          ← Voltar para o DRE
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-stone-800">Top 10 Marcas por Margem Bruta</h1>
          <p className="text-stone-500 text-sm mt-1">Receita e custo do que foi vendido, agrupados por marca.</p>
        </div>
        <div className="flex items-center gap-3">
          {podeVerVariasFranquias && (
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
          <input
            type="month"
            value={mesSelecionado}
            onChange={(e) => setMesSelecionado(e.target.value)}
            className="px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none text-stone-700"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-8 text-center text-stone-400 min-h-[300px] flex items-center justify-center">Carregando...</div>
      ) : topMarcas.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-8 min-h-[300px] flex flex-col items-center justify-center gap-2">
          <p className="text-stone-400 text-sm">Nenhuma venda com marca identificada nesse período.</p>
          <p className="text-stone-300 text-xs">Os dados aparecem aqui assim que o PDV sincronizar vendas granulares.</p>
        </div>
      ) : (
        <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-6">
          <ResponsiveContainer width="100%" height={Math.max(280, topMarcas.length * 40)}>
            <BarChart data={topMarcas} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" horizontal={false} />
              <XAxis type="number" stroke="#a8a29e" fontSize={12} tickFormatter={(v) => formatCurrency(Number(v))} />
              <YAxis type="category" dataKey="marca" stroke="#a8a29e" fontSize={12} width={120} />
              <Tooltip formatter={(value) => formatCurrency(Number(value))} />
              <Bar dataKey="margem" name="Margem Bruta" radius={[0, 4, 4, 0]}>
                {topMarcas.map((entry) => (
                  <Cell key={entry.marca} fill={entry.margem >= 0 ? '#059669' : '#ef4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
