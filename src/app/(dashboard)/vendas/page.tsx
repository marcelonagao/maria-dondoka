'use client';

import React, { useState, useEffect } from 'react';

interface HistoricoItem {
  id: string;
  valor_esperado: number;
  valor_contado: number;
  diferenca: number;
  contado_em: string;
}

interface LinhaCaixa {
  pdv_device_id: string;
  device_label: string;
  acumulado_atualizado_em: string | null;
  proximo_esperado: { dinheiro: number; cartao: number; pix: number; total: number } | null;
  historico: HistoricoItem[];
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

export default function PrestacaoContasPage() {
  const hoje = new Date().toISOString().slice(0, 10);
  const [dataSelecionada, setDataSelecionada] = useState(hoje);
  const [caixas, setCaixas] = useState<LinhaCaixa[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [valoresDigitados, setValoresDigitados] = useState<Record<string, string>>({});
  const [salvandoId, setSalvandoId] = useState<string | null>(null);
  const [expandido, setExpandido] = useState<string | null>(null);

  const carregar = async (data: string) => {
    try {
      setIsLoading(true);
      setErro(null);
      const res = await fetch(`/api/fechamentos/contagem?data=${data}`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = await res.json();
      setCaixas(json.caixas || []);
    } catch (err) {
      console.error('Erro ao carregar prestação de contas:', err);
      setErro('Não foi possível carregar os dados. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    carregar(dataSelecionada);
  }, [dataSelecionada]);

  const handleSalvar = async (pdv_device_id: string) => {
    const valorTexto = valoresDigitados[pdv_device_id];
    const valor = parseFloat(valorTexto);
    if (isNaN(valor) || valor < 0) {
      alert('Digite um valor válido para a contagem.');
      return;
    }

    setSalvandoId(pdv_device_id);
    try {
      const res = await fetch('/api/fechamentos/contagem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdv_device_id, data_fechamento: dataSelecionada, valor_contado: valor }),
      });
      if (!res.ok) throw new Error('Falha ao salvar');
      await carregar(dataSelecionada);
      setValoresDigitados((prev) => ({ ...prev, [pdv_device_id]: '' }));
    } catch (err) {
      console.error(err);
      alert('Erro ao salvar a contagem. Verifique o console.');
    } finally {
      setSalvandoId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-stone-800">Prestação de Contas</h1>
          <p className="text-stone-500 text-sm mt-1">Registre a contagem física de cada caixa. Um caixa pode ser fechado mais de uma vez no mesmo dia.</p>
        </div>
        <input
          type="date"
          value={dataSelecionada}
          max={hoje}
          onChange={(e) => setDataSelecionada(e.target.value)}
          className="px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none text-stone-700"
        />
      </div>

      {erro ? (
        <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-8 text-center text-red-500">{erro}</div>
      ) : isLoading ? (
        <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-8 text-center text-stone-400">Carregando...</div>
      ) : caixas.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-8 text-center text-stone-400">
          Nenhum caixa cadastrado. Cadastre em Configurações.
        </div>
      ) : (
        <div className="space-y-4">
          {caixas.map((c) => (
            <div key={c.pdv_device_id} className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden">
              <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="font-medium text-stone-800">{c.device_label}</h3>
                  <p className="text-xs text-stone-400 mt-1">
                    {c.acumulado_atualizado_em
                      ? `Vendas atualizadas em ${new Date(c.acumulado_atualizado_em).toLocaleTimeString('pt-BR')}`
                      : 'Vendas ainda não sincronizadas para este dia'}
                    {c.historico.length > 0 && ` · ${c.historico.length} fechamento(s) já registrado(s) hoje`}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-xs text-stone-400 uppercase tracking-wider">A conferir agora</p>
                    <p className="font-semibold text-stone-800">
                      {c.proximo_esperado ? formatCurrency(c.proximo_esperado.total) : '—'}
                    </p>
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Valor contado"
                    disabled={!c.proximo_esperado}
                    value={valoresDigitados[c.pdv_device_id] || ''}
                    onChange={(e) => setValoresDigitados((prev) => ({ ...prev, [c.pdv_device_id]: e.target.value }))}
                    className="w-32 px-3 py-2 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 outline-none disabled:bg-stone-50 disabled:text-stone-300"
                  />
                  <button
                    onClick={() => handleSalvar(c.pdv_device_id)}
                    disabled={!c.proximo_esperado || salvandoId === c.pdv_device_id}
                    className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {salvandoId === c.pdv_device_id ? 'Salvando...' : 'Fechar Caixa'}
                  </button>
                </div>
              </div>

              {c.historico.length > 0 && (
                <div className="border-t border-stone-100">
                  <button
                    onClick={() => setExpandido(expandido === c.pdv_device_id ? null : c.pdv_device_id)}
                    className="w-full px-6 py-3 text-xs text-stone-500 hover:bg-stone-50 transition-colors text-left"
                  >
                    {expandido === c.pdv_device_id ? '▾' : '▸'} Ver fechamentos de hoje
                  </button>
                  {expandido === c.pdv_device_id && (
                    <table className="w-full text-left text-sm text-stone-600">
                      <thead className="bg-stone-50 text-stone-500 uppercase text-xs">
                        <tr>
                          <th className="px-6 py-2">Horário</th>
                          <th className="px-6 py-2">Esperado</th>
                          <th className="px-6 py-2">Contado</th>
                          <th className="px-6 py-2">Diferença</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {c.historico.map((h) => (
                          <tr key={h.id}>
                            <td className="px-6 py-2">{new Date(h.contado_em).toLocaleTimeString('pt-BR')}</td>
                            <td className="px-6 py-2">{formatCurrency(h.valor_esperado)}</td>
                            <td className="px-6 py-2">{formatCurrency(h.valor_contado)}</td>
                            <td className={`px-6 py-2 font-medium ${h.diferenca < 0 ? 'text-red-600' : h.diferenca > 0 ? 'text-emerald-600' : 'text-stone-500'}`}>
                              {formatCurrency(h.diferenca)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}