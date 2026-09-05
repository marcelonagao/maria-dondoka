'use client';

import React from 'react';

export interface MetricListItem {
  label: string;
  value: React.ReactNode;
  dotColor?: string;
}

interface MetricListProps {
  items: MetricListItem[];
  variant?: 'light' | 'dark';
}

// Lista dividida de métricas relacionadas dentro de um card — substitui "uma caixa cinza
// por métrica" por uma única lista com ponto colorido por categoria. `variant="dark"` pra
// usar dentro de um HeroCard (fundo escuro).
export default function MetricList({ items, variant = 'light' }: MetricListProps) {
  const divideClass = variant === 'dark' ? 'divide-stone-800' : 'divide-stone-100';
  const labelClass = variant === 'dark' ? 'text-stone-400' : 'text-stone-500';
  const valueClass = variant === 'dark' ? 'text-stone-100' : 'text-stone-700';

  return (
    <div className={`divide-y ${divideClass}`}>
      {items.map((item, i) => (
        <div key={i} className="flex items-center justify-between py-2.5">
          <div className="flex items-center gap-2">
            {item.dotColor && (
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: item.dotColor }} />
            )}
            <span className={`text-sm font-medium ${labelClass}`}>{item.label}</span>
          </div>
          <span className={`text-sm font-medium tabular-nums ${valueClass}`}>{item.value}</span>
        </div>
      ))}
    </div>
  );
}
