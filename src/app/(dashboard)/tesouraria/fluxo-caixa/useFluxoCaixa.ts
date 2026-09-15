'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../../lib/supabase';
import {
  hojeBrasilia,
  mesAtualBrasilia,
  intervaloDoMes,
  adicionarDias,
  proximosMeses,
} from '../../../../lib/date';
import { ocorrenciasNoIntervalo, type FrequenciaRecorrencia } from '../../../../lib/recorrencia';

export interface MesFluxo {
  mes: string;
  entradas: number;
  saidas: number;
  resultado: number;
  // Quanto das saídas ainda não existe como lançamento — é recorrência projetada. Serve
  // pra tela deixar claro o que é compromisso registrado e o que é estimativa.
  saidasProjetadas: number;
  ehMesCorrente: boolean;
}

interface RecorrenteRow {
  id: string;
  franchise_id: string;
  valor_referencia: number;
  dia_vencimento: number;
  frequencia: FrequenciaRecorrencia;
  mes_referencia: number | null;
}

export const MESES_HORIZONTE = 6;
export const DIAS_HISTORICO_VENDAS = 90;

export function useFluxoCaixa(franchiseId?: string) {
  const [meses, setMeses] = useState<MesFluxo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [mediaDiariaPorDiaSemana, setMediaDiariaPorDiaSemana] = useState<number[]>([]);

  const carregar = useCallback(async () => {
    try {
      setIsLoading(true);
      setErro(null);

      const hoje = hojeBrasilia();
      const mesInicial = mesAtualBrasilia();
      const listaMeses = proximosMeses(mesInicial, MESES_HORIZONTE);
      const fimHorizonte = intervaloDoMes(listaMeses[listaMeses.length - 1]).fim;

      const inicioHistorico = adicionarDias(hoje, -DIAS_HISTORICO_VENDAS);

      const [vendasRes, pagarRes, recorrentesRes] = await Promise.all([
        // `serie_vendas_diaria`, não `resumo_vendas`: aqui só interessa faturamento por dia.
        // O resumo completo calcula ainda CMV, impostos, quebra por franquia e o Top 15 com
        // normalização por regex — pedir tudo isso para 90 dias de todas as lojas estourava
        // o statement timeout do Postgres (57014).
        supabase.rpc('serie_vendas_diaria', {
          p_franchise_id: franchiseId || null,
          p_data_inicio: inicioHistorico,
          p_data_fim: hoje,
        }),
        (() => {
          let q = supabase
            .from('accounts_payable')
            .select('due_date, amount, despesa_recorrente_id')
            .eq('status', 'pendente')
            .gte('due_date', intervaloDoMes(mesInicial).inicio)
            .lte('due_date', fimHorizonte);
          if (franchiseId) q = q.eq('franchise_id', franchiseId);
          return q;
        })(),
        (() => {
          let q = supabase
            .from('despesas_recorrentes')
            .select('id, franchise_id, valor_referencia, dia_vencimento, frequencia, mes_referencia')
            .eq('is_active', true);
          if (franchiseId) q = q.eq('franchise_id', franchiseId);
          return q;
        })(),
      ]);

      if (vendasRes.error) throw vendasRes.error;
      if (pagarRes.error) throw pagarRes.error;
      if (recorrentesRes.error) throw recorrentesRes.error;

      // --- Entradas: média por dia da semana dos últimos 90 dias ---
      const serie = ((vendasRes.data as any) || []) as { data: string; faturamento: number }[];
      const somaPorDiaSemana = [0, 0, 0, 0, 0, 0, 0];
      const contagemPorDiaSemana = [0, 0, 0, 0, 0, 0, 0];
      for (const ponto of serie) {
        const diaSemana = new Date(`${ponto.data}T00:00:00Z`).getUTCDay();
        somaPorDiaSemana[diaSemana] += Number(ponto.faturamento) || 0;
        contagemPorDiaSemana[diaSemana] += 1;
      }
      const medias = somaPorDiaSemana.map((soma, i) =>
        contagemPorDiaSemana[i] > 0 ? soma / contagemPorDiaSemana[i] : 0
      );
      setMediaDiariaPorDiaSemana(medias);

      // --- Saídas já lançadas ---
      const pagarPorMes = new Map<string, number>();
      // Chave (recorrente + vencimento) do que JÁ existe, pra não contar a mesma conta duas
      // vezes: o cron materializa a recorrência 2 dias antes, e nesse intervalo ela aparece
      // tanto em accounts_payable quanto na projeção.
      const jaMaterializado = new Set<string>();
      for (const linha of pagarRes.data || []) {
        const mes = linha.due_date.slice(0, 7);
        pagarPorMes.set(mes, (pagarPorMes.get(mes) || 0) + (Number(linha.amount) || 0));
        if (linha.despesa_recorrente_id) {
          jaMaterializado.add(`${linha.despesa_recorrente_id}|${linha.due_date}`);
        }
      }

      // --- Saídas de recorrências ainda não materializadas ---
      // Sem isso a projeção subestima os meses futuros de forma crescente: o cron só cria a
      // despesa 2 dias antes do vencimento, então nada de daqui a 2 meses existe ainda.
      const projetadoPorMes = new Map<string, number>();
      const inicioProjecao = new Date(`${hoje}T00:00:00Z`);
      const fimProjecao = new Date(`${fimHorizonte}T00:00:00Z`);

      for (const r of (recorrentesRes.data || []) as RecorrenteRow[]) {
        const ocorrencias = ocorrenciasNoIntervalo(r, inicioProjecao, fimProjecao);
        for (const data of ocorrencias) {
          if (jaMaterializado.has(`${r.id}|${data}`)) continue;
          const mes = data.slice(0, 7);
          projetadoPorMes.set(mes, (projetadoPorMes.get(mes) || 0) + (Number(r.valor_referencia) || 0));
        }
      }

      // --- Monta os meses ---
      const resultado: MesFluxo[] = listaMeses.map((mes) => {
        const { inicio, fim } = intervaloDoMes(mes);
        // No mês corrente só projeta os dias que ainda faltam — os que já passaram são
        // faturamento realizado e já estão na série histórica.
        const primeiroDiaAProjetar = mes === mesInicial ? adicionarDias(hoje, 1) : inicio;

        let entradas = 0;
        let cursor = primeiroDiaAProjetar;
        while (cursor <= fim) {
          entradas += medias[new Date(`${cursor}T00:00:00Z`).getUTCDay()];
          cursor = adicionarDias(cursor, 1);
        }

        const lancado = pagarPorMes.get(mes) || 0;
        const projetado = projetadoPorMes.get(mes) || 0;
        const saidas = lancado + projetado;

        return {
          mes,
          entradas,
          saidas,
          resultado: entradas - saidas,
          saidasProjetadas: projetado,
          ehMesCorrente: mes === mesInicial,
        };
      });

      setMeses(resultado);
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

  return { meses, isLoading, erro, mediaDiariaPorDiaSemana, recarregar: carregar };
}
