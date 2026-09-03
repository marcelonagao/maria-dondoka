'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuAberto, setMenuAberto] = useState(false);
  const [telasPermitidas, setTelasPermitidas] = useState<string[]>([]);

  useEffect(() => {
    async function carregarPerfil() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('profiles')
        .select('roles(telas_permitidas)')
        .eq('id', user.id)
        .maybeSingle();
      const papel = data?.roles as unknown as { telas_permitidas: string[] } | null;
      setTelasPermitidas(papel?.telas_permitidas || []);
    }
    carregarPerfil();
  }, []);

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      router.push('/login');
    } catch (error) {
      console.error('Erro ao sair:', error);
    }
  };

  const menuItems = [
    { name: 'Dashboard', path: '/dashboard', icon: '📊', tela: 'dashboard' },
    {
      name: 'Tesouraria',
      icon: '💰',
      tela: 'tesouraria',
      subItems: [
        { name: 'Contas a Pagar', path: '/tesouraria/pagar' },
        { name: 'Contas a Receber', path: '/tesouraria/receber' },
      ],
    },
    { name: 'Vendas (PDV)', path: '/vendas', icon: '🛍️', tela: 'vendas_pdv' },
    { name: 'Produtos', path: '/produtos', icon: '📦', tela: 'produtos' },
    { name: 'DRE', path: '/dre', icon: '📈', tela: 'dre' },
    { name: 'Configurações', path: '/configuracoes', icon: '⚙️', tela: 'configuracoes' },
    { name: 'Franquias', path: '/franquias', icon: '🏬', tela: 'franquias' },
  ].filter((item) => telasPermitidas.includes(item.tela));

  const fecharMenu = () => setMenuAberto(false);

  return (
    <div className="min-h-screen bg-stone-50 flex font-sans">
      {/* Overlay — só aparece no mobile quando o menu está aberto, fecha ao tocar fora */}
      {menuAberto && (
        <div
          onClick={fecharMenu}
          className="fixed inset-0 bg-stone-900/50 z-40 lg:hidden"
        />
      )}

      {/* Sidebar — off-canvas no mobile, fixa no desktop */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-stone-900 text-stone-100 flex flex-col
          transform transition-transform duration-200 ease-in-out
          ${menuAberto ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}
      >
        <div className="p-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-serif tracking-tight">
              Maria<span className="text-amber-400">Dondoka</span>
            </h1>
            <p className="text-xs text-stone-400 mt-1">Painel da Franquia</p>
          </div>
          <button onClick={fecharMenu} className="lg:hidden text-stone-400 hover:text-stone-100 text-xl">
            ✕
          </button>
        </div>

        <nav className="flex-1 px-4 space-y-1 mt-4 overflow-y-auto">
          {menuItems.map((item) => {
            if (item.subItems) {
              return (
                <div key={item.name} className="py-2">
                  <div className="flex items-center gap-3 px-4 py-2 text-stone-400">
                    <span>{item.icon}</span>
                    <span className="font-medium text-sm uppercase tracking-wider text-xs">{item.name}</span>
                  </div>
                  <div className="ml-11 mt-1 space-y-1">
                    {item.subItems.map((subItem) => {
                      const isSubActive = pathname === subItem.path;
                      return (
                        <Link
                          key={subItem.name}
                          href={subItem.path}
                          onClick={fecharMenu}
                          className={`block px-3 py-2 rounded-lg transition-colors text-sm ${
                            isSubActive
                              ? 'bg-amber-500/10 text-amber-400 font-medium'
                              : 'text-stone-400 hover:bg-stone-800 hover:text-stone-100'
                          }`}
                        >
                          {subItem.name}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            }

            const isActive = pathname === item.path || pathname?.startsWith(`${item.path}/`);
            return (
              <div key={item.name} className="py-1">
                <Link
                  href={item.path!}
                  onClick={fecharMenu}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-amber-500/10 text-amber-400 font-medium'
                      : 'text-stone-300 hover:bg-stone-800 hover:text-stone-100'
                  }`}
                >
                  <span>{item.icon}</span>
                  <span className="font-medium text-sm">{item.name}</span>
                </Link>
              </div>
            );
          })}
        </nav>

        <div className="p-4 border-t border-stone-800">
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm text-stone-400 hover:text-stone-100 transition-colors bg-stone-800/50 rounded-lg"
          >
            <span>🚪</span> Sair do Sistema
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-stone-200 flex items-center justify-between px-4 sm:px-8">
          <div className="flex items-center gap-3">
            <button onClick={() => setMenuAberto(true)} className="lg:hidden text-stone-600 text-xl">
              ☰
            </button>
            <h2 className="text-stone-800 font-medium tracking-tight">Gestão de Unidade</h2>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-amber-100 text-amber-700 rounded-full flex items-center justify-center font-bold text-sm">
              MD
            </div>
            <span className="text-sm font-medium text-stone-600 hidden sm:inline">Admin</span>
          </div>
        </header>

        <div className="flex-1 p-4 sm:p-8 overflow-auto">
          {children}
        </div>
      </main>
    </div>
  );
}