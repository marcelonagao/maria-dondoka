'use client';

import React from 'react';
import { ConsolidadoMetas, formatarMoeda, formatarPercentual } from '../../../lib/metas';

function Indicador({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-stone-600">{rotulo}</dt>
      <dd
        className={`font-semibold tabular-nums ${destaque ? 'text-2xl text-[#EC008C]' : 'text-lg text-stone-900'}`}
      >
        {valor}
      </dd>
    </div>
  );
}

export default function ResumoMetas({ resumo }: { resumo: ConsolidadoMetas }) {
  const { lojasComMeta, lojasSemMeta } = resumo;
  return (
    <section className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 space-y-3">
      <h2 className="font-semibold text-stone-800">Todas as lojas</h2>
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
        <Indicador rotulo="Realizado (todas as lojas)" valor={formatarMoeda(resumo.realizadoGeral)} destaque />
        <Indicador rotulo="Projeção do mês" valor={resumo.projecao !== null ? formatarMoeda(resumo.projecao) : '—'} />
        <Indicador rotulo="Meta" valor={lojasComMeta > 0 ? formatarMoeda(resumo.meta) : '—'} />
        <Indicador rotulo="Super meta" valor={lojasComMeta > 0 ? formatarMoeda(resumo.superMeta) : '—'} />
      </dl>
      <p className="text-xs text-stone-600 tabular-nums">
        {lojasComMeta > 0 ? (
          <>
            {resumo.lojasBatendoMeta} de {lojasComMeta} loja(s) com meta no ritmo ou acima
            {resumo.projecao !== null && resumo.meta > 0 && (
              <> · projeção = {formatarPercentual(resumo.projecao / resumo.meta)} da meta</>
            )}
          </>
        ) : (
          'Nenhuma loja com meta cadastrada neste mês.'
        )}
        {lojasSemMeta > 0 && lojasComMeta > 0 && (
          <> · {lojasSemMeta} loja(s) sem meta ficaram fora da comparação (o realizado acima as inclui)</>
        )}
      </p>
    </section>
  );
}
