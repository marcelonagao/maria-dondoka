'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { TELA_PARA_ROTA } from '../lib/telas';

interface ItemNav {
  name: string;
  tela: string;
  path: string;
  icon: string;
}

const ITENS_PRIMARIOS: ItemNav[] = [
  { name: 'Dashboard', tela: 'dashboard', path: TELA_PARA_ROTA.dashboard, icon: '📊' },
  { name: 'Tesouraria', tela: 'tesouraria', path: TELA_PARA_ROTA.tesouraria, icon: '💰' },
  { name: 'Vendas', tela: 'vendas_pdv', path: TELA_PARA_ROTA.vendas_pdv, icon: '🛍️' },
  { name: 'DP', tela: 'dp', path: TELA_PARA_ROTA.dp, icon: '🧑‍💼' },
];

const ITENS_SECUNDARIOS: ItemNav[] = [
  { name: 'Produtos', tela: 'produtos', path: TELA_PARA_ROTA.produtos, icon: '📦' },
  { name: 'DRE', tela: 'dre', path: TELA_PARA_ROTA.dre, icon: '📈' },
  { name: 'Configurações', tela: 'configuracoes', path: TELA_PARA_ROTA.configuracoes, icon: '⚙️' },
  { name: 'Franquias', tela: 'franquias', path: TELA_PARA_ROTA.franquias, icon: '🏬' },
];

interface MobileTabBarProps {
  telasPermitidas: string[];
}

// Barra de navegação fixa pra telas abaixo de `lg` — a sidebar desktop continua a mesma,
// isso é só o equivalente mobile. Mesmo filtro por telas_permitidas que o menu lateral já
// usa, então nunca mostra um item que o papel do usuário não acessa.
export default function MobileTabBar({ telasPermitidas }: MobileTabBarProps) {
  const pathname = usePathname();
  const [mostrarMais, setMostrarMais] = useState(false);

  const primariosVisiveis = ITENS_PRIMARIOS.filter((item) => telasPermitidas.includes(item.tela));
  const secundariosVisiveis = ITENS_SECUNDARIOS.filter((item) => telasPermitidas.includes(item.tela));

  const fecharMais = () => setMostrarMais(false);

  return (
    <>
      <nav className="fixed bottom-0 inset-x-0 z-40 lg:hidden bg-stone-900 border-t border-stone-800 flex">
        {primariosVisiveis.map((item) => {
          const ativo = pathname === item.path || pathname?.startsWith(`${item.path}/`);
          return (
            <Link
              key={item.tela}
              href={item.path}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-xs ${
                ativo ? 'text-amber-400' : 'text-stone-400'
              }`}
            >
              <span className="text-lg">{item.icon}</span>
              {item.name}
            </Link>
          );
        })}
        {secundariosVisiveis.length > 0 && (
          <button
            type="button"
            onClick={() => setMostrarMais(true)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-xs text-stone-400"
          >
            <span className="text-lg">⋯</span>
            Mais
          </button>
        )}
      </nav>

      {mostrarMais && (
        <div
          className="fixed inset-0 z-50 flex items-end lg:hidden bg-stone-900/50"
          onClick={fecharMais}
        >
          <div className="w-full bg-stone-900 rounded-t-2xl p-4 pb-6" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 bg-stone-700 rounded-full mx-auto mb-4" />
            <div className="space-y-1">
              {secundariosVisiveis.map((item) => (
                <Link
                  key={item.tela}
                  href={item.path}
                  onClick={fecharMais}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg text-stone-300 hover:bg-stone-800"
                >
                  <span>{item.icon}</span>
                  <span className="font-medium text-sm">{item.name}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
