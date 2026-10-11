// Agrupamento da série diária de vendas em dia, semana ou mês. Função pura de propósito: o
// que é "mês parcial" e como se compara um mês com o outro decide o que o sócio conclui, então
// precisa ser conferível sem navegador (scratch/conferir-serie.mjs).
import { adicionarDias, intervaloDoMes, rotuloDoMes } from './date';

export type Granularidade = 'dia' | 'semana' | 'mes';

// Um ponto por dia com venda, como vem do resumo_vendas. Os campos além de faturamento só
// existem depois de docs/sql/serie-diaria-completa.sql; sem eles a tela mostra "—" em vez de
// inventar zero.
export interface PontoDia {
  data: string;
  faturamento: number;
  quantidadeVendas?: number;
  cmv?: number;
  impostos?: number;
  lojas?: number;
}

export interface Bucket {
  chave: string;
  rotulo: string;
  inicio: string; // limites naturais do bucket (a semana inteira, o mês inteiro)
  fim: string;
  faturamento: number;
  quantidadeVendas: number | null;
  cmv: number | null;
  impostos: number | null;
  // Maior número de lojas com venda num mesmo dia do bucket — não "lojas distintas", que a
  // série diária não permite somar sem contar a mesma loja duas vezes.
  lojasMax: number | null;
  diasNoBucket: number;
  diasCobertos: number; // dias do bucket dentro do período e até hoje, com ou sem venda
  parcial: boolean;
  mediaDia: number;
  ticket: number | null;
  margemPct: number | null;
  // Contra o bucket anterior, pela média por dia: mês de 10 dias contra mês de 31 pelo total
  // pareceria queda de 70%. undefined = não há bucket anterior no período.
  variacaoMediaDia?: number | null;
  lojasDelta?: number | null;
}

export function diffDias(inicio: string, fim: string): number {
  const a = new Date(inicio + 'T00:00:00Z').getTime();
  const b = new Date(fim + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86400000) + 1;
}

// null = sem base de comparação significativa (anterior zerado, atual não-zero).
export function variacaoPct(atual: number, anterior: number): number | null {
  if (anterior === 0) return atual === 0 ? 0 : null;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}

// Até 45 dias o dia ainda se lê; até 120 a semana tira o serrilhado do domingo; acima disso
// são meses e o que interessa é um mês contra o outro.
export const LIMITE_DIA = 45;
export const LIMITE_SEMANA = 120;

export function granularidadePadrao(inicio: string, fim: string): Granularidade {
  const dias = diffDias(inicio, fim);
  if (dias <= LIMITE_DIA) return 'dia';
  if (dias <= LIMITE_SEMANA) return 'semana';
  return 'mes';
}

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

// Semana de segunda a domingo, como o calendário do comércio.
function segundaDaSemana(iso: string): string {
  const diaSemana = new Date(iso + 'T00:00:00Z').getUTCDay(); // 0 = domingo
  return adicionarDias(iso, -((diaSemana + 6) % 7));
}

function limitesDoBucket(iso: string, g: Granularidade): { chave: string; rotulo: string; inicio: string; fim: string } {
  if (g === 'dia') return { chave: iso, rotulo: ddmm(iso), inicio: iso, fim: iso };
  if (g === 'semana') {
    const seg = segundaDaSemana(iso);
    return { chave: seg, rotulo: ddmm(seg), inicio: seg, fim: adicionarDias(seg, 6) };
  }
  const mes = iso.slice(0, 7);
  const { inicio, fim } = intervaloDoMes(mes);
  return { chave: mes, rotulo: rotuloDoMes(mes), inicio, fim };
}

const menor = (a: string, b: string) => (a < b ? a : b);
const maior = (a: string, b: string) => (a > b ? a : b);

export function agruparSerie(
  pontos: PontoDia[],
  granularidade: Granularidade,
  inicio: string,
  fim: string,
  hoje: string
): Bucket[] {
  // O período não passa de hoje: dia que ainda não aconteceu não é dia sem venda.
  const ultimo = menor(fim, hoje);
  if (ultimo < inicio) return [];

  const porDia = new Map(pontos.map((p) => [p.data, p]));
  const buckets: Bucket[] = [];

  let cursor = inicio;
  while (cursor <= ultimo) {
    const lim = limitesDoBucket(cursor, granularidade);
    const de = maior(lim.inicio, inicio);
    const ate = menor(lim.fim, ultimo);

    let faturamento = 0;
    let quantidadeVendas: number | null = 0;
    let cmv: number | null = 0;
    let impostos: number | null = 0;
    let lojasMax: number | null = 0;
    for (let d = de; d <= ate; d = adicionarDias(d, 1)) {
      const p = porDia.get(d);
      if (!p) continue;
      faturamento += p.faturamento;
      quantidadeVendas = quantidadeVendas === null || p.quantidadeVendas === undefined ? null : quantidadeVendas + p.quantidadeVendas;
      cmv = cmv === null || p.cmv === undefined ? null : cmv + p.cmv;
      impostos = impostos === null || p.impostos === undefined ? null : impostos + p.impostos;
      lojasMax = lojasMax === null || p.lojas === undefined ? null : Math.max(lojasMax, p.lojas);
    }

    const diasNoBucket = diffDias(lim.inicio, lim.fim);
    const diasCobertos = diffDias(de, ate);
    buckets.push({
      ...lim,
      faturamento,
      quantidadeVendas,
      cmv,
      impostos,
      lojasMax,
      diasNoBucket,
      diasCobertos,
      parcial: diasCobertos < diasNoBucket,
      mediaDia: faturamento / diasCobertos,
      ticket: quantidadeVendas ? faturamento / quantidadeVendas : null,
      margemPct:
        cmv === null || impostos === null || faturamento <= 0 ? null : ((faturamento - cmv - impostos) / faturamento) * 100,
    });
    cursor = adicionarDias(lim.fim, 1);
  }

  for (let i = 1; i < buckets.length; i++) {
    const atual = buckets[i];
    const ant = buckets[i - 1];
    atual.variacaoMediaDia = variacaoPct(atual.mediaDia, ant.mediaDia);
    atual.lojasDelta = atual.lojasMax === null || ant.lojasMax === null ? null : atual.lojasMax - ant.lojasMax;
  }
  return buckets;
}
