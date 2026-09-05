'use client';

import React from 'react';

interface HeroCardProps {
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
  // Card de largura cheia (Painel Executivo) tem espaço pro tamanho padrão; num grid
  // apertado (ex: 3 colunas do Dashboard) um valor longo pode quebrar linha em text-5xl —
  // passe algo menor ali (ex: 'text-3xl sm:text-4xl').
  valueSizeClassName?: string;
  extra?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

// Card de destaque — reservado pro ÚNICO número mais importante de uma tela (CET, Saldo
// Projetado, etc). Amber fica só aqui e no item ativo de navegação — nunca em focus ring
// de formulário, isso é `focus:ring-stone-400`.
export default function HeroCard({
  label,
  value,
  valueClassName = 'text-stone-50',
  valueSizeClassName = 'text-4xl sm:text-5xl',
  extra,
  children,
  className = '',
}: HeroCardProps) {
  return (
    <div className={`bg-stone-900 text-stone-50 rounded-2xl p-6 ${className}`}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-sm font-medium text-stone-400">{label}</p>
        {extra}
      </div>
      <p className={`${valueSizeClassName} font-bold tabular-nums tracking-tight ${valueClassName}`}>
        {value}
      </p>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
