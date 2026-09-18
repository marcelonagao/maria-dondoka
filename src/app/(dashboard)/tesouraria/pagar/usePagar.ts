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
  // Nome, não id: fornecedor é cadastrado por franquia, então "Aluguel" existe 5 vezes com
  // ids diferentes. Filtrar por id traria só os lançamentos de uma loja.
  fornecedorNome: string;
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
  fornecedorNome: '',
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

// Linha enxuta usada só para montar as opções dos dropdowns.
interface LinhaOpcao {
  plano_conta_id: string | null;
  fornecedores: { nome: string } | null;
}

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

      // `!inner` só quando há filtro de fornecedor. Aplicado sempre, ele viraria INNER JOIN e
      // sumiria com todo lançamento de fornecedor_id nulo — guia de imposto, folha, avulsos.
      const embedFornecedor = filtros.fornecedorNome ? 'fornecedores!inner(nome)' : 'fornecedores(nome)';

      let query = supabase
        .from('accounts_payable')
        .select(`*, plano_contas(nome), franchises(name), ${embedFornecedor}`)
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
      // Filtro no recurso embutido: recorta as linhas-pai, e não o que vem embutido nelas,
      // porque o embed está marcado com !inner acima.
      if (filtros.fornecedorNome) query = query.eq('fornecedores.nome', filtros.fornecedorNome);
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
  }, [filtros.mes, filtros.status, filtros.categoriaId, filtros.fornecedorNome, filtros.franchiseId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Universo das opções de filtro: os lançamentos do recorte de contexto (mês, status,
  // franquia), SEM aplicar categoria e fornecedor. Estes dois são cruzados em memória logo
  // abaixo, cada um enxergando o outro mas não a si mesmo.
  //
  // O plano de contas tem 40 folhas selecionáveis e só 12 aparecem em lançamento, então
  // oferecer as 40 dava 28 opções que nunca retornam nada.
  const [linhasOpcoes, setLinhasOpcoes] = useState<LinhaOpcao[]>([]);

  useEffect(() => {
    let cancelado = false;

    async function carregarOpcoes() {
      try {
        let query = supabase
          .from('accounts_payable')
          .select('plano_conta_id, fornecedores(nome)')
          .range(0, 9999);

        if (filtros.mes) {
          const { inicio, fim } = intervaloDoMes(filtros.mes);
          query = query.gte('due_date', inicio).lte('due_date', fim);
        }
        if (filtros.status === 'ativas') query = query.neq('status', 'cancelado');
        if (filtros.status === 'pendentes') query = query.eq('status', 'pendente');
        if (filtros.status === 'pagas') query = query.eq('status', 'pago');
        if (filtros.status === 'canceladas') query = query.eq('status', 'cancelado');
        if (filtros.franchiseId) query = query.eq('franchise_id', filtros.franchiseId);

        const { data, error } = await query;
        if (error) throw error;
        if (cancelado) return;
        setLinhasOpcoes(((data as any) || []) as LinhaOpcao[]);
      } catch (error) {
        // Sem isso os dropdowns ficam vazios, mas a lista principal continua funcionando —
        // não vale derrubar a tela por causa das opções de filtro.
        console.error('Erro ao carregar opções de filtro:', error);
      }
    }

    carregarOpcoes();
    return () => { cancelado = true; };
  }, [filtros.mes, filtros.status, filtros.franchiseId]);

  // Cada lista ignora o próprio filtro e respeita o outro. É o que faz os dois conversarem:
  // escolher CMV reduz os fornecedores aos do CMV, mas a lista de categorias continua
  // inteira — senão ela colapsaria em CMV e não haveria como trocar sem limpar o filtro.
  //
  // O valor selecionado entra na lista mesmo quando o cruzamento o excluiria (categoria
  // trocada depois do fornecedor, por exemplo). Sem isso o <select> ficaria em branco
  // mostrando um filtro que está aplicado.
  const opcoesFiltro = useMemo(() => {
    const categorias = new Set<string>();
    const fornecedores = new Set<string>();

    for (const linha of linhasOpcoes) {
      const nome = linha.fornecedores?.nome;
      if (linha.plano_conta_id && (!filtros.fornecedorNome || nome === filtros.fornecedorNome)) {
        categorias.add(linha.plano_conta_id);
      }
      if (nome && (!filtros.categoriaId || linha.plano_conta_id === filtros.categoriaId)) {
        fornecedores.add(nome);
      }
    }

    if (filtros.categoriaId) categorias.add(filtros.categoriaId);
    if (filtros.fornecedorNome) fornecedores.add(filtros.fornecedorNome);

    return { categorias, fornecedores };
  }, [linhasOpcoes, filtros.categoriaId, filtros.fornecedorNome]);

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
    opcoesFiltro,
    filtros,
    atualizarFiltro,
    limparFiltros,
    totais,
    recarregar: carregar,
    ehVencida,
  };
}
