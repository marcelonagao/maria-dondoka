'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import PainelVendas from './PainelVendas';
import TopProdutosChart from './TopProdutosChart';

interface Franquia {
  id: string;
  name: string;
}

interface Alerta {
  id: string;
  franquia_nome: string | null;
  data_referencia: string | null;
  detalhe: string | null;
}

export default function DashboardPage() {
  const [isSocio, setIsSocio] = useState(false);
  const [franquias, setFranquias] = useState<Franquia[]>([]);
  const [franquiaSelecionada, setFranquiaSelecionada] = useState<string>('');
  const [alertas, setAlertas] = useState<Alerta[]>([]);

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
      </div>

      {alertas.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 sm:px-6 sm:py-4 text-red-700 text-sm space-y-1">
          {alertas.map((a) => (
            <p key={a.id}>
              ⚠️ Possível duplicidade detectada em{' '}
              <strong>{a.franquia_nome || 'franquia não identificada'}</strong>
              {a.data_referencia && `, ${a.data_referencia.split('-').reverse().join('/')}`} — verificar
              antes de confiar no DRE desse período.
            </p>
          ))}
        </div>
      )}

      <PainelVendas
        franchiseId={isSocio ? (franquiaSelecionada || undefined) : undefined}
        franquias={franquias}
        onSelecionarFranquia={setFranquiaSelecionada}
      />

      <TopProdutosChart franchiseId={isSocio ? (franquiaSelecionada || undefined) : undefined} />
    </div>
  );
}
