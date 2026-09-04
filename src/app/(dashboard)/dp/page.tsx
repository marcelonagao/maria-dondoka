'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';

interface Competencia {
  id: string;
  competencia: string;
  status: string;
  criado_em: string;
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
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [mesReferencia, setMesReferencia] = useState('');
  const [isEnviando, setIsEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const fetchCompetencias = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('folha_pagamento_competencias')
        .select('id, competencia, status, criado_em')
        .order('competencia', { ascending: false });
      if (error) throw error;
      setCompetencias(data || []);
    } catch (error) {
      console.error('Erro ao buscar competências:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCompetencias();
  }, []);

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
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-stone-600">
            <thead className="bg-stone-50 border-b border-stone-200 text-stone-500 uppercase text-xs font-medium">
              <tr>
                <th className="px-6 py-4">Competência</th>
                <th className="px-6 py-4">Enviado em</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {isLoading ? (
                <tr><td colSpan={4} className="px-6 py-8 text-center text-stone-400">Carregando...</td></tr>
              ) : competencias.length === 0 ? (
                <tr><td colSpan={4} className="px-6 py-8 text-center text-stone-400">Nenhuma folha enviada ainda.</td></tr>
              ) : (
                competencias.map((c) => {
                  const statusInfo = STATUS_LABELS[c.status] || { label: c.status, className: 'bg-stone-100 text-stone-600' };
                  return (
                    <tr key={c.id} className="hover:bg-stone-50/50 transition-colors">
                      <td className="px-6 py-4 font-medium text-stone-800">{formatCompetencia(c.competencia)}</td>
                      <td className="px-6 py-4">{new Date(c.criado_em).toLocaleDateString('pt-BR')}</td>
                      <td className="px-6 py-4">
                        <span className={`px-2.5 py-1 text-xs font-medium rounded-md ${statusInfo.className}`}>{statusInfo.label}</span>
                      </td>
                      <td className="px-6 py-4">
                        {(c.status === 'aguardando_revisao' || c.status === 'validado' || c.status === 'cancelado') && (
                          <Link href={`/dp/competencias/${c.id}`} className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors text-amber-600 hover:bg-amber-50">
                            {c.status === 'aguardando_revisao' ? 'Revisar' : 'Ver'}
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
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
