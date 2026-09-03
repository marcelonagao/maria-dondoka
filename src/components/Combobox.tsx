'use client';

import React, { useState, useEffect, useRef } from 'react';

export interface ComboboxOption {
  value: string;
  label: string;
}

interface ComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  required?: boolean;
  onCreateNew?: (nomeDigitado: string) => void;
  createNewLabel?: (query: string) => string;
}

type Linha = { tipo: 'opcao'; opcao: ComboboxOption } | { tipo: 'criar' };

export default function Combobox({
  value,
  onChange,
  options,
  placeholder,
  required,
  onCreateNew,
  createNewLabel,
}: ComboboxProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Mantém o texto exibido em sincronia com o value controlado pelo formulário pai
  // (ex: reset do form, ou troca de franquia limpando a seleção).
  useEffect(() => {
    const selecionada = options.find((o) => o.value === value);
    setQuery(selecionada ? selecionada.label : '');
  }, [value, options]);

  const queryNormalizada = query.trim().toLowerCase();
  const filtradas = queryNormalizada
    ? options.filter((o) => o.label.toLowerCase().includes(queryNormalizada))
    : options;

  const mostrarCriarNovo =
    !!onCreateNew &&
    query.trim().length > 0 &&
    !options.some((o) => o.label.toLowerCase() === queryNormalizada);

  const linhas: Linha[] = [
    ...filtradas.map((opcao): Linha => ({ tipo: 'opcao', opcao })),
    ...(mostrarCriarNovo ? [{ tipo: 'criar' } as Linha] : []),
  ];

  const selecionar = (opcao: ComboboxOption) => {
    onChange(opcao.value);
    setQuery(opcao.label);
    setIsOpen(false);
  };

  const criarNovo = () => {
    if (!onCreateNew) return;
    onCreateNew(query.trim());
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setIsOpen(true);
        setHighlightedIndex(0);
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, linhas.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const linha = linhas[highlightedIndex];
      if (!linha) return;
      if (linha.tipo === 'opcao') selecionar(linha.opcao);
      else criarNovo();
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative"
      onBlur={(e) => {
        if (!containerRef.current?.contains(e.relatedTarget as Node)) {
          setIsOpen(false);
          const selecionada = options.find((o) => o.value === value);
          setQuery(selecionada ? selecionada.label : '');
        }
      }}
    >
      <input
        type="text"
        required={required}
        autoComplete="off"
        className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
          setHighlightedIndex(0);
          if (value) onChange('');
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {isOpen && linhas.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full max-h-56 overflow-auto bg-white border border-stone-200 rounded-lg shadow-lg py-1">
          {linhas.map((linha, i) => (
            <li
              key={linha.tipo === 'opcao' ? linha.opcao.value : '__criar__'}
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => (linha.tipo === 'opcao' ? selecionar(linha.opcao) : criarNovo())}
              className={`px-4 py-2 text-sm cursor-pointer ${
                i === highlightedIndex ? 'bg-amber-50 text-amber-700' : 'text-stone-700 hover:bg-stone-50'
              } ${linha.tipo === 'criar' ? 'font-medium text-amber-600' : ''}`}
            >
              {linha.tipo === 'opcao'
                ? linha.opcao.label
                : createNewLabel
                ? createNewLabel(query.trim())
                : `+ Cadastrar novo "${query.trim()}"`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
