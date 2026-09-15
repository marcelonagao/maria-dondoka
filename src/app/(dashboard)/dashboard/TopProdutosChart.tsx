'use client';

import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { supabase } from '../../../lib/supabase';
import { formatCurrency } from '../../../lib/format';
import { mesAtualBrasilia, intervaloDoMes } from '../../../lib/date';
import { buscarTodosVendasItens } from '../../../lib/vendasItens';

interface ItemVenda {
  produto_nome: string | null;
  produto_sku: string | null;
  produto_codigo_pdv: string;
  quantidade: number;
  valor_total: number;
  franchise_id: string;
}

interface LinhaProduto {
  chave: string;
  rotulo: string;
  receita: number;
  unidades: number;
}

// Normalização mínima pra agrupar produto pelo mesmo texto entre vendas (trim + uppercase +
// colapsar espaços) — sem fuzzy matching, não existe lib pra isso no projeto ainda (regra da
// persona financeiro_senior: não introduzir dependência nova sem necessidade comprovada).
function normalizar(texto: string): string {
  return texto.trim().toUpperCase().replace(/\s+/g, ' ');
}

// Cascata de identificação: nome do produto (`produtos.descrição` na origem, sincronizado a
// partir de 2026-09-15 — histórico anterior não tem) → SKU → código interno do PDV. O código
// interno leva o franchise_id na chave porque o mesmo código significa produtos diferentes
// em lojas diferentes (cada franquia tem seu próprio MySQL, "schema idêntico, dados de
// referência diferentes").
function chaveEDoProduto(item: ItemVenda): { chave: string; rotulo: string } {
  if (item.produto_nome) {
    const norm = normalizar(item.produto_nome);
    return { chave: `nome:${norm}`, rotulo: norm };
  }
  if (item.produto_sku) {
    const norm = normalizar(item.produto_sku);
    return { chave: `sku:${norm}`, rotulo: norm };
  }
  const norm = normalizar(item.produto_codigo_pdv);
  return { chave: `cod:${item.franchise_id}:${norm}`, rotulo: `Código ${norm}` };
}

export default function TopProdutosChart({ franchiseId }: { franchiseId?: string }) {
  const [isLoading, setIsLoading] = useState(true);
  const [mesSelecionado, setMesSelecionado] = useState(mesAtualBrasilia());
  const [topProdutos, setTopProdutos] = useState<LinhaProduto[]>([]);

  useEffect(() => {
    async function carregar() {
      try {
        setIsLoading(true);
        const { inicio, fim } = intervaloDoMes(mesSelecionado);

        const dados = await buscarTodosVendasItens<ItemVenda>(
          supabase,
          'produto_nome, produto_sku, produto_codigo_pdv, quantidade, valor_total, franchise_id',
          inicio,
          fim
        );

        const data = franchiseId ? dados.filter((d) => d.franchise_id === franchiseId) : dados;

        const porProduto = new Map<string, { rotulo: string; receita: number; unidades: number }>();
        for (const item of data) {
          const { chave, rotulo } = chaveEDoProduto(item);
          const atual = porProduto.get(chave) || { rotulo, receita: 0, unidades: 0 };
          atual.receita += Number(item.valor_total);
          atual.unidades += Number(item.quantidade);
          porProduto.set(chave, atual);
        }

        const ranking = Array.from(porProduto.entries())
          .map(([chave, v]) => ({ chave, rotulo: v.rotulo, receita: v.receita, unidades: v.unidades }))
          .sort((a, b) => b.receita - a.receita)
          .slice(0, 15);

        setTopProdutos(ranking);
      } catch (error) {
        console.error('Erro ao carregar top produtos:', error);
        setTopProdutos([]);
      } finally {
        setIsLoading(false);
      }
    }

    carregar();
  }, [mesSelecionado, franchiseId]);

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
          className="px-3 py-1.5 border border-stone-300 rounded-lg text-xs text-stone-700 outline-none focus:ring-2 focus:ring-stone-400"
        />
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-stone-400 text-sm min-h-[300px] flex items-center justify-center">Carregando...</div>
      ) : topProdutos.length === 0 ? (
        <div className="p-8 min-h-[200px] flex flex-col items-center justify-center gap-2">
          <p className="text-stone-400 text-sm">Nenhuma venda com produto identificado nesse período.</p>
          <p className="text-stone-300 text-xs">Os dados aparecem aqui assim que o PDV sincronizar vendas granulares.</p>
        </div>
      ) : (
        <div className="p-6">
          <ResponsiveContainer width="100%" height={Math.max(320, topProdutos.length * 32)}>
            <BarChart data={topProdutos} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" horizontal={false} />
              <XAxis type="number" stroke="#a8a29e" fontSize={12} tickFormatter={(v) => formatCurrency(Number(v))} />
              <YAxis type="category" dataKey="rotulo" stroke="#a8a29e" fontSize={11} width={140} />
              <Tooltip
                formatter={(value, name) => (name === 'unidades' ? `${value} un.` : formatCurrency(Number(value)))}
                labelFormatter={(label) => label}
              />
              <Bar dataKey="receita" name="Faturamento" radius={[0, 4, 4, 0]}>
                {topProdutos.map((entry) => (
                  <Cell key={entry.chave} fill="#059669" />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
