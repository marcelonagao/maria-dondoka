'use client';

import React from 'react';
import { formatCurrency } from '../../../lib/format';
import type { Bucket } from '../../../lib/serieVendas';

export const HACHURA_PARCIAL = 'repeating-linear-gradient(45deg, #059669 0 2px, #d1fae5 2px 6px)';

function Variacao({ b }: { b: Bucket }) {
  if (b.variacaoMediaDia === undefined) return <span className="text-stone-500">—</span>;
  if (b.variacaoMediaDia === null) return <span className="text-stone-600">novo</span>;
  const subiu = b.variacaoMediaDia >= 0;
  return (
    <span className={`font-medium ${subiu ? 'text-green-800' : 'text-orange-800'}`}>
      {subiu ? '▲' : '▼'} {Math.abs(b.variacaoMediaDia).toFixed(1)}%
    </span>
  );
}

// Mês a mês, comparando pela média por dia: mês parcial e mês de 28 dias não viram queda.
// A coluna de lojas existe para que loja nova não seja lida como crescimento das antigas.
export default function TabelaMensal({ buckets, mostrarLojas }: { buckets: Bucket[]; mostrarLojas: boolean }) {
  const total = buckets.reduce((s, b) => s + b.faturamento, 0);
  const dias = buckets.reduce((s, b) => s + b.diasCobertos, 0);
  const temDetalhe = buckets.every((b) => b.quantidadeVendas !== null && b.cmv !== null && b.impostos !== null);
  const vendas = temDetalhe ? buckets.reduce((s, b) => s + (b.quantidadeVendas ?? 0), 0) : 0;
  const custo = temDetalhe ? buckets.reduce((s, b) => s + (b.cmv ?? 0) + (b.impostos ?? 0), 0) : 0;

  const th = 'px-3 py-2 text-right font-medium whitespace-nowrap';
  const td = 'px-3 py-2 text-right tabular-nums whitespace-nowrap';
  const primeira = 'sticky left-0 bg-white px-3 py-2 text-left';

  return (
    <div className="border-t border-stone-200">
      <p className="px-4 sm:px-6 pt-4 pb-2 text-xs font-medium text-stone-600">
        Mês a mês · variação pela média por dia
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs text-stone-700">
          <thead className="text-stone-600 border-b border-stone-200">
            <tr>
              <th className={`${primeira} font-medium`}>Mês</th>
              <th className={th}>Vendas</th>
              <th className={th}>Var. %</th>
              <th className={th}>Média/dia</th>
              <th className={th}>Ticket</th>
              <th className={th}>Margem</th>
              {mostrarLojas && (
                <th className={th} title="Maior número de lojas com venda num mesmo dia do mês">
                  Lojas
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {buckets.map((b) => {
              const lojaNova = mostrarLojas && !!b.lojasDelta && b.lojasDelta > 0;
              return (
                <tr key={b.chave}>
                  <td className={primeira}>
                    <span className="font-medium text-stone-800">{b.rotulo}</span>
                    {b.parcial && (
                      <span className="flex items-center gap-1 text-[11px] text-stone-600 tabular-nums">
                        <span aria-hidden className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundImage: HACHURA_PARCIAL }} />
                        parcial · {b.diasCobertos} de {b.diasNoBucket} dias
                      </span>
                    )}
                  </td>
                  <td className={`${td} font-semibold text-stone-800`}>{formatCurrency(b.faturamento)}</td>
                  <td className={td}>
                    <Variacao b={b} />
                    {lojaNova && <span className="block text-[11px] text-stone-600">inclui loja nova</span>}
                  </td>
                  <td className={td}>{formatCurrency(b.mediaDia)}</td>
                  <td className={td}>{b.ticket === null ? '—' : formatCurrency(b.ticket)}</td>
                  <td className={td}>{b.margemPct === null ? '—' : `${b.margemPct.toFixed(1)}%`}</td>
                  {mostrarLojas && (
                    <td className={td}>
                      {b.lojasMax ?? '—'}
                      {!!b.lojasDelta && (
                        <span className="block text-[11px] text-stone-600">
                          {b.lojasDelta > 0 ? '+' : '−'}
                          {Math.abs(b.lojasDelta)} loja{Math.abs(b.lojasDelta) > 1 ? 's' : ''}
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-stone-300 font-semibold text-stone-800">
            <tr>
              <td className={primeira}>Período</td>
              <td className={td}>{formatCurrency(total)}</td>
              <td className={td} />
              <td className={td}>{dias > 0 ? formatCurrency(total / dias) : '—'}</td>
              <td className={td}>{temDetalhe && vendas > 0 ? formatCurrency(total / vendas) : '—'}</td>
              <td className={td}>{temDetalhe && total > 0 ? `${(((total - custo) / total) * 100).toFixed(1)}%` : '—'}</td>
              {mostrarLojas && <td className={td} />}
            </tr>
          </tfoot>
        </table>
      </div>
      {!temDetalhe && (
        <p className="px-4 sm:px-6 py-2 text-[11px] text-stone-600">
          Ticket, margem e lojas por mês aparecem depois da atualização do banco (serie-diaria-completa.sql).
        </p>
      )}
    </div>
  );
}
