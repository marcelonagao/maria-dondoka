export interface Despesa {
  id: string;
  description: string;
  due_date: string;
  amount: number;
  status: string;
  plano_conta_id: string | null;
  fornecedor_id: string | null;
  franchise_id: string;
  paid_at: string | null;
  valor_juros: number | null;
  valor_multa: number | null;
  comprovante_url: string | null;
  despesa_recorrente_id: string | null;
  motivo_cancelamento: string | null;
  documento_origem: string | null;
  parcela_numero: number | null;
  parcela_total: number | null;
  folha_pagamento_competencia_id: string | null;
  folha_pagamento_item_id: string | null;
  plano_contas: { nome: string } | null;
  franchises: { name: string } | null;
  fornecedores: { nome: string } | null;
}

export interface ItemFuncionario {
  id: string;
  nome: string;
  cargo: string | null;
  valor_liquido: number;
}

export interface DetalheFolha {
  cargo: string | null;
  total_vencimentos: number;
  total_descontos: number;
  observacao: string | null;
}

export interface Parcela {
  vencimento: string;
  valor: string;
}

export type Frequencia = 'mensal' | 'trimestral' | 'semestral' | 'anual';

export interface Recorrente {
  id: string;
  valor_referencia: number;
  dia_vencimento: number;
  frequencia: Frequencia;
  mes_referencia: number | null;
  is_active: boolean;
}

export interface CategoriaContas {
  id: string;
  nome: string;
  categoria_pai_id: string | null;
}

export interface Franquia {
  id: string;
  name: string;
}

export interface Fornecedor {
  id: string;
  nome: string;
  franchise_id: string | null;
}
