'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import { hojeBrasilia } from '../../../lib/date';
import { labelFormaPagamento } from '../../../lib/formasPagamento';
import HeroCard from '../../../components/HeroCard';
import MetricList from '../../../components/MetricList';

const CORES_MODALIDADE: Record<string, string> = {
  dinheiro: '#34d399',
  cartao_debito: '#38bdf8',
  cartao_credito: '#818cf8',
  pix: '#fb923c',
  venda_internet: '#f472b6',
  deposito: '#94a3b8',
};

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

interface TransacaoPendente {
  id: string;
  valor: number;
  historico: string | null;
  criado_em: string;
}

interface FormaComTransacoes {
  forma_pagamento: string;
  transacoes: TransacaoPendente[];
}

interface LinhaUsuario {
  usuario: string;
  acumulado_atualizado_em: string | null;
  proximo_esperado: { dinheiro: number; formas_informativas: FormaPagamentoValor[]; total: number } | null;
  movimentacoes_pendentes: MovimentacaoPendente[];
  transacoes_pendentes: FormaComTransacoes[];
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
  const [usuarios, setUsuarios] = useState<LinhaUsuario[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [valoresDigitados, setValoresDigitados] = useState<Record<string, string>>({});
  const [salvandoId, setSalvandoId] = useState<string | null>(null);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [modalUsuario, setModalUsuario] = useState<string | null>(null);
  const [formMovimentacao, setFormMovimentacao] = useState({ tipo: 'sangria' as 'sangria' | 'suprimento', valor: '', motivo: '' });
  const [isSalvandoMovimentacao, setIsSalvandoMovimentacao] = useState(false);
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [funcionarioSelecionado, setFuncionarioSelecionado] = useState<Record<string, string>>({});
  const [isSincronizando, setIsSincronizando] = useState(false);
  const [formaExpandida, setFormaExpandida] = useState<string | null>(null);
  const [selecionadas, setSelecionadas] = useState<Record<string, boolean>>({});
  const [isConciliando, setIsConciliando] = useState(false);
  const [totalVendidoBruto, setTotalVendidoBruto] = useState(0);
  const [totalPorForma, setTotalPorForma] = useState<FormaPagamentoValor[]>([]);

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
      setUsuarios(json.caixas || []);
      setTotalVendidoBruto(json.total_vendido_bruto || 0);
      setTotalPorForma(json.total_por_forma || []);
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

  const handleSalvar = async (usuario: string) => {
    const valorTexto = valoresDigitados[usuario];
    const valor = parseFloat(valorTexto);
    if (isNaN(valor) || valor < 0) {
      alert('Digite um valor válido para a contagem.');
      return;
    }

    setSalvandoId(usuario);
    try {
      const funcionario_id = funcionarioSelecionado[usuario] || undefined;
      const res = await fetch('/api/fechamentos/contagem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario, data_fechamento: dataSelecionada, valor_contado_dinheiro: valor, funcionario_id }),
      });
      if (!res.ok) throw new Error('Falha ao salvar');
      await carregar(dataSelecionada);
      setValoresDigitados((prev) => ({ ...prev, [usuario]: '' }));
      setFuncionarioSelecionado((prev) => ({ ...prev, [usuario]: '' }));
    } catch (err) {
      console.error(err);
      alert('Erro ao salvar a contagem. Verifique o console.');
    } finally {
      setSalvandoId(null);
    }
  };

  const abrirModalMovimentacao = (usuario: string) => {
    setFormMovimentacao({ tipo: 'sangria', valor: '', motivo: '' });
    setModalUsuario(usuario);
  };

  const handleSalvarMovimentacao = async (e: React.FormEvent) => {
    e.preventDefault();
    const valor = parseFloat(formMovimentacao.valor);
    if (isNaN(valor) || valor <= 0) {
      alert('Digite um valor válido.');
      return;
    }
    if (!modalUsuario) return;

    setIsSalvandoMovimentacao(true);
    try {
      const { error } = await supabase.from('movimentacoes_caixa').insert([{
        usuario: modalUsuario,
        tipo: formMovimentacao.tipo,
        valor,
        motivo: formMovimentacao.motivo,
      }]);
      if (error) throw error;

      setModalUsuario(null);
      await carregar(dataSelecionada);
    } catch (err) {
      console.error('Erro ao registrar movimentação de caixa:', err);
      alert('Erro ao salvar no banco. Verifique o console.');
    } finally {
      setIsSalvandoMovimentacao(false);
    }
  };

  const handleConciliar = async (ids: string[]) => {
    if (ids.length === 0) return;
    setIsConciliando(true);
    try {
      const res = await fetch('/api/fechamentos/conciliar-transacoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error('Falha ao conciliar');
      setSelecionadas((prev) => {
        const proximo = { ...prev };
        ids.forEach((id) => delete proximo[id]);
        return proximo;
      });
      await carregar(dataSelecionada);
    } catch (err) {
      console.error('Erro ao conciliar transações:', err);
      alert('Erro ao conciliar. Verifique o console.');
    } finally {
      setIsConciliando(false);
    }
  };

  const totalPendente = usuarios.reduce((acc, u) => acc + (u.proximo_esperado?.dinheiro || 0), 0);
  const usuariosPendentes = usuarios.filter((u) => (u.proximo_esperado?.dinheiro || 0) > 0.005).map((u) => u.usuario);
  const dataEstaNoPassado = dataSelecionada < hoje;
  const rotuloData = dataSelecionada === hoje ? 'hoje' : `em ${dataSelecionada.split('-').reverse().join('/')}`;
  const rotuloDataKpi = dataSelecionada === hoje ? 'Hoje' : `em ${dataSelecionada.split('-').reverse().join('/')}`;

  // Ordem fixa pedida (não é a ordem "natural" do enum FORMAS_PAGAMENTO): dinheiro/débito/
  // crédito/pix sempre aparecem, venda_internet/depósito só quando há valor — resumo pra
  // comparar contra o comprovante da maquininha, não uma lista genérica de formas.
  const ORDEM_RESUMO_MODALIDADE = ['dinheiro', 'cartao_debito', 'cartao_credito', 'pix', 'venda_internet', 'deposito'];
  const SEMPRE_EXIBIR_NO_RESUMO = new Set(['dinheiro', 'cartao_debito', 'cartao_credito', 'pix']);
  const resumoPorModalidade = ORDEM_RESUMO_MODALIDADE
    .map((forma) => ({ forma_pagamento: forma, valor: totalPorForma.find((t) => t.forma_pagamento === forma)?.valor || 0 }))
    .filter((t) => SEMPRE_EXIBIR_NO_RESUMO.has(t.forma_pagamento) || t.valor > 0.005);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-stone-800">Prestação de Contas</h1>
          <p className="text-stone-500 text-sm mt-1">Registre a contagem física por operador. O mesmo usuário pode fechar mais de uma vez no mesmo dia.</p>
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

      {!isLoading && !erro && usuarios.length > 0 && (
        <div className="max-w-sm">
          <HeroCard label={`Total Vendido ${rotuloDataKpi}`} value={formatCurrency(totalVendidoBruto)} valueSizeClassName="text-3xl sm:text-4xl">
            <p className="text-xs text-stone-500 -mt-1 mb-2">Compare com o comprovante da maquininha.</p>
            <MetricList
              variant="dark"
              items={resumoPorModalidade.map((t) => ({
                label: labelFormaPagamento(t.forma_pagamento),
                value: formatCurrency(t.valor),
                dotColor: CORES_MODALIDADE[t.forma_pagamento],
              }))}
            />
          </HeroCard>
        </div>
      )}

      {!isLoading && !erro && dataEstaNoPassado && totalPendente > 0.005 && (
        <div className="bg-stone-100 border border-stone-200 rounded-xl px-6 py-4 text-stone-600 text-sm">
          Este fechamento é de um dia anterior. A contagem física de dinheiro pode não representar
          mais o caixa real, já que o valor provavelmente já se misturou com vendas de dias
          seguintes na mesma gaveta.
        </div>
      )}

      {funcionarios.length === 0 && (
        <p className="text-xs text-stone-400">
          Cadastre funcionários em Configurações para rastrear quem fecha o caixa.
        </p>
      )}

      {!isLoading && !erro && usuarios.length > 0 && (
        totalPendente > 0.005 ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-6 py-4 text-amber-800 text-sm font-medium">
            {formatCurrency(totalPendente)} ainda não conferidos {rotuloData} — pendente: {usuariosPendentes.join(', ')}
          </div>
        ) : (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-6 py-4 text-emerald-700 text-sm font-medium">
            Tudo conferido {rotuloData}.
          </div>
        )
      )}

      {erro ? (
        <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-8 text-center text-red-500">{erro}</div>
      ) : isLoading ? (
        <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-8 text-center text-stone-400">Carregando...</div>
      ) : usuarios.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-8 text-center text-stone-400">
          Nenhuma venda sincronizada para este dia.
        </div>
      ) : (
        <div className="space-y-4">
          {usuarios.map((u) => {
            const dinheiroEsperado = u.proximo_esperado?.dinheiro ?? 0;
            const temPendenciaConciliacao = u.transacoes_pendentes.some((t) => t.transacoes.length > 0);
            const temChipsExibiveis = !!u.proximo_esperado && u.proximo_esperado.formas_informativas.some((f) => f.valor !== 0);

            const botaoSangria = (
              <button
                type="button"
                onClick={() => abrirModalMovimentacao(u.usuario)}
                className="px-3 py-2 border border-stone-300 text-stone-600 hover:bg-stone-50 text-sm font-medium rounded-lg transition-colors"
              >
                Sangria/Suprimento
              </button>
            );

            const conteudoChips = temChipsExibiveis ? (
              <>
                <div className="flex flex-wrap gap-2">
                  {u.proximo_esperado!.formas_informativas
                    .filter((f) => f.valor !== 0)
                    .map((f) => {
                      const transacoesDaForma = u.transacoes_pendentes.find((t) => t.forma_pagamento === f.forma_pagamento)?.transacoes || [];
                      if (transacoesDaForma.length === 0) {
                        return (
                          <span key={f.forma_pagamento} className="text-xs bg-stone-50 text-stone-500 rounded-lg px-3 py-1.5">
                            {labelFormaPagamento(f.forma_pagamento)}: <span className="font-medium text-stone-600">{formatCurrency(f.valor)}</span>
                          </span>
                        );
                      }
                      const chave = `${u.usuario}::${f.forma_pagamento}`;
                      return (
                        <button
                          key={f.forma_pagamento}
                          type="button"
                          onClick={() => setFormaExpandida(formaExpandida === chave ? null : chave)}
                          className="text-xs bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 rounded-lg px-3 py-1.5 transition-colors flex items-center gap-1.5"
                        >
                          <span>
                            {formaExpandida === chave ? '▾' : '▸'} {labelFormaPagamento(f.forma_pagamento)}:{' '}
                            <span className="font-medium">{formatCurrency(f.valor)}</span>{' '}
                            · {transacoesDaForma.length} pendente{transacoesDaForma.length === 1 ? '' : 's'}
                          </span>
                          <span className="px-1.5 py-0.5 bg-amber-600 text-white rounded text-[10px] font-semibold uppercase tracking-wide">
                            Conciliar
                          </span>
                        </button>
                      );
                    })}
                </div>

                {u.proximo_esperado!.formas_informativas
                  .filter((f) => f.valor !== 0)
                  .map((f) => {
                    const chave = `${u.usuario}::${f.forma_pagamento}`;
                    if (formaExpandida !== chave) return null;
                    const transacoesDaForma = u.transacoes_pendentes.find((t) => t.forma_pagamento === f.forma_pagamento)?.transacoes || [];
                    if (transacoesDaForma.length === 0) return null;
                    const selecionadasDaForma = transacoesDaForma.filter((t) => selecionadas[t.id]);
                    const idsSelecionados = selecionadasDaForma.map((t) => t.id);
                    const valorSelecionado = selecionadasDaForma.reduce((acc, t) => acc + t.valor, 0);
                    return (
                      <div key={chave} className="bg-stone-50 border border-stone-200 rounded-lg p-3 space-y-1.5">
                        <div className="flex items-center justify-between pb-1">
                          <button
                            type="button"
                            onClick={() =>
                              setSelecionadas((prev) => {
                                const proximo = { ...prev };
                                transacoesDaForma.forEach((t) => { proximo[t.id] = true; });
                                return proximo;
                              })
                            }
                            className="text-xs text-stone-500 hover:text-stone-700 font-medium underline underline-offset-2"
                          >
                            Marcar Todas
                          </button>
                          <span className="text-xs text-stone-500">
                            {idsSelecionados.length > 0
                              ? `${idsSelecionados.length} selecionada(s) — ${formatCurrency(valorSelecionado)}`
                              : 'Nenhuma selecionada'}
                          </span>
                        </div>
                        {transacoesDaForma.map((t) => (
                          <label key={t.id} className="flex items-center justify-between gap-3 text-xs cursor-pointer">
                            <span className="flex items-center gap-2 text-stone-600">
                              <input
                                type="checkbox"
                                checked={!!selecionadas[t.id]}
                                onChange={(e) => setSelecionadas((prev) => ({ ...prev, [t.id]: e.target.checked }))}
                                className="rounded border-stone-300"
                              />
                              {t.historico || 'Sem descrição'}
                            </span>
                            <span className="font-medium text-stone-700 whitespace-nowrap">{formatCurrency(t.valor)}</span>
                          </label>
                        ))}
                        <div className="pt-2 flex justify-end">
                          <button
                            type="button"
                            disabled={idsSelecionados.length === 0 || isConciliando}
                            onClick={() => handleConciliar(idsSelecionados)}
                            className="px-3 py-1.5 bg-stone-900 hover:bg-stone-800 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {isConciliando ? 'Conciliando...' : `Conciliar Selecionadas (${idsSelecionados.length})`}
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </>
            ) : null;

            return (
            <div key={u.usuario} className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden">
              <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="font-medium text-stone-800">{u.usuario}</h3>
                  <p className="text-xs text-stone-400 mt-1">
                    {u.acumulado_atualizado_em
                      ? `Vendas atualizadas em ${new Date(u.acumulado_atualizado_em).toLocaleTimeString('pt-BR')}`
                      : 'Vendas ainda não sincronizadas para este dia'}
                    {u.historico.length > 0 && ` · ${u.historico.length} fechamento(s) já registrado(s) hoje`}
                  </p>
                </div>

                {dinheiroEsperado > 0 ? (
                  <div className="flex items-center gap-3">
                    {botaoSangria}
                    <div className="text-right">
                      <p className="text-xs text-stone-400 uppercase tracking-wider">Dinheiro esperado</p>
                      <p className="font-semibold text-stone-800">{formatCurrency(dinheiroEsperado)}</p>
                    </div>
                    {funcionarios.length > 0 && (
                      <select
                        value={funcionarioSelecionado[u.usuario] || ''}
                        onChange={(e) => setFuncionarioSelecionado((prev) => ({ ...prev, [u.usuario]: e.target.value }))}
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
                      value={valoresDigitados[u.usuario] || ''}
                      onChange={(e) => setValoresDigitados((prev) => ({ ...prev, [u.usuario]: e.target.value }))}
                      className="w-32 px-3 py-2 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 outline-none disabled:bg-stone-50 disabled:text-stone-300"
                    />
                    <button
                      onClick={() => handleSalvar(u.usuario)}
                      disabled={salvandoId === u.usuario}
                      className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {salvandoId === u.usuario ? 'Salvando...' : 'Fechar Caixa'}
                    </button>
                  </div>
                ) : (
                  botaoSangria
                )}
              </div>

              {dinheiroEsperado === 0 && temPendenciaConciliacao && conteudoChips && (
                <div className="px-6 pb-4 space-y-2">{conteudoChips}</div>
              )}

              {dinheiroEsperado === 0 && (
                <div className="px-6 pb-4 -mt-2">
                  <span className="text-sm text-stone-400">Dinheiro: nada a conferir hoje</span>
                </div>
              )}

              {(dinheiroEsperado > 0 || (dinheiroEsperado === 0 && !temPendenciaConciliacao)) && conteudoChips && (
                <div className="px-6 pb-4 -mt-2 space-y-2">{conteudoChips}</div>
              )}

              {u.movimentacoes_pendentes.length > 0 && (
                <div className="px-6 pb-4 -mt-2 space-y-1.5">
                  {u.movimentacoes_pendentes.map((m) => (
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

              {u.historico.length > 0 && (
                <div className="border-t border-stone-100">
                  <button
                    onClick={() => setExpandido(expandido === u.usuario ? null : u.usuario)}
                    className="w-full px-6 py-3 text-xs text-stone-500 hover:bg-stone-50 transition-colors text-left"
                  >
                    {expandido === u.usuario ? '▾' : '▸'} Ver fechamentos de hoje
                  </button>
                  {expandido === u.usuario && (
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
                        {u.historico.map((h) => {
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
            );
          })}
        </div>
      )}

      {modalUsuario && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex justify-between items-center p-6 border-b border-stone-100">
              <h2 className="text-lg font-semibold text-stone-800">Sangria / Suprimento — {modalUsuario}</h2>
              <button onClick={() => setModalUsuario(null)} className="text-stone-400 hover:text-stone-600">✕</button>
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
                  onClick={() => setModalUsuario(null)}
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
