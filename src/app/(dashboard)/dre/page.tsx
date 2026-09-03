'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { supabase } from '../../../lib/supabase';
import { mesAtualBrasilia, intervaloDoMes } from '../../../lib/date';
import { buscarTodosVendasItens } from '../../../lib/vendasItens';

interface CategoriaContas {
  id: string;
  nome: string;
  tipo: 'receita' | 'custo' | 'despesa';
  categoria_pai_id: string | null;
}

interface Franquia {
  id: string;
  name: string;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

export default function DrePage() {
  const [isLoading, setIsLoading] = useState(true);
  const [podeVerVariasFranquias, setPodeVerVariasFranquias] = useState(false);
  const [franquias, setFranquias] = useState<Franquia[]>([]);
  const [franquiaSelecionada, setFranquiaSelecionada] = useState('');
  const [mesSelecionado, setMesSelecionado] = useState(mesAtualBrasilia());

  const [receitaBruta, setReceitaBruta] = useState(0);
  const [cmv, setCmv] = useState(0);
  const [impostos, setImpostos] = useState(0);
  const [despesasPorCategoria, setDespesasPorCategoria] = useState<Record<string, number>>({});

  useEffect(() => {
    async function carregar() {
      try {
        setIsLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: perfil } = await supabase
          .from('profiles')
          .select('roles(escopo)')
          .eq('id', user.id)
          .maybeSingle();

        // Leitura pura (sem escrita) — só escopo importa aqui, a tela /dre já foi
        // filtrada pelo middleware antes de chegar neste componente.
        const papel = perfil?.roles as unknown as { escopo: string } | null;
        const podeVerVarias = papel?.escopo === 'todas_franquias';
        setPodeVerVariasFranquias(podeVerVarias);

        if (podeVerVarias) {
          const { data: franquiasData } = await supabase.from('franchises').select('id, name').order('name', { ascending: true });
          setFranquias(franquiasData || []);
        }

        const { inicio, fim } = intervaloDoMes(mesSelecionado);

        const [planoContasRes, vendasItens, pagarRes] = await Promise.all([
          supabase.from('plano_contas').select('id, nome, tipo, categoria_pai_id'),
          buscarTodosVendasItens<{ valor_total: number; quantidade: number; custo_unitario: number; aliquota_icm: number | null; franchise_id: string }>(
            supabase,
            'valor_total, quantidade, custo_unitario, aliquota_icm, franchise_id',
            inicio,
            fim
          ),
          supabase.from('accounts_payable').select('amount, franchise_id, paid_at, plano_conta_id').not('paid_at', 'is', null).gte('paid_at', inicio).lte('paid_at', fim + 'T23:59:59'),
        ]);

        if (planoContasRes.error) throw planoContasRes.error;
        if (pagarRes.error) throw pagarRes.error;

        const mapaContas = new Map<string, CategoriaContas>((planoContasRes.data || []).map((c) => [c.id, c as CategoriaContas]));

        const filtrarPorFranquia = <T extends { franchise_id: string }>(linhas: T[]) =>
          franquiaSelecionada ? linhas.filter((l) => l.franchise_id === franquiaSelecionada) : linhas;

        const vendasFiltradas = filtrarPorFranquia(vendasItens);
        const receita = vendasFiltradas.reduce((acc, v) => acc + Number(v.valor_total), 0);
        const custoVendido = vendasFiltradas.reduce((acc, v) => acc + Number(v.quantidade) * Number(v.custo_unitario), 0);
        const impostosVendas = vendasFiltradas.reduce((acc, v) => acc + Number(v.valor_total) * (Number(v.aliquota_icm) || 0) / 100, 0);

        setReceitaBruta(receita);
        setCmv(custoVendido);
        setImpostos(impostosVendas);

        const pagarFiltrado = filtrarPorFranquia((pagarRes.data || []) as any[]);

        const despesas: Record<string, number> = {};

        for (const p of pagarFiltrado) {
          const conta = p.plano_conta_id ? mapaContas.get(p.plano_conta_id) : null;
          if (!conta || conta.tipo !== 'despesa') continue;

          const pai = conta.categoria_pai_id ? mapaContas.get(conta.categoria_pai_id) : conta;
          const nomeGrupo = pai?.nome || conta.nome;
          despesas[nomeGrupo] = (despesas[nomeGrupo] || 0) + Number(p.amount);
        }

        setDespesasPorCategoria(despesas);
      } catch (error) {
        console.error('Erro ao carregar DRE:', error);
      } finally {
        setIsLoading(false);
      }
    }

    carregar();
  }, [mesSelecionado, franquiaSelecionada]);

  const margemBruta = receitaBruta - cmv - impostos;
  const totalDespesas = useMemo(
    () => Object.values(despesasPorCategoria).reduce((acc, v) => acc + v, 0),
    [despesasPorCategoria]
  );
  const resultado = margemBruta - totalDespesas;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-stone-800">DRE</h1>
          <p className="text-stone-500 text-sm mt-1">
            DRE gerencial (regime de caixa) — não substitui o DRE contábil oficial.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {podeVerVariasFranquias && (
            <select
              className="px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none bg-white text-stone-700 text-sm"
              value={franquiaSelecionada}
              onChange={(e) => setFranquiaSelecionada(e.target.value)}
            >
              <option value="">Todas as franquias</option>
              {franquias.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          )}
          <input
            type="month"
            value={mesSelecionado}
            onChange={(e) => setMesSelecionado(e.target.value)}
            className="px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none text-stone-700"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-8 text-center text-stone-400">Carregando...</div>
      ) : (
        <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm text-stone-600">
            <tbody className="divide-y divide-stone-100">
              <tr className="bg-stone-50">
                <td className="px-6 py-4 font-semibold text-stone-800">Receita Bruta (Vendas)</td>
                <td className="px-6 py-4 text-right font-semibold text-emerald-600">{formatCurrency(receitaBruta)}</td>
              </tr>
              <tr>
                <td className="px-6 py-4 text-stone-600">(−) Custo da Mercadoria Vendida (CMV)</td>
                <td className="px-6 py-4 text-right text-red-500">{formatCurrency(cmv)}</td>
              </tr>
              <tr>
                <td className="px-6 py-4 text-stone-600">(−) Impostos sobre Vendas</td>
                <td className="px-6 py-4 text-right text-red-500">{formatCurrency(impostos)}</td>
              </tr>
              <tr className="bg-stone-50">
                <td className="px-6 py-4 font-semibold text-stone-800">(=) Margem Bruta</td>
                <td className={`px-6 py-4 text-right font-semibold ${margemBruta >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {formatCurrency(margemBruta)}
                </td>
              </tr>
              <tr>
                <td className="px-6 py-4 font-medium text-stone-700">(−) Despesas Operacionais</td>
                <td className="px-6 py-4 text-right font-medium text-red-500">{formatCurrency(totalDespesas)}</td>
              </tr>
              {Object.entries(despesasPorCategoria).map(([nome, valor]) => (
                <tr key={nome}>
                  <td className="px-6 py-3 pl-10 text-stone-500">{nome}</td>
                  <td className="px-6 py-3 text-right text-stone-500">{formatCurrency(valor)}</td>
                </tr>
              ))}
              <tr className="bg-stone-900 text-white">
                <td className="px-6 py-4 font-semibold">Resultado do Período</td>
                <td className={`px-6 py-4 text-right font-semibold ${resultado >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {formatCurrency(resultado)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div>
        <Link href="/dre/margem-marcas" className="text-sm font-medium text-amber-600 hover:text-amber-700">
          Ver Top 10 Marcas por Margem Bruta →
        </Link>
      </div>
    </div>
  );
}
