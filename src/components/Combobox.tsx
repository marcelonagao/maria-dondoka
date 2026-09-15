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
  onCreateNew?: (nomeDigitado: string) => void | Promise<void>;
  createNewLabel?: (query: string) => string;
}

// Compara ignorando caixa, acento e espaço sobrando — sem isso "Ambev", "AMBEV" e "Ambev "
// viram três cadastros diferentes, e o projeto não tem tela pra deduplicar depois.
function normalizar(texto: string): string {
  return texto
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
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
  const [isCriando, setIsCriando] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Mantém o texto exibido em sincronia com o value controlado pelo formulário pai
  // (ex: reset do form, ou troca de franquia limpando a seleção). Enquanto o cadastro novo
  // está em voo não sincroniza: o value ainda é '' e o texto digitado sumiria da tela.
  useEffect(() => {
    if (isCriando) return;
    const selecionada = options.find((o) => o.value === value);
    setQuery(selecionada ? selecionada.label : '');
  }, [value, options, isCriando]);

  const queryNormalizada = normalizar(query);
  const filtradas = queryNormalizada
    ? options.filter((o) => normalizar(o.label).includes(queryNormalizada))
    : options;

  const mostrarCriarNovo =
    !!onCreateNew &&
    query.trim().length > 0 &&
    !options.some((o) => normalizar(o.label) === queryNormalizada);

  const linhas: Linha[] = [
    ...filtradas.map((opcao): Linha => ({ tipo: 'opcao', opcao })),
    ...(mostrarCriarNovo ? [{ tipo: 'criar' } as Linha] : []),
  ];

  const selecionar = (opcao: ComboboxOption) => {
    onChange(opcao.value);
    setQuery(opcao.label);
    setIsOpen(false);
  };

  const criarNovo = async () => {
    if (!onCreateNew || isCriando) return;
    setIsCriando(true);
    setIsOpen(false);
    try {
      await onCreateNew(query.trim());
    } finally {
      setIsCriando(false);
    }
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
        if (isCriando) return;
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
        disabled={isCriando}
        className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 outline-none disabled:bg-stone-50 disabled:text-stone-400"
        placeholder={isCriando ? 'Cadastrando...' : placeholder}
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
                i === highlightedIndex ? 'bg-stone-100 text-stone-900' : 'text-stone-700 hover:bg-stone-50'
              } ${linha.tipo === 'criar' ? 'font-medium text-stone-700' : ''}`}
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
