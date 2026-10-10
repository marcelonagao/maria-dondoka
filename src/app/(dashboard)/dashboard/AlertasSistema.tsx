'use client';

import React, { useEffect, useState } from 'react';

export interface Alerta {
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

const RESUMO_POR_TIPO: Record<string, [string, string]> = {
  duplicidade_vendas_itens: ['possível duplicidade', 'possíveis duplicidades'],
  item_valor_invalido: ['item descartado', 'itens descartados'],
  itens_divergem_caixa: ['divergência de caixa', 'divergências de caixa'],
};

// Divergência de caixa e duplicidade distorcem faturamento; item descartado é de um item só.
const TIPOS_GRAVES = ['itens_divergem_caixa', 'duplicidade_vendas_itens'];

// Guarda os IDs que o gestor já viu com a faixa recolhida. Se aparecer um ID fora dessa lista,
// a faixa reabre sozinha: recolher não pode esconder alerta novo.
const CHAVE_VISTOS = 'alertas-sistema-recolhidos';

function lerVistos(): string[] {
  try {
    const bruto = window.localStorage.getItem(CHAVE_VISTOS);
    const lista: unknown = bruto ? JSON.parse(bruto) : [];
    return Array.isArray(lista) ? lista.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function gravarVistos(ids: string[]) {
  try {
    window.localStorage.setItem(CHAVE_VISTOS, JSON.stringify(ids));
  } catch {
    // Sem armazenamento (janela privada): a faixa só volta a abrir a cada visita.
  }
}

function formatarData(data: string | null) {
  return data ? data.split('-').reverse().join('/') : null;
}

function resumir(alertas: Alerta[]): string {
  const contagem = new Map<string, number>();
  alertas.forEach((a) => contagem.set(a.tipo, (contagem.get(a.tipo) || 0) + 1));
  return Array.from(contagem.entries())
    .map(([tipo, n]) => {
      const rotulo = RESUMO_POR_TIPO[tipo];
      return `${n} ${rotulo ? (n === 1 ? rotulo[0] : rotulo[1]) : 'outro alerta'}`;
    })
    .join(' · ');
}

export default function AlertasSistema({ alertas, onResolvido }: { alertas: Alerta[]; onResolvido: (id: string) => void }) {
  // Começa aberta e só recolhe depois de ler o localStorage: no HTML pré-renderizado não há
  // storage, e começar recolhida esconderia alerta novo se a leitura falhasse.
  const [aberta, setAberta] = useState(true);
  const [resolvendo, setResolvendo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const idsKey = alertas.map((a) => a.id).sort().join(',');

  useEffect(() => {
    if (alertas.length === 0) return;
    const vistos = lerVistos();
    setAberta(alertas.some((a) => !vistos.includes(a.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  if (alertas.length === 0) return null;

  const alternar = () => {
    const proximaAberta = !aberta;
    setAberta(proximaAberta);
    // Ao recolher, registra o que foi visto; ao abrir, esquece — abrir de novo é intenção de revisar.
    gravarVistos(proximaAberta ? [] : alertas.map((a) => a.id));
  };

  const resolver = async (id: string) => {
    setResolvendo(id);
    setErro(null);
    try {
      const res = await fetch('/api/alertas', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        console.error('Falha ao marcar alerta como resolvido:', res.status, json);
        setErro(`Não foi possível marcar como resolvido (${json.error || res.status}). ${json.detalhe || ''}`);
        return;
      }
      onResolvido(id);
    } catch (err) {
      console.error('Erro ao marcar alerta como resolvido:', err);
      setErro('Não foi possível marcar como resolvido. Verifique a conexão e tente de novo.');
    } finally {
      setResolvendo(null);
    }
  };

  const temGrave = alertas.some((a) => TIPOS_GRAVES.includes(a.tipo));
  const cores = temGrave
    ? 'bg-red-50 border-red-200 text-red-800'
    : 'bg-amber-50 border-amber-200 text-amber-900';

  return (
    <div className={`border rounded-xl text-sm ${cores}`}>
      <button
        type="button"
        onClick={alternar}
        aria-expanded={aberta}
        className="w-full flex items-center justify-between gap-3 px-4 py-2.5 sm:px-6 text-left"
      >
        <span>
          ⚠️ <strong>{alertas.length === 1 ? '1 alerta' : `${alertas.length} alertas`}</strong>
          <span className="hidden sm:inline"> — {resumir(alertas)}</span>
        </span>
        <span className="text-xs font-medium underline shrink-0">{aberta ? 'Recolher ▴' : 'Ver detalhes ▾'}</span>
      </button>

      {aberta && (
        <div className="px-4 pb-3 sm:px-6 sm:pb-4 space-y-3 border-t border-current/10 pt-3">
          {alertas.map((a) => (
            <div key={a.id} className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
              <div>
                <p className={TIPOS_GRAVES.includes(a.tipo) ? 'font-medium' : ''}>
                  {MENSAGEM_POR_TIPO[a.tipo] || 'Alerta do sistema'} em{' '}
                  <strong>{a.franquia_nome || 'franquia não identificada'}</strong>
                  {a.data_referencia && `, ${formatarData(a.data_referencia)}`} — verificar antes de
                  confiar no DRE desse período.
                </p>
                {a.detalhe && <p className="text-xs mt-0.5 opacity-90">{a.detalhe}</p>}
              </div>
              <button
                type="button"
                onClick={() => resolver(a.id)}
                disabled={resolvendo === a.id}
                className="shrink-0 px-3 py-1.5 rounded-lg border border-current/30 bg-white/60 text-xs font-medium hover:bg-white disabled:opacity-50"
              >
                {resolvendo === a.id ? 'Salvando...' : 'Marcar como resolvido'}
              </button>
            </div>
          ))}
          {erro && <p className="text-xs font-medium">{erro}</p>}
        </div>
      )}
    </div>
  );
}
