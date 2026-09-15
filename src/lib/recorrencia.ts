export type FrequenciaRecorrencia = 'mensal' | 'trimestral' | 'semestral' | 'anual';

export interface RecorrenciaBase {
  dia_vencimento: number;
  frequencia: FrequenciaRecorrencia;
  mes_referencia: number | null;
}

export function mesesPorFrequencia(freq: string): number {
  const mapa: Record<string, number> = { mensal: 1, trimestral: 3, semestral: 6, anual: 12 };
  return mapa[freq] || 1;
}

// Pra mensal, o mês-base é o mês corrente; pra trimestral/semestral/anual, é o
// mes_referencia cadastrado (ex: IPVA anual vencendo sempre em janeiro = mes_referencia 1).
// Anda em blocos de N meses a partir daí até achar a primeira ocorrência >= a data de corte —
// funciona igual pras 4 frequências, sem precisar de lógica separada por caso.
//
// Este módulo existe para o cron de geração e a projeção de fluxo de caixa usarem a MESMA
// regra: duas cópias divergiriam com o tempo, e o fluxo de caixa passaria a prever um
// vencimento diferente do que o cron acabaria gerando.
export function calcularProximoVencimento(r: RecorrenciaBase, apartirDe: Date): string {
  const passo = mesesPorFrequencia(r.frequencia);
  const mesBase = r.frequencia === 'mensal' ? apartirDe.getUTCMonth() + 1 : (r.mes_referencia || 1);
  let candidato = new Date(Date.UTC(apartirDe.getUTCFullYear(), mesBase - 1, r.dia_vencimento));
  while (candidato < apartirDe) {
    candidato = new Date(Date.UTC(candidato.getUTCFullYear(), candidato.getUTCMonth() + passo, r.dia_vencimento));
  }
  return candidato.toISOString().slice(0, 10);
}

// Todas as ocorrências entre duas datas. Usado só na projeção — o cron materializa uma de
// cada vez, quando o vencimento entra na janela dele.
export function ocorrenciasNoIntervalo(r: RecorrenciaBase, inicio: Date, fim: Date): string[] {
  const passo = mesesPorFrequencia(r.frequencia);
  const datas: string[] = [];

  let candidato = new Date(`${calcularProximoVencimento(r, inicio)}T00:00:00Z`);
  // Teto de segurança: com passo mínimo de 1 mês, 120 iterações cobrem 10 anos. Protege
  // contra laço infinito caso alguma frequência inválida escape pro banco.
  let voltas = 0;
  while (candidato <= fim && voltas < 120) {
    datas.push(candidato.toISOString().slice(0, 10));
    candidato = new Date(
      Date.UTC(candidato.getUTCFullYear(), candidato.getUTCMonth() + passo, r.dia_vencimento)
    );
    voltas++;
  }

  return datas;
}
