import { intervaloDoMes } from './date';

// Regra de negócio da tela /metas. Fica fora da tela para ser conferida sem navegador
// (ver scratch/conferir-metas.mjs). A tela só desenha o que estas funções decidiram.

// Linha crua devolvida pela RPC acompanhamento_metas. numeric pode chegar como string.
export interface LinhaMetaCrua {
  franchise_id: string;
  franchise_nome: string;
  meta: number | string | null;
  super_meta: number | string | null;
  realizado_mes: number | string;
  realizado_hoje: number | string;
  soma_janela: number | string;
  primeira_venda: string | null;
}

export type FaseMes = 'corrente' | 'fechado' | 'futuro';
export type StatusMeta = 'super' | 'meta' | 'abaixo' | 'sem_meta' | 'futuro';

export interface AcompanhamentoLoja {
  franchiseId: string;
  nome: string;
  fase: FaseMes;
  meta: number | null;
  superMeta: number | null;
  realizado: number;
  // null em mês futuro (não há o que projetar).
  projecao: number | null;
  mediaDiaria: number;
  diasJanela: number;
  // Projeção apoiada em pouco histórico: aviso na tela, não bloqueio.
  estimativaFraca: boolean;
  diasRestantes: number;
  faltaMeta: number | null;
  faltaSuperMeta: number | null;
  // Quanto precisa vender por dia nos dias que restam depois de hoje. null quando não há dia
  // restante ou o alvo já foi batido.
  necessarioPorDiaMeta: number | null;
  necessarioPorDiaSuper: number | null;
  // Realizado até ontem ÷ (meta proporcional aos dias completos). >1 = adiantado.
  ritmo: number | null;
  // Fechamento se o resto do mês seguir o passo médio dos dias completos deste mês. Segunda
  // opinião para a projeção de 30 dias: quando as duas discordam, a tela avisa.
  passoMes: number | null;
  projecoesDivergem: boolean;
  status: StatusMeta;
}

// Abaixo disso o histórico é curto demais para a média de 30 dias valer como estimativa.
export const MIN_DIAS_ESTIMATIVA = 14;
const DIAS_JANELA = 30;
// Dias completos do mês necessários para o "passo do mês" valer (dia atual > este número).
const MIN_DIAS_PASSO = 3;
// Diferença relativa entre as duas projeções a partir da qual a tela avisa.
const LIMITE_DIVERGENCIA = 0.2;

const num = (v: number | string | null): number => (v === null ? 0 : Number(v));

function diasEntre(deISO: string, ateISO: string): number {
  const a = Date.UTC(+deISO.slice(0, 4), +deISO.slice(5, 7) - 1, +deISO.slice(8, 10));
  const b = Date.UTC(+ateISO.slice(0, 4), +ateISO.slice(5, 7) - 1, +ateISO.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

export function calcularLoja(linha: LinhaMetaCrua, mes: string, hoje: string): AcompanhamentoLoja {
  const { inicio, fim } = intervaloDoMes(mes);
  const fase: FaseMes = hoje > fim ? 'fechado' : hoje < inicio ? 'futuro' : 'corrente';
  const diasNoMes = Number(fim.slice(8, 10));

  const meta = linha.meta === null ? null : Number(linha.meta);
  const superMeta = linha.super_meta === null ? null : Number(linha.super_meta);
  const realizado = num(linha.realizado_mes);
  const realizadoHoje = num(linha.realizado_hoje);

  // Janela: dias entre a primeira venda e hoje (hoje fora), no máximo 30. Dia sem linha na
  // tabela conta como zero, porque loja fechada também é parte do ritmo real.
  const diasJanela = linha.primeira_venda
    ? Math.max(0, Math.min(DIAS_JANELA, diasEntre(linha.primeira_venda, hoje)))
    : 0;
  const mediaDiaria = diasJanela > 0 ? num(linha.soma_janela) / diasJanela : 0;

  const diaAtual = fase === 'corrente' ? Number(hoje.slice(8, 10)) : 0;
  const diasRestantes = fase === 'corrente' ? diasNoMes - diaAtual : 0;

  let projecao: number | null;
  if (fase === 'corrente') {
    // Hoje conta pelo maior entre o que já vendeu e a média: dia parcial não derruba a
    // projeção, e dia que já passou da média não é jogado fora.
    const ateOntem = realizado - realizadoHoje;
    projecao = ateOntem + Math.max(realizadoHoje, mediaDiaria) + mediaDiaria * diasRestantes;
  } else {
    projecao = fase === 'fechado' ? realizado : null;
  }

  const faltaMeta = meta === null ? null : Math.max(0, meta - realizado);
  const faltaSuperMeta = superMeta === null ? null : Math.max(0, superMeta - realizado);
  const porDia = (falta: number | null): number | null =>
    falta !== null && falta > 0 && diasRestantes > 0 ? falta / diasRestantes : null;

  let ritmo: number | null = null;
  if (fase === 'corrente' && meta !== null && diaAtual > 1) {
    const completos = diaAtual - 1;
    const esperado = (meta * completos) / diasNoMes;
    ritmo = esperado > 0 ? (realizado - realizadoHoje) / esperado : null;
  }

  // Precisa de alguns dias completos no mês, senão um dia isolado vira "passo".
  let passoMes: number | null = null;
  if (fase === 'corrente' && diaAtual > MIN_DIAS_PASSO) {
    const ateOntem = realizado - realizadoHoje;
    const mediaMes = ateOntem / (diaAtual - 1);
    passoMes = ateOntem + Math.max(realizadoHoje, mediaMes) + mediaMes * diasRestantes;
  }
  const maior = Math.max(projecao || 0, passoMes || 0);
  const projecoesDivergem =
    projecao !== null && passoMes !== null && maior > 0 && Math.abs(projecao - passoMes) / maior > LIMITE_DIVERGENCIA;

  // Mês fechado julga pelo realizado; mês corrente, pela projeção. Projeção igual à meta
  // conta como meta batida.
  const base = fase === 'fechado' ? realizado : projecao;
  let status: StatusMeta;
  if (meta === null || superMeta === null) status = 'sem_meta';
  else if (base === null) status = 'futuro';
  else if (base >= superMeta) status = 'super';
  else if (base >= meta) status = 'meta';
  else status = 'abaixo';

  return {
    franchiseId: linha.franchise_id,
    nome: linha.franchise_nome,
    fase,
    meta,
    superMeta,
    realizado,
    projecao,
    mediaDiaria,
    diasJanela,
    estimativaFraca: fase === 'corrente' && diasJanela < MIN_DIAS_ESTIMATIVA,
    diasRestantes,
    faltaMeta,
    faltaSuperMeta,
    necessarioPorDiaMeta: porDia(faltaMeta),
    necessarioPorDiaSuper: porDia(faltaSuperMeta),
    ritmo,
    passoMes,
    projecoesDivergem,
    status,
  };
}

export interface ConsolidadoMetas {
  // Realizado de TODAS as lojas: tem de bater com o Painel de Vendas do mesmo período.
  realizadoGeral: number;
  // Comparação com meta usa só as lojas que têm meta cadastrada.
  lojasComMeta: number;
  lojasSemMeta: number;
  realizado: number;
  projecao: number | null;
  meta: number;
  superMeta: number;
  lojasBatendoMeta: number;
}

export function consolidar(lojas: AcompanhamentoLoja[]): ConsolidadoMetas {
  const comMeta = lojas.filter((l) => l.meta !== null && l.superMeta !== null);
  const semProjecao = comMeta.some((l) => l.projecao === null);
  return {
    realizadoGeral: lojas.reduce((s, l) => s + l.realizado, 0),
    lojasComMeta: comMeta.length,
    lojasSemMeta: lojas.length - comMeta.length,
    realizado: comMeta.reduce((s, l) => s + l.realizado, 0),
    projecao: comMeta.length === 0 || semProjecao ? null : comMeta.reduce((s, l) => s + (l.projecao || 0), 0),
    meta: comMeta.reduce((s, l) => s + (l.meta || 0), 0),
    superMeta: comMeta.reduce((s, l) => s + (l.superMeta || 0), 0),
    lojasBatendoMeta: comMeta.filter((l) => l.status === 'meta' || l.status === 'super').length,
  };
}

const PESO_STATUS: Record<StatusMeta, number> = { abaixo: 0, meta: 1, super: 2, futuro: 3, sem_meta: 4 };

// Quem precisa de atenção primeiro: abaixo da meta (pior projeção/meta no topo), depois
// quem está no ritmo; loja sem meta vai para o fim.
export function ordenarPorAtencao(lojas: AcompanhamentoLoja[]): AcompanhamentoLoja[] {
  const razao = (l: AcompanhamentoLoja) =>
    l.meta && (l.fase === 'fechado' ? l.realizado : l.projecao) !== null
      ? ((l.fase === 'fechado' ? l.realizado : l.projecao) as number) / l.meta
      : 0;
  return [...lojas].sort(
    (a, b) =>
      PESO_STATUS[a.status] - PESO_STATUS[b.status] ||
      razao(a) - razao(b) ||
      a.nome.localeCompare(b.nome, 'pt-BR')
  );
}

export function formatarMoeda(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

export function formatarPercentual(razao: number): string {
  return `${Math.round(razao * 100)}%`;
}
