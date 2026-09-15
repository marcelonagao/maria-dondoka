'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../../../../lib/supabase';
import { hojeBrasilia, mesAtualBrasilia, intervaloDoMes, adicionarDias } from '../../../../lib/date';
import type { Despesa } from './types';

export type StatusFiltro = 'ativas' | 'pendentes' | 'pagas' | 'canceladas' | 'todas';
export type OrdenarPor = 'due_date' | 'amount' | 'fornecedor';

export interface FiltrosPagar {
  status: StatusFiltro;
  busca: string;
  // 'YYYY-MM' recorta o vencimento no servidor; '' traz tudo (sujeito ao teto abaixo).
  mes: string;
  categoriaId: string;
  fornecedorId: string;
  franchiseId: string;
  apenasVencidas: boolean;
  ordenarPor: OrdenarPor;
  ordemAsc: boolean;
}

export const FILTROS_INICIAIS: FiltrosPagar = {
  status: 'ativas',
  busca: '',
  mes: mesAtualBrasilia(),
  categoriaId: '',
  fornecedorId: '',
  franchiseId: '',
  apenasVencidas: false,
  ordenarPor: 'due_date',
  ordemAsc: true,
};

// O Supabase corta em 1000 linhas por padrão, sem erro — a versão anterior desta tela fazia
// `select('*')` solto e teria truncado em silêncio ao passar disso. O recorte por mês já
// mantém o volume normal bem abaixo, e este teto explícito existe para o caso "todos os
// meses": se bater no limite, a UI avisa em vez de mostrar número errado como se fosse certo.
const TETO_LINHAS = 2000;

function ehVencida(d: Despesa, hoje: string): boolean {
  return d.status === 'pendente' && d.due_date < hoje;
}

export function usePagar() {
  const [despesas, setDespesas] = useState<Despesa[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [truncado, setTruncado] = useState(false);
  const [filtros, setFiltros] = useState<FiltrosPagar>(FILTROS_INICIAIS);

  const atualizarFiltro = useCallback(<K extends keyof FiltrosPagar>(campo: K, valor: FiltrosPagar[K]) => {
    setFiltros((atual) => ({ ...atual, [campo]: valor }));
  }, []);

  const limparFiltros = useCallback(() => setFiltros(FILTROS_INICIAIS), []);

  // O que dá pra empurrar pro servidor vai pro servidor (recorte de período, status,
  // categoria, fornecedor, franquia). Busca textual, "só vencidas" e ordenação ficam no
  // client porque operam sobre o conjunto já recortado — e porque o agrupamento de folha
  // de pagamento precisa do mês inteiro carregado pra contar "X de Y pagos" corretamente.
  const carregar = useCallback(async () => {
    try {
      setIsLoading(true);

      let query = supabase
        .from('accounts_payable')
        .select('*, plano_contas(nome), franchises(name), fornecedores(nome)')
        .order('due_date', { ascending: true })
        .range(0, TETO_LINHAS - 1);

      if (filtros.mes) {
        const { inicio, fim } = intervaloDoMes(filtros.mes);
        query = query.gte('due_date', inicio).lte('due_date', fim);
      }
      if (filtros.status === 'ativas') query = query.neq('status', 'cancelado');
      if (filtros.status === 'pendentes') query = query.eq('status', 'pendente');
      if (filtros.status === 'pagas') query = query.eq('status', 'pago');
      if (filtros.status === 'canceladas') query = query.eq('status', 'cancelado');
      if (filtros.categoriaId) query = query.eq('plano_conta_id', filtros.categoriaId);
      if (filtros.fornecedorId) query = query.eq('fornecedor_id', filtros.fornecedorId);
      if (filtros.franchiseId) query = query.eq('franchise_id', filtros.franchiseId);

      const { data, error } = await query;
      if (error) throw error;

      const linhas = ((data as any) || []) as Despesa[];
      setDespesas(linhas);
      setTruncado(linhas.length >= TETO_LINHAS);
    } catch (error) {
      console.error('Erro ao buscar contas a pagar:', error);
    } finally {
      setIsLoading(false);
    }
  }, [filtros.mes, filtros.status, filtros.categoriaId, filtros.fornecedorId, filtros.franchiseId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const despesasVisiveis = useMemo(() => {
    const hoje = hojeBrasilia();
    const termo = filtros.busca.trim().toLowerCase();

    const filtradas = despesas.filter((d) => {
      if (filtros.apenasVencidas && !ehVencida(d, hoje)) return false;
      if (!termo) return true;
      const alvo = [d.fornecedores?.nome, d.description, d.documento_origem, d.plano_contas?.nome]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return alvo.includes(termo);
    });

    const sinal = filtros.ordemAsc ? 1 : -1;
    return filtradas.sort((a, b) => {
      if (filtros.ordenarPor === 'amount') return (Number(a.amount) - Number(b.amount)) * sinal;
      if (filtros.ordenarPor === 'fornecedor') {
        const na = a.fornecedores?.nome || a.description || '';
        const nb = b.fornecedores?.nome || b.description || '';
        return na.localeCompare(nb, 'pt-BR') * sinal;
      }
      return a.due_date.localeCompare(b.due_date) * sinal;
    });
  }, [despesas, filtros.busca, filtros.apenasVencidas, filtros.ordenarPor, filtros.ordemAsc]);

  // Totais do recorte visível, não da base inteira: o número tem que bater com o que está
  // na tela, senão vira fonte de desconfiança.
  const totais = useMemo(() => {
    const hoje = hojeBrasilia();
    const limite7Dias = adicionarDias(hoje, 7);
    let aPagar = 0;
    let vencido = 0;
    let proximos7Dias = 0;

    for (const d of despesasVisiveis) {
      if (d.status !== 'pendente') continue;
      const valor = Number(d.amount) || 0;
      aPagar += valor;
      if (d.due_date < hoje) vencido += valor;
      else if (d.due_date <= limite7Dias) proximos7Dias += valor;
    }

    return { aPagar, vencido, proximos7Dias, quantidade: despesasVisiveis.length };
  }, [despesasVisiveis]);

  return {
    despesas: despesasVisiveis,
    isLoading,
    truncado,
    filtros,
    atualizarFiltro,
    limparFiltros,
    totais,
    recarregar: carregar,
    ehVencida,
  };
}
