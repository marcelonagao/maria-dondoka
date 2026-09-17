'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import { formatCurrency } from '../../../lib/format';
import { mesAtualBrasilia, intervaloDoMes } from '../../../lib/date';

interface LinhaResumo {
  linha: string;
  receita: number;
  unidades: number;
  produtos: number;
}

interface ProdutoResumo {
  rotulo: string;
  receita: number;
  unidades: number;
}

const formatNumero = (valor: number) => valor.toLocaleString('pt-BR');

export default function VendasPorLinha({
  franchiseId,
  refreshKey = 0,
}: {
  franchiseId?: string;
  refreshKey?: number;
}) {
  const [isLoading, setIsLoading] = useState(true);
  const [mesSelecionado, setMesSelecionado] = useState(mesAtualBrasilia());
  const [linhas, setLinhas] = useState<LinhaResumo[]>([]);
  const [totalReceita, setTotalReceita] = useState(0);

  const [linhaAberta, setLinhaAberta] = useState<string | null>(null);
  const [produtosPorLinha, setProdutosPorLinha] = useState<Record<string, ProdutoResumo[]>>({});
  const [carregandoLinha, setCarregandoLinha] = useState<string | null>(null);

  useEffect(() => {
    async function carregar() {
      try {
        setIsLoading(true);
        const { inicio, fim } = intervaloDoMes(mesSelecionado);

        const { data, error } = await supabase.rpc('resumo_por_linha', {
          p_franchise_id: franchiseId || null,
          p_data_inicio: inicio,
          p_data_fim: fim,
        });
        if (error) throw error;

        const resultado = (data as { total_receita?: number; linhas?: LinhaResumo[] } | null) || {};
        setTotalReceita(Number(resultado.total_receita) || 0);
        setLinhas(
          (resultado.linhas || []).map((l) => ({
            linha: l.linha,
            receita: Number(l.receita) || 0,
            unidades: Number(l.unidades) || 0,
            produtos: Number(l.produtos) || 0,
          }))
        );
      } catch (error) {
        console.error('Erro ao carregar vendas por categoria:', error);
        setLinhas([]);
        setTotalReceita(0);
      } finally {
        setIsLoading(false);
      }
    }

    // Trocar de mês ou de franquia invalida o que já foi aberto — o top de produtos daquela
    // categoria era de outro recorte.
    setLinhaAberta(null);
    setProdutosPorLinha({});
    carregar();
  }, [mesSelecionado, franchiseId, refreshKey]);

  const alternarLinha = useCallback(
    async (linha: string) => {
      if (linhaAberta === linha) {
        setLinhaAberta(null);
        return;
      }
      setLinhaAberta(linha);

      // Só busca uma vez por categoria: reabrir usa o que já está em memória.
      if (produtosPorLinha[linha]) return;

      try {
        setCarregandoLinha(linha);
        const { inicio, fim } = intervaloDoMes(mesSelecionado);
        const { data, error } = await supabase.rpc('top_produtos_da_linha', {
          p_linha: linha,
          p_franchise_id: franchiseId || null,
          p_data_inicio: inicio,
          p_data_fim: fim,
          p_limite: 10,
        });
        if (error) throw error;

        const produtos = ((data as ProdutoResumo[] | null) || []).map((p) => ({
          rotulo: p.rotulo,
          receita: Number(p.receita) || 0,
          unidades: Number(p.unidades) || 0,
        }));
        setProdutosPorLinha((anterior) => ({ ...anterior, [linha]: produtos }));
      } catch (error) {
        console.error('Erro ao carregar produtos da categoria:', error);
        setProdutosPorLinha((anterior) => ({ ...anterior, [linha]: [] }));
      } finally {
        setCarregandoLinha(null);
      }
    },
    [linhaAberta, produtosPorLinha, mesSelecionado, franchiseId]
  );

  const maiorReceita = linhas[0]?.receita || 0;

  return (
    <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden">
      <div className="p-4 sm:p-6 border-b border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-medium text-stone-700">Vendas por Categoria</h3>
          <p className="text-xs text-stone-400 mt-1">
            Toque em uma categoria para ver os 10 produtos que mais faturaram nela.
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
        <div className="p-8 text-center text-stone-400 text-sm min-h-[200px] flex items-center justify-center">
          Carregando...
        </div>
      ) : linhas.length === 0 ? (
        <div className="p-8 min-h-[200px] flex flex-col items-center justify-center gap-2">
          <p className="text-stone-400 text-sm">Nenhuma venda nesse período.</p>
          <p className="text-stone-300 text-xs">Os dados aparecem assim que o PDV sincronizar.</p>
        </div>
      ) : (
        <>
          <div className="px-4 sm:px-6 py-3 bg-stone-50 border-b border-stone-100 flex items-baseline justify-between gap-3">
            <span className="text-xs text-stone-500">
              {linhas.length} categoria{linhas.length > 1 ? 's' : ''}
            </span>
            <span className="text-sm font-semibold tabular-nums text-stone-800">
              {formatCurrency(totalReceita)}
            </span>
          </div>

          <ol className="divide-y divide-stone-100">
            {linhas.map((item, i) => {
              const pctDoTotal = totalReceita > 0 ? (item.receita / totalReceita) * 100 : 0;
              const pctDaBarra = maiorReceita > 0 ? (item.receita / maiorReceita) * 100 : 0;
              const aberta = linhaAberta === item.linha;
              const produtos = produtosPorLinha[item.linha];

              return (
                <li key={item.linha}>
                  {/* Botão, não div com onClick: precisa funcionar por toque e por teclado. */}
                  <button
                    type="button"
                    onClick={() => alternarLinha(item.linha)}
                    aria-expanded={aberta}
                    className="w-full text-left px-4 sm:px-6 py-3 hover:bg-stone-50 transition-colors"
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs text-stone-400 tabular-nums w-5 shrink-0">{i + 1}</span>
                      <span className="text-sm text-stone-700 truncate flex-1" title={item.linha}>
                        {item.linha}
                      </span>
                      <span className="text-xs text-stone-400 tabular-nums shrink-0">
                        {pctDoTotal.toFixed(1)}%
                      </span>
                      <span className="text-sm font-semibold tabular-nums text-stone-800 shrink-0 w-28 text-right">
                        {formatCurrency(item.receita)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 pl-7">
                      <div className="h-1.5 flex-1 bg-stone-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-600 rounded-full"
                          style={{ width: `${pctDaBarra}%` }}
                        />
                      </div>
                      <span className="text-[11px] text-stone-400 tabular-nums shrink-0">
                        {formatNumero(item.unidades)} un. · {formatNumero(item.produtos)} SKUs
                      </span>
                    </div>
                  </button>

                  {aberta && (
                    <div className="bg-stone-50/70 border-t border-stone-100 px-4 sm:px-6 py-2">
                      {carregandoLinha === item.linha ? (
                        <p className="py-3 text-xs text-stone-400">Carregando produtos...</p>
                      ) : !produtos || produtos.length === 0 ? (
                        <p className="py-3 text-xs text-stone-400">
                          Nenhum produto identificado nesta categoria.
                        </p>
                      ) : (
                        <ol className="divide-y divide-stone-200/60">
                          {produtos.map((produto, j) => (
                            <li
                              key={produto.rotulo}
                              className="py-2 flex items-baseline gap-2 pl-7"
                            >
                              <span className="text-[11px] text-stone-400 tabular-nums w-4 shrink-0">
                                {j + 1}
                              </span>
                              <span
                                className="text-xs text-stone-600 truncate flex-1"
                                title={produto.rotulo}
                              >
                                {produto.rotulo}
                              </span>
                              <span className="text-[11px] text-stone-400 tabular-nums shrink-0">
                                {formatNumero(produto.unidades)} un.
                              </span>
                              <span className="text-xs font-medium tabular-nums text-stone-700 shrink-0 w-24 text-right">
                                {formatCurrency(produto.receita)}
                              </span>
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}
