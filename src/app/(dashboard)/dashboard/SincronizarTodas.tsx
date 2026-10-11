'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

interface LojaSync {
  id: string;
  nome: string;
  ultimoEnvio: string | null;
}

type EstadoLoja = 'aguardando' | 'ok' | 'falhou';

interface Progresso {
  iniciadoEm: string;
  lojas: LojaSync[];
  // Falhas já confirmadas pelo disparo (HTTP de erro, loja sem URL): não adianta esperar.
  falhas: Record<string, string>;
  terminou: boolean;
}

const INTERVALO_MS = 4_000;
const LIMITE_MS = 60_000;

const hora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  });

function estadoDe(l: LojaSync, p: Progresso): EstadoLoja {
  if (p.falhas[l.nome]) return 'falhou';
  // Date em vez de comparar texto: o banco devolve "+00:00" e o servidor "Z".
  return l.ultimoEnvio && new Date(l.ultimoEnvio).getTime() >= new Date(p.iniciadoEm).getTime() ? 'ok' : 'aguardando';
}

// O botão só dispara; quem diz se a loja atualizou é o último envio dela gravado no banco. Antes
// a mensagem contava só as lojas diretas (as que respondem na hora) e o sócio entendia que as
// outras não tinham sido atualizadas. Aqui a tela acompanha cada loja até o fim.
export default function SincronizarTodas({ onAtualizar }: { onAtualizar: () => void }) {
  const [rodando, setRodando] = useState(false);
  const [progresso, setProgresso] = useState<Progresso | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ativo = useRef(true);

  useEffect(() => {
    ativo.current = true;
    return () => {
      ativo.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const consultar = useCallback(async () => {
    const res = await fetch('/api/pdv/sync-todas', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { lojas: LojaSync[] };
    return json.lojas;
  }, []);

  const sincronizar = async () => {
    if (rodando) return;
    setRodando(true);
    setErro(null);
    setProgresso(null);
    const inicioLocal = Date.now();
    try {
      const res = await fetch('/api/pdv/sync-todas', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        setErro(json.detalhe || 'Não foi possível sincronizar agora.');
        setRodando(false);
        return;
      }

      const falhas: Record<string, string> = {};
      (json.resultados || []).forEach((r: { loja: string; status: string; detalhe?: string }) => {
        if (r.status === 'falhou') falhas[r.loja] = r.detalhe || 'falhou ao sincronizar';
        if (r.status === 'sem_url') falhas[r.loja] = 'sem endereço de sincronização cadastrado';
      });

      const acompanhar = async () => {
        if (!ativo.current) return;
        let lojas: LojaSync[] = [];
        try {
          lojas = await consultar();
        } catch (err) {
          // Falha de leitura não derruba o acompanhamento: tenta de novo no próximo ciclo.
          console.error('Erro ao consultar estado da sincronização:', err);
        }
        if (!ativo.current) return;

        const atual: Progresso = { iniciadoEm: json.iniciadoEm, lojas, falhas, terminou: false };
        const pendentes = lojas.filter((l) => estadoDe(l, atual) === 'aguardando');
        atual.terminou = (lojas.length > 0 && pendentes.length === 0) || Date.now() - inicioLocal >= LIMITE_MS;
        setProgresso(atual);

        if (atual.terminou) {
          setRodando(false);
          onAtualizar();
          return;
        }
        timer.current = setTimeout(acompanhar, INTERVALO_MS);
      };
      await acompanhar();
    } catch (err) {
      console.error('Erro ao sincronizar PDV:', err);
      setErro('Erro ao sincronizar. Verifique o console.');
      setRodando(false);
    }
  };

  const total = progresso?.lojas.length ?? 0;
  const estados = progresso ? progresso.lojas.map((l) => ({ l, e: estadoDe(l, progresso) })) : [];
  const ok = estados.filter((x) => x.e === 'ok').length;
  const naoAtualizadas = estados.filter((x) => x.e !== 'ok');

  return (
    <div className="flex flex-col gap-2 sm:items-end">
      <button
        type="button"
        onClick={sincronizar}
        disabled={rodando}
        className="flex-1 sm:flex-none px-3 py-2 rounded-lg text-sm font-medium bg-stone-800 text-white hover:bg-stone-700 disabled:opacity-50"
      >
        {rodando ? 'Sincronizando...' : 'Sincronizar PDV'}
      </button>

      <div className="sm:text-right text-xs min-h-[1.25rem]" aria-live="polite">
        {erro && <p className="text-red-800">{erro}</p>}
        {progresso && !progresso.terminou && (
          <p className="text-stone-700 tabular-nums">Sincronizando… {ok} de {total} lojas atualizadas</p>
        )}
        {progresso?.terminou && naoAtualizadas.length === 0 && (
          <p className="text-green-800 font-medium">✓ Todas as {total} lojas atualizadas</p>
        )}
        {progresso?.terminou && naoAtualizadas.length > 0 && (
          <div className="text-orange-800">
            <p className="font-medium">▼ {ok} de {total} lojas atualizadas. Sem resposta:</p>
            <ul>
              {naoAtualizadas.map(({ l, e }) => (
                <li key={l.id}>
                  {l.nome}
                  {e === 'falhou' && progresso.falhas[l.nome] ? ` — ${progresso.falhas[l.nome]}` : ''}
                  {' — '}
                  {l.ultimoEnvio ? `última atualização em ${hora(l.ultimoEnvio)}` : 'nunca atualizou'}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
