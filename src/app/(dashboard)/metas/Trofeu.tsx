import React from 'react';
import { Medalha } from '../../../lib/metas';

// Preenchimento e contorno por medalha. O contorno escuro garante que a prata e o ouro
// apareçam em fundo branco; o posto também vai escrito ao lado ("1º"), então a cor não é a única pista.
const CORES: Record<Medalha, { fill: string; stroke: string; rotulo: string }> = {
  ouro: { fill: '#D4A017', stroke: '#7A5C00', rotulo: '1º lugar' },
  prata: { fill: '#C0C0C0', stroke: '#57534E', rotulo: '2º lugar' },
  bronze: { fill: '#CD7F32', stroke: '#6B3E14', rotulo: '3º lugar' },
};

export default function Trofeu({ medalha }: { medalha: Medalha }) {
  const { fill, stroke, rotulo } = CORES[medalha];
  return (
    <svg
      role="img"
      aria-label={rotulo}
      width={24}
      height={24}
      viewBox="0 0 24 24"
      className="shrink-0"
      fill={fill}
      stroke={stroke}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* alças */}
      <path d="M7 5H4v2.5C4 9.4 5.3 10.8 7.2 11" fill="none" />
      <path d="M17 5h3v2.5c0 1.9-1.3 3.3-3.2 3.5" fill="none" />
      {/* taça */}
      <path d="M7 3h10v6.5a5 5 0 0 1-10 0V3z" />
      {/* haste e base */}
      <path d="M12 14.5V18" fill="none" />
      <path d="M8 21v-1.5a1.5 1.5 0 0 1 1.5-1.5h5a1.5 1.5 0 0 1 1.5 1.5V21H8z" />
    </svg>
  );
}
