'use client';

import React, { useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { adicionarMeses } from '../../../lib/date';
import { LinhaMetaCrua } from '../../../lib/metas';

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

const paraTexto = (v: number | string | null) => (v === null ? '' : String(Number(v)).replace('.', ','));

export default function EditorMetas({ mes, hoje, lojas, onSalvo }: Props) {
  const [campos, setCampos] = useState<Record<string, { meta: string; superMeta: string }>>(() =>
    Object.fromEntries(lojas.map((l) => [l.franchise_id, { meta: paraTexto(l.meta), superMeta: paraTexto(l.super_meta) }]))
  );
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'erro' | 'ok'; texto: string; detalhe?: string } | null>(null);

  const alterar = (id: string, campo: 'meta' | 'superMeta', valor: string) =>
    setCampos((atual) => ({ ...atual, [id]: { ...atual[id], [campo]: valor } }));

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
            novo[l.franchise_id] = { meta: paraTexto(l.meta), superMeta: paraTexto(l.super_meta) };
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
    const itens: { franchise_id: string; meta: number | null; super_meta: number | null }[] = [];
    for (const l of lojas) {
      const c = campos[l.franchise_id];
      const meta = lerValor(c.meta);
      const sup = lerValor(c.superMeta);
      if (Number.isNaN(meta) || Number.isNaN(sup)) {
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
      itens.push({ franchise_id: l.franchise_id, meta, super_meta: sup });
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
    'w-full px-2 py-1.5 border border-stone-300 rounded-lg text-sm text-right tabular-nums bg-white text-stone-900 focus:ring-2 focus:ring-stone-400 outline-none';

  return (
    <section className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-stone-800">Cadastrar metas do mês</h2>
        <button
          type="button"
          onClick={copiarMesAnterior}
          className="px-3 py-1.5 border border-stone-300 rounded-lg text-sm font-medium text-stone-700 hover:bg-stone-50"
        >
          Copiar do mês anterior
        </button>
      </div>
      <p className="text-xs text-stone-600">
        Valores em reais. Super meta em branco = igual à meta. Meta em branco remove a meta da loja neste mês.
      </p>

      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_7rem_7rem] sm:grid-cols-[1fr_10rem_10rem] gap-2 text-xs text-stone-600">
          <span>Loja</span>
          <span className="text-right">Meta</span>
          <span className="text-right">Super meta</span>
        </div>
        {lojas.map((l) => (
          <div key={l.franchise_id} className="grid grid-cols-[1fr_7rem_7rem] sm:grid-cols-[1fr_10rem_10rem] gap-2 items-center">
            <span className="text-sm text-stone-800 truncate">{l.franchise_nome}</span>
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
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={salvar}
          disabled={salvando}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-stone-800 text-white hover:bg-stone-700 disabled:opacity-50"
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
