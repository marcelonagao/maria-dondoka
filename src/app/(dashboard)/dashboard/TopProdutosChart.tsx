'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import { formatCurrency } from '../../../lib/format';
import { mesAtualBrasilia, intervaloDoMes } from '../../../lib/date';

interface LinhaProduto {
  rotulo: string;
  receita: number;
  unidades: number;
}

export default function TopProdutosChart({
  franchiseId,
  refreshKey = 0,
}: {
  franchiseId?: string;
  refreshKey?: number;
}) {
  const [isLoading, setIsLoading] = useState(true);
  const [mesSelecionado, setMesSelecionado] = useState(mesAtualBrasilia());
  const [topProdutos, setTopProdutos] = useState<LinhaProduto[]>([]);

  useEffect(() => {
    async function carregar() {
      try {
        setIsLoading(true);
        const { inicio, fim } = intervaloDoMes(mesSelecionado);

        // O ranking (agrupamento por nome/SKU/código, soma e corte no top 15) roda dentro
        // de `resumo_vendas` no Postgres — o navegador recebe 15 linhas, não o mês inteiro
        // de vendas_itens.
        const { data, error } = await supabase.rpc('resumo_vendas', {
          p_franchise_id: franchiseId || null,
          p_data_inicio: inicio,
          p_data_fim: fim,
        });
        if (error) throw error;

        const produtos = ((data as { top_produtos?: LinhaProduto[] } | null)?.top_produtos || []).map((p) => ({
          rotulo: p.rotulo,
          receita: Number(p.receita) || 0,
          unidades: Number(p.unidades) || 0,
        }));
        setTopProdutos(produtos);
      } catch (error) {
        console.error('Erro ao carregar top produtos:', error);
        setTopProdutos([]);
      } finally {
        setIsLoading(false);
      }
    }

    carregar();
  }, [mesSelecionado, franchiseId, refreshKey]);

  return (
    <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden">
      <div className="p-4 sm:p-6 border-b border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-medium text-stone-700">Top 15 Produtos por Faturamento</h3>
          <p className="text-xs text-stone-400 mt-1">
            Vendas anteriores a 15/09/2026 ainda não têm nome de produto sincronizado — aparecem
            pelo SKU ou código interno do PDV.
          </p>
        </div>
        <input
          type="month"
          value={mesSelecionado}
          onChange={(e) => setMesSelecionado(e.target.value)}
          className="w-full sm:w-auto px-3 py-2 border border-stone-300 rounded-lg text-xs text-stone-700 outline-none focus:ring-2 focus:ring-stone-400"
        />
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-stone-400 text-sm min-h-[200px] flex items-center justify-center">Carregando...</div>
      ) : topProdutos.length === 0 ? (
        <div className="p-8 min-h-[200px] flex flex-col items-center justify-center gap-2">
          <p className="text-stone-400 text-sm">Nenhuma venda com produto identificado nesse período.</p>
          <p className="text-stone-300 text-xs">Os dados aparecem aqui assim que o PDV sincronizar vendas granulares.</p>
        </div>
      ) : (
        // Lista em vez de gráfico de barras: o rótulo de produto é longo demais pra um eixo
        // vertical em tela de celular (comia ~40% da largura e ainda truncava). Aqui o nome
        // ocupa a linha inteira e a barra fica embaixo, proporcional ao 1º colocado.
        <ol className="divide-y divide-stone-100">
          {topProdutos.map((produto, i) => {
            const pct = topProdutos[0].receita > 0 ? (produto.receita / topProdutos[0].receita) * 100 : 0;
            return (
              <li key={produto.rotulo} className="px-4 sm:px-6 py-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs text-stone-400 tabular-nums w-5 shrink-0">{i + 1}</span>
                  <span className="text-sm text-stone-700 truncate flex-1" title={produto.rotulo}>
                    {produto.rotulo}
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-stone-800 shrink-0">
                    {formatCurrency(produto.receita)}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1.5 pl-7">
                  <div className="h-1.5 flex-1 bg-stone-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-600 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[11px] text-stone-400 tabular-nums shrink-0">
                    {produto.unidades.toLocaleString('pt-BR')} un.
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
