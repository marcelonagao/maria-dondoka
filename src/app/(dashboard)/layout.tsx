'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const menuItems = [
    { name: 'Dashboard', path: '/dashboard', icon: '📊' },
    { name: 'Tesouraria', path: '/tesouraria', icon: '💰' },
    { name: 'Vendas (PDV)', path: '/vendas', icon: '🛍️' },
    { name: 'Configurações', path: '/configuracoes', icon: '⚙️' },
  ];

  return (
    <div className="min-h-screen bg-stone-50 flex font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-stone-900 text-stone-100 flex flex-col">
        <div className="p-6">
          <h1 className="text-2xl font-serif tracking-tight">
            Maria<span className="text-amber-400">Dondoka</span>
          </h1>
          <p className="text-xs text-stone-400 mt-1">Painel da Franquia</p>
        </div>

        <nav className="flex-1 px-4 space-y-2 mt-4">
          {menuItems.map((item) => {
            const isActive = pathname === item.path || pathname?.startsWith(`${item.path}/`);
            return (
              <Link
                key={item.name}
                href={item.path}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-amber-500/10 text-amber-400'
                    : 'text-stone-300 hover:bg-stone-800 hover:text-stone-100'
                }`}
              >
                <span>{item.icon}</span>
                <span className="font-medium text-sm">{item.name}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-stone-800">
          <button className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm text-stone-400 hover:text-stone-100 transition-colors">
            <span>🚪</span> Sair do Sistema
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-stone-200 flex items-center justify-between px-8">
          <h2 className="text-stone-800 font-medium">Bem-vindo(a) ao painel</h2>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-amber-100 text-amber-700 rounded-full flex items-center justify-center font-bold text-sm">
              MD
            </div>
            <span className="text-sm font-medium text-stone-600">Admin Loja 01</span>
          </div>
        </header>
        
        <div className="flex-1 p-8 overflow-auto">
          {children}
        </div>
      </main>
    </div>
  );
}