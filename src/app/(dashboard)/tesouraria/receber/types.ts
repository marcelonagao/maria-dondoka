export interface Recebimento {
  id: string;
  description: string;
  origin: string;
  expected_date: string;
  gross_amount: number;
  fee_amount: number;
  net_amount: number;
  status: string;
}
