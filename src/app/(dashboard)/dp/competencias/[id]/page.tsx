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

  const [competencia, setCompetencia] = useState<{ competencia: string; status: string } | null>(null);
  const [itens, setItens] = useState<Item[]>([]);
  const [franquias, setFranquias] = useState<Franquia[]>([]);
  const [planoContas, setPlanoContas] = useState<CategoriaContas[]>([]);
  const [guias, setGuias] = useState<Guia[]>([]);
  const [vencimento, setVencimento] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isValidando, setIsValidando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const fetchDados = async () => {
    try {
      setIsLoading(true);
      const [compRes, itensRes, franquiasRes, planoContasRes] = await Promise.all([
        supabase.from('folha_pagamento_competencias').select('competencia, status').eq('id', competenciaId).single(),
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
      for (const item of itens) {
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
          })
          .eq('id', item.id);
        if (error) throw error;
      }

      // Upsert de funcionários por (franchise_id, codigo_folha).
      for (const item of itens) {
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
          await supabase.from('funcionarios').update(dadosFuncionario).eq('id', funcionarioExistente.id);
        } else {
          const { data: novoFuncionario, error: criarError } = await supabase
            .from('funcionarios')
            .insert(dadosFuncionario)
            .select('id')
            .single();
          if (criarError) throw criarError;
          funcionarioId = novoFuncionario.id;
        }

        await supabase.from('folha_pagamento_itens').update({ funcionario_id: funcionarioId }).eq('id', item.id);
      }

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

      // Guias avulsas — upload do arquivo (se houver) + uma linha por guia.
      for (const guia of guias) {
        if (!guia.franchiseId || !guia.valor) continue;
        let categoriaId = categoriaDaGuia(guia.tipo);
        if (guia.tipo === 'outro') categoriaId = guia.categoriaOutro || null;
        if (!categoriaId) continue;

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

        linhasDespesa.push({
          franchise_id: guia.franchiseId,
          plano_conta_id: categoriaId,
          description: `${guia.tipo === 'fgts' ? 'FGTS' : guia.tipo === 'inss_patronal' ? 'INSS Patronal' : guia.tipo === 'sindicato' ? 'Sindicato' : 'Guia'} - ${competencia.competencia.slice(0, 7)}`,
          due_date: vencimento,
          amount: parseFloat(guia.valor),
          status: 'pendente',
          folha_pagamento_competencia_id: competenciaId,
        });
      }

      if (linhasDespesa.length > 0) {
        const { error: despesasError } = await supabase.from('accounts_payable').insert(linhasDespesa);
        if (despesasError) throw despesasError;
      }

      const { data: { user } } = await supabase.auth.getUser();
      await supabase
        .from('folha_pagamento_competencias')
        .update({ status: 'validado', validado_por: user?.id || null, validado_em: new Date().toISOString() })
        .eq('id', competenciaId);

      await fetchDados();
    } catch (error) {
      console.error('Erro ao validar competência:', error);
      setErro(error instanceof Error ? error.message : 'Erro ao validar. Verifique o console.');
    } finally {
      setIsValidando(false);
    }
  };

  if (isLoading) {
    return <div className="text-stone-400 text-sm">Carregando...</div>;
  }
  if (!competencia) {
    return <div className="text-stone-400 text-sm">Competência não encontrada.</div>;
  }

  const jaValidado = competencia.status === 'validado';

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dp" className="text-sm font-medium text-amber-600 hover:text-amber-700">
          ← Voltar para DP
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold text-stone-800">Revisão — {competencia.competencia.slice(0, 7)}</h1>
        <p className="text-stone-500 text-sm mt-1">
          {jaValidado ? 'Competência já validada e lançada em Contas a Pagar.' : 'Confira os dados extraídos antes de lançar em Contas a Pagar.'}
        </p>
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
                    {semFranquia && <th className="px-4 py-2">Franquia</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {itensDaFranquia.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-2">
                        <input disabled={jaValidado} className="w-16 px-2 py-1 border border-stone-200 rounded text-xs" value={item.codigo_folha} onChange={(e) => atualizarItem(item.id, 'codigo_folha', e.target.value)} />
                      </td>
                      <td className="px-4 py-2">
                        <input disabled={jaValidado} className="w-48 px-2 py-1 border border-stone-200 rounded text-xs" value={item.nome} onChange={(e) => atualizarItem(item.id, 'nome', e.target.value)} />
                      </td>
                      <td className="px-4 py-2">
                        <input disabled={jaValidado} className="w-32 px-2 py-1 border border-stone-200 rounded text-xs" value={item.cargo || ''} onChange={(e) => atualizarItem(item.id, 'cargo', e.target.value)} />
                      </td>
                      <td className="px-4 py-2">
                        <input disabled={jaValidado} type="date" className="w-36 px-2 py-1 border border-stone-200 rounded text-xs" value={item.admissao || ''} onChange={(e) => atualizarItem(item.id, 'admissao', e.target.value)} />
                      </td>
                      <td className="px-4 py-2">
                        <input disabled={jaValidado} type="number" step="0.01" className="w-24 px-2 py-1 border border-stone-200 rounded text-xs" value={item.salario_base ?? ''} onChange={(e) => atualizarItem(item.id, 'salario_base', parseFloat(e.target.value) || null)} />
                      </td>
                      <td className="px-4 py-2">
                        <input disabled={jaValidado} type="number" step="0.01" className="w-24 px-2 py-1 border border-stone-200 rounded text-xs" value={item.valor_liquido} onChange={(e) => atualizarItem(item.id, 'valor_liquido', parseFloat(e.target.value) || 0)} />
                      </td>
                      <td className="px-4 py-2">
                        <input disabled={jaValidado} type="number" step="0.01" className="w-24 px-2 py-1 border border-stone-200 rounded text-xs" value={item.inss_empregado ?? ''} onChange={(e) => atualizarItem(item.id, 'inss_empregado', parseFloat(e.target.value) || null)} />
                      </td>
                      <td className="px-4 py-2">
                        <input disabled={jaValidado} type="number" step="0.01" className="w-24 px-2 py-1 border border-stone-200 rounded text-xs" value={item.fgts_mes ?? ''} onChange={(e) => atualizarItem(item.id, 'fgts_mes', parseFloat(e.target.value) || null)} />
                      </td>
                      {semFranquia && (
                        <td className="px-4 py-2">
                          <select
                            disabled={jaValidado}
                            className="px-2 py-1 border border-amber-300 rounded text-xs bg-white"
                            value={item.franchise_id || ''}
                            onChange={(e) => atualizarItem(item.id, 'franchise_id', e.target.value || null)}
                          >
                            <option value="">Selecione...</option>
                            {franquias.map((f) => (
                              <option key={f.id} value={f.id}>{f.name}</option>
                            ))}
                          </select>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-stone-50/50 font-medium text-stone-700">
                  <tr>
                    <td colSpan={5} className="px-4 py-2 text-right">Total:</td>
                    <td className="px-4 py-2">{formatCurrency(totalLiquido)}</td>
                    <td className="px-4 py-2">{formatCurrency(totalInss)}</td>
                    <td className="px-4 py-2">{formatCurrency(totalFgts)}</td>
                    {semFranquia && <td />}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        );
      })}

      {!jaValidado && (
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

      {!jaValidado && (
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
    </div>
  );
}
