'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { adicionarMeses, rotuloDoMes } from '../../../lib/date';
import {
  CelulaHistorico,
  LinhaHistoricoCrua,
  formatarMoeda,
  formatarPercentual,
  resumirHistorico,
} from '../../../lib/metas';

const MESES_HISTORICO = 6;

const COR: Record<CelulaHistorico['status'], string> = {
  super: 'text-green-800',
  meta: 'text-green-800',
  abaixo: 'text-orange-800',
  sem_meta: 'text-stone-500',
};
const ICONE: Record<CelulaHistorico['status'], string> = { super: '✓✓', meta: '✓', abaixo: '▼', sem_meta: '' };

function Celula({ c }: { c: CelulaHistorico }) {
  if (c.razao === null) {
    return <span className="text-stone-500" title="Sem meta cadastrada neste mês">—</span>;
  }
  return (
    <div
      className={`leading-tight ${COR[c.status]}`}
      title={`Meta ${formatarMoeda(c.meta as number)} · Super ${formatarMoeda(c.superMeta as number)}`}
    >
      <div className="font-semibold tabular-nums">
        {ICONE[c.status]} {formatarPercentual(c.razao)}
      </div>
      <div className="text-[11px] text-stone-600 tabular-nums">{formatarMoeda(c.realizado)}</div>
    </div>
  );
}

// Só meses FECHADOS: o mês corrente está em andamento e um percentual parcial pareceria
// resultado. Cada célula = realizado ÷ meta do mês; ✓ bateu a meta, ✓✓ bateu a super meta.
export default function HistoricoMetas({ mesCorrente, versao }: { mesCorrente: string; versao: number }) {
  const [linhas, setLinhas] = useState<LinhaHistoricoCrua[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<{ texto: string; detalhe?: string } | null>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      setCarregando(true);
      setErro(null);
      try {
        const { data, error } = await supabase.rpc('historico_metas', {
          p_mes_fim: `${adicionarMeses(mesCorrente, -1)}-01`,
          p_meses: MESES_HISTORICO,
        });
        if (error) throw error;
        if (!cancelado) setLinhas((data || []) as LinhaHistoricoCrua[]);
      } catch (err) {
        console.error('Erro ao carregar histórico de metas:', err);
        if (!cancelado) {
          setLinhas([]);
          setErro({
            texto: 'Não foi possível carregar o histórico de metas.',
            detalhe: err instanceof Error ? err.message : (err as { message?: string })?.message,
          });
        }
      } finally {
        if (!cancelado) setCarregando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [mesCorrente, versao]);

  const resumo = useMemo(() => resumirHistorico(linhas), [linhas]);
  const algumaMeta = resumo.lojas.some((l) => l.mesesComMeta > 0);

  return (
    <section className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 space-y-3">
      <div>
        <h2 className="font-semibold text-stone-800">Histórico dos últimos {MESES_HISTORICO} meses</h2>
        <p className="text-xs text-stone-600">
          Realizado ÷ meta de cada mês fechado. ✓ bateu a meta · ✓✓ bateu a super meta · ▼ abaixo · — sem meta no mês.
        </p>
      </div>

      {carregando && <div className="h-40 rounded-lg bg-stone-200/60 animate-pulse" aria-busy="true" />}

      {erro && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-3 py-2 text-sm" role="alert">
          <p className="font-medium">{erro.texto}</p>
          {erro.detalhe && <p className="text-xs mt-1 break-words">{erro.detalhe}</p>}
        </div>
      )}

      {!carregando && !erro && !algumaMeta && (
        <p className="text-sm text-stone-600">
          Ainda não há metas cadastradas nos últimos {MESES_HISTORICO} meses. O histórico começa a contar a partir do
          primeiro mês com meta.
        </p>
      )}

      {!carregando && !erro && algumaMeta && (
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr className="text-xs text-stone-600">
                <th className="sticky left-0 bg-white text-left font-medium py-2 pr-3 min-w-[9rem]">Loja</th>
                {resumo.meses.map((m) => (
                  <th key={m} className="text-right font-medium py-2 px-2 min-w-[5.5rem] capitalize">{rotuloDoMes(m)}</th>
                ))}
                <th className="text-right font-medium py-2 pl-3 min-w-[5rem]">Metas batidas</th>
              </tr>
            </thead>
            <tbody>
              {resumo.lojas.map((l) => (
                <tr key={l.franchiseId} className="border-t border-stone-100">
                  <td className="sticky left-0 bg-white py-2 pr-3 text-stone-800 border-t border-stone-100">{l.nome}</td>
                  {resumo.meses.map((m) => {
                    const c = l.celulas.find((x) => x.mes === m);
                    return (
                      <td key={m} className="text-right py-2 px-2 border-t border-stone-100">
                        {c ? <Celula c={c} /> : <span className="text-stone-500">—</span>}
                      </td>
                    );
                  })}
                  <td className="text-right py-2 pl-3 tabular-nums text-stone-800 border-t border-stone-100">
                    {l.mesesComMeta > 0 ? `${l.mesesBatidos} de ${l.mesesComMeta}` : '—'}
                  </td>
                </tr>
              ))}
              {resumo.lojas.length > 1 && (
                <tr>
                  <td className="sticky left-0 bg-white py-2 pr-3 font-semibold text-stone-900 border-t border-stone-300">
                    Todas (com meta)
                  </td>
                  {resumo.totais.map((c) => (
                    <td key={c.mes} className="text-right py-2 px-2 border-t border-stone-300">
                      <Celula c={c} />
                    </td>
                  ))}
                  <td className="border-t border-stone-300" />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
