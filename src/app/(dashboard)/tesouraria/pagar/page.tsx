'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '../../../../lib/supabase';
import { hojeBrasilia, dataParaTimestampBrasilia } from '../../../../lib/date';
import { formatCurrency } from '../../../../lib/format';
import Combobox, { ComboboxOption } from '../../../../components/Combobox';
import PaymentSettlementFields, { DadosPagamento } from '../../../../components/PaymentSettlementFields';

interface Despesa {
  id: string;
  description: string;
  due_date: string;
  amount: number;
  status: string;
  plano_conta_id: string | null;
  fornecedor_id: string | null;
  franchise_id: string;
  paid_at: string | null;
  valor_juros: number | null;
  valor_multa: number | null;
  comprovante_url: string | null;
  despesa_recorrente_id: string | null;
  motivo_cancelamento: string | null;
  plano_contas: { nome: string } | null;
  franchises: { name: string } | null;
}

interface CategoriaContas {
  id: string;
  nome: string;
  categoria_pai_id: string | null;
}

interface Franquia {
  id: string;
  name: string;
}

interface Fornecedor {
  id: string;
  nome: string;
  franchise_id: string | null;
}

const PAGAMENTO_INICIAL: DadosPagamento = {
  paidAt: hojeBrasilia(),
  valorJuros: '',
  valorMulta: '',
  comprovanteFile: null,
};

// Campos comparados na edição de uma despesa já lançada — cada diferença vira uma linha
// em accounts_payable_historico antes do update.
const CAMPOS_HISTORICO: Record<string, string> = {
  description: 'Observação',
  plano_conta_id: 'Categoria',
  fornecedor_id: 'Fornecedor',
  due_date: 'Vencimento',
  amount: 'Valor',
  paid_at: 'Data de pagamento',
  valor_juros: 'Juros',
  valor_multa: 'Multa',
  comprovante_url: 'Comprovante',
};

export default function ContasPagarPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [despesas, setDespesas] = useState<Despesa[]>([]);
  const [planoContas, setPlanoContas] = useState<CategoriaContas[]>([]);
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [podeLancarParaOutras, setPodeLancarParaOutras] = useState(false);
  const [minhaFranchiseId, setMinhaFranchiseId] = useState('');
  const [franquias, setFranquias] = useState<Franquia[]>([]);
  const [marcandoPagoId, setMarcandoPagoId] = useState<string | null>(null);
  const [contaParaPagar, setContaParaPagar] = useState<Despesa | null>(null);
  const [pagamentoModal, setPagamentoModal] = useState<DadosPagamento>(PAGAMENTO_INICIAL);
  const [despesaEditando, setDespesaEditando] = useState<Despesa | null>(null);
  const [despesaParaCancelar, setDespesaParaCancelar] = useState<Despesa | null>(null);
  const [motivoCancelamento, setMotivoCancelamento] = useState('');
  const [cancelandoId, setCancelandoId] = useState<string | null>(null);
  const [filtroStatus, setFiltroStatus] = useState<'ativas' | 'canceladas' | 'todas'>('ativas');

  const [formData, setFormData] = useState({
    description: '',
    planoContaId: '',
    fornecedorId: '',
    due_date: '',
    amount: '',
    franchiseId: '',
  });
  const [jaPaga, setJaPaga] = useState(false);
  const [pagamentoForm, setPagamentoForm] = useState<DadosPagamento>(PAGAMENTO_INICIAL);

  const fetchDespesas = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('accounts_payable')
        .select('*, plano_contas(nome), franchises(name)')
        .order('due_date', { ascending: true });

      if (error) throw error;
      setDespesas((data as any) || []);
    } catch (error) {
      console.error('Erro ao buscar contas a pagar:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchPlanoContas = async () => {
    const { data, error } = await supabase
      .from('plano_contas')
      .select('id, nome, categoria_pai_id')
      .eq('is_active', true)
      .in('tipo', ['despesa', 'custo'])
      .order('ordem', { ascending: true });
    if (error) { console.error('Erro ao buscar plano de contas:', error); return; }
    setPlanoContas(data || []);
  };

  const fetchFornecedores = async () => {
    const { data, error } = await supabase
      .from('fornecedores')
      .select('id, nome, franchise_id')
      .eq('is_active', true)
      .order('nome', { ascending: true });
    if (error) { console.error('Erro ao buscar fornecedores:', error); return; }
    setFornecedores(data || []);
  };

  const fetchPerfil = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase
      .from('profiles')
      .select('franchise_id, pode_lancar_para_outras_franquias')
      .eq('id', user.id)
      .maybeSingle();
    if (error) { console.error('Erro ao buscar perfil:', error); return; }
    setMinhaFranchiseId(data?.franchise_id || '');
    const pode = !!data?.pode_lancar_para_outras_franquias;
    setPodeLancarParaOutras(pode);
    if (pode) {
      const { data: franquiasData, error: franquiasError } = await supabase
        .from('franchises')
        .select('id, name')
        .order('name', { ascending: true });
      if (franquiasError) { console.error('Erro ao buscar franquias:', franquiasError); return; }
      setFranquias(franquiasData || []);
    }
  };

  useEffect(() => {
    fetchPerfil();
    fetchPlanoContas();
    fetchFornecedores();
    fetchDespesas();
  }, []);

  const getStatusBadge = (status: string) => {
    const badges: Record<string, JSX.Element> = {
      pendente: <span className="px-2.5 py-1 bg-amber-50 text-amber-700 text-xs font-medium rounded-md">Pendente</span>,
      pago: <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-medium rounded-md">Pago</span>,
      cancelado: <span className="px-2.5 py-1 bg-stone-100 text-stone-500 text-xs font-medium rounded-md">Cancelado</span>,
    };
    return badges[status] || <span className="px-2.5 py-1 bg-stone-100 text-stone-600 text-xs font-medium rounded-md">{status}</span>;
  };

  // Achata a hierarquia pai/filho de plano_contas numa lista única pro combobox de
  // Categoria: filho vira "Pai › Filho"; pai sem filhos vira uma opção direta.
  const categoriaOptions: ComboboxOption[] = planoContas
    .filter((c) => !c.categoria_pai_id)
    .flatMap((pai) => {
      const filhos = planoContas.filter((c) => c.categoria_pai_id === pai.id);
      return filhos.length > 0
        ? filhos.map((filho) => ({ value: filho.id, label: `${pai.nome} › ${filho.nome}` }))
        : [{ value: pai.id, label: pai.nome }];
    });

  const franquiaAtualId = formData.franchiseId || despesaEditando?.franchise_id || minhaFranchiseId;
  const fornecedorOptions: ComboboxOption[] = fornecedores
    .filter((f) => f.franchise_id === null || f.franchise_id === franquiaAtualId)
    .map((f) => ({ value: f.id, label: f.nome }));

  const despesasVisiveis = despesas.filter((d) => {
    if (filtroStatus === 'ativas') return d.status !== 'cancelado';
    if (filtroStatus === 'canceladas') return d.status === 'cancelado';
    return true;
  });

  const criarFornecedor = async (nome: string) => {
    if (!nome) return;
    try {
      const { data, error } = await supabase
        .from('fornecedores')
        .insert({ nome, franchise_id: franquiaAtualId || null })
        .select('id, nome, franchise_id')
        .single();
      if (error) throw error;
      setFornecedores((atual) => [...atual, data]);
      setFormData((atual) => ({ ...atual, fornecedorId: data.id }));
    } catch (error) {
      console.error('Erro ao cadastrar fornecedor:', error);
      alert('Erro ao cadastrar fornecedor. Verifique o console.');
    }
  };

  const enviarComprovante = async (file: File, franchiseId: string): Promise<string> => {
    const caminho = `${franchiseId}/${crypto.randomUUID()}-${file.name}`;
    const { error } = await supabase.storage.from('comprovantes-pagamento').upload(caminho, file);
    if (error) throw error;
    return caminho;
  };

  const verComprovante = async (path: string) => {
    const { data, error } = await supabase.storage.from('comprovantes-pagamento').createSignedUrl(path, 60);
    if (error || !data) { alert('Erro ao gerar o link do comprovante.'); return; }
    window.open(data.signedUrl, '_blank');
  };

  const fecharModal = () => {
    setIsModalOpen(false);
    setDespesaEditando(null);
    setFormData({ description: '', planoContaId: '', fornecedorId: '', due_date: '', amount: '', franchiseId: '' });
    setJaPaga(false);
    setPagamentoForm(PAGAMENTO_INICIAL);
  };

  const abrirNovaDespesa = () => {
    fecharModal();
    setIsModalOpen(true);
  };

  const abrirEdicao = (despesa: Despesa) => {
    setDespesaEditando(despesa);
    setFormData({
      description: despesa.description || '',
      planoContaId: despesa.plano_conta_id || '',
      fornecedorId: despesa.fornecedor_id || '',
      due_date: despesa.due_date,
      amount: String(despesa.amount),
      franchiseId: despesa.franchise_id,
    });
    if (despesa.status === 'pago') {
      setJaPaga(true);
      setPagamentoForm({
        paidAt: despesa.paid_at ? despesa.paid_at.slice(0, 10) : hojeBrasilia(),
        valorJuros: despesa.valor_juros ? String(despesa.valor_juros) : '',
        valorMulta: despesa.valor_multa ? String(despesa.valor_multa) : '',
        comprovanteFile: null,
      });
    } else {
      setJaPaga(false);
      setPagamentoForm(PAGAMENTO_INICIAL);
    }
    setIsModalOpen(true);
  };

  const salvarEdicao = async (original: Despesa, novo: Record<string, unknown>) => {
    const { data: { user } } = await supabase.auth.getUser();
    const linhasHistorico = Object.entries(CAMPOS_HISTORICO)
      .filter(([campo]) => campo in novo)
      .map(([campo, rotulo]) => {
        const valorAntigo = (original as any)[campo];
        const valorNovo = novo[campo];
        if (String(valorAntigo ?? '') === String(valorNovo ?? '')) return null;
        return {
          accounts_payable_id: original.id,
          campo_alterado: rotulo,
          valor_anterior: valorAntigo != null ? String(valorAntigo) : null,
          valor_novo: valorNovo != null ? String(valorNovo) : null,
          alterado_por: user?.id || null,
        };
      })
      .filter((linha): linha is NonNullable<typeof linha> => linha !== null);

    if (linhasHistorico.length > 0) {
      const { error: histError } = await supabase.from('accounts_payable_historico').insert(linhasHistorico);
      if (histError) console.error('Erro ao gravar histórico:', histError.message);
    }

    const { error } = await supabase.from('accounts_payable').update(novo).eq('id', original.id);
    if (error) throw error;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      if (!formData.planoContaId) throw new Error('Selecione uma categoria.');
      if (podeLancarParaOutras && !formData.franchiseId) throw new Error('Selecione a franquia.');

      let comprovanteUrl: string | null = despesaEditando?.comprovante_url || null;
      if (jaPaga) {
        if (pagamentoForm.comprovanteFile) {
          comprovanteUrl = await enviarComprovante(pagamentoForm.comprovanteFile, franquiaAtualId);
        } else if (!comprovanteUrl) {
          if (!confirm('Salvar sem comprovante de pagamento?')) { setIsSubmitting(false); return; }
        }
      }

      const dados: Record<string, unknown> = {
        description: formData.description,
        plano_conta_id: formData.planoContaId,
        fornecedor_id: formData.fornecedorId || null,
        due_date: formData.due_date,
        amount: parseFloat(formData.amount),
      };
      if (podeLancarParaOutras) dados.franchise_id = formData.franchiseId;

      if (jaPaga) {
        dados.status = 'pago';
        dados.paid_at = dataParaTimestampBrasilia(pagamentoForm.paidAt);
        dados.valor_juros = parseFloat(pagamentoForm.valorJuros) || 0;
        dados.valor_multa = parseFloat(pagamentoForm.valorMulta) || 0;
        dados.comprovante_url = comprovanteUrl;
      } else if (!despesaEditando) {
        dados.status = 'pendente';
      }

      if (despesaEditando) {
        await salvarEdicao(despesaEditando, dados);
      } else {
        const { error } = await supabase.from('accounts_payable').insert([dados]);
        if (error) throw error;
      }

      await fetchDespesas();
      fecharModal();
    } catch (error) {
      console.error('Erro ao salvar despesa:', error);
      alert('Erro ao salvar no banco. Verifique o console.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const abrirMarcarComoPago = (despesa: Despesa) => {
    setContaParaPagar(despesa);
    setPagamentoModal(PAGAMENTO_INICIAL);
  };

  const confirmarMarcarComoPago = async () => {
    if (!contaParaPagar) return;
    setMarcandoPagoId(contaParaPagar.id);
    try {
      let comprovanteUrl: string | null = null;
      if (pagamentoModal.comprovanteFile) {
        comprovanteUrl = await enviarComprovante(pagamentoModal.comprovanteFile, contaParaPagar.franchise_id);
      } else if (!confirm('Salvar sem comprovante de pagamento?')) {
        setMarcandoPagoId(null);
        return;
      }

      const { error } = await supabase
        .from('accounts_payable')
        .update({
          status: 'pago',
          paid_at: dataParaTimestampBrasilia(pagamentoModal.paidAt),
          valor_juros: parseFloat(pagamentoModal.valorJuros) || 0,
          valor_multa: parseFloat(pagamentoModal.valorMulta) || 0,
          comprovante_url: comprovanteUrl,
        })
        .eq('id', contaParaPagar.id);
      if (error) throw error;
      await fetchDespesas();
      setContaParaPagar(null);
    } catch (error) {
      console.error('Erro ao marcar como pago:', error);
      alert('Erro ao atualizar. Verifique o console.');
    } finally {
      setMarcandoPagoId(null);
    }
  };

  const abrirCancelar = (despesa: Despesa) => {
    setDespesaParaCancelar(despesa);
    setMotivoCancelamento('');
  };

  const confirmarCancelar = async () => {
    if (!despesaParaCancelar) return;
    setCancelandoId(despesaParaCancelar.id);
    try {
      const { error } = await supabase
        .from('accounts_payable')
        .update({ status: 'cancelado', motivo_cancelamento: motivoCancelamento || null })
        .eq('id', despesaParaCancelar.id);
      if (error) throw error;
      await fetchDespesas();
      setDespesaParaCancelar(null);
    } catch (error) {
      console.error('Erro ao cancelar despesa:', error);
      alert('Erro ao cancelar. Verifique o console.');
    } finally {
      setCancelandoId(null);
    }
  };

  return (
    <div className="space-y-6 relative">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-stone-800">Contas a Pagar</h1>
          <p className="text-stone-500 text-sm mt-1">
            {podeLancarParaOutras ? 'Gerencie as despesas e obrigações de todas as franquias.' : 'Gerencie as despesas e obrigações da sua franquia.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            className="px-3 py-2 border border-stone-300 rounded-lg text-sm bg-white text-stone-700 focus:ring-2 focus:ring-amber-400 outline-none"
            value={filtroStatus}
            onChange={(e) => setFiltroStatus(e.target.value as typeof filtroStatus)}
          >
            <option value="ativas">Ativas</option>
            <option value="canceladas">Canceladas</option>
            <option value="todas">Todas</option>
          </select>
          <button
            onClick={abrirNovaDespesa}
            className="bg-stone-900 hover:bg-stone-800 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            <span>+</span> Nova Despesa
          </button>
        </div>
      </div>

      <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden min-h-[300px]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-stone-600">
            <thead className="bg-stone-50 border-b border-stone-200 text-stone-500 uppercase text-xs font-medium">
              <tr>
                <th className="px-6 py-4">Descrição</th>
                {podeLancarParaOutras && <th className="px-6 py-4">Franquia</th>}
                <th className="px-6 py-4">Categoria</th>
                <th className="px-6 py-4">Vencimento</th>
                <th className="px-6 py-4">Valor</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {isLoading ? (
                <tr>
                  <td colSpan={podeLancarParaOutras ? 7 : 6} className="px-6 py-8 text-center text-stone-400">
                    Carregando dados do Supabase...
                  </td>
                </tr>
              ) : despesasVisiveis.length === 0 ? (
                <tr>
                  <td colSpan={podeLancarParaOutras ? 7 : 6} className="px-6 py-8 text-center text-stone-400">
                    Nenhuma conta a pagar encontrada.
                  </td>
                </tr>
              ) : (
                despesasVisiveis.map((despesa) => (
                  <tr key={despesa.id} className="hover:bg-stone-50/50 transition-colors">
                    <td className="px-6 py-4 font-medium text-stone-800">{despesa.description}</td>
                    {podeLancarParaOutras && <td className="px-6 py-4">{despesa.franchises?.name || '—'}</td>}
                    <td className="px-6 py-4">{despesa.plano_contas?.nome || '—'}</td>
                    <td className="px-6 py-4">{new Date(despesa.due_date + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                    <td className="px-6 py-4 font-medium text-red-600">{formatCurrency(despesa.amount)}</td>
                    <td className="px-6 py-4">
                      {getStatusBadge(despesa.status)}
                      {despesa.status === 'cancelado' && despesa.motivo_cancelamento && (
                        <p className="text-xs text-stone-400 mt-1">{despesa.motivo_cancelamento}</p>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {despesa.status === 'pendente' && (
                        <>
                          <button
                            onClick={() => abrirMarcarComoPago(despesa)}
                            disabled={marcandoPagoId === despesa.id}
                            className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
                          >
                            {marcandoPagoId === despesa.id ? 'Salvando...' : 'Marcar como pago'}
                          </button>
                          <button
                            onClick={() => abrirCancelar(despesa)}
                            className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors text-stone-400 hover:bg-red-50 hover:text-red-600"
                          >
                            Cancelar
                          </button>
                        </>
                      )}
                      {despesa.status === 'pago' && (
                        <>
                          <button
                            onClick={() => abrirEdicao(despesa)}
                            className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors text-stone-500 hover:bg-stone-100"
                          >
                            Editar
                          </button>
                          {despesa.comprovante_url && (
                            <button
                              onClick={() => verComprovante(despesa.comprovante_url!)}
                              className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors text-amber-600 hover:bg-amber-50"
                            >
                              Ver comprovante
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de Nova Despesa / Editar Despesa */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center p-6 border-b border-stone-100">
              <h2 className="text-lg font-semibold text-stone-800">
                {despesaEditando ? 'Editar Despesa' : 'Lançar Nova Despesa'}
              </h2>
              <button onClick={fecharModal} className="text-stone-400 hover:text-stone-600">✕</button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {podeLancarParaOutras && (
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Franquia</label>
                  <select
                    required
                    className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none bg-white text-stone-700"
                    value={formData.franchiseId}
                    onChange={e => setFormData({ ...formData, franchiseId: e.target.value, fornecedorId: '' })}
                  >
                    <option value="">Selecione...</option>
                    {franquias.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Categoria</label>
                <Combobox
                  required
                  placeholder="Digite para buscar..."
                  value={formData.planoContaId}
                  onChange={(v) => setFormData({ ...formData, planoContaId: v })}
                  options={categoriaOptions}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Fornecedor</label>
                <Combobox
                  placeholder="Digite para buscar ou cadastrar..."
                  value={formData.fornecedorId}
                  onChange={(v) => setFormData({ ...formData, fornecedorId: v })}
                  options={fornecedorOptions}
                  onCreateNew={criarFornecedor}
                  createNewLabel={(q) => `+ Cadastrar novo fornecedor "${q}"`}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Valor (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                    value={formData.amount}
                    onChange={e => setFormData({...formData, amount: e.target.value})}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Vencimento</label>
                  <input
                    type="date"
                    required
                    className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none text-stone-700"
                    value={formData.due_date}
                    onChange={e => setFormData({...formData, due_date: e.target.value})}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Observação (opcional)</label>
                <input
                  type="text"
                  className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                  value={formData.description}
                  onChange={e => setFormData({...formData, description: e.target.value})}
                  placeholder="Ex: Conta de Internet"
                />
              </div>

              {!despesaEditando && (
                <div>
                  <label className="flex items-center gap-2 text-sm text-stone-700">
                    <input
                      type="checkbox"
                      checked={jaPaga}
                      onChange={(e) => setJaPaga(e.target.checked)}
                      className="rounded border-stone-300 text-amber-500 focus:ring-amber-400"
                    />
                    Esta despesa já foi paga
                  </label>
                  {!jaPaga && formData.due_date && formData.due_date < hojeBrasilia() && (
                    <p className="text-xs text-amber-600 mt-1">
                      Esse vencimento já passou — se já foi paga, marque a opção acima.
                    </p>
                  )}
                </div>
              )}

              {jaPaga && (
                <PaymentSettlementFields
                  dueDate={formData.due_date}
                  value={pagamentoForm}
                  onChange={setPagamentoForm}
                  comprovanteUrlExistente={despesaEditando?.comprovante_url}
                  onVerComprovanteExistente={() => despesaEditando?.comprovante_url && verComprovante(despesaEditando.comprovante_url)}
                />
              )}

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={fecharModal}
                  className="flex-1 px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg font-medium transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-medium transition-colors disabled:opacity-70 flex justify-center items-center"
                >
                  {isSubmitting ? 'Salvando...' : 'Salvar Despesa'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Marcar como Pago */}
      {contaParaPagar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center p-6 border-b border-stone-100">
              <h2 className="text-lg font-semibold text-stone-800">Marcar como pago</h2>
              <button onClick={() => setContaParaPagar(null)} className="text-stone-400 hover:text-stone-600">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-stone-600">{contaParaPagar.description} — {formatCurrency(contaParaPagar.amount)}</p>
              <PaymentSettlementFields
                dueDate={contaParaPagar.due_date}
                value={pagamentoModal}
                onChange={setPagamentoModal}
              />
              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setContaParaPagar(null)}
                  className="flex-1 px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg font-medium transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmarMarcarComoPago}
                  disabled={marcandoPagoId === contaParaPagar.id}
                  className="flex-1 px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-medium transition-colors disabled:opacity-70 flex justify-center items-center"
                >
                  {marcandoPagoId === contaParaPagar.id ? 'Salvando...' : 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Cancelar despesa */}
      {despesaParaCancelar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="flex justify-between items-center p-6 border-b border-stone-100">
              <h2 className="text-lg font-semibold text-stone-800">Cancelar despesa</h2>
              <button onClick={() => setDespesaParaCancelar(null)} className="text-stone-400 hover:text-stone-600">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-stone-600">
                Tem certeza que deseja cancelar &quot;{despesaParaCancelar.description}&quot;?
              </p>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Motivo (opcional)</label>
                <input
                  type="text"
                  className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                  value={motivoCancelamento}
                  onChange={(e) => setMotivoCancelamento(e.target.value)}
                  placeholder="Ex: lançamento duplicado"
                />
              </div>
              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setDespesaParaCancelar(null)}
                  className="flex-1 px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg font-medium transition-colors"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  onClick={confirmarCancelar}
                  disabled={cancelandoId === despesaParaCancelar.id}
                  className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-70 flex justify-center items-center"
                >
                  {cancelandoId === despesaParaCancelar.id ? 'Cancelando...' : 'Confirmar cancelamento'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
