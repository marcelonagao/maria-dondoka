'use client';

import React, { useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { adicionarMeses } from '../../../lib/date';
import {
  LinhaMetaCrua, ORDEM_SEMANA, descreverDiasAbertos, diasAbertosDoAjuste, diasAbertosPelasVendas,
  diasAbertosPresumidos, nomeDiaSemana,
} from '../../../lib/metas';

interface Props {
  mes: string; // 'YYYY-MM'
  hoje: string;
  lojas: LinhaMetaCrua[];
  onSalvo: () => void;
}

// Convenção brasileira: ponto separa milhar, vírgula separa centavos.
function lerValor(texto: string): number | null {
  const limpo = texto.trim().replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
  if (limpo === '') return null;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : NaN;
}

// Inicial de cada dia; índice = dia da semana (0 = domingo). A ordem da semana vem de lib/metas.
const INICIAL_DIA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

const paraTexto = (v: number | string | null) => (v === null ? '' : String(Number(v)).replace('.', ','));

export default function EditorMetas({ mes, hoje, lojas, onSalvo }: Props) {
  const [campos, setCampos] = useState<Record<string, { meta: string; superMeta: string; metaSonhos: string }>>(() =>
    Object.fromEntries(lojas.map((l) => [l.franchise_id, { meta: paraTexto(l.meta), superMeta: paraTexto(l.super_meta), metaSonhos: paraTexto(l.meta_sonhos ?? null) }]))
  );
  // Ajuste de dias abertos por loja. null = automático (deduzido pelas vendas). O ajuste é exceção
  // do mês, por isso "Copiar do mês anterior" não mexe nele.
  const [ajustes, setAjustes] = useState<Record<string, boolean[] | null>>(() =>
    Object.fromEntries(lojas.map((l) => [l.franchise_id, diasAbertosDoAjuste(l.dias_abertos)]))
  );
  const deduzidos = useMemo(
    () => Object.fromEntries(lojas.map((l) => [
      l.franchise_id,
      diasAbertosPelasVendas(l.dias_com_venda_por_dia_semana, l.primeira_venda, hoje),
    ])),
    [lojas, hoje]
  );
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'erro' | 'ok'; texto: string; detalhe?: string } | null>(null);

  const alterar = (id: string, campo: 'meta' | 'superMeta' | 'metaSonhos', valor: string) =>
    setCampos((atual) => ({ ...atual, [id]: { ...atual[id], [campo]: valor } }));

  const alternarDia = (id: string, dia: number) =>
    setAjustes((atual) => {
      const a = atual[id];
      if (!a) return atual;
      // Loja sem nenhum dia aberto não tem o que projetar: o último dia ligado não desliga.
      if (a[dia] && a.filter(Boolean).length === 1) return atual;
      return { ...atual, [id]: a.map((v, d) => (d === dia ? !v : v)) };
    });

  const definirAjuste = (id: string, valor: boolean[] | null) =>
    setAjustes((atual) => ({ ...atual, [id]: valor }));

  const copiarMesAnterior = async () => {
    setAviso(null);
    try {
      const { data, error } = await supabase.rpc('acompanhamento_metas', {
        p_mes: `${adicionarMeses(mes, -1)}-01`,
        p_hoje: hoje,
      });
      if (error) throw error;
      const anterior = new Map<string, LinhaMetaCrua>(
        ((data || []) as LinhaMetaCrua[]).map((l) => [l.franchise_id, l])
      );
      setCampos((atual) => {
        const novo = { ...atual };
        Array.from(anterior.values()).forEach((l) => {
          if (l.meta !== null && novo[l.franchise_id]) {
            novo[l.franchise_id] = {
              meta: paraTexto(l.meta),
              superMeta: paraTexto(l.super_meta),
              metaSonhos: paraTexto(l.meta_sonhos ?? null),
            };
          }
        });
        return novo;
      });
      setAviso({ tipo: 'ok', texto: 'Valores do mês anterior copiados. Revise e salve.' });
    } catch (err) {
      console.error('Erro ao copiar metas do mês anterior:', err);
      setAviso({
        tipo: 'erro',
        texto: 'Não foi possível copiar o mês anterior.',
        detalhe: err instanceof Error ? err.message : (err as { message?: string })?.message,
      });
    }
  };

  const salvar = async () => {
    setAviso(null);
    const itens: {
      franchise_id: string;
      meta: number | null;
      super_meta: number | null;
      meta_sonhos: number | null;
      // Índices 0 = domingo, em ordem crescente. null = automático (pelas vendas).
      dias_abertos: number[] | null;
    }[] = [];
    for (const l of lojas) {
      const c = campos[l.franchise_id];
      const meta = lerValor(c.meta);
      const sup = lerValor(c.superMeta);
      const sonhos = lerValor(c.metaSonhos);
      if (Number.isNaN(meta) || Number.isNaN(sup) || Number.isNaN(sonhos)) {
        setAviso({ tipo: 'erro', texto: `${l.franchise_nome}: valor inválido. Use só números (vírgula para centavos).` });
        return;
      }
      if (meta !== null && meta <= 0) {
        setAviso({ tipo: 'erro', texto: `${l.franchise_nome}: a meta deve ser maior que zero.` });
        return;
      }
      if (meta === null && sup !== null) {
        setAviso({ tipo: 'erro', texto: `${l.franchise_nome}: informe a meta antes da super meta.` });
        return;
      }
      if (meta !== null && sup !== null && sup < meta) {
        setAviso({ tipo: 'erro', texto: `${l.franchise_nome}: a super meta não pode ser menor que a meta.` });
        return;
      }
      if (meta === null && sonhos !== null) {
        setAviso({ tipo: 'erro', texto: `${l.franchise_nome}: informe a meta antes da meta dos sonhos.` });
        return;
      }
      // Sonhos é o teto: precisa ser ≥ super (ou ≥ meta, quando a super está vazia e vale a própria meta).
      const piso = sup ?? meta;
      if (sonhos !== null && piso !== null && sonhos < piso) {
        setAviso({ tipo: 'erro', texto: `${l.franchise_nome}: a meta dos sonhos não pode ser menor que a super meta.` });
        return;
      }
      const ajuste = ajustes[l.franchise_id];
      // Meta em branco apaga a linha do mês no banco, e o ajuste iria junto sem aviso.
      if (ajuste && meta === null) {
        setAviso({ tipo: 'erro', texto: `${l.franchise_nome}: informe a meta para ajustar os dias abertos (ou volte ao automático).` });
        return;
      }
      const diasAbertos = ajuste ? ajuste.map((aberto, d) => (aberto ? d : -1)).filter((d) => d >= 0) : null;
      itens.push({ franchise_id: l.franchise_id, meta, super_meta: sup, meta_sonhos: sonhos, dias_abertos: diasAbertos });
    }

    setSalvando(true);
    try {
      const { error } = await supabase.rpc('salvar_metas_mes', { p_mes: `${mes}-01`, p_metas: itens });
      if (error) throw error;
      setAviso({ tipo: 'ok', texto: 'Metas salvas.' });
      onSalvo();
    } catch (err) {
      console.error('Erro ao salvar metas:', err);
      setAviso({
        tipo: 'erro',
        texto: 'Não foi possível salvar as metas.',
        detalhe: err instanceof Error ? err.message : (err as { message?: string })?.message,
      });
    } finally {
      setSalvando(false);
    }
  };

  const entrada =
    'w-full min-h-[44px] px-2 py-2 border border-stone-300 rounded-lg text-sm text-right tabular-nums bg-white text-stone-900 focus:ring-2 focus:ring-stone-400 outline-none';

  return (
    <section className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-stone-800">Cadastrar metas do mês</h2>
        <button
          type="button"
          onClick={copiarMesAnterior}
          className="px-3 py-2 min-h-[44px] border border-stone-300 rounded-lg text-sm font-medium text-stone-700 hover:bg-stone-50"
        >
          Copiar do mês anterior
        </button>
      </div>
      <p className="text-xs text-stone-600">
        Valores em reais. Super meta em branco = igual à meta. Meta em branco remove a meta da loja neste mês. Meta dos sonhos em branco = loja sem esse alvo.
      </p>
      <p className="text-xs text-stone-600">
        Dias abertos: o ajuste vale só para este mês. Use quando a loja abrir ou fechar fora do costume (ex.: domingos de dezembro).
      </p>

      <div className="space-y-2">
        <div className="grid grid-cols-3 sm:grid-cols-[1fr_9rem_9rem_9rem] gap-2 text-xs text-stone-600">
          <span className="hidden sm:block">Loja</span>
          <span className="text-right">Meta</span>
          <span className="text-right">Super meta</span>
          <span className="text-right">Meta dos sonhos</span>
        </div>
        {lojas.map((l) => (
          <div key={l.franchise_id} className="grid grid-cols-3 sm:grid-cols-[1fr_9rem_9rem_9rem] gap-2 items-center pb-3 border-b border-stone-100 last:border-b-0">
            <span className="col-span-3 sm:col-span-1 text-sm font-medium sm:font-normal text-stone-800 truncate">{l.franchise_nome}</span>
            <input
              aria-label={`Meta de ${l.franchise_nome}`}
              inputMode="decimal"
              className={entrada}
              value={campos[l.franchise_id]?.meta ?? ''}
              onChange={(e) => alterar(l.franchise_id, 'meta', e.target.value)}
            />
            <input
              aria-label={`Super meta de ${l.franchise_nome}`}
              inputMode="decimal"
              className={entrada}
              value={campos[l.franchise_id]?.superMeta ?? ''}
              onChange={(e) => alterar(l.franchise_id, 'superMeta', e.target.value)}
            />
            <input
              aria-label={`Meta dos sonhos de ${l.franchise_nome}`}
              inputMode="decimal"
              className={entrada}
              value={campos[l.franchise_id]?.metaSonhos ?? ''}
              onChange={(e) => alterar(l.franchise_id, 'metaSonhos', e.target.value)}
            />
            <DiasAbertos
              nomeLoja={l.franchise_nome}
              ajuste={ajustes[l.franchise_id] ?? null}
              deduzido={deduzidos[l.franchise_id]}
              presumido={diasAbertosPresumidos(l.dias_com_venda_por_dia_semana, l.primeira_venda, hoje)}
              onAjustar={() => definirAjuste(l.franchise_id, deduzidos[l.franchise_id].slice())}
              onAutomatico={() => definirAjuste(l.franchise_id, null)}
              onAlternar={(dia) => alternarDia(l.franchise_id, dia)}
            />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={salvar}
          disabled={salvando}
          className="px-4 py-2 min-h-[44px] rounded-lg text-sm font-medium bg-stone-800 text-white hover:bg-stone-700 disabled:opacity-50"
        >
          {salvando ? 'Salvando...' : 'Salvar metas'}
        </button>
        {aviso && (
          <div className={`text-sm ${aviso.tipo === 'erro' ? 'text-red-800' : 'text-green-800'}`} role="status">
            <p>{aviso.texto}</p>
            {aviso.detalhe && <p className="text-xs text-stone-600 mt-0.5">{aviso.detalhe}</p>}
          </div>
        )}
      </div>
    </section>
  );
}

function DiasAbertos({ nomeLoja, ajuste, deduzido, presumido, onAjustar, onAutomatico, onAlternar }: {
  nomeLoja: string;
  ajuste: boolean[] | null;
  deduzido: boolean[];
  presumido: boolean;
  onAjustar: () => void;
  onAutomatico: () => void;
  onAlternar: (dia: number) => void;
}) {
  const botao =
    'px-3 py-2 min-h-[44px] border border-stone-300 rounded-lg text-sm font-medium text-stone-700 hover:bg-stone-50';

  if (!ajuste) {
    return (
      <div className="col-span-3 sm:col-start-2 sm:col-span-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-xs text-stone-600">
          Abre {descreverDiasAbertos(deduzido)} ({presumido ? 'presumido: pouco histórico de vendas' : 'pelas vendas'})
        </p>
        <button type="button" onClick={onAjustar} className={botao} aria-label={`Ajustar dias abertos de ${nomeLoja} neste mês`}>
          Ajustar este mês
        </button>
      </div>
    );
  }

  return (
    <div className="col-span-3 sm:col-start-2 sm:col-span-3 space-y-1">
      <p className="text-xs text-stone-600">Dias abertos (ajustado neste mês): {descreverDiasAbertos(ajuste)}</p>
      {/* Grupo colado e com leve sangria no celular: 7 alvos de 44px (308px) não cabem nos 296px
          úteis do cartão em 360px de tela sem isso. */}
      <div role="group" aria-label={`Dias abertos de ${nomeLoja}`} className="flex -mx-2 sm:mx-0">
        {ORDEM_SEMANA.map((d, i) => (
          <button
            key={d}
            type="button"
            aria-pressed={ajuste[d]}
            aria-label={`${nomeDiaSemana(d)} (${nomeLoja})`}
            onClick={() => onAlternar(d)}
            className={`relative shrink-0 w-11 min-h-[44px] border text-sm font-medium ${i === 0 ? 'rounded-l-lg' : '-ml-px'} ${i === 6 ? 'rounded-r-lg' : ''} ${
              ajuste[d]
                ? 'bg-stone-800 text-white border-stone-800 z-10'
                : 'bg-white text-stone-700 border-stone-400 hover:bg-stone-50'
            }`}
          >
            {INICIAL_DIA[d]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-xs text-stone-600">Ao menos um dia precisa ficar aberto.</p>
        <button type="button" onClick={onAutomatico} className={botao}>
          Voltar ao automático
        </button>
      </div>
    </div>
  );
}
