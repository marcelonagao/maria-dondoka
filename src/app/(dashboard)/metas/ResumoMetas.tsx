'use client';

import React from 'react';
import { ConsolidadoMetas, formatarMoeda, formatarPercentual } from '../../../lib/metas';

function Indicador({ rotulo, valor, destaque, nota }: { rotulo: string; valor: string; destaque?: boolean; nota?: string }) {
  return (
    <div>
      <dt className="text-xs text-stone-600">{rotulo}</dt>
      <dd
        className={`font-semibold tabular-nums ${destaque ? 'text-2xl text-[#EC008C]' : 'text-lg text-stone-900'}`}
      >
        {valor}
      </dd>
      {nota && <dd className="text-[11px] text-stone-600">{nota}</dd>}
    </div>
  );
}

export default function ResumoMetas({ resumo }: { resumo: ConsolidadoMetas }) {
  const { lojasComMeta, lojasSemMeta } = resumo;
  return (
    <section className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 space-y-3">
      <h2 className="font-semibold text-stone-800">Todas as lojas</h2>
      <dl className={`grid grid-cols-2 gap-x-4 gap-y-3 ${resumo.lojasComSonhos > 0 ? 'sm:grid-cols-3 lg:grid-cols-5' : 'sm:grid-cols-4'}`}>
        <Indicador rotulo="Realizado (todas as lojas)" valor={formatarMoeda(resumo.realizadoGeral)} destaque />
        <Indicador rotulo="Projeção do mês" valor={resumo.projecao !== null ? formatarMoeda(resumo.projecao) : '—'} />
        <Indicador rotulo="Meta" valor={lojasComMeta > 0 ? formatarMoeda(resumo.meta) : '—'} />
        <Indicador rotulo="Super meta" valor={lojasComMeta > 0 ? formatarMoeda(resumo.superMeta) : '—'} />
        {/* Opcional por loja: a soma é só de quem tem, e isso fica escrito. */}
        {resumo.lojasComSonhos > 0 && (
          <Indicador
            rotulo="Meta dos sonhos"
            valor={formatarMoeda(resumo.metaSonhos)}
            nota={resumo.lojasComSonhos < lojasComMeta ? `em ${resumo.lojasComSonhos} de ${lojasComMeta} lojas` : undefined}
          />
        )}
      </dl>
      <p className="text-xs text-stone-600 tabular-nums">
        {lojasComMeta > 0 ? (
          <>
            {resumo.lojasBatendoMeta} de {lojasComMeta} loja(s) com meta no ritmo ou acima
            {resumo.projecao !== null && resumo.metaDaProjecao > 0 && (
              <> · projeção = {formatarPercentual(resumo.projecao / resumo.metaDaProjecao)} da meta</>
            )}
            {resumo.lojasSemProjecao > 0 && (
              <> · {resumo.lojasSemProjecao} loja(s) recém-aberta(s) ficaram fora da projeção</>
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
