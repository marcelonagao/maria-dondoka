'use client';

import React from 'react';
import { Corrida, RaiaCorrida, formatarMoeda, formatarPercentual } from '../../../lib/metas';
import Trofeu from './Trofeu';
import { COR_TEXTO_STATUS, rotuloStatus } from './estilos';

// Mesmos desenhos do card e da legenda: a amostra tem de ser idêntica ao que a pista mostra.
const HACHURA = 'repeating-linear-gradient(45deg, #a8a29e 0 4px, #e7e5e4 4px 8px)';
const XADREZ = 'repeating-conic-gradient(#1c1917 0 25%, #fff 0 50%)';

// "R$ 98 mil" cabe em 360px; o valor exato está no card.
const abreviarMoeda = (v: number) => (v >= 1000 ? `R$ ${Math.round(v / 1000)} mil` : formatarMoeda(v));

function avisosDaRaia(r: RaiaCorrida, escala: number): string[] {
  const avisos: string[] = [];
  if (r.passouDoTeto) avisos.push(`acima de ${Math.round(escala * 100)}% — fora da escala`);
  if (r.alvosForaDaEscala.includes('super')) avisos.push('super fora da escala');
  if (r.alvosForaDaEscala.includes('sonhos')) avisos.push('sonhos fora da escala');
  return avisos;
}

// O aria-label substitui o conteúdo do botão: tem de levar tudo que a raia mostra em texto.
function descreverRaia(r: RaiaCorrida, escala: number): string {
  const partes = [r.posicao !== null ? `${r.posicao}º, ${r.nome}` : r.nome];
  if (r.razao !== null) {
    partes.push(`${formatarPercentual(r.razao)} da meta`, rotuloStatus(r));
    if (r.base !== null) partes.push(`${r.fase === 'fechado' ? 'realizado' : 'projeção'} ${formatarMoeda(r.base)}`);
    partes.push(...avisosDaRaia(r, escala));
  } else {
    // Fora do ranking: sem razão não há o que correr, então diz por quê (mesmo rótulo do card).
    partes.push(rotuloStatus(r));
  }
  partes.push('ver detalhe');
  return partes.join(', ');
}

function Chegada({ left }: { left: number }) {
  return (
    <span
      className="absolute -top-1 -bottom-1 w-1.5 -translate-x-1/2"
      style={{ left: `${left}%`, backgroundImage: XADREZ, backgroundSize: '6px 6px', outline: '1px solid #1c1917' }}
    />
  );
}

function Raia({ raia, escala, pctChegada, onIr }: {
  raia: RaiaCorrida; escala: number; pctChegada: number; onIr: (franchiseId: string) => void;
}) {
  const fechado = raia.fase === 'fechado';
  const { razao } = raia;
  const pctBase = raia.pctBase ?? 0;

  const avisos = avisosDaRaia(raia, escala);

  return (
    <li>
      <button
        type="button"
        onClick={() => onIr(raia.franchiseId)}
        aria-label={descreverRaia(raia, escala)}
        className="w-full text-left min-h-[56px] py-2 px-2 rounded-lg hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex items-center gap-1.5">
            {raia.medalha && <Trofeu medalha={raia.medalha} />}
            {raia.posicao !== null && (
              <span className={`tabular-nums ${raia.medalha ? 'font-semibold text-stone-800' : 'text-stone-600'}`}>
                {raia.posicao}º
              </span>
            )}
            <span className="truncate font-medium text-stone-800">{raia.nome}</span>
          </div>
          <div className="shrink-0 text-right tabular-nums">
            {razao !== null ? (
              <>
                <p className={`font-semibold ${COR_TEXTO_STATUS[raia.status]}`}>
                  {formatarPercentual(razao)} <span className="text-xs font-normal">da meta</span>
                </p>
                {raia.base !== null && (
                  <p className="text-[11px] text-stone-600">
                    {fechado ? 'realizado' : 'proj.'} {abreviarMoeda(raia.base)}
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-stone-700">{rotuloStatus(raia)}</p>
            )}
          </div>
        </div>

        {razao !== null && (
          <>
            <div className="relative h-3 rounded-full bg-stone-100 mt-1.5" aria-hidden="true">
              {raia.pctBase !== null && raia.pctBase > raia.pctRealizado && (
                <div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ width: `${pctBase}%`, backgroundImage: HACHURA }}
                />
              )}
              <div className="absolute inset-y-0 left-0 rounded-full bg-stone-800" style={{ width: `${raia.pctRealizado}%` }} />
              <Chegada left={pctChegada} />
              {raia.pctSuper !== null && (
                <span className="absolute -top-1 -bottom-1 w-0.5 bg-[#EC008C]" style={{ left: `${raia.pctSuper}%` }} />
              )}
              {raia.pctSonhos !== null && (
                <span className="absolute -top-1 -bottom-1 w-0.5 bg-amber-700" style={{ left: `${raia.pctSonhos}%` }} />
              )}
              {raia.passouDoTeto ? (
                <span className="absolute right-0 top-1/2 -translate-y-1/2 text-stone-800 text-xs leading-none">▶</span>
              ) : (
                <span
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full bg-white border-2 border-stone-800"
                  style={{ left: `${pctBase}%` }}
                />
              )}
            </div>
            {avisos.length > 0 && (
              <p className="mt-1 text-[11px] text-stone-600">{avisos.join(' · ')}</p>
            )}
          </>
        )}
      </button>
    </li>
  );
}

export default function CorridaMetas({ corrida, onIr }: { corrida: Corrida; onIr: (franchiseId: string) => void }) {
  const { raias, escala, pctChegada } = corrida;
  const todasFechadas = raias.length > 0 && raias.every((r) => r.fase === 'fechado');
  const temSonhos = raias.some((r) => r.pctSonhos !== null || r.alvosForaDaEscala.includes('sonhos'));

  return (
    <section className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 space-y-3">
      <div>
        <h2 className="font-semibold text-stone-800">Corrida da meta</h2>
        <p className="text-xs text-stone-600 mt-0.5">
          {todasFechadas ? '% da meta realizada no mês' : '% da meta projetada no mês'} · toque numa loja para ver o detalhe
        </p>
      </div>

      <ol className="space-y-1">
        {raias.map((r) => (
          <Raia key={r.franchiseId} raia={r} escala={escala} pctChegada={pctChegada} onIr={onIr} />
        ))}
      </ol>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-stone-700">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm bg-stone-800" aria-hidden="true" />
          vendido
        </span>
        {!todasFechadas && (
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundImage: HACHURA }} aria-hidden="true" />
            projeção
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block h-3 w-1.5"
            style={{ backgroundImage: XADREZ, backgroundSize: '6px 6px', outline: '1px solid #1c1917' }}
            aria-hidden="true"
          />
          chegada = meta
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3.5 w-0.5 bg-[#EC008C]" aria-hidden="true" />
          super
        </span>
        {temSonhos && (
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3.5 w-0.5 bg-amber-700" aria-hidden="true" />
            sonhos
          </span>
        )}
      </div>
    </section>
  );
}
