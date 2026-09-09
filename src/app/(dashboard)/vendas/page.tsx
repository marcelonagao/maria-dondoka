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

interface FormaInformativa extends FormaPagamentoValor {
  volume: number;
}

interface LinhaUsuario {
  usuario: string;
  acumulado_atualizado_em: string | null;
  proximo_esperado: { dinheiro: number; formas_informativas: FormaInformativa[]; total: number } | null;
  movimentacoes_pendentes: MovimentacaoPendente[];
  transacoes_pendentes: FormaComTransacoes[];
  historico: HistoricoItem[];
}

interface Funcionario {
  id: string;
  nome: string;
}

interface FitaSalva {
  id: string;
  rotulo: string | null;
  valor_comprovante: number;
  conferido_em: string;
}

interface ConferenciaModalidade {
  forma_pagamento: string;
  fitas: FitaSalva[];
}

interface VolumeForma {
  forma_pagamento: string;
  volume: number;
}

// Estado editável de uma fita — `id: null` significa rascunho ainda não salvo.
interface FitaDraft {
  id: string | null;
  rotulo: string;
  valor: string;
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
  const [volumePorForma, setVolumePorForma] = useState<VolumeForma[]>([]);
  const [fitasPorForma, setFitasPorForma] = useState<Record<string, FitaDraft[]>>({});
  const [salvandoFitaChave, setSalvandoFitaChave] = useState<string | null>(null);

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
      setVolumePorForma(json.volume_por_forma || []);
      const conferencias: ConferenciaModalidade[] = json.conferencias_por_forma || [];
      setFitasPorForma(
        Object.fromEntries(
          conferencias.map((c) => [
            c.forma_pagamento,
            c.fitas.map((f) => ({ id: f.id, rotulo: f.rotulo || '', valor: String(f.valor_comprovante) })),
          ])
        )
      );
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

  // Sem fita salva ainda, mostra 1 campo vazio pra começar (spec) — o estado guardado só
  // tem entrada pra forma que já tem pelo menos uma fita gravada.
  const fitasParaExibir = (forma: string): FitaDraft[] => {
    const fitas = fitasPorForma[forma];
    return fitas && fitas.length > 0 ? fitas : [{ id: null, rotulo: '', valor: '' }];
  };

  const handleAdicionarFita = (forma: string) => {
    setFitasPorForma((prev) => ({ ...prev, [forma]: [...fitasParaExibir(forma), { id: null, rotulo: '', valor: '' }] }));
  };

  const handleAlterarFita = (forma: string, index: number, campo: 'rotulo' | 'valor', valorNovo: string) => {
    setFitasPorForma((prev) => {
      const atual = [...fitasParaExibir(forma)];
      atual[index] = { ...atual[index], [campo]: valorNovo };
      return { ...prev, [forma]: atual };
    });
  };

  const handleRemoverFita = async (forma: string, index: number) => {
    const atual = fitasParaExibir(forma);
    const fita = atual[index];
    if (!fita.id) {
      // Rascunho ainda não salvo — remove só localmente, sem chamada nenhuma.
      setFitasPorForma((prev) => {
        const lista = [...atual];
        lista.splice(index, 1);
        return { ...prev, [forma]: lista };
      });
      return;
    }
    if (!confirm('Excluir esta fita? Essa ação não pode ser desfeita.')) return;
    try {
      const res = await fetch('/api/fechamentos/conferencia-maquininha', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: fita.id }),
      });
      if (!res.ok) throw new Error('Falha ao excluir fita');
      await carregar(dataSelecionada);
    } catch (err) {
      console.error('Erro ao excluir fita:', err);
      alert('Erro ao excluir a fita. Verifique o console.');
    }
  };

  const handleSalvarFita = async (forma: string, index: number) => {
    const fita = fitasParaExibir(forma)[index];
    if (!fita || fita.valor.trim() === '') return;
    const valorNumerico = parseFloat(fita.valor);
    if (isNaN(valorNumerico)) return;

    const chave = `${forma}::${index}`;
    setSalvandoFitaChave(chave);
    try {
      if (fita.id) {
        const res = await fetch('/api/fechamentos/conferencia-maquininha', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: fita.id, rotulo: fita.rotulo || undefined, valor_comprovante: valorNumerico }),
        });
        if (!res.ok) throw new Error('Falha ao atualizar fita');
      } else {
        const res = await fetch('/api/fechamentos/conferencia-maquininha', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: dataSelecionada, forma_pagamento: forma, rotulo: fita.rotulo || undefined, valor_comprovante: valorNumerico }),
        });
        if (!res.ok) throw new Error('Falha ao salvar fita');
      }
      await carregar(dataSelecionada);
    } catch (err) {
      console.error('Erro ao salvar fita:', err);
      alert('Erro ao salvar a fita. Verifique o console.');
    } finally {
      setSalvandoFitaChave(null);
    }
  };

  // SISTEMA é um login genérico/compartilhado (não venda automática) — precisa de
  // fechamento igual a qualquer outro operador, então entra normalmente aqui.
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

  // Pendente aqui é agregado de TODOS os usuários — só informativo no resumo (sem botão),
  // a ação de conciliar continua sendo por operador, no card de cada um.
  const pendentesPorForma = new Map<string, number>();
  for (const u of usuarios) {
    for (const t of u.transacoes_pendentes) {
      pendentesPorForma.set(t.forma_pagamento, (pendentesPorForma.get(t.forma_pagamento) || 0) + t.transacoes.length);
    }
  }
  const modalidadesResumo = resumoPorModalidade.map((t) => ({ ...t, pendentes: pendentesPorForma.get(t.forma_pagamento) || 0 }));

  // Linhas da grade de comparação com a fita, com a diferença já calculada — reusado no
  // corpo da tabela e na linha de total, pra não duplicar a lógica.
  const linhasFita = modalidadesResumo
    .filter((m) => m.forma_pagamento !== 'dinheiro')
    .map((m) => {
      const volume = volumePorForma.find((v) => v.forma_pagamento === m.forma_pagamento)?.volume || 0;
      const fitas = fitasParaExibir(m.forma_pagamento);
      const somaFitas = fitas.reduce((acc, f) => {
        const v = parseFloat(f.valor);
        return acc + (isNaN(v) ? 0 : v);
      }, 0);
      const algumaFitaPreenchida = fitas.some((f) => f.valor.trim() !== '');
      const diferenca = m.valor - somaFitas;
      return { ...m, volume, fitas, algumaFitaPreenchida, diferenca };
    });
  const algumaFitaPreenchidaGeral = linhasFita.some((l) => l.algumaFitaPreenchida);
  const diferencaTotalFita = linhasFita.filter((l) => l.algumaFitaPreenchida).reduce((acc, l) => acc + l.diferenca, 0);
  const bateuTotalFita = Math.abs(diferencaTotalFita) <= 0.005;

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
        <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden">
          <div className="p-6 flex items-center justify-between gap-4">
            <div>
              <h3 className="font-medium text-stone-800">Comparação com a Fita da Maquininha</h3>
              <p className="text-xs text-stone-400 mt-1 max-w-xl">
                Dia inteiro, todas as vendas da loja. Detecta modalidade errada selecionada na
                venda — é diferente da conferência de cada fechamento abaixo.
              </p>
            </div>
            <span className="font-semibold text-stone-800 whitespace-nowrap">{formatCurrency(totalVendidoBruto)}</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-stone-600">
              <thead className="bg-stone-50 text-stone-500 uppercase text-xs">
                <tr>
                  <th className="px-6 py-2">Forma de Pagamento</th>
                  <th className="px-6 py-2">Esperado (Sistema)</th>
                  <th className="px-6 py-2">Volume</th>
                  <th
                    className="px-6 py-2 cursor-help"
                    title="Some os sub-totais da(s) bandeira(s) no comprovante antes de digitar, se a maquininha imprimir separado por bandeira."
                  >
                    Comprovante(s) da Fita ⓘ
                  </th>
                  <th className="px-6 py-2">Diferença</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                <tr>
                  <td className="px-6 py-3 font-medium text-stone-700">Dinheiro</td>
                  <td className="px-6 py-3">{formatCurrency(resumoPorModalidade.find((m) => m.forma_pagamento === 'dinheiro')?.valor || 0)}</td>
                  <td className="px-6 py-3 text-stone-400">—</td>
                  <td className="px-6 py-3 text-stone-400">—</td>
                  <td className="px-6 py-3 text-stone-400">—</td>
                </tr>
                {linhasFita.map((m) => {
                  const bateu = Math.abs(m.diferenca) <= 0.005;
                  const corDiferenca = !m.algumaFitaPreenchida ? 'text-stone-400' : bateu ? 'text-emerald-600' : 'text-red-600';

                  return (
                    <tr key={m.forma_pagamento}>
                      <td className="px-6 py-3 font-medium text-stone-700 align-top">{labelFormaPagamento(m.forma_pagamento)}</td>
                      <td className="px-6 py-3 align-top">{formatCurrency(m.valor)}</td>
                      <td className="px-6 py-3 text-stone-500 align-top whitespace-nowrap">{m.volume} venda{m.volume === 1 ? '' : 's'}</td>
                      <td className="px-6 py-3 align-top">
                        <div className="space-y-1.5">
                          {m.fitas.map((fita, index) => {
                            const chave = `${m.forma_pagamento}::${index}`;
                            return (
                              <div key={index} className="flex items-center gap-1.5">
                                <input
                                  type="text"
                                  placeholder="Rótulo (opcional)"
                                  value={fita.rotulo}
                                  onChange={(e) => handleAlterarFita(m.forma_pagamento, index, 'rotulo', e.target.value)}
                                  onBlur={() => handleSalvarFita(m.forma_pagamento, index)}
                                  className="w-24 px-2 py-1 border border-stone-300 rounded text-xs text-stone-600 focus:ring-2 focus:ring-stone-400 outline-none"
                                />
                                <input
                                  type="number"
                                  step="0.01"
                                  placeholder="R$ 0,00"
                                  value={fita.valor}
                                  onChange={(e) => handleAlterarFita(m.forma_pagamento, index, 'valor', e.target.value)}
                                  onBlur={() => handleSalvarFita(m.forma_pagamento, index)}
                                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                  disabled={salvandoFitaChave === chave}
                                  className="w-24 px-2 py-1 border border-stone-300 rounded text-xs text-stone-700 focus:ring-2 focus:ring-stone-400 outline-none disabled:opacity-60"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleRemoverFita(m.forma_pagamento, index)}
                                  className="text-stone-300 hover:text-red-500 text-xs px-1"
                                  title="Remover esta fita"
                                >
                                  ✕
                                </button>
                              </div>
                            );
                          })}
                          <button
                            type="button"
                            onClick={() => handleAdicionarFita(m.forma_pagamento)}
                            className="text-xs text-stone-500 hover:text-stone-700 underline underline-offset-2"
                          >
                            + Adicionar fita
                          </button>
                        </div>
                      </td>
                      <td className={`px-6 py-3 align-top font-semibold whitespace-nowrap ${corDiferenca}`}>
                        {!m.algumaFitaPreenchida ? '—' : `${bateu ? '✓ ' : ''}${formatCurrency(m.diferenca)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-stone-200 font-semibold text-stone-800">
                  <td className="px-6 py-3" colSpan={4}>Diferença Total (Fita vs. Sistema)</td>
                  <td className={`px-6 py-3 whitespace-nowrap ${!algumaFitaPreenchidaGeral ? 'text-stone-400' : bateuTotalFita ? 'text-emerald-600' : 'text-red-600'}`}>
                    {!algumaFitaPreenchidaGeral ? '—' : `${bateuTotalFita ? '✓ ' : ''}${formatCurrency(diferencaTotalFita)}`}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {!isLoading && !erro && dataEstaNoPassado && totalPendente > 0.005 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-6 py-4 text-blue-800 text-sm flex items-start gap-2">
          <span>⚠️</span>
          <span>
            Este fechamento é de um dia anterior. A contagem física de dinheiro pode não representar
            mais o caixa real, já que o valor provavelmente já se misturou com vendas de dias
            seguintes na mesma gaveta.
          </span>
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
            // SISTEMA é login genérico/compartilhado, não venda automática — renderiza
            // como qualquer outro operador, sem exceção (mesma grade, mesmo fechamento).
            const dinheiroEsperado = u.proximo_esperado?.dinheiro ?? 0;
            const formasNaoDinheiro = u.proximo_esperado ? u.proximo_esperado.formas_informativas.filter((f) => f.valor !== 0) : [];

            const valorContadoTexto = valoresDigitados[u.usuario] || '';
            const valorContadoNumerico = parseFloat(valorContadoTexto);
            const dinheiroFoiDigitado = valorContadoTexto.trim() !== '' && !isNaN(valorContadoNumerico);
            const diferencaDinheiro = dinheiroFoiDigitado ? valorContadoNumerico - dinheiroEsperado : null;

            const linhasNaoDinheiro = formasNaoDinheiro.map((f) => {
              const transacoesDaForma = u.transacoes_pendentes.find((t) => t.forma_pagamento === f.forma_pagamento)?.transacoes || [];
              // Reage em tempo real ao check/uncheck do painel (antes até de salvar): marcar
              // = "confirmei, tira da diferença"; desmarcar = "sinalizei, volta pra diferença".
              const diferenca = transacoesDaForma.filter((t) => !selecionadas[t.id]).reduce((acc, t) => acc + t.valor, 0);
              return { ...f, transacoesDaForma, diferenca };
            });

            const diferencaTotal = diferencaDinheiro === null
              ? null
              : diferencaDinheiro + linhasNaoDinheiro.reduce((acc, l) => acc + l.diferenca, 0);
            const totalBateu = diferencaTotal !== null && Math.abs(diferencaTotal) <= 0.005;

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
                <button
                  type="button"
                  onClick={() => abrirModalMovimentacao(u.usuario)}
                  className="px-3 py-2 border border-stone-300 text-stone-600 hover:bg-stone-50 text-sm font-medium rounded-lg transition-colors"
                >
                  Sangria/Suprimento
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-stone-600">
                  <thead className="bg-stone-50 text-stone-500 uppercase text-xs">
                    <tr>
                      <th className="px-6 py-2">Forma de Pagamento</th>
                      <th className="px-6 py-2">Esperado</th>
                      <th className="px-6 py-2">Resultado</th>
                      <th className="px-6 py-2">Diferença</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    <tr>
                      <td className="px-6 py-3 font-medium text-stone-700">Dinheiro</td>
                      <td className="px-6 py-3">{formatCurrency(dinheiroEsperado)}</td>
                      <td className="px-6 py-3">
                        {dinheiroEsperado > 0 ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="number"
                              step="0.01"
                              placeholder="Valor contado"
                              value={valoresDigitados[u.usuario] || ''}
                              onChange={(e) => setValoresDigitados((prev) => ({ ...prev, [u.usuario]: e.target.value }))}
                              className="w-32 px-3 py-1.5 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 outline-none"
                            />
                            {funcionarios.length > 0 && (
                              <select
                                value={funcionarioSelecionado[u.usuario] || ''}
                                onChange={(e) => setFuncionarioSelecionado((prev) => ({ ...prev, [u.usuario]: e.target.value }))}
                                className="px-3 py-1.5 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 outline-none bg-white text-stone-700"
                              >
                                <option value="">Quem está fechando?</option>
                                {funcionarios.map((f) => (
                                  <option key={f.id} value={f.id}>{f.nome}</option>
                                ))}
                              </select>
                            )}
                          </div>
                        ) : (
                          <span className="text-stone-400">Nada a conferir hoje</span>
                        )}
                      </td>
                      <td className={`px-6 py-3 font-medium whitespace-nowrap ${
                        diferencaDinheiro === null ? 'text-stone-400' : Math.abs(diferencaDinheiro) <= 0.005 ? 'text-emerald-600' : 'text-red-600'
                      }`}>
                        {diferencaDinheiro === null ? '—' : `${Math.abs(diferencaDinheiro) <= 0.005 ? '✓ ' : ''}${formatCurrency(diferencaDinheiro)}`}
                      </td>
                    </tr>

                    {linhasNaoDinheiro.map((f) => {
                      const chave = `${u.usuario}::${f.forma_pagamento}`;
                      const selecionadasDaForma = f.transacoesDaForma.filter((t) => selecionadas[t.id]);
                      const idsSelecionados = selecionadasDaForma.map((t) => t.id);
                      const valorSelecionado = selecionadasDaForma.reduce((acc, t) => acc + t.valor, 0);
                      const bateu = Math.abs(f.diferenca) <= 0.005;

                      return (
                        <React.Fragment key={f.forma_pagamento}>
                          <tr>
                            <td className="px-6 py-3 font-medium text-stone-700">{labelFormaPagamento(f.forma_pagamento)}</td>
                            <td className="px-6 py-3">
                              {formatCurrency(f.valor)}{' '}
                              <span className="text-stone-400">({f.volume} venda{f.volume === 1 ? '' : 's'})</span>
                            </td>
                            <td className="px-6 py-3">
                              {f.transacoesDaForma.length > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => setFormaExpandida(formaExpandida === chave ? null : chave)}
                                  className="text-amber-800 font-medium hover:underline"
                                >
                                  {formaExpandida === chave ? '▾' : '▸'} {f.transacoesDaForma.length} sinalizada{f.transacoesDaForma.length === 1 ? '' : 's'} → Conciliar
                                </button>
                              ) : (
                                <span className="text-emerald-600">✓ {f.volume}/{f.volume} conferidas</span>
                              )}
                            </td>
                            <td className={`px-6 py-3 font-medium whitespace-nowrap ${bateu ? 'text-emerald-600' : 'text-red-600'}`}>
                              {bateu ? '✓ ' : ''}{formatCurrency(f.diferenca)}
                            </td>
                          </tr>
                          {formaExpandida === chave && f.transacoesDaForma.length > 0 && (
                            <tr>
                              <td colSpan={4} className="px-6 pb-4">
                                <div className="bg-stone-50 border border-stone-200 rounded-lg p-3 space-y-1.5">
                                  <div className="flex items-center justify-between pb-1">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setSelecionadas((prev) => {
                                          const proximo = { ...prev };
                                          f.transacoesDaForma.forEach((t) => { proximo[t.id] = true; });
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
                                  {f.transacoesDaForma.map((t) => (
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
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-stone-300 bg-stone-50 font-semibold text-stone-800 text-base">
                      <td className="px-6 py-3" colSpan={3}>Diferença Total deste Fechamento</td>
                      <td className={`px-6 py-3 whitespace-nowrap ${
                        diferencaTotal === null ? 'text-stone-400' : totalBateu ? 'text-emerald-600' : 'text-red-600'
                      }`}>
                        {diferencaTotal === null ? '—' : `${totalBateu ? '✓ ' : ''}${formatCurrency(diferencaTotal)}`}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="px-6 py-4 flex justify-center border-t border-stone-100">
                <button
                  onClick={() => handleSalvar(u.usuario)}
                  disabled={!valoresDigitados[u.usuario] || salvandoId === u.usuario}
                  className="px-6 py-2 bg-stone-900 hover:bg-stone-800 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {salvandoId === u.usuario ? 'Salvando...' : 'Finalizar Fechamento'}
                </button>
              </div>

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
