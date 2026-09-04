'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { supabase } from '../../../../../lib/supabase';
import { formatCurrency } from '../../../../../lib/format';
import Combobox, { ComboboxOption } from '../../../../../components/Combobox';

interface Item {
  id: string;
  franchise_id: string | null;
  cnpj_extraido: string;
  codigo_folha: string;
  nome: string;
  cargo: string | null;
  cbo: string | null;
  admissao: string | null;
  salario_base: number | null;
  total_vencimentos: number;
  total_descontos: number;
  valor_liquido: number;
  inss_empregado: number | null;
  fgts_mes: number | null;
  horas_extras_qtd: number | null;
  horas_extras_valor: number | null;
  reflexo_dsr_valor: number | null;
}

interface Franquia {
  id: string;
  name: string;
}

interface CategoriaContas {
  id: string;
  nome: string;
  categoria_pai_id: string | null;
}

interface Guia {
  franchiseId: string;
  tipo: 'fgts' | 'inss_patronal' | 'sindicato' | 'outro';
  categoriaOutro: string;
  valor: string;
  file: File | null;
}

const CATEGORIA_SALARIOS = '601fd51a-6f90-4c03-84fb-b62f00632168';
const CATEGORIA_FGTS = 'cf7a667a-f21f-4c3c-82de-f925bff74773';
const CATEGORIA_INSS_PATRONAL = 'ea1388ca-8859-41da-8f55-70fcd2e5ba49';
const CATEGORIA_BENEFICIOS = '9222fd0f-a088-4f5e-9577-ef6c8f9e6afc';

const GUIA_INICIAL: Guia = { franchiseId: '', tipo: 'fgts', categoriaOutro: '', valor: '', file: null };

function calcularVencimentoPadrao(competenciaISO: string): string {
  const [ano, mes] = competenciaISO.split('-').map(Number);
  return new Date(Date.UTC(ano, mes, 5)).toISOString().slice(0, 10);
}

export default function RevisaoCompetenciaPage() {
  const params = useParams();
  const competenciaId = params.id as string;

  const [competencia, setCompetencia] = useState<{ competencia: string; status: string; motivo_cancelamento: string | null } | null>(null);
  const [itens, setItens] = useState<Item[]>([]);
  const [franquias, setFranquias] = useState<Franquia[]>([]);
  const [planoContas, setPlanoContas] = useState<CategoriaContas[]>([]);
  const [guias, setGuias] = useState<Guia[]>([]);
  const [vencimento, setVencimento] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isValidando, setIsValidando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [mostrarCancelar, setMostrarCancelar] = useState(false);
  const [motivoCancelamento, setMotivoCancelamento] = useState('');
  const [isCancelando, setIsCancelando] = useState(false);

  const fetchDados = async () => {
    try {
      setIsLoading(true);
      const [compRes, itensRes, franquiasRes, planoContasRes] = await Promise.all([
        supabase.from('folha_pagamento_competencias').select('competencia, status, motivo_cancelamento').eq('id', competenciaId).single(),
        supabase.from('folha_pagamento_itens').select('*').eq('competencia_id', competenciaId).order('nome'),
        supabase.from('franchises').select('id, name').order('name'),
        supabase.from('plano_contas').select('id, nome, categoria_pai_id').eq('is_active', true).in('tipo', ['despesa', 'custo']).order('ordem'),
      ]);
      if (compRes.error) throw compRes.error;
      if (itensRes.error) throw itensRes.error;
      setCompetencia(compRes.data);
      setItens(itensRes.data || []);
      setFranquias(franquiasRes.data || []);
      setPlanoContas(planoContasRes.data || []);
      if (compRes.data) setVencimento(calcularVencimentoPadrao(compRes.data.competencia));
    } catch (error) {
      console.error('Erro ao buscar competência:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDados();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competenciaId]);

  const categoriaOptions: ComboboxOption[] = planoContas
    .filter((c) => !c.categoria_pai_id)
    .flatMap((pai) => {
      const filhos = planoContas.filter((c) => c.categoria_pai_id === pai.id);
      return filhos.length > 0
        ? filhos.map((filho) => ({ value: filho.id, label: `${pai.nome} › ${filho.nome}` }))
        : [{ value: pai.id, label: pai.nome }];
    });

  const atualizarItem = (id: string, campo: keyof Item, valor: any) => {
    setItens((atual) => atual.map((it) => (it.id === id ? { ...it, [campo]: valor } : it)));
  };

  const grupos = useMemo(() => {
    const mapa = new Map<string, Item[]>();
    for (const item of itens) {
      const chave = item.franchise_id || '__sem_franquia__';
      if (!mapa.has(chave)) mapa.set(chave, []);
      mapa.get(chave)!.push(item);
    }
    return mapa;
  }, [itens]);

  const nomeFranquia = (id: string) => franquias.find((f) => f.id === id)?.name || '—';

  const existeItemSemFranquia = itens.some((i) => !i.franchise_id);

  const adicionarGuia = () => setGuias((atual) => [...atual, { ...GUIA_INICIAL }]);
  const atualizarGuia = (indice: number, campo: keyof Guia, valor: any) => {
    setGuias((atual) => atual.map((g, i) => (i === indice ? { ...g, [campo]: valor } : g)));
  };
  const removerGuia = (indice: number) => setGuias((atual) => atual.filter((_, i) => i !== indice));

  const categoriaDaGuia = (tipo: Guia['tipo']) => {
    if (tipo === 'fgts') return CATEGORIA_FGTS;
    if (tipo === 'inss_patronal') return CATEGORIA_INSS_PATRONAL;
    if (tipo === 'sindicato') return CATEGORIA_BENEFICIOS;
    return null; // 'outro' -> categoriaOutro escolhida manualmente
  };

  const handleValidar = async () => {
    if (!competencia || existeItemSemFranquia) return;
    setIsValidando(true);
    setErro(null);
    try {
      // Trava contra duplo clique / reprocessamento acidental da mesma competência.
      const { data: existentes, error: existentesError } = await supabase
        .from('accounts_payable')
        .select('id')
        .eq('folha_pagamento_competencia_id', competenciaId)
        .limit(1);
      if (existentesError) throw existentesError;
      if (existentes && existentes.length > 0) {
        throw new Error('Esta competência já foi lançada em Contas a Pagar.');
      }

      // Persiste os valores editados na revisão antes de gerar as despesas.
      // Em paralelo (Promise.all) — sequencial aqui já causou timeout real em folhas
      // com muitos funcionários (cada item fazia até 3 round-trips ao banco em série).
      await Promise.all(
        itens.map(async (item) => {
          const { error } = await supabase
            .from('folha_pagamento_itens')
            .update({
              franchise_id: item.franchise_id,
              nome: item.nome,
              cargo: item.cargo,
              cbo: item.cbo,
              admissao: item.admissao,
              salario_base: item.salario_base,
              total_vencimentos: item.total_vencimentos,
              total_descontos: item.total_descontos,
              valor_liquido: item.valor_liquido,
              inss_empregado: item.inss_empregado,
              fgts_mes: item.fgts_mes,
              horas_extras_qtd: item.horas_extras_qtd,
              horas_extras_valor: item.horas_extras_valor,
              reflexo_dsr_valor: item.reflexo_dsr_valor,
            })
            .eq('id', item.id);
          if (error) throw error;
        })
      );

      // Upsert de funcionários por (franchise_id, codigo_folha) — também em paralelo;
      // a cadeia select->insert/update->update é independente entre funcionários diferentes.
      await Promise.all(
        itens.map(async (item) => {
          const { data: funcionarioExistente } = await supabase
            .from('funcionarios')
            .select('id')
            .eq('franchise_id', item.franchise_id)
            .eq('codigo_folha', item.codigo_folha)
            .maybeSingle();

          const dadosFuncionario = {
            franchise_id: item.franchise_id,
            nome: item.nome,
            codigo_folha: item.codigo_folha,
            cargo: item.cargo,
            cbo: item.cbo,
            admissao: item.admissao,
            salario_base: item.salario_base,
            ativo: true,
          };

          let funcionarioId = funcionarioExistente?.id;
          if (funcionarioExistente) {
            const { error: atualizarError } = await supabase.from('funcionarios').update(dadosFuncionario).eq('id', funcionarioExistente.id);
            if (atualizarError) throw atualizarError;
          } else {
            const { data: novoFuncionario, error: criarError } = await supabase
              .from('funcionarios')
              .insert(dadosFuncionario)
              .select('id')
              .single();
            if (criarError) throw criarError;
            funcionarioId = novoFuncionario.id;
          }

          const { error: vincularError } = await supabase.from('folha_pagamento_itens').update({ funcionario_id: funcionarioId }).eq('id', item.id);
          if (vincularError) throw vincularError;
        })
      );

      // Uma linha de Contas a Pagar por franquia (soma do líquido dos itens dela).
      const linhasDespesa: Record<string, unknown>[] = [];
      for (const [franchiseId, itensDaFranquia] of Array.from(grupos.entries())) {
        if (franchiseId === '__sem_franquia__') continue;
        const total = itensDaFranquia.reduce((acc, it) => acc + Number(it.valor_liquido), 0);
        linhasDespesa.push({
          franchise_id: franchiseId,
          plano_conta_id: CATEGORIA_SALARIOS,
          description: `Folha de Pagamento - ${competencia.competencia.slice(0, 7)}`,
          due_date: vencimento,
          amount: total,
          status: 'pendente',
          folha_pagamento_competencia_id: competenciaId,
        });
      }

      // Guias avulsas — upload do arquivo (se houver) + uma linha por guia, em paralelo.
      const linhasGuias = await Promise.all(
        guias.map(async (guia) => {
          if (!guia.franchiseId || !guia.valor) return null;
          let categoriaId = categoriaDaGuia(guia.tipo);
          if (guia.tipo === 'outro') categoriaId = guia.categoriaOutro || null;
          if (!categoriaId) return null;

          let arquivoPath = '';
          if (guia.file) {
            arquivoPath = `guias/${crypto.randomUUID()}-${guia.file.name}`;
            const { error: uploadError } = await supabase.storage.from('folhas-pagamento').upload(arquivoPath, guia.file);
            if (uploadError) throw uploadError;
          }

          const { error: guiaError } = await supabase.from('folha_pagamento_guias').insert({
            competencia_id: competenciaId,
            franchise_id: guia.franchiseId,
            tipo: guia.tipo,
            valor: parseFloat(guia.valor),
            arquivo_path: arquivoPath,
          });
          if (guiaError) throw guiaError;

          return {
            franchise_id: guia.franchiseId,
            plano_conta_id: categoriaId,
            description: `${guia.tipo === 'fgts' ? 'FGTS' : guia.tipo === 'inss_patronal' ? 'INSS Patronal' : guia.tipo === 'sindicato' ? 'Sindicato' : 'Guia'} - ${competencia.competencia.slice(0, 7)}`,
            due_date: vencimento,
            amount: parseFloat(guia.valor),
            status: 'pendente',
            folha_pagamento_competencia_id: competenciaId,
          };
        })
      );
      for (const linha of linhasGuias) {
        if (linha) linhasDespesa.push(linha);
      }

      if (linhasDespesa.length > 0) {
        const { error: despesasError } = await supabase.from('accounts_payable').insert(linhasDespesa);
        if (despesasError) throw despesasError;
      }

      const { data: { user } } = await supabase.auth.getUser();
      const { error: statusError } = await supabase
        .from('folha_pagamento_competencias')
        .update({ status: 'validado', validado_por: user?.id || null, validado_em: new Date().toISOString() })
        .eq('id', competenciaId);
      if (statusError) throw statusError;

      await fetchDados();
    } catch (error) {
      console.error('Erro ao validar competência:', error);
      setErro(error instanceof Error ? error.message : 'Erro ao validar. Verifique o console.');
    } finally {
      setIsValidando(false);
    }
  };

  const handleCancelar = async () => {
    setIsCancelando(true);
    setErro(null);
    try {
      // Não existe fluxo de reversão de despesa já paga no projeto — se alguma despesa
      // gerada por essa competência já foi paga, bloqueia e pede resolução manual.
      const { data: pagas, error: pagasError } = await supabase
        .from('accounts_payable')
        .select('id')
        .eq('folha_pagamento_competencia_id', competenciaId)
        .eq('status', 'pago')
        .limit(1);
      if (pagasError) throw pagasError;
      if (pagas && pagas.length > 0) {
        throw new Error('Existem despesas desta competência já pagas — resolva-as manualmente em Contas a Pagar antes de cancelar.');
      }

      const { error: despesasError } = await supabase
        .from('accounts_payable')
        .update({ status: 'cancelado', motivo_cancelamento: motivoCancelamento || 'Competência de folha cancelada.' })
        .eq('folha_pagamento_competencia_id', competenciaId)
        .eq('status', 'pendente');
      if (despesasError) throw despesasError;

      const { data: { user } } = await supabase.auth.getUser();
      const { error: statusError } = await supabase
        .from('folha_pagamento_competencias')
        .update({
          status: 'cancelado',
          cancelado_por: user?.id || null,
          cancelado_em: new Date().toISOString(),
          motivo_cancelamento: motivoCancelamento || null,
        })
        .eq('id', competenciaId);
      if (statusError) throw statusError;

      setMostrarCancelar(false);
      await fetchDados();
    } catch (error) {
      console.error('Erro ao cancelar competência:', error);
      setErro(error instanceof Error ? error.message : 'Erro ao cancelar. Verifique o console.');
    } finally {
      setIsCancelando(false);
    }
  };

  if (isLoading) {
    return <div className="text-stone-400 text-sm">Carregando...</div>;
  }
  if (!competencia) {
    return <div className="text-stone-400 text-sm">Competência não encontrada.</div>;
  }

  const jaValidado = competencia.status === 'validado';
  const jaCancelado = competencia.status === 'cancelado';
  const podeEditar = competencia.status === 'aguardando_revisao';

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dp" className="text-sm font-medium text-amber-600 hover:text-amber-700">
          ← Voltar para DP
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-stone-800">Revisão — {competencia.competencia.slice(0, 7)}</h1>
          <p className="text-stone-500 text-sm mt-1">
            {jaCancelado
              ? `Competência cancelada.${competencia.motivo_cancelamento ? ` Motivo: ${competencia.motivo_cancelamento}` : ''}`
              : jaValidado
                ? 'Competência já validada e lançada em Contas a Pagar.'
                : 'Confira os dados extraídos antes de lançar em Contas a Pagar.'}
          </p>
        </div>
        {jaValidado && (
          <button
            type="button"
            onClick={() => { setMotivoCancelamento(''); setMostrarCancelar(true); }}
            className="text-sm font-medium text-red-600 hover:text-red-700 whitespace-nowrap"
          >
            Cancelar competência
          </button>
        )}
      </div>

      {erro && <div className="p-4 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">{erro}</div>}

      {Array.from(grupos.entries()).map(([chave, itensDaFranquia]) => {
        const semFranquia = chave === '__sem_franquia__';
        const totalLiquido = itensDaFranquia.reduce((acc, it) => acc + Number(it.valor_liquido), 0);
        const totalInss = itensDaFranquia.reduce((acc, it) => acc + Number(it.inss_empregado || 0), 0);
        const totalFgts = itensDaFranquia.reduce((acc, it) => acc + Number(it.fgts_mes || 0), 0);

        return (
          <div
            key={chave}
            className={`bg-white border rounded-xl shadow-sm overflow-hidden ${semFranquia ? 'border-amber-300' : 'border-stone-200'}`}
          >
            <div className={`px-6 py-3 border-b ${semFranquia ? 'bg-amber-50 border-amber-200' : 'bg-stone-50 border-stone-200'}`}>
              <h3 className={`text-sm font-semibold ${semFranquia ? 'text-amber-700' : 'text-stone-700'}`}>
                {semFranquia ? '⚠ Franquia não identificada' : nomeFranquia(chave)}
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-stone-600">
                <thead className="bg-stone-50/50 text-stone-500 uppercase text-xs font-medium">
                  <tr>
                    <th className="px-4 py-2">Código</th>
                    <th className="px-4 py-2">Nome</th>
                    <th className="px-4 py-2">Cargo</th>
                    <th className="px-4 py-2">Admissão</th>
                    <th className="px-4 py-2">Salário Base</th>
                    <th className="px-4 py-2">Líquido</th>
                    <th className="px-4 py-2">INSS</th>
                    <th className="px-4 py-2">FGTS</th>
                    <th className="px-4 py-2">H. Extras (qtd)</th>
                    <th className="px-4 py-2">H. Extras (R$)</th>
                    <th className="px-4 py-2">Reflexo DSR</th>
                    <th className="px-4 py-2">Franquia</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {itensDaFranquia.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-2">
                        <input disabled={!podeEditar} className="w-16 px-2 py-1 border border-stone-200 rounded text-xs" value={item.codigo_folha} onChange={(e) => atualizarItem(item.id, 'codigo_folha', e.target.value)} />
                      </td>
                      <td className="px-4 py-2">
                        <input disabled={!podeEditar} className="w-48 px-2 py-1 border border-stone-200 rounded text-xs" value={item.nome} onChange={(e) => atualizarItem(item.id, 'nome', e.target.value)} />
                      </td>
                      <td className="px-4 py-2">
                        <input disabled={!podeEditar} className="w-32 px-2 py-1 border border-stone-200 rounded text-xs" value={item.cargo || ''} onChange={(e) => atualizarItem(item.id, 'cargo', e.target.value)} />
                      </td>
                      <td className="px-4 py-2">
                        <input disabled={!podeEditar} type="date" className="w-36 px-2 py-1 border border-stone-200 rounded text-xs" value={item.admissao || ''} onChange={(e) => atualizarItem(item.id, 'admissao', e.target.value)} />
                      </td>
                      <td className="px-4 py-2">
                        <input disabled={!podeEditar} type="number" step="0.01" className="w-24 px-2 py-1 border border-stone-200 rounded text-xs" value={item.salario_base ?? ''} onChange={(e) => atualizarItem(item.id, 'salario_base', parseFloat(e.target.value) || null)} />
                      </td>
                      <td className="px-4 py-2">
                        <input disabled={!podeEditar} type="number" step="0.01" className="w-24 px-2 py-1 border border-stone-200 rounded text-xs" value={item.valor_liquido} onChange={(e) => atualizarItem(item.id, 'valor_liquido', parseFloat(e.target.value) || 0)} />
                      </td>
                      <td className="px-4 py-2">
                        <input disabled={!podeEditar} type="number" step="0.01" className="w-24 px-2 py-1 border border-stone-200 rounded text-xs" value={item.inss_empregado ?? ''} onChange={(e) => atualizarItem(item.id, 'inss_empregado', parseFloat(e.target.value) || null)} />
                      </td>
                      <td className="px-4 py-2">
                        <input disabled={!podeEditar} type="number" step="0.01" className="w-24 px-2 py-1 border border-stone-200 rounded text-xs" value={item.fgts_mes ?? ''} onChange={(e) => atualizarItem(item.id, 'fgts_mes', parseFloat(e.target.value) || null)} />
                      </td>
                      <td className="px-4 py-2">
                        <input disabled={!podeEditar} type="number" step="0.01" className="w-20 px-2 py-1 border border-stone-200 rounded text-xs" value={item.horas_extras_qtd ?? ''} onChange={(e) => atualizarItem(item.id, 'horas_extras_qtd', parseFloat(e.target.value) || null)} />
                      </td>
                      <td className="px-4 py-2">
                        <input disabled={!podeEditar} type="number" step="0.01" className="w-24 px-2 py-1 border border-stone-200 rounded text-xs" value={item.horas_extras_valor ?? ''} onChange={(e) => atualizarItem(item.id, 'horas_extras_valor', parseFloat(e.target.value) || null)} />
                      </td>
                      <td className="px-4 py-2">
                        <input disabled={!podeEditar} type="number" step="0.01" className="w-24 px-2 py-1 border border-stone-200 rounded text-xs" value={item.reflexo_dsr_valor ?? ''} onChange={(e) => atualizarItem(item.id, 'reflexo_dsr_valor', parseFloat(e.target.value) || null)} />
                      </td>
                      <td className="px-4 py-2">
                        <select
                          disabled={!podeEditar}
                          className={`px-2 py-1 border rounded text-xs bg-white ${semFranquia ? 'border-amber-300' : 'border-stone-200'}`}
                          value={item.franchise_id || ''}
                          onChange={(e) => atualizarItem(item.id, 'franchise_id', e.target.value || null)}
                        >
                          <option value="">Selecione...</option>
                          {franquias.map((f) => (
                            <option key={f.id} value={f.id}>{f.name}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-stone-50/50 font-medium text-stone-700">
                  <tr>
                    <td colSpan={5} className="px-4 py-2 text-right">Total:</td>
                    <td className="px-4 py-2">{formatCurrency(totalLiquido)}</td>
                    <td className="px-4 py-2">{formatCurrency(totalInss)}</td>
                    <td className="px-4 py-2">{formatCurrency(totalFgts)}</td>
                    <td />
                    <td />
                    <td />
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        );
      })}

      {podeEditar && (
        <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-stone-700">Guias avulsas (FGTS, INSS Patronal, Sindicato...)</h3>
            <button type="button" onClick={adicionarGuia} className="text-xs font-medium text-amber-600 hover:text-amber-700">
              + Adicionar guia
            </button>
          </div>
          {guias.map((guia, i) => (
            <div key={i} className="grid grid-cols-5 gap-3 items-end p-3 bg-stone-50 rounded-lg border border-stone-200">
              <div>
                <label className="block text-xs text-stone-600 mb-1">Franquia</label>
                <select className="w-full px-2 py-1.5 border border-stone-300 rounded text-sm bg-white" value={guia.franchiseId} onChange={(e) => atualizarGuia(i, 'franchiseId', e.target.value)}>
                  <option value="">Selecione...</option>
                  {franquias.map((f) => (<option key={f.id} value={f.id}>{f.name}</option>))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-stone-600 mb-1">Tipo</label>
                <select className="w-full px-2 py-1.5 border border-stone-300 rounded text-sm bg-white" value={guia.tipo} onChange={(e) => atualizarGuia(i, 'tipo', e.target.value as Guia['tipo'])}>
                  <option value="fgts">FGTS</option>
                  <option value="inss_patronal">INSS Patronal</option>
                  <option value="sindicato">Sindicato</option>
                  <option value="outro">Outro</option>
                </select>
              </div>
              {guia.tipo === 'outro' ? (
                <div>
                  <label className="block text-xs text-stone-600 mb-1">Categoria</label>
                  <Combobox
                    placeholder="Digite para buscar..."
                    value={guia.categoriaOutro}
                    onChange={(v) => atualizarGuia(i, 'categoriaOutro', v)}
                    options={categoriaOptions}
                  />
                </div>
              ) : <div />}
              <div>
                <label className="block text-xs text-stone-600 mb-1">Valor (R$)</label>
                <input type="number" step="0.01" className="w-full px-2 py-1.5 border border-stone-300 rounded text-sm" value={guia.valor} onChange={(e) => atualizarGuia(i, 'valor', e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                <input type="file" accept="application/pdf,image/*" className="text-xs" onChange={(e) => atualizarGuia(i, 'file', e.target.files?.[0] || null)} />
                <button type="button" onClick={() => removerGuia(i)} className="text-red-500 hover:text-red-700 text-xs">✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {podeEditar && (
        <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Vencimento (usado em todos os lançamentos gerados)</label>
            <input type="date" className="w-48 px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none text-stone-700" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
          </div>
          {existeItemSemFranquia && (
            <p className="text-sm text-amber-600">Resolva a franquia de todos os funcionários destacados acima antes de validar.</p>
          )}
          <button
            onClick={handleValidar}
            disabled={isValidando || existeItemSemFranquia}
            className="px-6 py-3 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {isValidando ? 'Validando...' : 'Validar Fechamento'}
          </button>
        </div>
      )}

      {mostrarCancelar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="flex justify-between items-center p-6 border-b border-stone-100">
              <h2 className="text-lg font-semibold text-stone-800">Cancelar competência</h2>
              <button onClick={() => setMostrarCancelar(false)} className="text-stone-400 hover:text-stone-600">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-stone-600">
                Tem certeza que deseja cancelar a competência de {competencia.competencia.slice(0, 7)}? As despesas pendentes geradas por ela serão canceladas em Contas a Pagar.
              </p>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Motivo (opcional)</label>
                <input
                  type="text"
                  className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                  value={motivoCancelamento}
                  onChange={(e) => setMotivoCancelamento(e.target.value)}
                  placeholder="Ex: competência errada, era Agosto"
                />
              </div>
              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setMostrarCancelar(false)}
                  className="flex-1 px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg font-medium transition-colors"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  onClick={handleCancelar}
                  disabled={isCancelando}
                  className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-70 flex justify-center items-center"
                >
                  {isCancelando ? 'Cancelando...' : 'Confirmar cancelamento'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
