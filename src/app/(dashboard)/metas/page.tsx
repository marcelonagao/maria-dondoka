'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { adicionarMeses, hojeBrasilia, mesAtualBrasilia } from '../../../lib/date';
import {
  LinhaMetaCrua,
  calcularLoja,
  consolidar,
  ordenarPorAtencao,
} from '../../../lib/metas';
import ResumoMetas from './ResumoMetas';
import CardLoja from './CardLoja';
import EditorMetas from './EditorMetas';

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const rotuloMes = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1]} de ${mes.slice(0, 4)}`;

export default function MetasPage() {
  // Data só depois da montagem: o HTML é pré-renderizado no build e texto de data no JSX
  // quebraria a hidratação (os botões deixariam de responder ao clique).
  const [mes, setMes] = useState('');
  const [hoje, setHoje] = useState('');
  const [isSocio, setIsSocio] = useState(false);
  const [linhas, setLinhas] = useState<LinhaMetaCrua[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<{ texto: string; detalhe?: string } | null>(null);
  const [editando, setEditando] = useState(false);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    setMes(mesAtualBrasilia());
    setHoje(hojeBrasilia());
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: perfil } = await supabase.from('profiles').select('roles(escopo)').eq('id', user.id).maybeSingle();
        const papel = perfil?.roles as unknown as { escopo: string } | null;
        setIsSocio(papel?.escopo === 'todas_franquias');
      } catch (err) {
        // Sem o escopo a tela segue só de leitura: o banco barra a gravação de qualquer forma.
        console.error('Erro ao carregar escopo da tela de metas:', err);
      }
    })();
  }, []);

  const carregar = useCallback(async () => {
    if (!mes || !hoje) return;
    setCarregando(true);
    setErro(null);
    try {
      const { data, error } = await supabase.rpc('acompanhamento_metas', { p_mes: `${mes}-01`, p_hoje: hoje });
      if (error) throw error;
      setLinhas((data || []) as LinhaMetaCrua[]);
    } catch (err) {
      console.error('Erro ao carregar acompanhamento de metas:', err);
      setLinhas([]);
      setErro({
        texto: 'Não foi possível carregar as metas agora.',
        detalhe: err instanceof Error ? err.message : (err as { message?: string })?.message,
      });
    } finally {
      setCarregando(false);
    }
  }, [mes, hoje]);

  useEffect(() => {
    carregar();
  }, [carregar, versao]);

  const lojas = useMemo(
    () => (mes && hoje ? ordenarPorAtencao(linhas.map((l) => calcularLoja(l, mes, hoje))) : []),
    [linhas, mes, hoje]
  );
  const resumo = useMemo(() => consolidar(lojas), [lojas]);

  const trocarMes = (delta: number) => {
    setEditando(false);
    setMes((m) => adicionarMeses(m, delta));
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-stone-800">Metas</h1>
          <p className="text-stone-600 text-sm mt-1">
            Realizado, projeção e quanto falta para a meta e a super meta.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => trocarMes(-1)}
            disabled={!mes}
            aria-label="Mês anterior"
            className="px-3 py-2 border border-stone-300 rounded-lg text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-50"
          >
            ‹
          </button>
          <span className="min-w-[10rem] text-center text-sm font-medium text-stone-800 capitalize">
            {mes ? rotuloMes(mes) : ' '}
          </span>
          <button
            type="button"
            onClick={() => trocarMes(1)}
            disabled={!mes}
            aria-label="Próximo mês"
            className="px-3 py-2 border border-stone-300 rounded-lg text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-50"
          >
            ›
          </button>
          {isSocio && (
            <button
              type="button"
              onClick={() => setEditando((v) => !v)}
              disabled={!mes || linhas.length === 0}
              className="ml-1 px-3 py-2 rounded-lg text-sm font-medium bg-stone-800 text-white hover:bg-stone-700 disabled:opacity-50"
            >
              {editando ? 'Fechar edição' : 'Editar metas'}
            </button>
          )}
        </div>
      </div>

      {erro && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl px-4 py-3 text-sm" role="alert">
          <p className="font-medium">{erro.texto}</p>
          {erro.detalhe && <p className="text-xs mt-1 break-words">{erro.detalhe}</p>}
          <button type="button" onClick={carregar} className="mt-2 text-xs font-medium underline">
            Tentar de novo
          </button>
        </div>
      )}

      {carregando && !erro && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-64 rounded-xl bg-stone-200/60 animate-pulse" />
          ))}
        </div>
      )}

      {!carregando && !erro && lojas.length === 0 && (
        <p className="text-sm text-stone-600 bg-white border border-stone-200 rounded-xl px-4 py-6 text-center">
          Nenhuma loja ativa encontrada para este usuário.
        </p>
      )}

      {!carregando && !erro && lojas.length > 0 && (
        <>
          {/* Gerente vê só a própria loja: o consolidado dele seria a loja repetida. */}
          {lojas.length > 1 && <ResumoMetas resumo={resumo} />}

          {isSocio && editando && (
            <EditorMetas
              key={mes}
              mes={mes}
              hoje={hoje}
              lojas={linhas}
              onSalvo={() => setVersao((v) => v + 1)}
            />
          )}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {lojas.map((l) => (
              <CardLoja key={l.franchiseId} loja={l} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
