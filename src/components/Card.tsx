'use client';

import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
}

// Card padrão do app — fundo branco, borda sutil, cantos suaves. Reservar o card escuro
// (HeroCard) só pro número que mais importa numa tela; este aqui é pra tudo que é apoio.
export default function Card({ children, className = '' }: CardProps) {
  return (
    <div className={`bg-white border border-stone-200 rounded-2xl p-5 sm:p-6 ${className}`}>
      {children}
    </div>
  );
}
