'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import { hojeBrasilia } from '../../../lib/date';
import { labelFormaPagamento } from '../../../lib/formasPagamento';

interface FormaPagamentoValor {
  forma_pagamento: string;
  valor: number;
}

interface FormaPagamentoFechamento {
  forma_pagamento: string;
  valor_esperado: number;
  valor_contado: number | null;
}

interface HistoricoItem {
  id: string;
  valor_esperado: number;
  valor_contado: number;
  diferenca: number;
  contado_em: string;
  funcionario_nome: string | null;
  formas: FormaPagamentoFechamento[];
}

interface MovimentacaoPendente {
  id: string;
  tipo: 'sangria' | 'suprimento';
  valor: number;
  motivo: string;
  criado_em: string;
}

interface LinhaCaixa {
  pdv_device_id: string;
  device_label: string;
  acumulado_atualizado_em: string | null;
  proximo_esperado: { dinheiro: number; formas_informativas: FormaPagamentoValor[]; total: number } | null;
  movimentacoes_pendentes: MovimentacaoPendente[];
  historico: HistoricoItem[];
}

interface Funcionario {
  id: string;
  nome: string;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

export default function PrestacaoContasPage() {
  const hoje = hojeBrasilia();
  const [dataSelecionada, setDataSelecionada] = useState(hoje);
  const [caixas, setCaixas] = useState<LinhaCaixa[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [valoresDigitados, setValoresDigitados] = useState<Record<string, string>>({});
  const [salvandoId, setSalvandoId] = useState<string | null>(null);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [modalCaixaId, setModalCaixaId] = useState<string | null>(null);
  const [formMovimentacao, setFormMovimentacao] = useState({ tipo: 'sangria' as 'sangria' | 'suprimento', valor: '', motivo: '' });
  const [isSalvandoMovimentacao, setIsSalvandoMovimentacao] = useState(false);
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [funcionarioSelecionado, setFuncionarioSelecionado] = useState<Record<string, string>>({});
  const [isSincronizando, setIsSincronizando] = useState(false);

  const handleSincronizarAgora = async () => {
    setIsSincronizando(true);
    try {
      const res = await fetch('/api/pdv/trigger-sync', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        alert(json.detalhe || 'Não foi possível sincronizar agora.');
        return;
      }
      alert(json.resposta || 'Sincronização concluída.');
      await carregar(dataSelecionada);
    } catch (err) {
      console.error('Erro ao sincronizar agora:', err);
      alert('Erro ao sincronizar. Verifique o console.');
    } finally {
      setIsSincronizando(false);
    }
  };

  useEffect(() => {
    supabase.from('funcionarios').select('id, nome').eq('ativo', true).order('nome', { ascending: true })
      .then(({ data, error }) => {
        if (error) { console.error('Erro ao carregar funcionários:', error); return; }
        setFuncionarios(data || []);
      });
  }, []);

  const carregar = async (data: string) => {
    try {
      setIsLoading(true);
      setErro(null);
      const res = await fetch(`/api/fechamentos/contagem?data=${data}`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = await res.json();
      setCaixas(json.caixas || []);
    } catch (err) {
      console.error('Erro ao carregar prestação de contas:', err);
      setErro('Não foi possível carregar os dados. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    carregar(dataSelecionada);
  }, [dataSelecionada]);

  const handleSalvar = async (pdv_device_id: string) => {
    const valorTexto = valoresDigitados[pdv_device_id];
    const valor = parseFloat(valorTexto);
    if (isNaN(valor) || valor < 0) {
      alert('Digite um valor válido para a contagem.');
      return;
    }

    setSalvandoId(pdv_device_id);
    try {
      const funcionario_id = funcionarioSelecionado[pdv_device_id] || undefined;
      const res = await fetch('/api/fechamentos/contagem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdv_device_id, data_fechamento: dataSelecionada, valor_contado_dinheiro: valor, funcionario_id }),
      });
      if (!res.ok) throw new Error('Falha ao salvar');
      await carregar(dataSelecionada);
      setValoresDigitados((prev) => ({ ...prev, [pdv_device_id]: '' }));
      setFuncionarioSelecionado((prev) => ({ ...prev, [pdv_device_id]: '' }));
    } catch (err) {
      console.error(err);
      alert('Erro ao salvar a contagem. Verifique o console.');
    } finally {
      setSalvandoId(null);
    }
  };

  const abrirModalMovimentacao = (pdv_device_id: string) => {
    setFormMovimentacao({ tipo: 'sangria', valor: '', motivo: '' });
    setModalCaixaId(pdv_device_id);
  };

  const handleSalvarMovimentacao = async (e: React.FormEvent) => {
    e.preventDefault();
    const valor = parseFloat(formMovimentacao.valor);
    if (isNaN(valor) || valor <= 0) {
      alert('Digite um valor válido.');
      return;
    }
    if (!modalCaixaId) return;

    setIsSalvandoMovimentacao(true);
    try {
      const { error } = await supabase.from('movimentacoes_caixa').insert([{
        pdv_device_id: modalCaixaId,
        tipo: formMovimentacao.tipo,
        valor,
        motivo: formMovimentacao.motivo,
      }]);
      if (error) throw error;

      setModalCaixaId(null);
      await carregar(dataSelecionada);
    } catch (err) {
      console.error('Erro ao registrar movimentação de caixa:', err);
      alert('Erro ao salvar no banco. Verifique o console.');
    } finally {
      setIsSalvandoMovimentacao(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-stone-800">Prestação de Contas</h1>
          <p className="text-stone-500 text-sm mt-1">Registre a contagem física de cada caixa. Um caixa pode ser fechado mais de uma vez no mesmo dia.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSincronizarAgora}
            disabled={isSincronizando}
            className="px-4 py-2 border border-stone-300 text-stone-600 hover:bg-stone-50 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {isSincronizando ? 'Sincronizando...' : 'Sincronizar agora'}
          </button>
          <input
            type="date"
            value={dataSelecionada}
            max={hoje}
            onChange={(e) => setDataSelecionada(e.target.value)}
            className="px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none text-stone-700"
          />
        </div>
      </div>

      {funcionarios.length === 0 && (
        <p className="text-xs text-stone-400">
          Cadastre funcionários em Configurações para rastrear quem fecha o caixa.
        </p>
      )}

      {erro ? (
        <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-8 text-center text-red-500">{erro}</div>
      ) : isLoading ? (
        <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-8 text-center text-stone-400">Carregando...</div>
      ) : caixas.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-8 text-center text-stone-400">
          Nenhum caixa cadastrado. Cadastre em Configurações.
        </div>
      ) : (
        <div className="space-y-4">
          {caixas.map((c) => (
            <div key={c.pdv_device_id} className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden">
              <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="font-medium text-stone-800">{c.device_label}</h3>
                  <p className="text-xs text-stone-400 mt-1">
                    {c.acumulado_atualizado_em
                      ? `Vendas atualizadas em ${new Date(c.acumulado_atualizado_em).toLocaleTimeString('pt-BR')}`
                      : 'Vendas ainda não sincronizadas para este dia'}
                    {c.historico.length > 0 && ` · ${c.historico.length} fechamento(s) já registrado(s) hoje`}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => abrirModalMovimentacao(c.pdv_device_id)}
                    className="px-3 py-2 border border-stone-300 text-stone-600 hover:bg-stone-50 text-sm font-medium rounded-lg transition-colors"
                  >
                    Sangria/Suprimento
                  </button>
                  <div className="text-right">
                    <p className="text-xs text-stone-400 uppercase tracking-wider">Dinheiro esperado</p>
                    <p className="font-semibold text-stone-800">
                      {c.proximo_esperado ? formatCurrency(c.proximo_esperado.dinheiro) : '—'}
                    </p>
                  </div>
                  {funcionarios.length > 0 && (
                    <select
                      value={funcionarioSelecionado[c.pdv_device_id] || ''}
                      onChange={(e) => setFuncionarioSelecionado((prev) => ({ ...prev, [c.pdv_device_id]: e.target.value }))}
                      className="px-3 py-2 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 outline-none bg-white text-stone-700"
                    >
                      <option value="">Quem está fechando?</option>
                      {funcionarios.map((f) => (
                        <option key={f.id} value={f.id}>{f.nome}</option>
                      ))}
                    </select>
                  )}
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Valor contado"
                    disabled={!c.proximo_esperado || c.proximo_esperado.dinheiro === 0}
                    value={valoresDigitados[c.pdv_device_id] || ''}
                    onChange={(e) => setValoresDigitados((prev) => ({ ...prev, [c.pdv_device_id]: e.target.value }))}
                    className="w-32 px-3 py-2 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 outline-none disabled:bg-stone-50 disabled:text-stone-300"
                  />
                  <button
                onClick={() => handleSalvar(c.pdv_device_id)}
                disabled={!c.proximo_esperado || c.proximo_esperado.dinheiro === 0 || salvandoId === c.pdv_device_id}
                className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    {salvandoId === c.pdv_device_id ? 'Salvando...' : 'Fechar Caixa'}
                  </button>
                </div>
              </div>

              {c.proximo_esperado && c.proximo_esperado.formas_informativas.some((f) => f.valor !== 0) && (
                <div className="px-6 pb-4 -mt-2 flex flex-wrap gap-2">
                  {c.proximo_esperado.formas_informativas
                    .filter((f) => f.valor !== 0)
                    .map((f) => (
                      <span key={f.forma_pagamento} className="text-xs bg-stone-50 text-stone-500 rounded-lg px-3 py-1.5">
                        {labelFormaPagamento(f.forma_pagamento)}: <span className="font-medium text-stone-600">{formatCurrency(f.valor)}</span>
                      </span>
                    ))}
                </div>
              )}

              {c.movimentacoes_pendentes.length > 0 && (
                <div className="px-6 pb-4 -mt-2 space-y-1.5">
                  {c.movimentacoes_pendentes.map((m) => (
                    <div key={m.id} className="flex items-center justify-between text-xs bg-stone-50 rounded-lg px-3 py-2">
                      <span className="text-stone-600">
                        <span className={m.tipo === 'sangria' ? 'text-red-600 font-medium' : 'text-emerald-600 font-medium'}>
                          {m.tipo === 'sangria' ? 'Sangria' : 'Suprimento'}
                        </span>
                        {' — '}{m.motivo}
                      </span>
                      <span className={`font-medium ${m.tipo === 'sangria' ? 'text-red-600' : 'text-emerald-600'}`}>
                        {m.tipo === 'sangria' ? '-' : '+'} {formatCurrency(m.valor)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {c.historico.length > 0 && (
                <div className="border-t border-stone-100">
                  <button
                    onClick={() => setExpandido(expandido === c.pdv_device_id ? null : c.pdv_device_id)}
                    className="w-full px-6 py-3 text-xs text-stone-500 hover:bg-stone-50 transition-colors text-left"
                  >
                    {expandido === c.pdv_device_id ? '▾' : '▸'} Ver fechamentos de hoje
                  </button>
                  {expandido === c.pdv_device_id && (
                    <table className="w-full text-left text-sm text-stone-600">
                      <thead className="bg-stone-50 text-stone-500 uppercase text-xs">
                        <tr>
                          <th className="px-6 py-2">Horário</th>
                          <th className="px-6 py-2">Esperado</th>
                          <th className="px-6 py-2">Contado</th>
                          <th className="px-6 py-2">Diferença</th>
                          <th className="px-6 py-2">Fechado por</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {c.historico.map((h) => {
                          const outrasFormas = h.formas.filter((f) => f.forma_pagamento !== 'dinheiro' && f.valor_esperado !== 0);
                          return (
                            <React.Fragment key={h.id}>
                              <tr>
                                <td className="px-6 py-2">{new Date(h.contado_em).toLocaleTimeString('pt-BR')}</td>
                                <td className="px-6 py-2">{formatCurrency(h.valor_esperado)}</td>
                                <td className="px-6 py-2">{formatCurrency(h.valor_contado)}</td>
                                <td className={`px-6 py-2 font-medium ${h.diferenca < 0 ? 'text-red-600' : h.diferenca > 0 ? 'text-emerald-600' : 'text-stone-500'}`}>
                                  {formatCurrency(h.diferenca)}
                                </td>
                                <td className="px-6 py-2 text-stone-500">{h.funcionario_nome || '—'}</td>
                              </tr>
                              {outrasFormas.length > 0 && (
                                <tr>
                                  <td colSpan={5} className="px-6 pb-2 pt-0 text-xs text-stone-400">
                                    {outrasFormas.map((f) => `${labelFormaPagamento(f.forma_pagamento)}: ${formatCurrency(f.valor_esperado)}`).join(' · ')}
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {modalCaixaId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex justify-between items-center p-6 border-b border-stone-100">
              <h2 className="text-lg font-semibold text-stone-800">Sangria / Suprimento</h2>
              <button onClick={() => setModalCaixaId(null)} className="text-stone-400 hover:text-stone-600">✕</button>
            </div>

            <form onSubmit={handleSalvarMovimentacao} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Tipo</label>
                <select
                  className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none bg-white text-stone-700"
                  value={formMovimentacao.tipo}
                  onChange={(e) => setFormMovimentacao({ ...formMovimentacao, tipo: e.target.value as 'sangria' | 'suprimento' })}
                >
                  <option value="sangria">Sangria (retirada de dinheiro)</option>
                  <option value="suprimento">Suprimento (troco/reforço de dinheiro)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Valor (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                  value={formMovimentacao.valor}
                  onChange={(e) => setFormMovimentacao({ ...formMovimentacao, valor: e.target.value })}
                  placeholder="0.00"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Motivo</label>
                <input
                  type="text"
                  required
                  className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                  value={formMovimentacao.motivo}
                  onChange={(e) => setFormMovimentacao({ ...formMovimentacao, motivo: e.target.value })}
                  placeholder="Ex: Compra de material de limpeza"
                />
              </div>

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setModalCaixaId(null)}
                  className="flex-1 px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg font-medium transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSalvandoMovimentacao}
                  className="flex-1 px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-medium transition-colors disabled:opacity-70 flex justify-center items-center"
                >
                  {isSalvandoMovimentacao ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}