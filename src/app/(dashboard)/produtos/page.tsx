'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { mesAtualBrasilia, intervaloDoMes } from '../../../lib/date';

/**
 * Catálogo do PDV com as duas margens lado a lado.
 *
 * Existe para corrigir o custo lançado no PDV, que está inflado: medido na Loja4 em
 * 05/10/2026, 1.207 dos 19.617 produtos têm custo igual ou maior que o preço de venda.
 *
 * - Margem de cadastro: (preço − custo) ÷ preço. Vale para todo produto, inclusive o que
 *   nunca vendeu — é nela que o erro de custo aparece.
 * - Margem realizada: do que foi vendido no período, com o custo que veio na venda. Diz
 *   quais categorias pesam no bolso, para a correção começar pelo que dá dinheiro.
 *
 * A tela antiga era um cadastro manual de produto, sem uso (uma linha de teste). Com o
 * catálogo vindo do PDV, edição manual seria sobrescrita na carga seguinte — por isso saiu.
 */

interface Franquia {
  id: string;
  name: string;
}

interface CategoriaLinha {
  categoria: string;
  produtos: number;
  anomalias: number;
  margem_cadastro_pct: number | null;
  receita: number;
  cmv: number;
  margem_realizada_pct: number | null;
}

interface ProdutoLinha {
  sku: string;
  nome: string;
  codigo_barras: string | null;
  preco_custo: number | null;
  preco_venda: number | null;
  margem_cadastro_pct: number | null;
  estoque: number;
  unidades: number;
  receita: number;
  margem_realizada_pct: number | null;
  alerta: string | null;
}

const formatCurrency = (valor: number | null) =>
  valor === null || valor === undefined
    ? '—'
    : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);

const formatPct = (valor: number | null) =>
  valor === null || valor === undefined ? '—' : `${Number(valor).toFixed(1)}%`;

const formatNumero = (valor: number) => new Intl.NumberFormat('pt-BR').format(valor);

// O que vai no topo das duas tabelas. A ordem dos produtos é decidida no banco: a maior
// categoria tem 8.621 produtos, e ordenar no navegador depois do limite mostraria o topo da
// ordem errada.
const ORDENS = [
  { valor: 'realizada', rotulo: 'Maior margem realizada' },
  { valor: 'faturamento', rotulo: 'Maior faturamento' },
  { valor: 'cadastro', rotulo: 'Maior margem de cadastro' },
] as const;

type Ordem = (typeof ORDENS)[number]['valor'];

const chaveDaOrdem = (ordem: Ordem) => (c: CategoriaLinha) => {
  if (ordem === 'faturamento') return c.receita ?? 0;
  if (ordem === 'cadastro') return c.margem_cadastro_pct ?? -Infinity;
  return c.margem_realizada_pct ?? -Infinity;
};

// Margem negativa em vermelho; o resto em cinza. Verde só onde a margem é boa de verdade,
// senão a cor deixa de significar algo.
const corDaMargem = (valor: number | null) => {
  if (valor === null || valor === undefined) return 'text-stone-400';
  if (valor < 0) return 'text-red-600 font-semibold';
  if (valor < 10) return 'text-amber-600';
  return 'text-stone-700';
};

export default function ProdutosPage() {
  const [franquias, setFranquias] = useState<Franquia[]>([]);
  const [franquiaSelecionada, setFranquiaSelecionada] = useState('');
  const [podeVerVarias, setPodeVerVarias] = useState(false);
  const [mes, setMes] = useState(mesAtualBrasilia());

  const [categorias, setCategorias] = useState<CategoriaLinha[]>([]);
  const [categoriaAberta, setCategoriaAberta] = useState<string | null>(null);
  const [produtos, setProdutos] = useState<ProdutoLinha[]>([]);
  const [ordem, setOrdem] = useState<Ordem>('realizada');
  const [busca, setBusca] = useState('');
  const [lidoEm, setLidoEm] = useState<string | null>(null);

  const [carregando, setCarregando] = useState(true);
  const [carregandoProdutos, setCarregandoProdutos] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Quem é o usuário e quais lojas ele enxerga. Lojista só vê a própria: cadastro, custo e
  // código de produto são de cada loja, então a tela trabalha sempre com uma loja por vez.
  useEffect(() => {
    async function identificar() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: perfil } = await supabase
          .from('profiles')
          .select('franchise_id, roles(escopo)')
          .eq('id', user.id)
          .maybeSingle();

        const papel = perfil?.roles as unknown as { escopo: string } | null;
        const varias = papel?.escopo === 'todas_franquias';
        setPodeVerVarias(varias);

        if (varias) {
          const { data } = await supabase
            .from('franchises')
            .select('id, name')
            .eq('is_active', true)
            .order('name', { ascending: true });
          setFranquias(data || []);
          setFranquiaSelecionada((atual) => atual || data?.[0]?.id || '');
        } else if (perfil?.franchise_id) {
          setFranquiaSelecionada(perfil.franchise_id);
        }
      } catch (falha) {
        console.error('Erro ao identificar o usuário na tela de produtos:', falha);
        setErro('Não foi possível identificar seu acesso.');
      }
    }
    identificar();
  }, []);

  const carregarCategorias = useCallback(async () => {
    if (!franquiaSelecionada) return;
    setCarregando(true);
    setErro(null);
    try {
      const { inicio, fim } = intervaloDoMes(mes);

      const [resumo, carimbo] = await Promise.all([
        supabase.rpc('margem_categorias', {
          p_franchise_id: franquiaSelecionada,
          p_data_inicio: inicio,
          p_data_fim: fim,
        }),
        supabase
          .from('produtos')
          .select('atualizado_em')
          .eq('franchise_id', franquiaSelecionada)
          .order('atualizado_em', { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (resumo.error) throw resumo.error;
      setCategorias((resumo.data as CategoriaLinha[]) || []);
      setLidoEm((carimbo.data as { atualizado_em: string | null } | null)?.atualizado_em ?? null);
      setCategoriaAberta(null);
      setProdutos([]);
    } catch (falha) {
      console.error('Erro ao carregar margem por categoria:', falha);
      // A mensagem técnica fica menor, abaixo — esconder o texto do banco já custou um
      // ciclo inteiro de diagnóstico neste workspace.
      setErro(falha instanceof Error ? falha.message : String(falha));
    } finally {
      setCarregando(false);
    }
  }, [franquiaSelecionada, mes]);

  useEffect(() => { carregarCategorias(); }, [carregarCategorias]);

  const carregarProdutos = useCallback(async (categoria: string) => {
    setCarregandoProdutos(true);
    try {
      const { inicio, fim } = intervaloDoMes(mes);
      const { data, error } = await supabase.rpc('margem_produtos', {
        p_franchise_id: franquiaSelecionada,
        p_categoria: categoria,
        p_data_inicio: inicio,
        p_data_fim: fim,
        p_limite: 300,
        p_ordem: ordem,
      });
      if (error) throw error;
      setProdutos((data as ProdutoLinha[]) || []);
    } catch (falha) {
      console.error('Erro ao carregar produtos da categoria:', falha);
      setErro(falha instanceof Error ? falha.message : String(falha));
    } finally {
      setCarregandoProdutos(false);
    }
  }, [franquiaSelecionada, mes, ordem]);

  const abrirCategoria = useCallback((categoria: string) => {
    if (categoriaAberta === categoria) {
      setCategoriaAberta(null);
      setProdutos([]);
      return;
    }
    setCategoriaAberta(categoria);
    setBusca('');
    carregarProdutos(categoria);
  }, [categoriaAberta, carregarProdutos]);

  // Trocar a ordem recarrega a categoria aberta: o corte em 300 é feito no banco, então a
  // ordem nova precisa vir de lá, não de uma reordenação do que já está na tela.
  useEffect(() => {
    if (categoriaAberta) carregarProdutos(categoriaAberta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordem]);

  const produtosFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return produtos;
    return produtos.filter(
      (p) => p.nome.toLowerCase().includes(termo) || p.sku.includes(termo) || (p.codigo_barras || '').includes(termo)
    );
  }, [produtos, busca]);

  // As 37 categorias cabem todas na tela, então a ordem delas é só uma reordenação aqui.
  const categoriasOrdenadas = useMemo(() => {
    const chave = chaveDaOrdem(ordem);
    return [...categorias].sort((a, b) => chave(b) - chave(a));
  }, [categorias, ordem]);

  const totais = useMemo(() => ({
    produtos: categorias.reduce((soma, c) => soma + c.produtos, 0),
    anomalias: categorias.reduce((soma, c) => soma + c.anomalias, 0),
  }), [categorias]);

  const catalogoVazio = !carregando && totais.produtos === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-stone-800">Produtos: custo, preço e margem</h1>
          <p className="text-stone-500 text-sm mt-1">
            Cadastro do PDV por categoria, para conferir o custo lançado.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {podeVerVarias && (
            <select
              className="px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none bg-white text-stone-700 text-sm"
              value={franquiaSelecionada}
              onChange={(e) => setFranquiaSelecionada(e.target.value)}
            >
              {franquias.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          )}
          <select
            className="px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none bg-white text-stone-700 text-sm"
            value={ordem}
            onChange={(e) => setOrdem(e.target.value as Ordem)}
          >
            {ORDENS.map((o) => (
              <option key={o.valor} value={o.valor}>{o.rotulo}</option>
            ))}
          </select>
          <input
            type="month"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            className="px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none text-stone-700"
          />
        </div>
      </div>

      {/* Sem isto a tela afirma atualidade que não tem: o cadastro é carregado do PDV de
          tempos em tempos, não a cada abertura. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-stone-500">
        <span>
          Cadastro lido em{' '}
          <strong className="text-stone-700">
            {lidoEm ? new Date(lidoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'nunca'}
          </strong>
        </span>
        {totais.produtos > 0 && (
          <>
            <span>{formatNumero(totais.produtos)} produtos</span>
            <span className={totais.anomalias > 0 ? 'text-red-600 font-semibold' : 'text-emerald-700'}>
              {totais.anomalias > 0
                ? `${formatNumero(totais.anomalias)} com custo a conferir`
                : 'nenhum custo fora do padrão'}
            </span>
          </>
        )}
        <span className="text-stone-400">· margem realizada: vendas do mês escolhido</span>
      </div>

      {erro && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-red-800">Não foi possível carregar os produtos.</p>
          <p className="text-xs text-red-600 mt-1 font-mono break-all">{erro}</p>
        </div>
      )}

      {carregando ? (
        <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-8 text-center text-stone-400 min-h-[300px] flex items-center justify-center">
          Carregando...
        </div>
      ) : catalogoVazio ? (
        <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-8 min-h-[300px] flex flex-col items-center justify-center gap-2 text-center">
          <p className="text-stone-500 text-sm">O cadastro desta loja ainda não foi carregado do PDV.</p>
          <p className="text-stone-400 text-xs">Hoje a carga é feita pela equipe técnica, loja a loja.</p>
        </div>
      ) : (
        <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 border-b border-stone-200">
                <tr className="text-stone-500 text-xs uppercase tracking-wider">
                  <th className="text-left font-semibold px-4 py-3">Categoria</th>
                  <th className="text-right font-semibold px-4 py-3">Produtos</th>
                  <th className="text-right font-semibold px-4 py-3">A conferir</th>
                  <th className="text-right font-semibold px-4 py-3">Margem cadastro</th>
                  <th className="text-right font-semibold px-4 py-3">Vendas do mês</th>
                  <th className="text-right font-semibold px-4 py-3">Margem realizada</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {categoriasOrdenadas.map((c) => (
                  <React.Fragment key={c.categoria}>
                    <tr
                      onClick={() => abrirCategoria(c.categoria)}
                      className={`cursor-pointer hover:bg-stone-50 ${categoriaAberta === c.categoria ? 'bg-stone-50' : ''}`}
                    >
                      <td className="px-4 py-3 font-medium text-stone-700">
                        <span className="text-stone-400 mr-2">{categoriaAberta === c.categoria ? '▾' : '▸'}</span>
                        {c.categoria}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-stone-600">{formatNumero(c.produtos)}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${c.anomalias > 0 ? 'text-red-600 font-semibold' : 'text-stone-400'}`}>
                        {c.anomalias > 0 ? formatNumero(c.anomalias) : '—'}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums ${corDaMargem(c.margem_cadastro_pct)}`}>
                        {formatPct(c.margem_cadastro_pct)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-stone-600">{formatCurrency(c.receita)}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${corDaMargem(c.margem_realizada_pct)}`}>
                        {formatPct(c.margem_realizada_pct)}
                      </td>
                    </tr>

                    {categoriaAberta === c.categoria && (
                      <tr>
                        <td colSpan={6} className="bg-stone-50 px-4 py-4">
                          {carregandoProdutos ? (
                            <p className="text-stone-400 text-sm py-4 text-center">Carregando produtos...</p>
                          ) : (
                            <>
                              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                                <p className="text-xs text-stone-500">
                                  {formatNumero(produtosFiltrados.length)} de {formatNumero(produtos.length)} produtos ·
                                  {' '}{ORDENS.find((o) => o.valor === ordem)?.rotulo.toLowerCase()} primeiro
                                </p>
                                <input
                                  type="search"
                                  value={busca}
                                  onChange={(e) => setBusca(e.target.value)}
                                  placeholder="Buscar por nome, código ou código de barras"
                                  className="px-3 py-1.5 border border-stone-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400 w-full sm:w-80"
                                />
                              </div>

                              <div className="overflow-x-auto bg-white border border-stone-200 rounded-lg">
                                <table className="w-full text-sm">
                                  <thead className="bg-white border-b border-stone-200">
                                    <tr className="text-stone-500 text-xs uppercase tracking-wider">
                                      <th className="text-left font-semibold px-3 py-2">Produto</th>
                                      <th className="text-right font-semibold px-3 py-2">Custo</th>
                                      <th className="text-right font-semibold px-3 py-2">Preço</th>
                                      <th className="text-right font-semibold px-3 py-2">Margem cadastro</th>
                                      <th className="text-right font-semibold px-3 py-2">Vendidos</th>
                                      <th className="text-right font-semibold px-3 py-2">Faturamento</th>
                                      <th className="text-right font-semibold px-3 py-2">Margem realizada</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-stone-100">
                                    {produtosFiltrados.map((p) => (
                                      <tr key={p.sku} className="hover:bg-stone-50">
                                        <td className="px-3 py-2">
                                          <p className="text-stone-700">{p.nome}</p>
                                          <p className="text-[11px] text-stone-400">
                                            cód. {p.sku}
                                            {p.codigo_barras ? ` · ${p.codigo_barras}` : ''}
                                            {p.alerta ? <span className="ml-2 text-red-600 font-semibold">⚠ {p.alerta}</span> : null}
                                          </p>
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums text-stone-600">{formatCurrency(p.preco_custo)}</td>
                                        <td className="px-3 py-2 text-right tabular-nums text-stone-600">{formatCurrency(p.preco_venda)}</td>
                                        <td className={`px-3 py-2 text-right tabular-nums ${corDaMargem(p.margem_cadastro_pct)}`}>
                                          {formatPct(p.margem_cadastro_pct)}
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums text-stone-600">
                                          {p.unidades > 0 ? formatNumero(p.unidades) : '—'}
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums text-stone-600">
                                          {p.receita > 0 ? formatCurrency(p.receita) : '—'}
                                        </td>
                                        <td className={`px-3 py-2 text-right tabular-nums ${corDaMargem(p.margem_realizada_pct)}`}>
                                          {formatPct(p.margem_realizada_pct)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>

                              {produtos.length >= 300 && (
                                <p className="text-[11px] text-stone-400 mt-2">
                                  Mostrando os 300 primeiros desta categoria, na ordem escolhida.
                                </p>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
