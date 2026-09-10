'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../../../lib/supabase';
import { hojeBrasilia, dataParaTimestampBrasilia, adicionarDias } from '../../../../lib/date';
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
  documento_origem: string | null;
  parcela_numero: number | null;
  parcela_total: number | null;
  folha_pagamento_competencia_id: string | null;
  folha_pagamento_item_id: string | null;
  plano_contas: { nome: string } | null;
  franchises: { name: string } | null;
  fornecedores: { nome: string } | null;
}

interface ItemFuncionario {
  id: string;
  nome: string;
  cargo: string | null;
  valor_liquido: number;
}

interface DetalheFolha {
  cargo: string | null;
  total_vencimentos: number;
  total_descontos: number;
  observacao: string | null;
}

interface Parcela {
  vencimento: string;
  valor: string;
}

type Frequencia = 'mensal' | 'trimestral' | 'semestral' | 'anual';

interface Recorrente {
  id: string;
  valor_referencia: number;
  dia_vencimento: number;
  frequencia: Frequencia;
  mes_referencia: number | null;
  is_active: boolean;
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
  documento_origem: 'Documento de origem',
  due_date: 'Vencimento',
  amount: 'Valor',
  paid_at: 'Data de pagamento',
  valor_juros: 'Juros',
  valor_multa: 'Multa',
  comprovante_url: 'Comprovante',
};

// Divide o valor total em N parcelas usando matemática em centavos (evita erro de ponto
// flutuante) — o resíduo do arredondamento sempre vai pra última parcela, garantindo que
// a soma das N parcelas bate exatamente com o total informado. Vencimentos seguintes
// somam 30 dias como sugestão inicial — só no momento da geração, não recalcula depois.
function gerarParcelas(n: number, valorTotalStr: string, vencimentoSeed: string): Parcela[] {
  const centavosTotal = Math.round((parseFloat(valorTotalStr) || 0) * 100);
  const base = Math.floor(centavosTotal / n);
  const resto = centavosTotal - base * n;
  const linhas: Parcela[] = [];
  let vencimento = vencimentoSeed;
  for (let i = 0; i < n; i++) {
    if (i > 0) vencimento = adicionarDias(linhas[i - 1].vencimento, 30);
    const centavos = base + (i === n - 1 ? resto : 0);
    linhas.push({ vencimento, valor: (centavos / 100).toFixed(2) });
  }
  return linhas;
}

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
  const [expandedDespesas, setExpandedDespesas] = useState<Set<string>>(new Set());
  const [itensPorChave, setItensPorChave] = useState<Map<string, ItemFuncionario[]>>(new Map());
  const [carregandoItens, setCarregandoItens] = useState<Set<string>>(new Set());
  const [expandedGruposFolha, setExpandedGruposFolha] = useState<Set<string>>(new Set());
  const [detalhesFolhaPorItem, setDetalhesFolhaPorItem] = useState<Map<string, DetalheFolha>>(new Map());
  const [carregandoDetalhesFolha, setCarregandoDetalhesFolha] = useState<Set<string>>(new Set());
  const [itemExpandidoNoGrupo, setItemExpandidoNoGrupo] = useState<string | null>(null);
  const [confirmandoItemId, setConfirmandoItemId] = useState<string | null>(null);

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
  const [documentoOrigem, setDocumentoOrigem] = useState('');
  const [parcelarEm, setParcelarEm] = useState(1);
  const [repetirDespesa, setRepetirDespesa] = useState(false);
  const [frequenciaRecorrencia, setFrequenciaRecorrencia] = useState<Frequencia>('mensal');
  const [recorrenteParaGerenciar, setRecorrenteParaGerenciar] = useState<Recorrente | null>(null);
  const [gerenciandoRecorrente, setGerenciandoRecorrente] = useState(false);
  const [parcelas, setParcelas] = useState<Parcela[]>([]);

  const fetchDespesas = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('accounts_payable')
        .select('*, plano_contas(nome), franchises(name), fornecedores(nome)')
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
      .select('franchise_id, roles(escopo, pode_lancar_despesas_outras_franquias)')
      .eq('id', user.id)
      .maybeSingle();
    if (error) { console.error('Erro ao buscar perfil:', error); return; }
    setMinhaFranchiseId(data?.franchise_id || '');
    const papel = data?.roles as unknown as { escopo: string; pode_lancar_despesas_outras_franquias: boolean } | null;
    // Duas condições juntas: escopo amplo governa leitura, essa flag específica governa
    // escrever despesa em nome de outra franquia — não é a mesma coisa (ver auditoria).
    const pode = papel?.escopo === 'todas_franquias' && !!papel?.pode_lancar_despesas_outras_franquias;
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
      pendente: <span className="px-2.5 py-1 bg-stone-200 text-stone-700 text-xs font-medium rounded-md">Pendente</span>,
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

  // Despesas de folha geradas por funcionário (folha_pagamento_item_id preenchido) se
  // agrupam por competência+franquia — aparecem como uma linha-resumo colapsada, não uma
  // por funcionário. Despesas antigas (agregadas, sem esse campo), guias e despesas
  // normais não entram aqui, continuam soltas na listagem de sempre.
  const gruposFolha = useMemo(() => {
    const mapa = new Map<string, Despesa[]>();
    for (const d of despesasVisiveis) {
      if (!d.folha_pagamento_item_id || !d.folha_pagamento_competencia_id) continue;
      const chave = `${d.folha_pagamento_competencia_id}|${d.franchise_id}`;
      if (!mapa.has(chave)) mapa.set(chave, []);
      mapa.get(chave)!.push(d);
    }
    return mapa;
  }, [despesasVisiveis]);

  const toggleGrupoFolha = async (chave: string, itensDoGrupo: Despesa[]) => {
    const jaExpandido = expandedGruposFolha.has(chave);
    setExpandedGruposFolha((atual) => {
      const novo = new Set(atual);
      if (jaExpandido) novo.delete(chave); else novo.add(chave);
      return novo;
    });
    if (jaExpandido) return;

    const itemIds = itensDoGrupo.map((d) => d.folha_pagamento_item_id!).filter((id) => !detalhesFolhaPorItem.has(id));
    if (itemIds.length === 0) return;

    setCarregandoDetalhesFolha((atual) => new Set([...Array.from(atual), ...itemIds]));
    try {
      const { data, error } = await supabase
        .from('folha_pagamento_itens')
        .select('id, cargo, total_vencimentos, total_descontos, observacao')
        .in('id', itemIds);
      if (error) throw error;
      setDetalhesFolhaPorItem((atual) => {
        const novo = new Map(atual);
        for (const item of data || []) novo.set(item.id, item);
        return novo;
      });
    } catch (error) {
      console.error('Erro ao buscar detalhes da folha:', error);
    } finally {
      setCarregandoDetalhesFolha((atual) => {
        const novo = new Set(atual);
        for (const id of itemIds) novo.delete(id);
        return novo;
      });
    }
  };

  const nomeFuncionarioDaDescricao = (descricao: string) => descricao.split(' - Folha de Pagamento')[0];

  const formatarCompetencia = (descricaoGrupo: string) => {
    // descricaoGrupo já vem como "Folha de Pagamento 2026-08" (ver descricaoGrupo abaixo)
    const match = descricaoGrupo.match(/(\d{4})-(\d{2})/);
    if (!match) return descricaoGrupo;
    const nomesMeses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    return `Folha de Pagamento · ${nomesMeses[parseInt(match[2], 10) - 1]}/${match[1].slice(2)}`;
  };

  const confirmarPagamentoFuncionario = async (despesa: Despesa) => {
    const itemId = despesa.folha_pagamento_item_id;
    if (!itemId) return;
    setConfirmandoItemId(itemId);
    try {
      const agora = new Date().toISOString();
      const { data: { user } } = await supabase.auth.getUser();

      const [despesaRes, itemRes] = await Promise.all([
        supabase.from('accounts_payable').update({ status: 'pago', paid_at: agora }).eq('id', despesa.id),
        supabase.from('folha_pagamento_itens').update({ pago_em: agora, pago_por: user?.id || null }).eq('id', itemId),
      ]);
      if (despesaRes.error) throw despesaRes.error;
      if (itemRes.error) throw itemRes.error;

      await fetchDespesas();
    } catch (error) {
      console.error('Erro ao confirmar pagamento:', error);
      alert('Erro ao confirmar pagamento. Verifique o console.');
    } finally {
      setConfirmandoItemId(null);
    }
  };

  const desfazerPagamentoFuncionario = async (despesa: Despesa) => {
    const itemId = despesa.folha_pagamento_item_id;
    if (!itemId) return;
    setConfirmandoItemId(itemId);
    try {
      const [despesaRes, itemRes] = await Promise.all([
        supabase.from('accounts_payable').update({ status: 'pendente', paid_at: null }).eq('id', despesa.id),
        supabase.from('folha_pagamento_itens').update({ pago_em: null, pago_por: null }).eq('id', itemId),
      ]);
      if (despesaRes.error) throw despesaRes.error;
      if (itemRes.error) throw itemRes.error;

      await fetchDespesas();
    } catch (error) {
      console.error('Erro ao desfazer confirmação:', error);
      alert('Erro ao desfazer. Verifique o console.');
    } finally {
      setConfirmandoItemId(null);
    }
  };

  const salvarObservacaoFuncionario = async (itemId: string, observacao: string) => {
    setDetalhesFolhaPorItem((atual) => {
      const novo = new Map(atual);
      const atual2 = novo.get(itemId);
      if (atual2) novo.set(itemId, { ...atual2, observacao });
      return novo;
    });
    const { error } = await supabase.from('folha_pagamento_itens').update({ observacao }).eq('id', itemId);
    if (error) console.error('Erro ao salvar observação:', error.message);
  };

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
    setDocumentoOrigem('');
    setParcelarEm(1);
    setParcelas([]);
    setRepetirDespesa(false);
    setFrequenciaRecorrencia('mensal');
  };

  const handleParcelarEmChange = (valor: string) => {
    const n = Math.max(1, parseInt(valor, 10) || 1);
    setParcelarEm(n);
    if (n > 1) {
      const seed = parcelas[0]?.vencimento || formData.due_date || hojeBrasilia();
      setParcelas(gerarParcelas(n, formData.amount, seed));
    } else {
      if (parcelas[0]?.vencimento) {
        setFormData((atual) => ({ ...atual, due_date: parcelas[0].vencimento }));
      }
      setParcelas([]);
    }
  };

  const atualizarParcela = (indice: number, campo: keyof Parcela, valor: string) => {
    setParcelas((atual) => atual.map((p, i) => (i === indice ? { ...p, [campo]: valor } : p)));
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
    setDocumentoOrigem(despesa.documento_origem || '');
    setParcelarEm(1);
    setParcelas([]);
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

      // Lançamento parcelado: N linhas numa chamada só, sem status pago/comprovante (isso
      // acontece depois, parcela por parcela, pela listagem normal).
      if (!despesaEditando && parcelarEm > 1) {
        const somaParcelas = parcelas.reduce((acc, p) => acc + (parseFloat(p.valor) || 0), 0);
        const total = parseFloat(formData.amount) || 0;
        const diferenca = Math.round((total - somaParcelas) * 100) / 100;
        if (Math.abs(diferenca) >= 0.01) {
          const seguir = confirm(
            `A soma das parcelas (${formatCurrency(somaParcelas)}) não bate com o valor total da nota (${formatCurrency(total)}) — diferença de ${formatCurrency(Math.abs(diferenca))}. Salvar mesmo assim?`
          );
          if (!seguir) { setIsSubmitting(false); return; }
        }

        const linhas = parcelas.map((p, i) => ({
          description: formData.description,
          plano_conta_id: formData.planoContaId,
          fornecedor_id: formData.fornecedorId || null,
          documento_origem: documentoOrigem || null,
          due_date: p.vencimento,
          amount: parseFloat(p.valor) || 0,
          parcela_numero: i + 1,
          parcela_total: parcelas.length,
          status: 'pendente',
          ...(podeLancarParaOutras ? { franchise_id: formData.franchiseId } : {}),
        }));

        const { error } = await supabase.from('accounts_payable').insert(linhas);
        if (error) throw error;

        await fetchDespesas();
        fecharModal();
        return;
      }

      // Alerta de duplicidade só faz sentido pra lançamento avulso, com fornecedor
      // selecionado (sem fornecedor, "mesmo fornecedor_id" não diz nada).
      if (!despesaEditando && formData.fornecedorId) {
        const { data: possiveisDuplicatas } = await supabase
          .from('accounts_payable')
          .select('id, due_date')
          .eq('fornecedor_id', formData.fornecedorId)
          .eq('amount', parseFloat(formData.amount))
          .neq('status', 'cancelado')
          .gte('due_date', adicionarDias(formData.due_date, -3))
          .lte('due_date', adicionarDias(formData.due_date, 3));

        if (possiveisDuplicatas && possiveisDuplicatas.length > 0) {
          const dataExistente = new Date(possiveisDuplicatas[0].due_date + 'T00:00:00').toLocaleDateString('pt-BR');
          if (!confirm(`Já existe uma despesa parecida, lançada em ${dataExistente}. Continuar mesmo assim?`)) {
            setIsSubmitting(false);
            return;
          }
        }
      }

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
        documento_origem: documentoOrigem || null,
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

      // "Repetir esta despesa": cria o molde em despesas_recorrentes ANTES da própria
      // despesa, pra já linkar via despesa_recorrente_id no insert seguinte (evita um
      // update extra depois). dia_vencimento/mes_referencia vêm da própria data de
      // vencimento informada — mensal ignora mes_referencia (grava null), igual à
      // convenção já usada pelo cron (gerar-despesas-recorrentes/route.ts).
      if (!despesaEditando && parcelarEm === 1 && repetirDespesa) {
        const dataVenc = new Date(formData.due_date + 'T00:00:00');
        const nomeCategoria = planoContas.find((c) => c.id === formData.planoContaId)?.nome;
        const { data: novaRecorrente, error: recorrenteError } = await supabase
          .from('despesas_recorrentes')
          .insert({
            franchise_id: podeLancarParaOutras ? formData.franchiseId : minhaFranchiseId,
            descricao: formData.description || nomeCategoria || 'Despesa recorrente',
            plano_conta_id: formData.planoContaId,
            fornecedor_id: formData.fornecedorId || null,
            valor_referencia: parseFloat(formData.amount),
            dia_vencimento: dataVenc.getDate(),
            frequencia: frequenciaRecorrencia,
            mes_referencia: frequenciaRecorrencia !== 'mensal' ? dataVenc.getMonth() + 1 : null,
          })
          .select('id')
          .single();
        if (recorrenteError) throw recorrenteError;
        dados.despesa_recorrente_id = novaRecorrente.id;
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

  // Uma competência de folha pode ter funcionários de mais de uma franquia (arquivo
  // multi-CNPJ) — a chave do cache combina competência+franquia, não só a competência,
  // pra nunca misturar a lista de funcionários de uma franquia com a de outra.
  const toggleDetalheFuncionarios = async (despesa: Despesa) => {
    const competenciaId = despesa.folha_pagamento_competencia_id;
    if (!competenciaId) return;
    const chave = `${competenciaId}|${despesa.franchise_id}`;

    setExpandedDespesas((atual) => {
      const novo = new Set(atual);
      if (novo.has(despesa.id)) novo.delete(despesa.id); else novo.add(despesa.id);
      return novo;
    });

    if (itensPorChave.has(chave)) return;
    setCarregandoItens((atual) => new Set(atual).add(chave));
    try {
      const { data, error } = await supabase
        .from('folha_pagamento_itens')
        .select('id, nome, cargo, valor_liquido')
        .eq('competencia_id', competenciaId)
        .eq('franchise_id', despesa.franchise_id)
        .order('nome');
      if (error) throw error;
      setItensPorChave((atual) => new Map(atual).set(chave, data || []));
    } catch (error) {
      console.error('Erro ao buscar funcionários da folha:', error);
    } finally {
      setCarregandoItens((atual) => {
        const novo = new Set(atual);
        novo.delete(chave);
        return novo;
      });
    }
  };

  // Conteúdo da coluna primária (agora Fornecedor, não mais Descrição) — reaproveitado
  // em toda linha, normal ou resumo de grupo de folha. Fallback: fornecedor > descrição >
  // placeholder, nessa ordem, nunca undefined/vazio.
  const celulaFornecedor = (despesa: Despesa) => {
    const nome = despesa.fornecedores?.nome;
    const principal = nome || despesa.description || 'Sem fornecedor';
    const ehPlaceholder = !nome && !despesa.description;
    const mostrarDescricaoSecundaria = !!nome && !!despesa.description;
    return { principal, ehPlaceholder, mostrarDescricaoSecundaria };
  };

  // Reaproveitado tanto na linha normal quanto na linha de cada funcionário dentro de um
  // grupo de folha expandido — mesma ação, independente de onde a despesa é exibida.
  const renderAcoesDespesa = (despesa: Despesa) => (
    <>
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
              className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors text-stone-600 hover:bg-stone-100"
            >
              Ver comprovante
            </button>
          )}
        </>
      )}
      {despesa.status === 'cancelado' && despesa.motivo_cancelamento && (
        <p className="text-xs text-stone-400">{despesa.motivo_cancelamento}</p>
      )}
      {despesa.despesa_recorrente_id && (
        <button
          onClick={() => abrirGerenciarRecorrente(despesa.despesa_recorrente_id!)}
          className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors text-stone-500 hover:bg-stone-100"
        >
          🔁 Gerenciar recorrência
        </button>
      )}
    </>
  );

  const abrirGerenciarRecorrente = async (recorrenteId: string) => {
    try {
      const { data, error } = await supabase
        .from('despesas_recorrentes')
        .select('id, valor_referencia, dia_vencimento, frequencia, mes_referencia, is_active')
        .eq('id', recorrenteId)
        .single();
      if (error) throw error;
      setRecorrenteParaGerenciar(data as Recorrente);
    } catch (error) {
      console.error('Erro ao buscar recorrência:', error);
      alert('Erro ao carregar a recorrência. Verifique o console.');
    }
  };

  const salvarRecorrente = async () => {
    if (!recorrenteParaGerenciar) return;
    setGerenciandoRecorrente(true);
    try {
      const mesReferencia =
        recorrenteParaGerenciar.frequencia === 'mensal'
          ? null
          : recorrenteParaGerenciar.mes_referencia || new Date().getMonth() + 1;
      const { error } = await supabase
        .from('despesas_recorrentes')
        .update({
          valor_referencia: recorrenteParaGerenciar.valor_referencia,
          dia_vencimento: recorrenteParaGerenciar.dia_vencimento,
          frequencia: recorrenteParaGerenciar.frequencia,
          mes_referencia: mesReferencia,
          is_active: recorrenteParaGerenciar.is_active,
        })
        .eq('id', recorrenteParaGerenciar.id);
      if (error) throw error;
      setRecorrenteParaGerenciar(null);
    } catch (error) {
      console.error('Erro ao salvar recorrência:', error);
      alert('Erro ao salvar. Verifique o console.');
    } finally {
      setGerenciandoRecorrente(false);
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
            className="px-3 py-2 border border-stone-300 rounded-lg text-sm bg-white text-stone-700 focus:ring-2 focus:ring-stone-400 outline-none"
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
                <th className="sticky left-0 z-10 bg-stone-50 px-6 py-4">Fornecedor</th>
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
                (() => {
                  const gruposJaRenderizados = new Set<string>();
                  return despesasVisiveis.map((despesa) => {
                    // Linha nova (por funcionário) que já faz parte de um grupo: renderiza
                    // só a linha-resumo do grupo na primeira ocorrência, e nada nas demais
                    // (elas aparecem dentro do grupo, só quando expandido).
                    if (despesa.folha_pagamento_item_id && despesa.folha_pagamento_competencia_id) {
                      const chaveGrupo = `${despesa.folha_pagamento_competencia_id}|${despesa.franchise_id}`;
                      if (gruposJaRenderizados.has(chaveGrupo)) return null;
                      gruposJaRenderizados.add(chaveGrupo);

                      const itensDoGrupo = gruposFolha.get(chaveGrupo) || [];
                      const valorTotal = itensDoGrupo.reduce((acc, d) => acc + Number(d.amount), 0);
                      const pagos = itensDoGrupo.filter((d) => d.status === 'pago').length;
                      const cancelados = itensDoGrupo.filter((d) => d.status === 'cancelado').length;
                      const expandido = expandedGruposFolha.has(chaveGrupo);
                      const primeiro = itensDoGrupo[0];
                      const descricaoGrupo = primeiro.description.slice(primeiro.description.indexOf('Folha de Pagamento'));

                      return (
                        <React.Fragment key={chaveGrupo}>
                          <tr className="hover:bg-stone-50/50 transition-colors">
                            <td className="sticky left-0 z-10 bg-white px-6 py-4 font-medium text-stone-800">
                              {formatarCompetencia(descricaoGrupo)}
                              <button
                                type="button"
                                onClick={() => toggleGrupoFolha(chaveGrupo, itensDoGrupo)}
                                className="flex items-center gap-1 text-xs font-medium text-stone-600 hover:text-stone-800 mt-1"
                              >
                                <span className={`inline-block transition-transform ${expandido ? 'rotate-90' : ''}`}>›</span>
                                Ver funcionários ({itensDoGrupo.length})
                              </button>
                            </td>
                            {podeLancarParaOutras && <td className="px-6 py-4">{primeiro.franchises?.name || '—'}</td>}
                            <td className="px-6 py-4">{primeiro.plano_contas?.nome || '—'}</td>
                            <td className="px-6 py-4">{new Date(primeiro.due_date + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                            <td className="px-6 py-4 font-medium text-red-600">{formatCurrency(valorTotal)}</td>
                            <td className="px-6 py-4">
                              {pagos === itensDoGrupo.length ? (
                                getStatusBadge('pago')
                              ) : cancelados === itensDoGrupo.length ? (
                                getStatusBadge('cancelado')
                              ) : pagos === 0 ? (
                                getStatusBadge('pendente')
                              ) : (
                                <span className="px-2.5 py-1 bg-blue-50 text-blue-700 text-xs font-medium rounded-md">
                                  {pagos} de {itensDoGrupo.length} pagos
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4" />
                          </tr>
                          {expandido && (
                            <tr>
                              <td colSpan={podeLancarParaOutras ? 7 : 6} className="p-0 border-t border-stone-100">
                                <div className="bg-stone-50/50 max-h-96 overflow-y-auto">
                                  <div className="sticky top-0 z-10 bg-stone-100 px-6 py-2 flex items-center justify-between border-b border-stone-200">
                                    <span className="text-sm font-medium text-stone-700">{formatarCompetencia(descricaoGrupo)}</span>
                                    <div className="flex items-center gap-4 text-sm">
                                      <span className="font-medium tabular-nums text-stone-700">{formatCurrency(valorTotal)}</span>
                                      <span className="text-stone-500">{pagos} de {itensDoGrupo.length} confirmados</span>
                                    </div>
                                  </div>
                                  <div className="divide-y divide-stone-100">
                                    {itensDoGrupo.map((d) => {
                                      const itemId = d.folha_pagamento_item_id!;
                                      const detalhe = detalhesFolhaPorItem.get(itemId);
                                      const linhaExpandida = itemExpandidoNoGrupo === d.id;
                                      return (
                                        <div key={d.id} className="px-6">
                                          <div
                                            className="flex items-center justify-between gap-3 py-2.5 cursor-pointer"
                                            onClick={() => setItemExpandidoNoGrupo(linhaExpandida ? null : d.id)}
                                          >
                                            <div className="min-w-0">
                                              <p className="text-sm font-medium text-stone-800 truncate">{nomeFuncionarioDaDescricao(d.description)}</p>
                                              {detalhe?.cargo && <p className="text-xs text-stone-400 truncate">{detalhe.cargo}</p>}
                                            </div>
                                            <div className="flex items-center gap-3 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                                              <span className="text-sm font-medium tabular-nums text-stone-600">{formatCurrency(d.amount)}</span>
                                              {d.status === 'pago' ? (
                                                <div className="flex items-center gap-2 text-xs">
                                                  <span className="text-emerald-600 font-medium">
                                                    ✓ Confirmado {d.paid_at ? `em ${new Date(d.paid_at).toLocaleDateString('pt-BR')} às ${new Date(d.paid_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}
                                                  </span>
                                                  <button
                                                    onClick={() => desfazerPagamentoFuncionario(d)}
                                                    disabled={confirmandoItemId === itemId}
                                                    className="text-stone-400 hover:text-red-600 underline disabled:opacity-50"
                                                  >
                                                    Desfazer
                                                  </button>
                                                </div>
                                              ) : d.status === 'cancelado' ? (
                                                getStatusBadge('cancelado')
                                              ) : (
                                                <button
                                                  onClick={() => confirmarPagamentoFuncionario(d)}
                                                  disabled={confirmandoItemId === itemId}
                                                  className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
                                                >
                                                  {confirmandoItemId === itemId ? 'Salvando...' : 'Confirmar pagamento'}
                                                </button>
                                              )}
                                            </div>
                                          </div>
                                          {linhaExpandida && (
                                            <div className="pb-3 pl-0 pr-0 -mt-1" onClick={(e) => e.stopPropagation()}>
                                              {carregandoDetalhesFolha.has(itemId) || !detalhe ? (
                                                <p className="text-xs text-stone-400">Carregando detalhes...</p>
                                              ) : (
                                                <div className="grid grid-cols-2 gap-3 text-sm bg-white rounded-lg border border-stone-200 p-3">
                                                  <div>
                                                    <p className="text-xs text-stone-400">Salário bruto</p>
                                                    <p className="tabular-nums text-stone-700">{formatCurrency(detalhe.total_vencimentos)}</p>
                                                  </div>
                                                  <div>
                                                    <p className="text-xs text-stone-400">Descontos</p>
                                                    <p className="tabular-nums text-stone-700">{formatCurrency(detalhe.total_descontos)}</p>
                                                  </div>
                                                  <div>
                                                    <p className="text-xs text-stone-400">Vencimento</p>
                                                    <p className="text-stone-700">{new Date(d.due_date + 'T00:00:00').toLocaleDateString('pt-BR')}</p>
                                                  </div>
                                                  <div className="col-span-2">
                                                    <label className="text-xs text-stone-400 block mb-1">Observação</label>
                                                    <input
                                                      type="text"
                                                      defaultValue={detalhe.observacao || ''}
                                                      onBlur={(e) => salvarObservacaoFuncionario(itemId, e.target.value)}
                                                      className="w-full px-2 py-1 border border-stone-200 rounded text-sm"
                                                      placeholder="Ex: Pix enviado com 1 dia de atraso"
                                                    />
                                                  </div>
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    }

                    // Despesa fora de qualquer grupo (normal, guia, ou agregada legada de
                    // folha) — renderiza exatamente como sempre.
                    const mostraDetalheFuncionarios =
                      !!despesa.folha_pagamento_competencia_id &&
                      !despesa.folha_pagamento_item_id &&
                      despesa.plano_contas?.nome === 'Salários e Ordenados';
                    const chaveDetalhe = `${despesa.folha_pagamento_competencia_id}|${despesa.franchise_id}`;
                    const expandida = expandedDespesas.has(despesa.id);
                    return (
                    <React.Fragment key={despesa.id}>
                    <tr className="hover:bg-stone-50/50 transition-colors">
                      <td className="sticky left-0 z-10 bg-white px-6 py-4">
                        {(() => {
                          const { principal, ehPlaceholder, mostrarDescricaoSecundaria } = celulaFornecedor(despesa);
                          return (
                            <>
                              <p className={`font-medium ${ehPlaceholder ? 'text-stone-400' : 'text-stone-800'}`}>
                                {despesa.despesa_recorrente_id && <span title="Despesa recorrente">🔁 </span>}
                                {principal}
                              </p>
                              {mostrarDescricaoSecundaria && <p className="text-xs text-stone-400 mt-0.5">{despesa.description}</p>}
                            </>
                          );
                        })()}
                        {!!despesa.parcela_total && despesa.parcela_total > 1 && (
                          <p className="text-xs font-normal text-stone-400 mt-0.5">
                            Parcela {despesa.parcela_numero}/{despesa.parcela_total}
                            {despesa.documento_origem && ` • ${despesa.documento_origem}`}
                          </p>
                        )}
                        {mostraDetalheFuncionarios && (
                          <button
                            type="button"
                            onClick={() => toggleDetalheFuncionarios(despesa)}
                            className="flex items-center gap-1 text-xs font-medium text-stone-600 hover:text-stone-800 mt-1"
                          >
                            <span className={`inline-block transition-transform ${expandida ? 'rotate-90' : ''}`}>›</span>
                            Ver funcionários
                          </button>
                        )}
                      </td>
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
                      <td className="px-6 py-4">{renderAcoesDespesa(despesa)}</td>
                    </tr>
                    {mostraDetalheFuncionarios && expandida && (
                      <tr>
                        <td colSpan={podeLancarParaOutras ? 7 : 6} className="px-6 py-3 bg-stone-50/50 border-t border-stone-100">
                          {carregandoItens.has(chaveDetalhe) ? (
                            <p className="text-xs text-stone-400">Carregando funcionários...</p>
                          ) : (
                            <div className="max-w-md">
                              {(itensPorChave.get(chaveDetalhe) || []).map((item) => (
                                <div key={item.id} className="flex items-center justify-between gap-3 py-2">
                                  <div className="min-w-0">
                                    <p className="text-sm text-stone-700 truncate">{item.nome}</p>
                                    {item.cargo && <p className="text-xs text-stone-400 truncate">{item.cargo}</p>}
                                  </div>
                                  <span className="text-sm font-medium tabular-nums text-stone-700 flex-shrink-0">
                                    {formatCurrency(item.valor_liquido)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                    );
                  });
                })()
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
                    className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 outline-none bg-white text-stone-700"
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

              {!despesaEditando && (
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Documento de origem (opcional)</label>
                  <input
                    type="text"
                    className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 outline-none"
                    value={documentoOrigem}
                    onChange={(e) => setDocumentoOrigem(e.target.value)}
                    placeholder="Ex: NF 12345"
                  />
                </div>
              )}

              {despesaEditando ? (
                // Editando: exatamente o Valor+Vencimento de sempre, sem parcelamento.
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1">Valor (R$)</label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 outline-none"
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
                      className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 outline-none text-stone-700"
                      value={formData.due_date}
                      onChange={e => setFormData({...formData, due_date: e.target.value})}
                    />
                  </div>
                </div>
              ) : (
                <>
                  {/* Valor e "Parcelar em" sempre juntos, nessa ordem — parcelas dependem do
                      valor total, então o valor precisa vir preenchido antes de escolher N. */}
                  <div className={repetirDespesa ? 'grid grid-cols-1 gap-4' : 'grid grid-cols-2 gap-4'}>
                    <div>
                      <label className="block text-sm font-medium text-stone-700 mb-1">
                        {parcelarEm > 1 ? 'Valor total da nota (R$)' : 'Valor (R$)'}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        required
                        className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 outline-none"
                        value={formData.amount}
                        onChange={e => setFormData({...formData, amount: e.target.value})}
                        placeholder="0.00"
                      />
                    </div>
                    {!repetirDespesa && (
                      <div>
                        <label className="block text-sm font-medium text-stone-700 mb-1">Parcelar em</label>
                        <input
                          type="number"
                          min={1}
                          className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 outline-none"
                          value={parcelarEm}
                          onChange={(e) => handleParcelarEmChange(e.target.value)}
                        />
                      </div>
                    )}
                  </div>

                  {parcelarEm === 1 ? (
                    <div>
                      <label className="block text-sm font-medium text-stone-700 mb-1">Vencimento</label>
                      <input
                        type="date"
                        required
                        className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 outline-none text-stone-700"
                        value={formData.due_date}
                        onChange={e => setFormData({...formData, due_date: e.target.value})}
                      />
                      <div className="mt-3">
                        <label className="flex items-center gap-2 text-sm text-stone-700">
                          <input
                            type="checkbox"
                            checked={repetirDespesa}
                            onChange={(e) => setRepetirDespesa(e.target.checked)}
                            className="rounded border-stone-300 text-stone-800 focus:ring-stone-400"
                          />
                          Repetir esta despesa
                        </label>
                        {repetirDespesa && (
                          <select
                            className="mt-2 w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 outline-none bg-white text-stone-700 text-sm"
                            value={frequenciaRecorrencia}
                            onChange={(e) => setFrequenciaRecorrencia(e.target.value as Frequencia)}
                          >
                            <option value="mensal">Mensal</option>
                            <option value="trimestral">Trimestral</option>
                            <option value="semestral">Semestral</option>
                            <option value="anual">Anual</option>
                          </select>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {parcelas.map((p, i) => (
                        <div key={i} className="p-3 bg-stone-50 rounded-lg border border-stone-200">
                          <p className="text-xs font-medium text-stone-500 mb-2">Parcela {i + 1} de {parcelas.length}</p>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="block text-xs text-stone-600 mb-1">Vencimento</label>
                              <input
                                type="date"
                                required
                                className="w-full px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 outline-none text-stone-700 text-sm"
                                value={p.vencimento}
                                onChange={(e) => atualizarParcela(i, 'vencimento', e.target.value)}
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-stone-600 mb-1">Valor (R$)</label>
                              <input
                                type="number"
                                step="0.01"
                                required
                                className="w-full px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 outline-none text-sm"
                                value={p.valor}
                                onChange={(e) => atualizarParcela(i, 'valor', e.target.value)}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Observação (opcional)</label>
                <input
                  type="text"
                  className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 outline-none"
                  value={formData.description}
                  onChange={e => setFormData({...formData, description: e.target.value})}
                  placeholder="Ex: Conta de Internet"
                />
              </div>

              {!despesaEditando && parcelarEm === 1 && (
                <div>
                  <label className="flex items-center gap-2 text-sm text-stone-700">
                    <input
                      type="checkbox"
                      checked={jaPaga}
                      onChange={(e) => setJaPaga(e.target.checked)}
                      className="rounded border-stone-300 text-stone-800 focus:ring-stone-400"
                    />
                    Esta despesa já foi paga
                  </label>
                  {!jaPaga && formData.due_date && formData.due_date < hojeBrasilia() && (
                    <p className="text-xs text-stone-500 mt-1">
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
                  className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 outline-none"
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

      {/* Modal de Gerenciar recorrência */}
      {recorrenteParaGerenciar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="flex justify-between items-center p-6 border-b border-stone-100">
              <h2 className="text-lg font-semibold text-stone-800">🔁 Gerenciar recorrência</h2>
              <button onClick={() => setRecorrenteParaGerenciar(null)} className="text-stone-400 hover:text-stone-600">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Valor de referência (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 outline-none"
                  value={recorrenteParaGerenciar.valor_referencia}
                  onChange={(e) => setRecorrenteParaGerenciar({ ...recorrenteParaGerenciar, valor_referencia: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Dia do vencimento</label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 outline-none"
                    value={recorrenteParaGerenciar.dia_vencimento}
                    onChange={(e) => setRecorrenteParaGerenciar({ ...recorrenteParaGerenciar, dia_vencimento: parseInt(e.target.value, 10) || 1 })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Frequência</label>
                  <select
                    className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 outline-none bg-white text-stone-700"
                    value={recorrenteParaGerenciar.frequencia}
                    onChange={(e) => setRecorrenteParaGerenciar({ ...recorrenteParaGerenciar, frequencia: e.target.value as Frequencia })}
                  >
                    <option value="mensal">Mensal</option>
                    <option value="trimestral">Trimestral</option>
                    <option value="semestral">Semestral</option>
                    <option value="anual">Anual</option>
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-stone-700">
                <input
                  type="checkbox"
                  checked={recorrenteParaGerenciar.is_active}
                  onChange={(e) => setRecorrenteParaGerenciar({ ...recorrenteParaGerenciar, is_active: e.target.checked })}
                  className="rounded border-stone-300 text-stone-800 focus:ring-stone-400"
                />
                Ativa (gera novas ocorrências automaticamente)
              </label>
              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setRecorrenteParaGerenciar(null)}
                  className="flex-1 px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg font-medium transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={salvarRecorrente}
                  disabled={gerenciandoRecorrente}
                  className="flex-1 px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-medium transition-colors disabled:opacity-70 flex justify-center items-center"
                >
                  {gerenciandoRecorrente ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
