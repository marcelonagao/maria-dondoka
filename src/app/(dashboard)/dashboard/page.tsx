'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import { hojeBrasilia, adicionarDias } from '../../../lib/date';
import PainelVendas from './PainelVendas';
import VendasPorLinha from './VendasPorLinha';

interface Franquia {
  id: string;
  name: string;
}

interface Alerta {
  id: string;
  tipo: string;
  franquia_nome: string | null;
  data_referencia: string | null;
  detalhe: string | null;
}

const MENSAGEM_POR_TIPO: Record<string, string> = {
  duplicidade_vendas_itens: 'Possível duplicidade detectada',
  item_valor_invalido: 'Item de venda descartado por valor inválido',
  itens_divergem_caixa: 'Itens de venda não batem com o caixa',
};

function formatarData(data: string | null) {
  return data ? data.split('-').reverse().join('/') : null;
}

export default function DashboardPage() {
  const [isSocio, setIsSocio] = useState(false);
  const [franquias, setFranquias] = useState<Franquia[]>([]);
  const [franquiaSelecionada, setFranquiaSelecionada] = useState<string>('');
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  // Período escolhido nos chips do painel de vendas, elevado para cá porque o card de
  // categorias também o consome. Inicia nos mesmos 7 dias que o painel usa por padrão: com
  // um valor diferente, o card faria uma consulta descartável antes do primeiro aviso.
  const [periodo, setPeriodo] = useState({
    inicio: adicionarDias(hojeBrasilia(), -6),
    fim: hojeBrasilia(),
  });
  const [isSincronizando, setIsSincronizando] = useState(false);
  const [statusSync, setStatusSync] = useState<string | null>(null);

  // "Atualizar" só refaz a consulta do dashboard — o dado já está no Supabase, não precisa
  // falar com o PDV. É instantâneo e é o que resolve 90% dos casos.
  const atualizar = () => setRefreshKey((k) => k + 1);

  // "Sincronizar PDV" vai buscar dado novo nas lojas. Loja1/Loja4 respondem na hora; as
  // outras 6 rodam um script PHP que pode passar do orçamento de tempo da rota — nesse
  // caso a resposta diz "em andamento" e o dado entra pelo webhook logo depois.
  const sincronizarPdv = async () => {
    setIsSincronizando(true);
    setStatusSync(null);
    try {
      const rota = isSocio ? '/api/pdv/sync-todas' : '/api/pdv/trigger-sync';
      const res = await fetch(rota, { method: 'POST' });
      const json = await res.json();

      if (!res.ok) {
        setStatusSync(json.detalhe || 'Não foi possível sincronizar agora.');
        return;
      }

      if (Array.isArray(json.resultados)) {
        const ok = json.resultados.filter((r: { status: string }) => r.status === 'sincronizada').length;
        const andamento = json.resultados.filter((r: { status: string }) => r.status === 'em_andamento').length;
        const falhas = json.resultados.filter((r: { status: string }) => r.status === 'falhou').length;
        const partes = [`${ok} loja(s) sincronizada(s)`];
        if (andamento > 0) partes.push(`${andamento} ainda processando`);
        if (falhas > 0) partes.push(`${falhas} com falha`);
        setStatusSync(partes.join(' · '));
      } else {
        setStatusSync(json.resposta || 'Sincronização concluída.');
      }

      atualizar();
    } catch (err) {
      console.error('Erro ao sincronizar PDV:', err);
      setStatusSync('Erro ao sincronizar. Verifique o console.');
    } finally {
      setIsSincronizando(false);
    }
  };

  useEffect(() => {
    async function carregarEscopo() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: perfil } = await supabase
          .from('profiles')
          .select('roles(escopo)')
          .eq('id', user.id)
          .maybeSingle();

        // Leitura pura (sem escrita) — só escopo importa, mesmo padrão do DRE.
        const papel = perfil?.roles as unknown as { escopo: string } | null;
        const socio = papel?.escopo === 'todas_franquias';
        setIsSocio(socio);

        if (socio) {
          const { data: franquiasData, error } = await supabase
            .from('franchises')
            .select('id, name')
            .eq('is_active', true)
            .order('name', { ascending: true });
          if (error) throw error;
          setFranquias(franquiasData || []);
        } else {
          // Não-sócio: a RLS já restringe tudo à própria franquia, não precisa do nome dela.
          setFranquias([]);
        }
      } catch (error) {
        console.error('Erro ao carregar escopo do dashboard:', error);
      }
    }

    carregarEscopo();

    // /api/alertas já filtra por escopo no servidor (devolve lista vazia pra quem não é
    // sócio) — não precisa esperar isSocio resolver aqui.
    fetch('/api/alertas')
      .then((res) => res.json())
      .then((json) => setAlertas(json.alertas || []))
      .catch((err) => console.error('Erro ao carregar alertas:', err));
  }, []);

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-stone-800">Visão Geral</h1>
          <p className="text-stone-500 text-sm mt-1">
            {isSocio ? 'Acompanhe as vendas de todas as franquias.' : 'Acompanhe as vendas da sua franquia.'}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          {isSocio && (
            <select
              className="w-full sm:w-auto px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 outline-none bg-white text-stone-700 text-sm"
              value={franquiaSelecionada}
              onChange={(e) => setFranquiaSelecionada(e.target.value)}
            >
              <option value="">Todas as franquias</option>
              {franquias.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          )}
          <div className="flex gap-2">
            <button
              onClick={atualizar}
              className="flex-1 sm:flex-none px-3 py-2 border border-stone-300 rounded-lg text-sm font-medium text-stone-700 hover:bg-stone-50"
            >
              Atualizar
            </button>
            <button
              onClick={sincronizarPdv}
              disabled={isSincronizando}
              className="flex-1 sm:flex-none px-3 py-2 rounded-lg text-sm font-medium bg-stone-800 text-white hover:bg-stone-700 disabled:opacity-50"
            >
              {isSincronizando ? 'Sincronizando...' : 'Sincronizar PDV'}
            </button>
          </div>
        </div>
      </div>

      {statusSync && (
        <p className="text-xs text-stone-500 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2">
          {statusSync}
        </p>
      )}

      {alertas.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 sm:px-6 sm:py-4 text-red-700 text-sm space-y-2">
          {alertas.map((a) => (
            <div key={a.id}>
              <p>
                ⚠️ {MENSAGEM_POR_TIPO[a.tipo] || 'Alerta do sistema'} em{' '}
                <strong>{a.franquia_nome || 'franquia não identificada'}</strong>
                {a.data_referencia && `, ${formatarData(a.data_referencia)}`} — verificar antes de
                confiar no DRE desse período.
              </p>
              {a.detalhe && <p className="text-xs text-red-600/80 mt-0.5">{a.detalhe}</p>}
            </div>
          ))}
        </div>
      )}

      <PainelVendas
        franchiseId={isSocio ? (franquiaSelecionada || undefined) : undefined}
        franquias={franquias}
        onSelecionarFranquia={setFranquiaSelecionada}
        onPeriodoChange={setPeriodo}
        refreshKey={refreshKey}
      />

      <VendasPorLinha
        franchiseId={isSocio ? (franquiaSelecionada || undefined) : undefined}
        inicio={periodo.inicio}
        fim={periodo.fim}
        refreshKey={refreshKey}
      />
    </div>
  );
}
