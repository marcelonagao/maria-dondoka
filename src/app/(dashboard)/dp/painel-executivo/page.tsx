'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { supabase } from '../../../../lib/supabase';
import { mesAtualBrasilia } from '../../../../lib/date';
import { formatCurrency } from '../../../../lib/format';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

const CATEGORIA_BENEFICIOS = '9222fd0f-a088-4f5e-9577-ef6c8f9e6afc';

interface Franquia {
  id: string;
  name: string;
}

interface Competencia {
  id: string;
  competencia: string;
  status: string;
}

interface CustoMes {
  salarios: number;
  encargos: number;
  beneficios: number;
}

const CORES_LINHA = ['#d97706', '#059669', '#2563eb', '#db2777', '#7c3aed', '#0891b2', '#dc2626', '#65a30d'];

function formatCompetenciaCurta(competenciaYYYYMM: string) {
  const [ano, mes] = competenciaYYYYMM.split('-');
  const nomesMeses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${nomesMeses[parseInt(mes, 10) - 1]}/${ano.slice(2)}`;
}

function custoVazio(): CustoMes {
  return { salarios: 0, encargos: 0, beneficios: 0 };
}

export default function PainelExecutivoDpPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [podeVerVariasFranquias, setPodeVerVariasFranquias] = useState(false);
  const [franquiaPropria, setFranquiaPropria] = useState<string | null>(null);
  const [franquias, setFranquias] = useState<Franquia[]>([]);
  const [franquiaSelecionada, setFranquiaSelecionada] = useState('');
  const [mesSelecionado, setMesSelecionado] = useState(mesAtualBrasilia());

  // custosPorFranquia: franchise_id -> (competencia YYYY-MM -> custo do mês)
  const [custosPorFranquia, setCustosPorFranquia] = useState<Map<string, Map<string, CustoMes>>>(new Map());

  useEffect(() => {
    async function carregar() {
      try {
        setIsLoading(true);
        setErro(null);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: perfil } = await supabase
          .from('profiles')
          .select('franchise_id, roles(escopo)')
          .eq('id', user.id)
          .maybeSingle();

        const papel = perfil?.roles as unknown as { escopo: string } | null;
        const podeVerVarias = papel?.escopo === 'todas_franquias';
        setPodeVerVariasFranquias(podeVerVarias);
        setFranquiaPropria(perfil?.franchise_id || null);

        if (podeVerVarias) {
          const { data: franquiasData } = await supabase.from('franchises').select('id, name').order('name', { ascending: true });
          setFranquias(franquiasData || []);
        }

        const [competenciasRes, itensRes, guiasRes, planoContasRes] = await Promise.all([
          supabase
            .from('folha_pagamento_competencias')
            .select('id, competencia, status')
            .in('status', ['aguardando_revisao', 'validado']),
          supabase
            .from('folha_pagamento_itens')
            .select('competencia_id, franchise_id, total_vencimentos, fgts_mes')
            .not('franchise_id', 'is', null),
          supabase
            .from('folha_pagamento_guias')
            .select('competencia_id, franchise_id, tipo, valor')
            .eq('tipo', 'inss_patronal'),
          supabase.from('plano_contas').select('id, categoria_pai_id'),
        ]);

        if (competenciasRes.error) throw competenciasRes.error;
        if (itensRes.error) throw itensRes.error;
        if (guiasRes.error) throw guiasRes.error;
        if (planoContasRes.error) throw planoContasRes.error;

        const competencias = (competenciasRes.data || []) as Competencia[];
        const mapaCompetencia = new Map(competencias.map((c) => [c.id, c.competencia.slice(0, 7)]));

        // "Pertence a Benefícios" é resolvido dinamicamente (categoria-pai + filhas), não
        // hardcodado — se alguém criar uma subcategoria nova, o painel já soma sem mudar código.
        const idsBeneficios = new Set(
          (planoContasRes.data || [])
            .filter((c) => c.id === CATEGORIA_BENEFICIOS || c.categoria_pai_id === CATEGORIA_BENEFICIOS)
            .map((c) => c.id)
        );

        const { data: pagarData, error: pagarError } = await supabase
          .from('accounts_payable')
          .select('franchise_id, amount, paid_at, plano_conta_id')
          .eq('status', 'pago')
          .not('paid_at', 'is', null)
          .in('plano_conta_id', Array.from(idsBeneficios));
        if (pagarError) throw pagarError;

        const mapa = new Map<string, Map<string, CustoMes>>();
        const pegarCelula = (franchiseId: string, competenciaYYYYMM: string) => {
          if (!mapa.has(franchiseId)) mapa.set(franchiseId, new Map());
          const porFranquia = mapa.get(franchiseId)!;
          if (!porFranquia.has(competenciaYYYYMM)) porFranquia.set(competenciaYYYYMM, custoVazio());
          return porFranquia.get(competenciaYYYYMM)!;
        };

        for (const item of itensRes.data || []) {
          const competenciaYYYYMM = mapaCompetencia.get(item.competencia_id);
          if (!competenciaYYYYMM || !item.franchise_id) continue;
          const celula = pegarCelula(item.franchise_id, competenciaYYYYMM);
          celula.salarios += Number(item.total_vencimentos) || 0;
          celula.encargos += Number(item.fgts_mes) || 0;
        }

        for (const guia of guiasRes.data || []) {
          const competenciaYYYYMM = mapaCompetencia.get(guia.competencia_id);
          if (!competenciaYYYYMM) continue;
          const celula = pegarCelula(guia.franchise_id, competenciaYYYYMM);
          celula.encargos += Number(guia.valor) || 0;
        }

        // Benefícios agrupa pelo mês em que a despesa foi PAGA (regime de caixa), não pelo
        // vínculo com a competência de folha — qualquer despesa de Benefícios paga no mês conta.
        for (const p of pagarData || []) {
          if (!p.paid_at || !p.franchise_id) continue;
          const competenciaYYYYMM = p.paid_at.slice(0, 7);
          const celula = pegarCelula(p.franchise_id, competenciaYYYYMM);
          celula.beneficios += Number(p.amount) || 0;
        }

        setCustosPorFranquia(mapa);
      } catch (err) {
        console.error('Erro ao carregar painel executivo de DP:', err);
        setErro('Não foi possível carregar o painel. Tente novamente.');
      } finally {
        setIsLoading(false);
      }
    }

    carregar();
  }, []);

  const franquiasComDado = useMemo(() => Array.from(custosPorFranquia.keys()), [custosPorFranquia]);
  const nomeFranquia = useMemo(() => {
    const mapa = new Map(franquias.map((f) => [f.id, f.name]));
    return (id: string) => mapa.get(id) || id;
  }, [franquias]);

  // Card do mês selecionado: franquia específica, ou soma de todas.
  const custoDoMes: CustoMes = useMemo(() => {
    const franquiasAlvo = franquiaSelecionada
      ? [franquiaSelecionada]
      : podeVerVariasFranquias
        ? franquiasComDado
        : franquiaPropria
          ? [franquiaPropria]
          : [];

    const total = custoVazio();
    for (const fid of franquiasAlvo) {
      const celula = custosPorFranquia.get(fid)?.get(mesSelecionado);
      if (!celula) continue;
      total.salarios += celula.salarios;
      total.encargos += celula.encargos;
      total.beneficios += celula.beneficios;
    }
    return total;
  }, [custosPorFranquia, franquiaSelecionada, mesSelecionado, podeVerVariasFranquias, franquiasComDado, franquiaPropria]);

  const cetDoMes = custoDoMes.salarios + custoDoMes.encargos + custoDoMes.beneficios;
  const temDadoNoMes = cetDoMes > 0;

  // Série do gráfico: uma linha por franquia (se "Todas") ou uma linha só (franquia filtrada).
  const dadosGrafico = useMemo(() => {
    const franquiasNoGrafico = franquiaSelecionada
      ? [franquiaSelecionada]
      : podeVerVariasFranquias
        ? franquiasComDado
        : franquiaPropria
          ? [franquiaPropria]
          : [];

    const todosMeses = new Set<string>();
    for (const fid of franquiasNoGrafico) {
      const meses = custosPorFranquia.get(fid);
      if (meses) Array.from(meses.keys()).forEach((mes) => todosMeses.add(mes));
    }
    const mesesOrdenados = Array.from(todosMeses).sort();

    return mesesOrdenados.map((mes) => {
      const ponto: Record<string, number | string> = { competencia: mes };
      for (const fid of franquiasNoGrafico) {
        const celula = custosPorFranquia.get(fid)?.get(mes);
        const total = celula ? celula.salarios + celula.encargos + celula.beneficios : 0;
        ponto[fid] = total;
      }
      return ponto;
    });
  }, [custosPorFranquia, franquiaSelecionada, podeVerVariasFranquias, franquiasComDado, franquiaPropria]);

  const franquiasNoGrafico = franquiaSelecionada ? [franquiaSelecionada] : franquiasComDado;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-stone-800">Painel Executivo — DP</h1>
          <p className="text-stone-500 text-sm mt-1">
            Custo Efetivo Total (CET) de folha por franquia: salário + encargos + benefícios.
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
      ) : erro ? (
        <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-8 text-center text-red-500 text-sm">{erro}</div>
      ) : (
        <>
          <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-6">
            <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wider mb-2">
              Custo Efetivo Total (CET) — {formatCompetenciaCurta(mesSelecionado)}
            </h3>
            {!temDadoNoMes ? (
              <p className="text-stone-400 text-sm py-4">Nenhuma folha processada nesta competência.</p>
            ) : (
              <>
                <p className="text-3xl font-semibold text-stone-800 mb-4">{formatCurrency(cetDoMes)}</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                  <div className="bg-stone-50 rounded-lg p-3">
                    <p className="text-stone-400 text-xs uppercase tracking-wider mb-1">Salários</p>
                    <p className="font-medium text-stone-700">{formatCurrency(custoDoMes.salarios)}</p>
                  </div>
                  <div className="bg-stone-50 rounded-lg p-3">
                    <p className="text-stone-400 text-xs uppercase tracking-wider mb-1">Encargos (FGTS + INSS Patronal)</p>
                    <p className="font-medium text-stone-700">{formatCurrency(custoDoMes.encargos)}</p>
                  </div>
                  <div className="bg-stone-50 rounded-lg p-3">
                    <p className="text-stone-400 text-xs uppercase tracking-wider mb-1">Benefícios</p>
                    <p className="font-medium text-stone-700">{formatCurrency(custoDoMes.beneficios)}</p>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-6">
            <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wider mb-4">Tendência de CET</h3>
            {dadosGrafico.length === 0 ? (
              <p className="text-stone-400 text-sm py-4">Sem competências processadas para exibir tendência.</p>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={dadosGrafico}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
                  <XAxis dataKey="competencia" tickFormatter={formatCompetenciaCurta} stroke="#a8a29e" fontSize={12} />
                  <YAxis stroke="#a8a29e" fontSize={12} tickFormatter={(v) => `R$ ${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    formatter={(value) => formatCurrency(Number(value))}
                    labelFormatter={(label) => formatCompetenciaCurta(String(label))}
                  />
                  <Legend formatter={(value) => nomeFranquia(String(value))} />
                  {franquiasNoGrafico.map((fid, idx) => (
                    <Line
                      key={fid}
                      type="monotone"
                      dataKey={fid}
                      name={nomeFranquia(fid)}
                      stroke={CORES_LINHA[idx % CORES_LINHA.length]}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </>
      )}

      <div>
        <Link href="/dp" className="text-sm font-medium text-amber-600 hover:text-amber-700">
          ← Voltar para DP
        </Link>
      </div>
    </div>
  );
}
