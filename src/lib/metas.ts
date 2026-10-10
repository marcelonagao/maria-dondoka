import { adicionarDias, intervaloDoMes } from './date';

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
  // Vendas das 8 semanas anteriores a hoje, por dia da semana (índice 0 = domingo).
  soma_por_dia_semana: (number | string)[] | null;
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
  // true quando a projeção usou o formato da semana da loja (senão, todos os dias valem igual).
  usaDiaSemana: boolean;
  status: StatusMeta;
}

// Abaixo disso o histórico é curto demais para a média de 30 dias valer como estimativa.
export const MIN_DIAS_ESTIMATIVA = 14;
const DIAS_JANELA = 30;
// O formato da semana vem de 8 semanas; com menos que isso (ou dia da semana com menos de 4
// amostras) a loja cai na projeção plana em vez de inventar um perfil.
const DIAS_PERFIL = 56;
const MIN_DIAS_PERFIL = 28;
const MIN_AMOSTRAS_POR_DIA = 4;
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

const diaDaSemana = (dataISO: string): number => new Date(dataISO + 'T00:00:00Z').getUTCDay();

// Fator de cada dia da semana (0 = domingo) = média daquele dia ÷ média das 7 médias, então a
// média dos fatores é exatamente 1: o perfil só redistribui, não muda o nível. null = sem base.
export function fatoresDiaSemana(
  soma: (number | string)[] | null,
  primeiraVenda: string | null,
  hoje: string
): number[] | null {
  if (!soma || soma.length !== 7 || !primeiraVenda) return null;
  const desdePerfil = adicionarDias(hoje, -DIAS_PERFIL);
  const inicio = primeiraVenda > desdePerfil ? primeiraVenda : desdePerfil;
  const total = diasEntre(inicio, hoje);
  if (total < MIN_DIAS_PERFIL) return null;
  const contagem = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < total; i++) contagem[diaDaSemana(adicionarDias(inicio, i))]++;
  if (contagem.some((c) => c < MIN_AMOSTRAS_POR_DIA)) return null;
  const medias = contagem.map((c, d) => num(soma[d]) / c);
  const media = medias.reduce((a, b) => a + b, 0) / 7;
  return media > 0 ? medias.map((m) => m / media) : null;
}

// Soma dos fatores dos dias [de, ate). Sem fatores, cada dia vale 1.
function somaFatores(f: number[] | null, de: string, ate: string): number {
  const dias = Math.max(0, diasEntre(de, ate));
  if (!f) return dias;
  let t = 0;
  for (let i = 0; i < dias; i++) t += f[diaDaSemana(adicionarDias(de, i))];
  return t;
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
  const fatores = fatoresDiaSemana(linha.soma_por_dia_semana, linha.primeira_venda, hoje);
  const fator = (dataISO: string) => (fatores ? fatores[diaDaSemana(dataISO)] : 1);
  // Nível = média diária "de um dia comum": a janela é dividida pela soma dos fatores dos dias
  // que ela cobre (e não pelo número de dias), para uma janela com mais fins de semana não inflar.
  const nivelJanela = (() => {
    if (diasJanela === 0) return 0;
    const soma = somaFatores(fatores, adicionarDias(hoje, -diasJanela), hoje);
    return soma > 0 ? num(linha.soma_janela) / soma : 0;
  })();

  const diaAtual = fase === 'corrente' ? Number(hoje.slice(8, 10)) : 0;
  const diasRestantes = fase === 'corrente' ? diasNoMes - diaAtual : 0;

  let projecao: number | null;
  if (fase === 'corrente') {
    // Hoje conta pelo maior entre o que já vendeu e a média: dia parcial não derruba a
    // projeção, e dia que já passou da média não é jogado fora.
    const ateOntem = realizado - realizadoHoje;
    projecao = ateOntem + Math.max(realizadoHoje, nivelJanela * fator(hoje));
    for (let i = 1; i <= diasRestantes; i++) projecao += nivelJanela * fator(adicionarDias(hoje, i));
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
    const somaCompletos = somaFatores(fatores, inicio, hoje);
    const nivelMes = somaCompletos > 0 ? ateOntem / somaCompletos : 0;
    passoMes = ateOntem + Math.max(realizadoHoje, nivelMes * fator(hoje));
    for (let i = 1; i <= diasRestantes; i++) passoMes += nivelMes * fator(adicionarDias(hoje, i));
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
    usaDiaSemana: fase === 'corrente' && fatores !== null,
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

// ---------------------------------------------------------------------------
// Histórico (meses fechados). Mês corrente fica de fora: medição parcial não é resultado.
// ---------------------------------------------------------------------------

// Linha crua da RPC historico_metas. `mes` chega como 'YYYY-MM-01'.
export interface LinhaHistoricoCrua {
  franchise_id: string;
  franchise_nome: string;
  mes: string;
  meta: number | string | null;
  super_meta: number | string | null;
  realizado: number | string;
}

export interface CelulaHistorico {
  mes: string; // 'YYYY-MM'
  meta: number | null;
  superMeta: number | null;
  realizado: number;
  // realizado ÷ meta; null quando não havia meta no mês.
  razao: number | null;
  status: 'super' | 'meta' | 'abaixo' | 'sem_meta';
}

export interface LojaHistorico {
  franchiseId: string;
  nome: string;
  celulas: CelulaHistorico[];
  mesesComMeta: number;
  mesesBatidos: number;
}

export interface ResumoHistorico {
  meses: string[];
  lojas: LojaHistorico[];
  // Por mês: só as lojas que tinham meta naquele mês entram na conta.
  totais: CelulaHistorico[];
}

function celulaHistorico(mes: string, meta: number | null, superMeta: number | null, realizado: number): CelulaHistorico {
  if (meta === null || superMeta === null || meta <= 0) {
    return { mes, meta: null, superMeta: null, realizado, razao: null, status: 'sem_meta' };
  }
  const status = realizado >= superMeta ? 'super' : realizado >= meta ? 'meta' : 'abaixo';
  return { mes, meta, superMeta, realizado, razao: realizado / meta, status };
}

export function resumirHistorico(linhas: LinhaHistoricoCrua[]): ResumoHistorico {
  const meses = Array.from(new Set(linhas.map((l) => l.mes.slice(0, 7)))).sort();
  const porLoja = new Map<string, LojaHistorico>();

  linhas.forEach((l) => {
    const mes = l.mes.slice(0, 7);
    const meta = l.meta === null ? null : Number(l.meta);
    const superMeta = l.super_meta === null ? null : Number(l.super_meta);
    let loja = porLoja.get(l.franchise_id);
    if (!loja) {
      loja = { franchiseId: l.franchise_id, nome: l.franchise_nome, celulas: [], mesesComMeta: 0, mesesBatidos: 0 };
      porLoja.set(l.franchise_id, loja);
    }
    loja.celulas.push(celulaHistorico(mes, meta, superMeta, num(l.realizado)));
  });

  const lojas = Array.from(porLoja.values()).map((loja) => {
    const celulas = [...loja.celulas].sort((a, b) => a.mes.localeCompare(b.mes));
    return {
      ...loja,
      celulas,
      mesesComMeta: celulas.filter((c) => c.status !== 'sem_meta').length,
      mesesBatidos: celulas.filter((c) => c.status === 'meta' || c.status === 'super').length,
    };
  }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  const totais = meses.map((mes) => {
    const comMeta = lojas
      .map((l) => l.celulas.find((c) => c.mes === mes))
      .filter((c): c is CelulaHistorico => !!c && c.status !== 'sem_meta');
    return celulaHistorico(
      mes,
      comMeta.length ? comMeta.reduce((s, c) => s + (c.meta || 0), 0) : null,
      comMeta.length ? comMeta.reduce((s, c) => s + (c.superMeta || 0), 0) : null,
      comMeta.reduce((s, c) => s + c.realizado, 0)
    );
  });

  return { meses, lojas, totais };
}

// Resumo para o alerta do Dashboard: lojas com meta cuja projeção fica abaixo dela. Loja com
// pouco histórico fica fora da contagem (a projeção dela ainda não tem base para alarmar).
export function lojasAbaixoDaMeta(lojas: AcompanhamentoLoja[]): {
  abaixo: AcompanhamentoLoja[];
  comMeta: number;
  poucosDados: number;
} {
  const avaliaveis = lojas.filter((l) => l.fase === 'corrente' && l.status !== 'sem_meta');
  const confiaveis = avaliaveis.filter((l) => !l.estimativaFraca);
  return {
    abaixo: confiaveis.filter((l) => l.status === 'abaixo'),
    comMeta: confiaveis.length,
    poucosDados: avaliaveis.length - confiaveis.length,
  };
}
