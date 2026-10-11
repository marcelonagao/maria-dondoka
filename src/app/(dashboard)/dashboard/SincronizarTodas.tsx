'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

interface LojaSync {
  id: string;
  nome: string;
  ultimoEnvio: string | null;
}

interface Progresso {
  iniciadoEm: string;
  lojas: LojaSync[];
  // Falhas já confirmadas pelo disparo (HTTP de erro, loja sem endereço): não adianta esperar.
  falhas: Record<string, string>;
  terminou: boolean;
  concluidoEm?: string;
}

// O script das 7 lojas percorre uma por vez e passa de 30 s; 90 s dá folga sem deixar o
// sócio esperando indefinidamente.
const INTERVALO_MS = 4_000;
const LIMITE_MS = 90_000;

const horaMinuto = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
const diaHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  });

function atualizada(l: LojaSync, p: Progresso): boolean {
  if (p.falhas[l.nome]) return false;
  // Date em vez de comparar texto: o banco devolve "+00:00" e o servidor "Z".
  return !!l.ultimoEnvio && new Date(l.ultimoEnvio).getTime() >= new Date(p.iniciadoEm).getTime();
}

export interface EstadoSincronizacao {
  sincronizar: () => void;
  rodando: boolean;
  progresso: Progresso | null;
  erro: string | null;
  fechar: () => void;
}

// O botão só dispara; quem diz se a loja atualizou é o último envio dela gravado no banco
// (pdv_devices.last_sync_at). Hook separado do texto para o botão ficar no cabeçalho e o
// resultado numa linha própria, sem empurrar o título.
export function useSincronizarTodas(onAtualizar: () => void): EstadoSincronizacao {
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
        if (r.status === 'sem_url') falhas[r.loja] = 'sem endereço de sincronização';
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
        const aguardando = lojas.filter((l) => !atualizada(l, atual) && !falhas[l.nome]);
        atual.terminou = (lojas.length > 0 && aguardando.length === 0) || Date.now() - inicioLocal >= LIMITE_MS;
        if (atual.terminou) atual.concluidoEm = new Date().toISOString();
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

  const fechar = () => {
    setProgresso(null);
    setErro(null);
  };

  return { sincronizar, rodando, progresso, erro, fechar };
}

// Uma linha só. O detalhe por loja fica recolhido: quem quer saber quais abre, o resto do
// painel não é empurrado para baixo.
export function StatusSincronizacao({ estado }: { estado: EstadoSincronizacao }) {
  const { progresso, erro, rodando, fechar } = estado;
  if (!progresso && !erro) return null;

  if (erro) {
    return (
      <p className="text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2" role="alert">
        {erro}
      </p>
    );
  }
  const p = progresso as Progresso;
  const total = p.lojas.length;
  const ok = p.lojas.filter((l) => atualizada(l, p));
  const pendentes = p.lojas.filter((l) => !atualizada(l, p));

  if (rodando || !p.terminou) {
    return (
      <p className="text-xs text-stone-700 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 tabular-nums" aria-live="polite">
        Sincronizando… {ok.length} de {total} lojas atualizadas
      </p>
    );
  }

  const botaoFechar = (
    <button type="button" onClick={fechar} aria-label="Fechar aviso" className="ml-auto px-1 font-medium">
      ×
    </button>
  );

  if (pendentes.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-green-800 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
        <span>✓ Todas as {total} lojas atualizadas às {horaMinuto(p.concluidoEm || p.iniciadoEm)}</span>
        {botaoFechar}
      </div>
    );
  }

  return (
    <details className="text-xs text-orange-800 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
      <summary className="flex items-center gap-2 cursor-pointer list-none">
        <span>
          ▼ {ok.length} de {total} lojas atualizadas · {pendentes.length} sem resposta{' '}
          <span className="underline">ver quais</span>
        </span>
        {botaoFechar}
      </summary>
      <ul className="mt-2 space-y-0.5 tabular-nums">
        {pendentes.map((l) => (
          <li key={l.id}>
            {l.nome}
            {p.falhas[l.nome] ? ` — ${p.falhas[l.nome]}` : ''}
            {' — '}
            {l.ultimoEnvio ? `última atualização ${diaHora(l.ultimoEnvio)}` : 'nunca atualizou'}
          </li>
        ))}
      </ul>
    </details>
  );
}
