'use client';

import React from 'react';
import { formatCurrency } from '../../../../lib/format';
import type { ComboboxOption } from '../../../../components/Combobox';
import type { Franquia } from './types';
import type { FiltrosPagar, OrdenarPor, StatusFiltro } from './usePagar';

interface FiltrosBarProps {
  filtros: FiltrosPagar;
  atualizarFiltro: <K extends keyof FiltrosPagar>(campo: K, valor: FiltrosPagar[K]) => void;
  limparFiltros: () => void;
  categoriaOptions: ComboboxOption[];
  fornecedorOptions: ComboboxOption[];
  franquias: Franquia[];
  mostrarFranquia: boolean;
  totais: { aPagar: number; vencido: number; proximos7Dias: number; quantidade: number };
  truncado: boolean;
}

// `w-full sm:w-auto` centralizado aqui: no celular os controles viram duas colunas de mesma
// largura, e no desktop voltam a se dimensionar pelo conteúdo. Sem isso, cada <select> saía
// com a largura do seu maior texto e as bordas não formavam coluna nenhuma.
const CAMPO = 'w-full sm:w-auto px-3 py-2 border border-stone-300 rounded-lg text-sm bg-white text-stone-700 focus:ring-2 focus:ring-stone-400 outline-none';

export default function FiltrosBar({
  filtros,
  atualizarFiltro,
  limparFiltros,
  categoriaOptions,
  fornecedorOptions,
  franquias,
  mostrarFranquia,
  totais,
  truncado,
}: FiltrosBarProps) {
  return (
    <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden">
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-stone-200">
        <div className="p-4">
          <p className="text-[11px] sm:text-xs font-medium text-stone-500">A pagar no período</p>
          <p className="text-base sm:text-lg font-semibold tabular-nums text-stone-800 mt-1">
            {formatCurrency(totais.aPagar)}
          </p>
        </div>
        <div className="p-4">
          <p className="text-[11px] sm:text-xs font-medium text-stone-500">Vencido</p>
          <p className={`text-base sm:text-lg font-semibold tabular-nums mt-1 ${totais.vencido > 0 ? 'text-red-600' : 'text-stone-800'}`}>
            {formatCurrency(totais.vencido)}
          </p>
        </div>
        <div className="p-4">
          <p className="text-[11px] sm:text-xs font-medium text-stone-500">Vence em 7 dias</p>
          <p className="text-base sm:text-lg font-semibold tabular-nums text-stone-800 mt-1">
            {formatCurrency(totais.proximos7Dias)}
          </p>
        </div>
        <div className="p-4">
          <p className="text-[11px] sm:text-xs font-medium text-stone-500">Lançamentos</p>
          <p className="text-base sm:text-lg font-semibold tabular-nums text-stone-800 mt-1">
            {totais.quantidade.toLocaleString('pt-BR')}
          </p>
        </div>
      </div>

      <div className="border-t border-stone-200 p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="search"
            placeholder="Buscar por fornecedor, observação, documento ou categoria..."
            className={`${CAMPO} flex-1`}
            value={filtros.busca}
            onChange={(e) => atualizarFiltro('busca', e.target.value)}
          />
          <input
            type="month"
            className={`${CAMPO} sm:w-44`}
            value={filtros.mes}
            onChange={(e) => atualizarFiltro('mes', e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <select
            className={CAMPO}
            value={filtros.status}
            onChange={(e) => atualizarFiltro('status', e.target.value as StatusFiltro)}
          >
            <option value="ativas">Ativas</option>
            <option value="pendentes">Pendentes</option>
            <option value="pagas">Pagas</option>
            <option value="canceladas">Canceladas</option>
            <option value="todas">Todas</option>
          </select>

          <select
            className={CAMPO}
            value={filtros.categoriaId}
            onChange={(e) => atualizarFiltro('categoriaId', e.target.value)}
          >
            <option value="">Todas as categorias</option>
            {categoriaOptions.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>

          <select
            className={CAMPO}
            value={filtros.fornecedorNome}
            onChange={(e) => atualizarFiltro('fornecedorNome', e.target.value)}
          >
            <option value="">Todos os fornecedores</option>
            {fornecedorOptions.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>

          {mostrarFranquia && (
            <select
              className={CAMPO}
              value={filtros.franchiseId}
              onChange={(e) => atualizarFiltro('franchiseId', e.target.value)}
            >
              <option value="">Todas as franquias</option>
              {franquias.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          )}

          <select
            className={CAMPO}
            value={`${filtros.ordenarPor}:${filtros.ordemAsc ? 'asc' : 'desc'}`}
            onChange={(e) => {
              const [campo, ordem] = e.target.value.split(':');
              atualizarFiltro('ordenarPor', campo as OrdenarPor);
              atualizarFiltro('ordemAsc', ordem === 'asc');
            }}
          >
            <option value="due_date:asc">Vencimento ↑</option>
            <option value="due_date:desc">Vencimento ↓</option>
            <option value="amount:desc">Maior valor</option>
            <option value="amount:asc">Menor valor</option>
            <option value="fornecedor:asc">Fornecedor A-Z</option>
          </select>

          <button
            type="button"
            onClick={() => atualizarFiltro('apenasVencidas', !filtros.apenasVencidas)}
            className={`w-full sm:w-auto px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
              filtros.apenasVencidas
                ? 'bg-red-50 border-red-200 text-red-700'
                : 'bg-white border-stone-300 text-stone-600 hover:bg-stone-50'
            }`}
          >
            {filtros.apenasVencidas ? '✓ ' : ''}Só vencidas
          </button>

          <button
            type="button"
            onClick={limparFiltros}
            className="w-full sm:w-auto px-3 py-2 rounded-lg text-sm font-medium text-stone-500 border border-transparent hover:bg-stone-100"
          >
            Limpar
          </button>
        </div>

        {!filtros.mes && (
          <p className="text-xs text-stone-400">
            Sem recorte de mês: a lista pode ficar longa e pesada de carregar.
          </p>
        )}
        {truncado && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Mostrando apenas as primeiras linhas do período — há mais lançamentos do que cabe
            numa consulta. Escolha um mês específico para ver o total correto.
          </p>
        )}
      </div>
    </div>
  );
}
