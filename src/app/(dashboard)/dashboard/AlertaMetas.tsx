'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../../lib/supabase';
import { hojeBrasilia, mesAtualBrasilia } from '../../../lib/date';
import { LinhaMetaCrua, calcularLoja, lojasAbaixoDaMeta } from '../../../lib/metas';

interface Resumo {
  abaixo: string[];
  comMeta: number;
  poucosDados: number;
}

// Faixa do Dashboard: quantas lojas projetam fechar o mês abaixo da meta. Boa notícia tem o
// mesmo destaque da má (verde x laranja), senão não se distingue "conferi e está certo" de
// "ninguém olhou". Se a consulta falhar, a faixa some e o erro vai para o console: é um aviso
// extra e não pode derrubar o painel de vendas.
export default function AlertaMetas() {
  const [resumo, setResumo] = useState<Resumo | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const mes = mesAtualBrasilia();
        const hoje = hojeBrasilia();
        const { data, error } = await supabase.rpc('acompanhamento_metas', { p_mes: `${mes}-01`, p_hoje: hoje });
        if (error) throw error;
        const lojas = ((data || []) as LinhaMetaCrua[]).map((l) => calcularLoja(l, mes, hoje));
        const r = lojasAbaixoDaMeta(lojas);
        setResumo({ abaixo: r.abaixo.map((l) => l.nome), comMeta: r.comMeta, poucosDados: r.poucosDados });
      } catch (err) {
        console.error('Erro ao carregar alerta de metas:', err);
      }
    })();
  }, []);

  // Sem nenhuma loja avaliável (metas não cadastradas) não há o que afirmar.
  if (!resumo || resumo.comMeta === 0) return null;

  const ok = resumo.abaixo.length === 0;
  const nota = resumo.poucosDados > 0 ? ` · ${resumo.poucosDados} loja(s) com poucos dados ficaram fora` : '';

  return (
    <Link
      href="/metas"
      className={`flex items-center justify-between gap-3 border rounded-xl px-4 py-2.5 sm:px-6 text-sm ${
        ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-orange-50 border-orange-200 text-orange-800'
      }`}
    >
      <span>
        {ok ? (
          <>✓ <strong>Todas as {resumo.comMeta} lojas</strong> projetam bater a meta do mês{nota}</>
        ) : (
          <>
            ▼ <strong>{resumo.abaixo.length} de {resumo.comMeta} lojas</strong> projetam fechar abaixo da meta:{' '}
            {resumo.abaixo.join(', ')}
            {nota}
          </>
        )}
      </span>
      <span className="text-xs font-medium underline shrink-0">Ver metas ›</span>
    </Link>
  );
}
