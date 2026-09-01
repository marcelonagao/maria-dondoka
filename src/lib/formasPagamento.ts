export const FORMAS_PAGAMENTO = [
  'dinheiro',
  'cartao_debito',
  'cartao_credito',
  'venda_internet',
  'deposito',
  'pix',
] as const;

export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number];

export const FORMA_PAGAMENTO_LABELS: Record<string, string> = {
  dinheiro: 'Dinheiro',
  cartao_debito: 'Cartão Débito',
  cartao_credito: 'Cartão Crédito',
  venda_internet: 'Venda p/ Internet',
  deposito: 'Depósito',
  pix: 'Pix',
};

export function labelFormaPagamento(forma: string): string {
  return FORMA_PAGAMENTO_LABELS[forma] || forma;
}
