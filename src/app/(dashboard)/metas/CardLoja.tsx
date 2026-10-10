'use client';

import React from 'react';
import { AcompanhamentoLoja, formatarMoeda, formatarPercentual } from '../../../lib/metas';

// Cores com contraste AA em fundo branco (orange-700 ≈ 5,2:1, green-800 ≈ 7:1). O estado
// nunca depende só da cor: sempre há ícone e texto.
const ESTILO_STATUS = {
  super: 'text-green-800 bg-green-50 border-green-200',
  meta: 'text-green-800 bg-green-50 border-green-200',
  abaixo: 'text-orange-800 bg-orange-50 border-orange-200',
  sem_meta: 'text-stone-700 bg-stone-100 border-stone-200',
  futuro: 'text-stone-700 bg-stone-100 border-stone-200',
} as const;

function rotuloStatus(l: AcompanhamentoLoja): string {
  const fechado = l.fase === 'fechado';
  switch (l.status) {
    case 'super': return fechado ? '✓ Super meta batida' : '✓ No ritmo da super meta';
    case 'meta': return fechado ? '✓ Meta batida' : '✓ No ritmo da meta';
    case 'abaixo': return fechado ? '▼ Meta não batida' : '▼ Abaixo da meta';
    case 'futuro': return 'Mês ainda não começou';
    default: return 'Sem meta cadastrada';
  }
}

function LinhaFalta({ alvo, falta, porDia, dias, realizado, valor }: {
  alvo: string; falta: number; porDia: number | null; dias: number; realizado: number; valor: number;
}) {
  if (falta <= 0) {
    return (
      <p className="text-green-800 font-medium">
        ✓ {alvo} batida <span className="font-normal">(+{formatarMoeda(realizado - valor)})</span>
      </p>
    );
  }
  return (
    <p className="text-stone-800">
      Faltam <strong className="tabular-nums">{formatarMoeda(falta)}</strong> para a {alvo.toLowerCase()}
      {porDia !== null && (
        <span className="text-stone-600"> · {formatarMoeda(porDia)}/dia nos {dias} dias restantes</span>
      )}
    </p>
  );
}

export default function CardLoja({ loja }: { loja: AcompanhamentoLoja }) {
  const { meta, superMeta, realizado, projecao } = loja;
  const temMeta = meta !== null && superMeta !== null;

  // Escala da barra: 0 até o maior valor relevante + folga, para as marcas nunca colarem na borda.
  const topo = Math.max(superMeta || 0, projecao || 0, realizado, 1) * 1.05;
  const pct = (v: number) => Math.min(100, Math.max(0, (v / topo) * 100));
  const pReal = pct(realizado);
  const pProj = projecao !== null ? pct(projecao) : pReal;
  const pMeta = temMeta ? pct(meta as number) : 0;
  const pSuper = temMeta ? pct(superMeta as number) : 0;
  // Meta fica sempre em cima e super sempre embaixo: em linhas separadas os rótulos nunca se
  // sobrepõem, por mais perto que as marcas estejam. Do meio da barra em diante o texto termina
  // na marca (cresce para a esquerda); antes disso, começa nela. Assim nada passa da borda do card.
  const posicao = (p: number) =>
    p > 50 ? { right: `${100 - p}%`, paddingRight: 4 } : { left: `${p}%`, paddingLeft: 4 };

  return (
    <article className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 space-y-3">
      <header className="flex items-start justify-between gap-2">
        <h2 className="font-semibold text-stone-800 truncate">{loja.nome}</h2>
        <span className={`shrink-0 text-xs font-medium px-2 py-1 rounded-full border ${ESTILO_STATUS[loja.status]}`}>
          {rotuloStatus(loja)}
        </span>
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-xs text-stone-600">Realizado</dt>
          <dd className="text-lg font-semibold text-stone-900 tabular-nums">{formatarMoeda(realizado)}</dd>
        </div>
        <div>
          <dt className="text-xs text-stone-600">Projeção do mês</dt>
          <dd className="text-lg font-semibold text-stone-900 tabular-nums">
            {projecao !== null ? formatarMoeda(projecao) : '—'}
          </dd>
        </div>
      </dl>

      {temMeta && (
        <>
          {/* Barra de escala única: 0 até o topo. Sólido = realizado; hachurado = projeção. */}
          <div className="pt-5 pb-1">
            <div className="relative h-3 rounded-full bg-stone-100">
              {projecao !== null && pProj > pReal && (
                <div
                  className="absolute inset-y-0 rounded-full"
                  style={{
                    left: 0,
                    width: `${pProj}%`,
                    backgroundImage:
                      'repeating-linear-gradient(45deg, #a8a29e 0 4px, #e7e5e4 4px 8px)',
                  }}
                />
              )}
              <div className="absolute inset-y-0 left-0 rounded-full bg-stone-800" style={{ width: `${pReal}%` }} />
              <span className="absolute -top-1 -bottom-1 w-0.5 bg-stone-900" style={{ left: `${pMeta}%` }} />
              <span className="absolute -top-1 -bottom-1 w-0.5 bg-[#EC008C]" style={{ left: `${pSuper}%` }} />
              <span
                className="absolute -top-5 text-[11px] font-medium text-stone-800 whitespace-nowrap"
                style={posicao(pMeta)}
              >
                Meta {formatarMoeda(meta as number)}
              </span>
              <span
                className="absolute top-4 text-[11px] font-medium text-stone-800 whitespace-nowrap"
                style={posicao(pSuper)}
              >
                Super {formatarMoeda(superMeta as number)}
              </span>
            </div>
            {/* Reserva a linha dos rótulos de baixo, senão os cards desalinham. */}
            <div className="h-4" />
          </div>

          <div className="text-sm space-y-1">
            <LinhaFalta alvo="Meta" falta={loja.faltaMeta as number} porDia={loja.necessarioPorDiaMeta}
              dias={loja.diasRestantes} realizado={realizado} valor={meta as number} />
            <LinhaFalta alvo="Super meta" falta={loja.faltaSuperMeta as number} porDia={loja.necessarioPorDiaSuper}
              dias={loja.diasRestantes} realizado={realizado} valor={superMeta as number} />
          </div>

          <p className="text-xs text-stone-600 tabular-nums">
            {projecao !== null && <>Projeção = {formatarPercentual(projecao / (meta as number))} da meta e {formatarPercentual(projecao / (superMeta as number))} da super</>}
            {loja.ritmo !== null && <> · Ritmo {formatarPercentual(loja.ritmo)}</>}
          </p>
          {loja.passoMes !== null && (
            <p className="text-xs text-stone-600 tabular-nums">
              No passo deste mês: <strong>{formatarMoeda(loja.passoMes)}</strong> ({formatarPercentual(loja.passoMes / (meta as number))} da meta)
            </p>
          )}
        </>
      )}

      {!temMeta && (
        <p className="text-sm text-stone-600">Cadastre a meta deste mês para acompanhar o ritmo.</p>
      )}

      {/* Altura reservada: só algumas lojas têm o aviso e a fileira não pode desalinhar. */}
      <div className="min-h-[3.5rem] text-xs text-orange-800 space-y-1">
        {loja.estimativaFraca && (
          <p>
            {loja.diasJanela === 0
              ? '⚠ Sem histórico de vendas: a projeção ainda não tem base.'
              : `⚠ Estimativa com poucos dados: média de ${loja.diasJanela} dia(s) de venda.`}
          </p>
        )}
        {loja.projecoesDivergem && (
          <p>
            ⚠ A projeção (média dos últimos 30 dias) e o passo deste mês divergem. O mês atual está{' '}
            {(loja.passoMes as number) > (loja.projecao as number) ? 'mais forte' : 'mais fraco'} que os 30 dias
            anteriores — confira antes de decidir.
          </p>
        )}
      </div>
    </article>
  );
}
