'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';
import { formatCurrency } from '../../../lib/format';

interface Competencia {
  id: string;
  competencia: string;
  status: string;
  criado_em: string;
}

interface Franquia {
  id: string;
  name: string;
}

interface ResumoItens {
  valor: number;
  qtd: number;
}

interface GrupoMes {
  valorTotal: number;
  qtdFuncionarios: number;
  porFranquia: Map<string, Competencia[]>;
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  processando: { label: 'Processando...', className: 'bg-amber-50 text-amber-700' },
  aguardando_revisao: { label: 'Aguardando revisão', className: 'bg-blue-50 text-blue-700' },
  validado: { label: 'Validado', className: 'bg-emerald-50 text-emerald-700' },
  erro: { label: 'Erro na extração', className: 'bg-red-50 text-red-600' },
  cancelado: { label: 'Cancelada', className: 'bg-stone-200 text-stone-600' },
};

function formatCompetencia(dataISO: string) {
  const [ano, mes] = dataISO.split('-');
  const nomesMeses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  return `${nomesMeses[parseInt(mes, 10) - 1]} de ${ano}`;
}

export default function DpPage() {
  const router = useRouter();
  const [competencias, setCompetencias] = useState<Competencia[]>([]);
  const [franquiasPorCompetencia, setFranquiasPorCompetencia] = useState<Map<string, string[]>>(new Map());
  const [resumoPorCompetencia, setResumoPorCompetencia] = useState<Map<string, ResumoItens>>(new Map());
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [mesReferencia, setMesReferencia] = useState('');
  const [isEnviando, setIsEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const fetchCompetencias = async () => {
    try {
      setIsLoading(true);
      const [competenciasRes, itensRes, franquiasRes] = await Promise.all([
        supabase.from('folha_pagamento_competencias').select('id, competencia, status, criado_em').order('competencia', { ascending: false }),
        supabase.from('folha_pagamento_itens').select('competencia_id, franchise_id, valor_liquido'),
        supabase.from('franchises').select('id, name'),
      ]);
      if (competenciasRes.error) throw competenciasRes.error;
      setCompetencias(competenciasRes.data || []);

      const nomePorId = new Map((franquiasRes.data || []).map((f: Franquia) => [f.id, f.name]));
      const idsPorCompetencia = new Map<string, Set<string>>();
      const resumo = new Map<string, ResumoItens>();
      for (const item of itensRes.data || []) {
        const atual = resumo.get(item.competencia_id) || { valor: 0, qtd: 0 };
        atual.valor += Number(item.valor_liquido) || 0;
        atual.qtd += 1;
        resumo.set(item.competencia_id, atual);

        if (!item.franchise_id) continue;
        if (!idsPorCompetencia.has(item.competencia_id)) idsPorCompetencia.set(item.competencia_id, new Set());
        idsPorCompetencia.get(item.competencia_id)!.add(item.franchise_id);
      }
      setResumoPorCompetencia(resumo);

      const nomesPorCompetencia = new Map<string, string[]>();
      for (const [competenciaId, ids] of Array.from(idsPorCompetencia.entries())) {
        nomesPorCompetencia.set(competenciaId, Array.from(ids).map((id) => nomePorId.get(id) || '—').sort());
      }
      setFranquiasPorCompetencia(nomesPorCompetencia);
    } catch (error) {
      console.error('Erro ao buscar competências:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCompetencias();
  }, []);

  const gruposPorMes = useMemo(() => {
    const meses = new Map<string, GrupoMes>();
    for (const c of competencias) {
      const mes = c.competencia.slice(0, 7);
      if (!meses.has(mes)) meses.set(mes, { valorTotal: 0, qtdFuncionarios: 0, porFranquia: new Map() });
      const grupoMes = meses.get(mes)!;

      // Competência cancelada não representa custo real do mês; erro nunca tem itens.
      if (c.status !== 'cancelado' && c.status !== 'erro') {
        const resumo = resumoPorCompetencia.get(c.id);
        if (resumo) {
          grupoMes.valorTotal += resumo.valor;
          grupoMes.qtdFuncionarios += resumo.qtd;
        }
      }

      const nomesFranquias = franquiasPorCompetencia.get(c.id) || [];
      const chaveFranquia = nomesFranquias.length === 0 ? '—' : nomesFranquias.length === 1 ? nomesFranquias[0] : 'Múltiplas franquias';
      if (!grupoMes.porFranquia.has(chaveFranquia)) grupoMes.porFranquia.set(chaveFranquia, []);
      grupoMes.porFranquia.get(chaveFranquia)!.push(c);
    }
    return Array.from(meses.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [competencias, resumoPorCompetencia, franquiasPorCompetencia]);

  const toggleMes = (mes: string) => {
    setExpandedMonths((atual) => {
      const novo = new Set(atual);
      if (novo.has(mes)) novo.delete(mes); else novo.add(mes);
      return novo;
    });
  };

  const fecharModal = () => {
    setIsModalOpen(false);
    setArquivo(null);
    setMesReferencia('');
    setErro(null);
  };

  const handleEnviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!arquivo || !mesReferencia) return;
    setIsEnviando(true);
    setErro(null);
    try {
      const formData = new FormData();
      formData.append('arquivo', arquivo);
      formData.append('competencia', `${mesReferencia}-01`);

      // Fetch same-origin já manda os cookies de sessão automaticamente — a rota lê
      // autenticação via cookie (mesmo padrão de getPerfilAutenticado), não header.
      const res = await fetch('/api/dp/processar-folha', {
        method: 'POST',
        body: formData,
      });
      const resultado = await res.json();
      if (!res.ok) throw new Error(resultado.detalhe || resultado.error || 'Erro ao processar folha.');

      fecharModal();
      router.push(`/dp/competencias/${resultado.competencia_id}`);
    } catch (error) {
      console.error('Erro ao enviar folha:', error);
      setErro(error instanceof Error ? error.message : 'Erro ao enviar. Tente novamente.');
    } finally {
      setIsEnviando(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-stone-800">DP — Folha de Pagamento</h1>
          <p className="text-stone-500 text-sm mt-1">Envie o recibo mensal e revise antes de lançar em Contas a Pagar.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/dp/funcionarios" className="text-sm font-medium text-amber-600 hover:text-amber-700">
            Funcionários →
          </Link>
          <button
            onClick={() => setIsModalOpen(true)}
            className="bg-stone-900 hover:bg-stone-800 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            <span>+</span> Nova Folha
          </button>
        </div>
      </div>

      <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden min-h-[200px]">
        {isLoading ? (
          <div className="px-6 py-8 text-center text-stone-400">Carregando...</div>
        ) : gruposPorMes.length === 0 ? (
          <div className="px-6 py-8 text-center text-stone-400">Nenhuma folha enviada ainda.</div>
        ) : (
          <div className="divide-y divide-stone-100">
            {gruposPorMes.map(([mes, grupo]) => {
              const expandido = expandedMonths.has(mes);
              return (
                <div key={mes}>
                  <button
                    type="button"
                    onClick={() => toggleMes(mes)}
                    className="w-full flex items-center justify-between px-6 py-4 hover:bg-stone-50/50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`text-stone-400 transition-transform inline-block ${expandido ? 'rotate-90' : ''}`}>›</span>
                      <span className="font-medium text-stone-800">{formatCompetencia(`${mes}-01`)}</span>
                    </div>
                    <div className="flex items-center gap-6 text-sm">
                      <span className="font-medium text-stone-700">{formatCurrency(grupo.valorTotal)}</span>
                      <span className="text-stone-400">{grupo.qtdFuncionarios} funcionário{grupo.qtdFuncionarios === 1 ? '' : 's'}</span>
                    </div>
                  </button>
                  {expandido && (
                    <div className="bg-stone-50/50 border-t border-stone-100">
                      {Array.from(grupo.porFranquia.entries())
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([nomeFranquia, competenciasDaFranquia]) => (
                          <div key={nomeFranquia} className="px-6 py-3 border-b border-stone-100 last:border-b-0">
                            <p className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">{nomeFranquia}</p>
                            <div className="space-y-1">
                              {competenciasDaFranquia.map((c) => {
                                const statusInfo = STATUS_LABELS[c.status] || { label: c.status, className: 'bg-stone-100 text-stone-600' };
                                return (
                                  <div key={c.id} className="flex items-center justify-between py-1.5 text-sm">
                                    <span className="text-stone-500">Enviado em {new Date(c.criado_em).toLocaleDateString('pt-BR')}</span>
                                    <div className="flex items-center gap-3">
                                      <span className={`px-2.5 py-1 text-xs font-medium rounded-md ${statusInfo.className}`}>{statusInfo.label}</span>
                                      {(c.status === 'aguardando_revisao' || c.status === 'validado' || c.status === 'cancelado') && (
                                        <Link href={`/dp/competencias/${c.id}`} className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors text-amber-600 hover:bg-amber-50">
                                          {c.status === 'aguardando_revisao' ? 'Revisar' : 'Ver'}
                                        </Link>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex justify-between items-center p-6 border-b border-stone-100">
              <h2 className="text-lg font-semibold text-stone-800">Nova Folha de Pagamento</h2>
              <button onClick={fecharModal} className="text-stone-400 hover:text-stone-600">✕</button>
            </div>
            <form onSubmit={handleEnviar} className="p-6 space-y-4">
              {erro && (
                <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">{erro}</div>
              )}
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Competência (mês)</label>
                <input
                  type="month"
                  required
                  className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none text-stone-700"
                  value={mesReferencia}
                  onChange={(e) => setMesReferencia(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Arquivo PDF</label>
                <input
                  type="file"
                  required
                  accept="application/pdf"
                  className="w-full text-sm text-stone-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-stone-100 file:text-stone-700 file:text-sm file:font-medium hover:file:bg-stone-200"
                  onChange={(e) => setArquivo(e.target.files?.[0] || null)}
                />
              </div>
              <p className="text-xs text-stone-400">
                A extração pode levar até um minuto. A tela de revisão abre automaticamente depois.
              </p>
              <div className="pt-2 flex gap-3">
                <button type="button" onClick={fecharModal} className="flex-1 px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg font-medium transition-colors">
                  Cancelar
                </button>
                <button type="submit" disabled={isEnviando} className="flex-1 px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-medium transition-colors disabled:opacity-70 flex justify-center items-center">
                  {isEnviando ? 'Processando...' : 'Enviar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
