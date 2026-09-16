'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../../../lib/supabase';
import {
  hojeBrasilia,
  mesAtualBrasilia,
  intervaloDoMes,
  adicionarDias,
  proximosMeses,
} from '../../../../lib/date';
import { resolverRaiz, type CategoriaNo } from '../../../../lib/planoContas';
import { ocorrenciasNoIntervalo, type FrequenciaRecorrencia } from '../../../../lib/recorrencia';

// Raiz do plano de contas que recebe os boletos de fornecedor. Confirmada por query direta
// (74 lançamentos) — é raiz própria, de tipo 'custo', e por isso NÃO aparece entre as 6
// categorias de despesa do DRE: lá o CMV vem do custo dos itens vendidos, não das contas.
export const RAIZ_CMV = '4fb7a7bf-0891-48fb-aac2-dea05df8ece2';

export const MESES_HORIZONTE = 6;
export const DIAS_HISTORICO_VENDAS = 90;

export interface GrupoSaida {
  raizId: string;
  nome: string;
  lancado: number;
  estimado: number;
  total: number;
  // Explica de onde veio a parte estimada, pra tela não mostrar número sem origem.
  origemEstimativa: string | null;
}

export interface MesFluxo {
  mes: string;
  entradas: number;
  saidas: number;
  resultado: number;
  grupos: GrupoSaida[];
  ehMesCorrente: boolean;
}

interface LinhaPagar {
  due_date: string;
  amount: number;
  plano_conta_id: string | null;
  despesa_recorrente_id: string | null;
  folha_pagamento_item_id: string | null;
}

interface RecorrenteRow {
  id: string;
  plano_conta_id: string | null;
  valor_referencia: number;
  dia_vencimento: number;
  frequencia: FrequenciaRecorrencia;
  mes_referencia: number | null;
}

interface DadosBrutos {
  medias: number[];
  percentualCmvApurado: number;
  categorias: CategoriaNo[];
  pagar: LinhaPagar[];
  recorrentes: RecorrenteRow[];
  folhaEstimada: number;
}

const SEM_CATEGORIA = '__sem_categoria__';

export function useFluxoCaixa(franchiseId?: string) {
  const [dados, setDados] = useState<DadosBrutos | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setIsLoading(true);
      setErro(null);

      const hoje = hojeBrasilia();
      const mesInicial = mesAtualBrasilia();
      const listaMeses = proximosMeses(mesInicial, MESES_HORIZONTE);
      const fimHorizonte = intervaloDoMes(listaMeses[listaMeses.length - 1]).fim;
      const inicioHistorico = adicionarDias(hoje, -DIAS_HISTORICO_VENDAS);

      const [vendasRes, pagarRes, recorrentesRes, categoriasRes, competenciaRes] = await Promise.all([
        supabase.rpc('serie_vendas_diaria', {
          p_franchise_id: franchiseId || null,
          p_data_inicio: inicioHistorico,
          p_data_fim: hoje,
        }),
        (() => {
          let q = supabase
            .from('accounts_payable')
            .select('due_date, amount, plano_conta_id, despesa_recorrente_id, folha_pagamento_item_id')
            .eq('status', 'pendente')
            .gte('due_date', intervaloDoMes(mesInicial).inicio)
            .lte('due_date', fimHorizonte);
          if (franchiseId) q = q.eq('franchise_id', franchiseId);
          return q;
        })(),
        (() => {
          let q = supabase
            .from('despesas_recorrentes')
            .select('id, plano_conta_id, valor_referencia, dia_vencimento, frequencia, mes_referencia')
            .eq('is_active', true);
          if (franchiseId) q = q.eq('franchise_id', franchiseId);
          return q;
        })(),
        supabase.from('plano_contas').select('id, nome, categoria_pai_id'),
        supabase
          .from('folha_pagamento_competencias')
          .select('id')
          .eq('status', 'validado')
          .order('competencia', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (vendasRes.error) throw vendasRes.error;
      if (pagarRes.error) throw pagarRes.error;
      if (recorrentesRes.error) throw recorrentesRes.error;
      if (categoriasRes.error) throw categoriasRes.error;

      // --- Entradas e percentual de CMV, da mesma série ---
      const serie = ((vendasRes.data as any) || []) as { data: string; faturamento: number; cmv: number }[];
      const somaPorDiaSemana = [0, 0, 0, 0, 0, 0, 0];
      const contagemPorDiaSemana = [0, 0, 0, 0, 0, 0, 0];
      let totalFaturamento = 0;
      let totalCmv = 0;
      for (const ponto of serie) {
        const diaSemana = new Date(`${ponto.data}T00:00:00Z`).getUTCDay();
        const faturamento = Number(ponto.faturamento) || 0;
        somaPorDiaSemana[diaSemana] += faturamento;
        contagemPorDiaSemana[diaSemana] += 1;
        totalFaturamento += faturamento;
        totalCmv += Number(ponto.cmv) || 0;
      }
      const medias = somaPorDiaSemana.map((soma, i) =>
        contagemPorDiaSemana[i] > 0 ? soma / contagemPorDiaSemana[i] : 0
      );
      const percentualCmvApurado = totalFaturamento > 0 ? (totalCmv / totalFaturamento) * 100 : 0;

      // --- Folha: última competência validada, só os salários por funcionário ---
      // As guias (FGTS, INSS, sindicato) ficam de fora de propósito: elas estão cadastradas
      // como despesas_recorrentes e já entram pela projeção de recorrência. Somar as duas
      // contaria o mesmo encargo duas vezes.
      let folhaEstimada = 0;
      if (competenciaRes.data?.id) {
        let q = supabase
          .from('accounts_payable')
          .select('amount')
          .eq('folha_pagamento_competencia_id', competenciaRes.data.id)
          .not('folha_pagamento_item_id', 'is', null)
          .neq('status', 'cancelado');
        if (franchiseId) q = q.eq('franchise_id', franchiseId);
        const { data: linhasFolha, error: folhaError } = await q;
        if (folhaError) throw folhaError;
        folhaEstimada = (linhasFolha || []).reduce((acc, l) => acc + (Number(l.amount) || 0), 0);
      }

      setDados({
        medias,
        percentualCmvApurado,
        categorias: (categoriasRes.data || []) as CategoriaNo[],
        pagar: ((pagarRes.data as any) || []) as LinhaPagar[],
        recorrentes: ((recorrentesRes.data as any) || []) as RecorrenteRow[],
        folhaEstimada,
      });
    } catch (err) {
      console.error('Erro ao montar o fluxo de caixa:', err);
      setErro('Não foi possível montar a projeção. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  }, [franchiseId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  return {
    dados,
    isLoading,
    erro,
    percentualCmvApurado: dados?.percentualCmvApurado ?? 0,
    recarregar: carregar,
  };
}

// Separado do carregamento pra que mexer no % de CMV recalcule na hora, sem ir ao banco.
export function useProjecao(dados: DadosBrutos | null, percentualCmv: number): MesFluxo[] {
  return useMemo(() => {
    if (!dados) return [];

    const hoje = hojeBrasilia();
    const mesInicial = mesAtualBrasilia();
    const listaMeses = proximosMeses(mesInicial, MESES_HORIZONTE);
    const fimHorizonte = intervaloDoMes(listaMeses[listaMeses.length - 1]).fim;

    const nomePorRaiz = new Map<string, string>();
    const raizDaConta = (planoContaId: string | null): string => {
      const raiz = resolverRaiz(dados.categorias, planoContaId);
      if (!raiz) return SEM_CATEGORIA;
      if (!nomePorRaiz.has(raiz)) {
        nomePorRaiz.set(raiz, dados.categorias.find((c) => c.id === raiz)?.nome || 'Sem categoria');
      }
      return raiz;
    };
    nomePorRaiz.set(SEM_CATEGORIA, 'Sem categoria');

    // --- Lançado por mês/raiz ---
    const lancadoPorMes = new Map<string, Map<string, number>>();
    const jaMaterializado = new Set<string>();
    const mesesComFolhaLancada = new Set<string>();

    for (const linha of dados.pagar) {
      const mes = linha.due_date.slice(0, 7);
      const raiz = raizDaConta(linha.plano_conta_id);
      if (!lancadoPorMes.has(mes)) lancadoPorMes.set(mes, new Map());
      const doMes = lancadoPorMes.get(mes)!;
      doMes.set(raiz, (doMes.get(raiz) || 0) + (Number(linha.amount) || 0));

      if (linha.despesa_recorrente_id) {
        jaMaterializado.add(`${linha.despesa_recorrente_id}|${linha.due_date}`);
      }
      if (linha.folha_pagamento_item_id) mesesComFolhaLancada.add(mes);
    }

    // --- Recorrências ainda não materializadas, por mês/raiz ---
    const recorrentePorMes = new Map<string, Map<string, number>>();
    const inicioProjecao = new Date(`${hoje}T00:00:00Z`);
    const fimProjecao = new Date(`${fimHorizonte}T00:00:00Z`);

    for (const r of dados.recorrentes) {
      const raiz = raizDaConta(r.plano_conta_id);
      for (const data of ocorrenciasNoIntervalo(r, inicioProjecao, fimProjecao)) {
        if (jaMaterializado.has(`${r.id}|${data}`)) continue;
        const mes = data.slice(0, 7);
        if (!recorrentePorMes.has(mes)) recorrentePorMes.set(mes, new Map());
        const doMes = recorrentePorMes.get(mes)!;
        doMes.set(raiz, (doMes.get(raiz) || 0) + (Number(r.valor_referencia) || 0));
      }
    }

    // A raiz de "Despesas com Pessoal" é descoberta pelo dado, não fixada: é a raiz das
    // despesas que vieram da folha.
    const raizPessoal = dados.pagar.find((l) => l.folha_pagamento_item_id)?.plano_conta_id
      ? raizDaConta(dados.pagar.find((l) => l.folha_pagamento_item_id)!.plano_conta_id)
      : null;

    return listaMeses.map((mes) => {
      const { inicio, fim } = intervaloDoMes(mes);
      // No mês corrente só os dias que faltam: os que já passaram são faturamento realizado.
      const primeiroDiaAProjetar = mes === mesInicial ? adicionarDias(hoje, 1) : inicio;

      let entradas = 0;
      let cursor = primeiroDiaAProjetar;
      while (cursor <= fim) {
        entradas += dados.medias[new Date(`${cursor}T00:00:00Z`).getUTCDay()];
        cursor = adicionarDias(cursor, 1);
      }

      const lancado = lancadoPorMes.get(mes) || new Map<string, number>();
      const recorrente = recorrentePorMes.get(mes) || new Map<string, number>();

      const raizes = new Set<string>([
        ...Array.from(lancado.keys()),
        ...Array.from(recorrente.keys()),
        RAIZ_CMV,
      ]);
      if (raizPessoal) raizes.add(raizPessoal);

      const grupos: GrupoSaida[] = Array.from(raizes).map((raizId) => {
        const valorLancado = lancado.get(raizId) || 0;
        let estimado = recorrente.get(raizId) || 0;
        const origens: string[] = [];
        if (estimado > 0) origens.push('recorrências ainda não geradas');

        if (raizId === RAIZ_CMV) {
          // O percentual define o CMV TOTAL do mês. O que já está em boleto é a compra a
          // prazo; só a diferença vira compra à vista. Somar os dois contaria a mesma
          // mercadoria duas vezes.
          const cmvTotal = (entradas * percentualCmv) / 100;
          const aVista = Math.max(0, cmvTotal - valorLancado);
          if (aVista > 0) {
            estimado += aVista;
            origens.push('compra à vista estimada sobre a venda projetada');
          }
        }

        if (raizPessoal && raizId === raizPessoal && !mesesComFolhaLancada.has(mes) && dados.folhaEstimada > 0) {
          estimado += dados.folhaEstimada;
          origens.push('folha da última competência fechada');
        }

        return {
          raizId,
          nome: nomePorRaiz.get(raizId) || 'Sem categoria',
          lancado: valorLancado,
          estimado,
          total: valorLancado + estimado,
          origemEstimativa: origens.length > 0 ? origens.join(' + ') : null,
        };
      })
        .filter((g) => g.total > 0)
        .sort((a, b) => b.total - a.total);

      const saidas = grupos.reduce((acc, g) => acc + g.total, 0);

      return {
        mes,
        entradas,
        saidas,
        resultado: entradas - saidas,
        grupos,
        ehMesCorrente: mes === mesInicial,
      };
    });
  }, [dados, percentualCmv]);
}
