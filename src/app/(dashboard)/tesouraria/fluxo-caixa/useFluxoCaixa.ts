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
  raizPessoal: string | null;
  // Faturamento que já entrou nos dias decorridos do mês corrente. Sem isso, o mês atual
  // comparava meia receita contra um mês inteiro de contas — inclusive boletos já vencidos
  // — e sempre parecia deficitário.
  realizadoMesCorrente: number;
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

      const [vendasRes, pagarRes, recorrentesRes, categoriasRes] = await Promise.all([
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
      let realizadoMesCorrente = 0;
      for (const ponto of serie) {
        const diaSemana = new Date(`${ponto.data}T00:00:00Z`).getUTCDay();
        const faturamento = Number(ponto.faturamento) || 0;
        somaPorDiaSemana[diaSemana] += faturamento;
        contagemPorDiaSemana[diaSemana] += 1;
        totalFaturamento += faturamento;
        totalCmv += Number(ponto.cmv) || 0;
        if (ponto.data.slice(0, 7) === mesInicial) realizadoMesCorrente += faturamento;
      }
      const medias = somaPorDiaSemana.map((soma, i) =>
        contagemPorDiaSemana[i] > 0 ? soma / contagemPorDiaSemana[i] : 0
      );
      const percentualCmvApurado = totalFaturamento > 0 ? (totalCmv / totalFaturamento) * 100 : 0;

      // --- Custo de pessoal do último mês fechado, para repetir nos meses futuros ---
      // Base = TUDO que foi lançado em Pessoal fora de recorrência naquele mês, não só as
      // linhas vindas da folha. Duas razões: (1) `valor_liquido` da folha já vem líquido do
      // adiantamento, então o vale sai do caixa por fora e nunca apareceria; (2) há
      // lançamentos manuais de Ordenado e FGTS por funcionário que não passam pelo fluxo da
      // folha. Somando só a folha, setembro (R$ 115 mil lançados) ficava maior que a
      // estimativa de outubro (R$ 77 mil), o que não faz sentido.
      // Recorrências (FGTS/INSS/Sindicato cadastrados com 🔁) ficam de fora porque já entram
      // pela projeção de recorrência — seriam contadas duas vezes.
      const linhasPessoalRes = await (() => {
        let q = supabase
          .from('accounts_payable')
          .select('due_date, amount, plano_conta_id, despesa_recorrente_id, folha_pagamento_item_id')
          .neq('status', 'cancelado')
          .is('despesa_recorrente_id', null)
          .gte('due_date', adicionarDias(hoje, -150));
        if (franchiseId) q = q.eq('franchise_id', franchiseId);
        return q;
      })();
      if (linhasPessoalRes.error) throw linhasPessoalRes.error;

      const categorias = (categoriasRes.data || []) as CategoriaNo[];
      // A raiz de Pessoal é descoberta pelo dado: é a raiz das despesas geradas pela folha.
      const linhaDeFolha = (linhasPessoalRes.data || []).find((l: any) => l.folha_pagamento_item_id);
      const raizPessoal = linhaDeFolha
        ? resolverRaiz(categorias, (linhaDeFolha as any).plano_conta_id)
        : null;

      // Base = só as linhas vindas do fluxo da folha. Lançamento manual de Pessoal não entra:
      // os "Ordenado"/"FGTS" por funcionário que aparecem soltos são rescisão, evento único —
      // repeti-los em todo mês futuro inflaria a projeção permanentemente.
      // Limitação conhecida: `valor_liquido` da folha já vem líquido do adiantamento, então o
      // vale pago por fora não entra nesta base e a estimativa fica subdimensionada nesse
      // valor. Precisa de uma forma de identificar vale (categoria própria) pra corrigir.
      const folhaPorMes = new Map<string, number>();
      for (const linha of (linhasPessoalRes.data || []) as any[]) {
        if (!linha.folha_pagamento_item_id) continue;
        const mes = linha.due_date.slice(0, 7);
        folhaPorMes.set(mes, (folhaPorMes.get(mes) || 0) + (Number(linha.amount) || 0));
      }
      const mesReferencia = Array.from(folhaPorMes.keys()).sort().pop();
      const folhaEstimada = mesReferencia ? folhaPorMes.get(mesReferencia) || 0 : 0;

      setDados({
        medias,
        percentualCmvApurado,
        categorias,
        pagar: ((pagarRes.data as any) || []) as LinhaPagar[],
        recorrentes: ((recorrentesRes.data as any) || []) as RecorrenteRow[],
        folhaEstimada,
        raizPessoal,
        realizadoMesCorrente,
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
    // A folha estimada é o LÍQUIDO da última competência, então só o líquido já lançado a
    // abate. Vale e rescisão são desembolsos adicionais ao líquido — se abatessem, lançar o
    // vale reduziria a previsão de salário, que é o oposto do certo.
    const folhaLancadaPorMes = new Map<string, number>();
    const jaMaterializado = new Set<string>();

    for (const linha of dados.pagar) {
      const mes = linha.due_date.slice(0, 7);
      const raiz = raizDaConta(linha.plano_conta_id);
      const valor = Number(linha.amount) || 0;

      if (!lancadoPorMes.has(mes)) lancadoPorMes.set(mes, new Map());
      const doMes = lancadoPorMes.get(mes)!;
      doMes.set(raiz, (doMes.get(raiz) || 0) + valor);

      if (linha.despesa_recorrente_id) {
        jaMaterializado.add(`${linha.despesa_recorrente_id}|${linha.due_date}`);
      }
      if (linha.folha_pagamento_item_id) {
        folhaLancadaPorMes.set(mes, (folhaLancadaPorMes.get(mes) || 0) + valor);
      }
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

    const raizPessoal = dados.raizPessoal;

    return listaMeses.map((mes) => {
      const { inicio, fim } = intervaloDoMes(mes);
      const ehMesCorrente = mes === mesInicial;
      // No mês corrente, os dias decorridos entram pelo faturamento REAL e só os que faltam
      // são projetados. As saídas do mês são sempre o mês inteiro (inclusive boletos já
      // vencidos), então contar só a receita restante comparava meio mês com um mês cheio.
      const primeiroDiaAProjetar = ehMesCorrente ? adicionarDias(hoje, 1) : inicio;

      let entradas = ehMesCorrente ? dados.realizadoMesCorrente : 0;
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

        if (raizPessoal && raizId === raizPessoal && dados.folhaEstimada > 0) {
          // Mesma lógica do CMV: a folha da última competência é o TOTAL esperado do mês.
          // O que já foi lançado de Pessoal fora de recorrência (a própria folha, ou um
          // vale adiantado) é abatido, e só a diferença entra como estimativa — senão o
          // vale seria contado duas vezes.
          const jaLancadoDeFolha = folhaLancadaPorMes.get(mes) || 0;
          const faltaDaFolha = Math.max(0, dados.folhaEstimada - jaLancadoDeFolha);
          if (faltaDaFolha > 0) {
            estimado += faltaDaFolha;
            origens.push('folha da última competência fechada');
          }
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
        ehMesCorrente,
      };
    });
  }, [dados, percentualCmv]);
}
