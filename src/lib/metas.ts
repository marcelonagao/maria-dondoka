import { adicionarDias, intervaloDoMes } from './date';

// Regra de negócio da tela /metas. Fica fora da tela para ser conferida sem navegador
// (ver scratch/conferir-metas.mjs). A tela só desenha o que estas funções decidiram.

// Linha crua devolvida pela RPC acompanhamento_metas. numeric pode chegar como string.
export interface LinhaMetaCrua {
  franchise_id: string;
  franchise_nome: string;
  meta: number | string | null;
  super_meta: number | string | null;
  // Opcional: banco anterior a docs/sql/metas-sonhos.sql não devolve a coluna.
  meta_sonhos?: number | string | null;
  realizado_mes: number | string;
  realizado_hoje: number | string;
  soma_janela: number | string;
  primeira_venda: string | null;
  // Vendas das 8 semanas anteriores a hoje, por dia da semana (índice 0 = domingo).
  soma_por_dia_semana: (number | string)[] | null;
  // Mesma janela: quantos dias de cada dia da semana tiveram venda. É o que diz se a loja abre
  // naquele dia. Opcional: banco anterior a docs/sql/metas-dias-abertos.sql não devolve.
  dias_com_venda_por_dia_semana?: (number | string)[] | null;
  // Ajuste do mês (0 = domingo): dias em que a loja abre. null/vazio = deduzir pelas vendas.
  dias_abertos?: (number | string)[] | null;
}

export type FaseMes = 'corrente' | 'fechado' | 'futuro';
export type StatusMeta = 'sonho' | 'super' | 'meta' | 'abaixo' | 'sem_meta' | 'sem_base' | 'futuro';

export interface AcompanhamentoLoja {
  franchiseId: string;
  nome: string;
  fase: FaseMes;
  meta: number | null;
  superMeta: number | null;
  // Terceiro alvo, opcional (≥ super meta). null = loja sem meta dos sonhos no mês.
  metaSonhos: number | null;
  realizado: number;
  // null em mês futuro (não há o que projetar).
  projecao: number | null;
  mediaDiaria: number;
  diasJanela: number;
  // Projeção apoiada em pouco histórico: aviso na tela, não bloqueio.
  estimativaFraca: boolean;
  diasRestantes: number;
  realizadoHoje: number;
  faltaMeta: number | null;
  faltaSuperMeta: number | null;
  faltaMetaSonhos: number | null;
  // Dias da semana em que a loja abre neste mês (0 = domingo) e de onde isso veio.
  diasAbertos: boolean[];
  // 'presumido' = algum dia da semana ainda não apareceu nas vendas (ou o banco não manda a
  // contagem) e foi contado como aberto sem medição.
  origemDiasAbertos: 'vendas' | 'ajuste' | 'presumido';
  hojeAberto: boolean;
  // Dia da semana de hoje (0 = domingo); null fora do mês corrente.
  hojeDiaSemana: number | null;
  // Dias abertos de hoje (inclusive) até o fim do mês. 0 fora do mês corrente.
  diasAbertosAteFim: number;
  // Plano do dia, calculado sobre o vendido ATÉ ONTEM, então não muda ao longo do dia:
  // (alvo − até ontem) × peso de hoje ÷ soma dos pesos de hoje ao fim do mês. 0 = hoje a loja não
  // abre. null = sem o alvo, alvo já batido até ontem, fora do mês corrente ou sem dia aberto.
  metaHojeMeta: number | null;
  metaHojeSuper: number | null;
  metaHojeSonhos: number | null;
  // O que falta agora ÷ dias abertos de hoje (se aberto) ao fim do mês. null = sem o alvo, alvo
  // batido, fora do mês corrente ou sem dia aberto.
  mediaDiaAbertoMeta: number | null;
  mediaDiaAbertoSuper: number | null;
  mediaDiaAbertoSonhos: number | null;
  // Realizado até ontem ÷ parte da meta esperada até ontem (pesada por dia da semana e dias
  // abertos). >1 = adiantado.
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
// Com menos dias completos que isso não há média: a "projeção" seria só o realizado do dia, e
// uma loja recém-aberta pareceria fechar o mês com o faturamento de um dia.
export const MIN_DIAS_PROJECAO = 3;
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
  const contagem = amostrasPorDiaSemana(primeiraVenda, hoje);
  if (contagem.some((c) => c < MIN_AMOSTRAS_POR_DIA)) return null;
  const medias = contagem.map((c, d) => num(soma[d]) / c);
  const media = medias.reduce((a, b) => a + b, 0) / 7;
  return media > 0 ? medias.map((m) => m / media) : null;
}

// Quantas vezes cada dia da semana apareceu entre a primeira venda (ou 8 semanas atrás) e ontem.
function amostrasPorDiaSemana(primeiraVenda: string, hoje: string): number[] {
  const desdePerfil = adicionarDias(hoje, -DIAS_PERFIL);
  const inicio = primeiraVenda > desdePerfil ? primeiraVenda : desdePerfil;
  const total = Math.max(0, diasEntre(inicio, hoje));
  const contagem = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < total; i++) contagem[diaDaSemana(adicionarDias(inicio, i))]++;
  return contagem;
}

const TODOS_ABERTOS = [true, true, true, true, true, true, true];

// Dia da semana aberto = teve venda em pelo menos metade das vezes que apareceu nas 8 semanas.
// Dia que ainda não apareceu (loja nova) conta como aberto: na dúvida, não se tira dia da conta.
// Sem a contagem (banco antigo), todos abertos — o comportamento de antes.
export function diasAbertosPelasVendas(
  diasComVenda: (number | string)[] | null | undefined,
  primeiraVenda: string | null,
  hoje: string
): boolean[] {
  if (!diasComVenda || diasComVenda.length !== 7 || !primeiraVenda) return TODOS_ABERTOS.slice();
  return amostrasPorDiaSemana(primeiraVenda, hoje).map((a, d) => a === 0 || num(diasComVenda[d]) * 2 >= a);
}

// true quando a dedução não mediu todos os dias da semana (loja nova ou banco sem a contagem).
export function diasAbertosPresumidos(
  diasComVenda: (number | string)[] | null | undefined,
  primeiraVenda: string | null,
  hoje: string
): boolean {
  if (!diasComVenda || diasComVenda.length !== 7 || !primeiraVenda) return true;
  return amostrasPorDiaSemana(primeiraVenda, hoje).some((a) => a === 0);
}

// Ajuste do mês gravado na meta. null quando não há ajuste válido (vale a dedução pelas vendas).
export function diasAbertosDoAjuste(v: (number | string)[] | null | undefined): boolean[] | null {
  if (!v || v.length === 0) return null;
  const abertos = [false, false, false, false, false, false, false];
  v.forEach((x) => {
    const d = Number(x);
    if (Number.isInteger(d) && d >= 0 && d <= 6) abertos[d] = true;
  });
  return abertos.some(Boolean) ? abertos : null;
}

export const NOMES_DIA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const NOMES_DIA_EXTENSO = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
export const nomeDiaSemana = (d: number): string => NOMES_DIA_EXTENSO[d];
// Semana começando na segunda, que é como a loja pensa ("seg a sáb").
export const ORDEM_SEMANA = [1, 2, 3, 4, 5, 6, 0];

// "todos os dias", "seg a sáb", "seg, qua, sex".
export function descreverDiasAbertos(abertos: boolean[]): string {
  const dias = ORDEM_SEMANA.filter((d) => abertos[d]);
  if (dias.length === 7) return 'todos os dias';
  if (dias.length === 0) return 'nenhum dia';
  const primeiro = ORDEM_SEMANA.indexOf(dias[0]);
  const continuo = dias.every((d, i) => ORDEM_SEMANA[primeiro + i] === d);
  if (continuo && dias.length >= 3) return `${NOMES_DIA[dias[0]]} a ${NOMES_DIA[dias[dias.length - 1]]}`;
  return dias.map((d) => NOMES_DIA[d]).join(', ');
}

// Soma dos pesos (por dia da semana) dos dias [de, ate).
function somaPesos(p: number[], de: string, ate: string): number {
  const dias = Math.max(0, diasEntre(de, ate));
  let t = 0;
  for (let i = 0; i < dias; i++) t += p[diaDaSemana(adicionarDias(de, i))];
  return t;
}

function contarAbertos(abertos: boolean[], de: string, ate: string): number {
  return somaPesos(abertos.map((a) => (a ? 1 : 0)), de, ate);
}

export function calcularLoja(linha: LinhaMetaCrua, mes: string, hoje: string): AcompanhamentoLoja {
  const { inicio, fim } = intervaloDoMes(mes);
  const fase: FaseMes = hoje > fim ? 'fechado' : hoje < inicio ? 'futuro' : 'corrente';
  const diasNoMes = Number(fim.slice(8, 10));

  const meta = linha.meta === null ? null : Number(linha.meta);
  const superMeta = linha.super_meta === null ? null : Number(linha.super_meta);
  const metaSonhos = linha.meta_sonhos === null || linha.meta_sonhos === undefined ? null : Number(linha.meta_sonhos);
  const realizado = num(linha.realizado_mes);
  const realizadoHoje = num(linha.realizado_hoje);

  // Janela: dias entre a primeira venda e hoje (hoje fora), no máximo 30. Dia sem linha na
  // tabela conta como zero, porque loja fechada também é parte do ritmo real.
  const diasJanela = linha.primeira_venda
    ? Math.max(0, Math.min(DIAS_JANELA, diasEntre(linha.primeira_venda, hoje)))
    : 0;
  const mediaDiaria = diasJanela > 0 ? num(linha.soma_janela) / diasJanela : 0;
  const fatores = fatoresDiaSemana(linha.soma_por_dia_semana, linha.primeira_venda, hoje);
  // Peso de cada dia da semana. Histórico: fator do perfil (ou 1, sem perfil) nos dias em que a
  // loja abriu, 0 nos que ficou fechada. Mês: o mesmo, com o ajuste do mês por cima — dia fechado
  // pelo ajuste vale 0; dia aberto pelo ajuste sem histórico (domingo de dezembro) vale um dia
  // aberto médio, porque o perfil não tem como saber quanto ele vende.
  const abertosVendas = diasAbertosPelasVendas(linha.dias_com_venda_por_dia_semana, linha.primeira_venda, hoje);
  const ajuste = diasAbertosDoAjuste(linha.dias_abertos);
  const diasAbertos = ajuste || abertosVendas;
  const pesoHist = abertosVendas.map((a, d) => (a ? (fatores ? fatores[d] : 1) : 0));
  const abertosHist = pesoHist.filter((_, d) => abertosVendas[d]);
  const pesoMedioAberto = abertosHist.length > 0 ? abertosHist.reduce((a, b) => a + b, 0) / abertosHist.length : 1;
  const pesoMes = diasAbertos.map((a, d) => (!a ? 0 : abertosVendas[d] ? pesoHist[d] : pesoMedioAberto));
  const peso = (dataISO: string) => pesoMes[diaDaSemana(dataISO)];
  // Nível = venda de "um dia comum": a janela é dividida pela soma dos pesos dos dias que ela
  // cobre (e não pelo número de dias), para uma janela com mais fins de semana não inflar e dia
  // fechado não puxar a média para baixo.
  const nivelJanela = (() => {
    if (diasJanela === 0) return 0;
    const soma = somaPesos(pesoHist, adicionarDias(hoje, -diasJanela), hoje);
    return soma > 0 ? num(linha.soma_janela) / soma : 0;
  })();

  const diaAtual = fase === 'corrente' ? Number(hoje.slice(8, 10)) : 0;
  const diasRestantes = fase === 'corrente' ? diasNoMes - diaAtual : 0;
  const amanha = adicionarDias(fim, 1);

  const semBase = fase === 'corrente' && diasJanela < MIN_DIAS_PROJECAO;

  const ateOntem = realizado - realizadoHoje;
  let projecao: number | null;
  if (semBase) {
    projecao = null;
  } else if (fase === 'corrente') {
    // Hoje conta pelo maior entre o que já vendeu e a média: dia parcial não derruba a
    // projeção, e dia que já passou da média não é jogado fora.
    projecao = ateOntem + Math.max(realizadoHoje, nivelJanela * peso(hoje));
    for (let i = 1; i <= diasRestantes; i++) projecao += nivelJanela * peso(adicionarDias(hoje, i));
  } else {
    projecao = fase === 'fechado' ? realizado : null;
  }

  const faltaMeta = meta === null ? null : Math.max(0, meta - realizado);
  const faltaSuperMeta = superMeta === null ? null : Math.max(0, superMeta - realizado);
  const faltaMetaSonhos = metaSonhos === null ? null : Math.max(0, metaSonhos - realizado);

  // Plano do dia: parte do que faltava ao abrir a loja hoje (até ontem), para o número não
  // mudar a cada venda. Dia de peso maior (sábado) recebe parte maior; dia fechado, nenhuma.
  const corrente = fase === 'corrente';
  const hojeAberto = corrente && pesoMes[diaDaSemana(hoje)] > 0;
  const diasAbertosAteFim = corrente ? contarAbertos(diasAbertos, hoje, amanha) : 0;
  const pesoAteFim = corrente ? somaPesos(pesoMes, hoje, amanha) : 0;
  const faltaAoAbrir = (alvo: number | null): number | null =>
    !corrente || alvo === null || alvo - ateOntem <= 0 || pesoAteFim <= 0 ? null : alvo - ateOntem;
  const metaHoje = (alvo: number | null): number | null => {
    const f = faltaAoAbrir(alvo);
    return f === null ? null : (f * peso(hoje)) / pesoAteFim;
  };
  // A média divide o que falta AGORA (o mesmo número da linha "Faltam"), para as duas fecharem.
  const mediaDiaAberto = (falta: number | null): number | null =>
    !corrente || falta === null || falta <= 0 || diasAbertosAteFim === 0 ? null : falta / diasAbertosAteFim;

  // Esperado até ontem = meta × peso dos dias completos ÷ peso do mês inteiro: um começo de mês
  // com mais domingos fechados não parece atraso.
  let ritmo: number | null = null;
  if (corrente && meta !== null && diaAtual > 1) {
    const pesoTotal = somaPesos(pesoMes, inicio, amanha);
    const esperado = pesoTotal > 0 ? (meta * somaPesos(pesoMes, inicio, hoje)) / pesoTotal : 0;
    ritmo = esperado > 0 ? ateOntem / esperado : null;
  }

  // Precisa de alguns dias completos no mês, senão um dia isolado vira "passo".
  let passoMes: number | null = null;
  if (corrente && diaAtual > MIN_DIAS_PASSO) {
    const somaCompletos = somaPesos(pesoMes, inicio, hoje);
    const nivelMes = somaCompletos > 0 ? ateOntem / somaCompletos : 0;
    passoMes = ateOntem + Math.max(realizadoHoje, nivelMes * peso(hoje));
    for (let i = 1; i <= diasRestantes; i++) passoMes += nivelMes * peso(adicionarDias(hoje, i));
  }
  const maior = Math.max(projecao || 0, passoMes || 0);
  const projecoesDivergem =
    projecao !== null && passoMes !== null && maior > 0 && Math.abs(projecao - passoMes) / maior > LIMITE_DIVERGENCIA;

  // Mês fechado julga pelo realizado; mês corrente, pela projeção. Projeção igual à meta
  // conta como meta batida.
  const base = fase === 'fechado' ? realizado : projecao;
  let status: StatusMeta;
  if (meta === null || superMeta === null) status = 'sem_meta';
  else if (semBase) status = 'sem_base';
  else if (base === null) status = 'futuro';
  else if (metaSonhos !== null && base >= metaSonhos) status = 'sonho';
  else if (base >= superMeta) status = 'super';
  else if (base >= meta) status = 'meta';
  else status = 'abaixo';

  return {
    franchiseId: linha.franchise_id,
    nome: linha.franchise_nome,
    fase,
    meta,
    superMeta,
    metaSonhos,
    realizado,
    projecao,
    mediaDiaria,
    diasJanela,
    estimativaFraca: fase === 'corrente' && diasJanela < MIN_DIAS_ESTIMATIVA,
    diasRestantes,
    realizadoHoje,
    faltaMeta,
    faltaSuperMeta,
    faltaMetaSonhos,
    diasAbertos,
    origemDiasAbertos: ajuste
      ? 'ajuste'
      : diasAbertosPresumidos(linha.dias_com_venda_por_dia_semana, linha.primeira_venda, hoje)
        ? 'presumido'
        : 'vendas',
    hojeAberto,
    hojeDiaSemana: corrente ? diaDaSemana(hoje) : null,
    diasAbertosAteFim,
    metaHojeMeta: metaHoje(meta),
    metaHojeSuper: metaHoje(superMeta),
    metaHojeSonhos: metaHoje(metaSonhos),
    mediaDiaAbertoMeta: mediaDiaAberto(faltaMeta),
    mediaDiaAbertoSuper: mediaDiaAberto(faltaSuperMeta),
    mediaDiaAbertoSonhos: mediaDiaAberto(faltaMetaSonhos),
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
  // Meta só das lojas que entram na projeção: é contra ela que a projeção se compara.
  metaDaProjecao: number;
  lojasSemProjecao: number;
  meta: number;
  superMeta: number;
  // Só das lojas que têm meta dos sonhos (é opcional): a tela diz "em N de M lojas" quando parcial.
  metaSonhos: number;
  lojasComSonhos: number;
  lojasBatendoMeta: number;
}

export function consolidar(lojas: AcompanhamentoLoja[]): ConsolidadoMetas {
  const comMeta = lojas.filter((l) => l.meta !== null && l.superMeta !== null);
  // Loja sem projeção (recém-aberta) sai da soma da projeção E da meta usada para compará-la,
  // senão a projeção do grupo apareceria artificialmente baixa.
  const comProjecao = comMeta.filter((l) => l.projecao !== null);
  return {
    realizadoGeral: lojas.reduce((s, l) => s + l.realizado, 0),
    lojasComMeta: comMeta.length,
    lojasSemMeta: lojas.length - comMeta.length,
    realizado: comMeta.reduce((s, l) => s + l.realizado, 0),
    projecao: comProjecao.length === 0 ? null : comProjecao.reduce((s, l) => s + (l.projecao || 0), 0),
    metaDaProjecao: comProjecao.reduce((s, l) => s + (l.meta || 0), 0),
    lojasSemProjecao: comMeta.length - comProjecao.length,
    meta: comMeta.reduce((s, l) => s + (l.meta || 0), 0),
    superMeta: comMeta.reduce((s, l) => s + (l.superMeta || 0), 0),
    metaSonhos: comMeta.reduce((s, l) => s + (l.metaSonhos || 0), 0),
    lojasComSonhos: comMeta.filter((l) => l.metaSonhos !== null).length,
    lojasBatendoMeta: comMeta.filter((l) => l.status === 'meta' || l.status === 'super' || l.status === 'sonho').length,
  };
}

export type Medalha = 'ouro' | 'prata' | 'bronze';

export interface LojaRanqueada {
  loja: AcompanhamentoLoja;
  // 1 = mais perto da meta. null = fora do ranking (sem meta ou sem projeção).
  posicao: number | null;
  medalha: Medalha | null;
}

const MEDALHAS: Medalha[] = ['ouro', 'prata', 'bronze'];

// Ranking de quem está mais perto da meta: projeção ÷ meta (mês fechado: realizado ÷ meta), maior
// primeiro. A razão é sobre a meta, não sobre a super ou a dos sonhos: é o único alvo que toda loja
// com meta tem, então as lojas ficam comparáveis. Loja com estimativa fraca entra (o card avisa).
const baseDoRanking = (l: AcompanhamentoLoja) => (l.fase === 'fechado' ? l.realizado : l.projecao);
const avaliavelNoRanking = (l: AcompanhamentoLoja) =>
  l.meta !== null && l.meta > 0 && l.superMeta !== null && l.status !== 'sem_base' && baseDoRanking(l) !== null;

export function ranquearLojas(lojas: AcompanhamentoLoja[]): LojaRanqueada[] {
  const razao = (l: AcompanhamentoLoja) => (baseDoRanking(l) as number) / (l.meta as number);
  const porNome = (a: AcompanhamentoLoja, b: AcompanhamentoLoja) => a.nome.localeCompare(b.nome, 'pt-BR');

  const noRanking = lojas.filter(avaliavelNoRanking).sort((a, b) => razao(b) - razao(a) || porNome(a, b));
  const fora = lojas.filter((l) => !avaliavelNoRanking(l)).sort(porNome);
  // Uma loja só (gerente vê a própria) não tem com quem disputar: "1º" e ouro seriam mérito falso.
  if (noRanking.length < 2) {
    return [...noRanking, ...fora].map((loja) => ({ loja, posicao: null, medalha: null }));
  }
  return [
    ...noRanking.map((loja, i) => ({ loja, posicao: i + 1, medalha: MEDALHAS[i] ?? null })),
    ...fora.map((loja) => ({ loja, posicao: null, medalha: null })),
  ];
}

export interface RaiaCorrida {
  franchiseId: string;
  nome: string;
  posicao: number | null;
  medalha: Medalha | null;
  status: StatusMeta;
  fase: FaseMes;
  // base ÷ meta, sem teto (é o número escrito). null = fora do ranking (sem meta ou sem projeção).
  razao: number | null;
  // R$ da base (projeção; mês fechado: realizado), para o rótulo.
  base: number | null;
  // Posições 0..100 na escala comum da pista. Tudo é relativo à meta da própria loja.
  pctRealizado: number;
  pctBase: number | null;
  pctSuper: number | null;
  pctSonhos: number | null;
  // Base além do teto: a raia encosta no fim e a tela avisa; a razão escrita continua real.
  passouDoTeto: boolean;
  // Alvos que existem mas não cabem na escala: a tela diz em vez de sumir com a marca.
  alvosForaDaEscala: ('super' | 'sonhos')[];
}

export interface Corrida {
  // Fim da pista em múltiplos da meta (1,5 = 150% da meta).
  escala: number;
  // Linha de chegada (a meta) em 0..100 — a mesma coluna em todas as raias.
  pctChegada: number;
  raias: RaiaCorrida[];
  // Lojas com pista (meta e base). Com menos de 2 não há corrida: a tela não mostra a seção.
  emDisputa: number;
}

const ESCALA_MIN = 1.1;
const ESCALA_TETO = 2;

// Pista do ranking: tudo em % da meta de cada loja, não em R$. O ranking é por base ÷ meta; em R$
// a loja grande pareceria na frente da pequena que está mais perto da meta, e a pista contradiria
// a ordem. Escala comum, com teto, para uma loja muito acima não espremer as outras.
export function montarCorrida(ranking: LojaRanqueada[]): Corrida {
  const razoes: number[] = [];
  for (const { loja } of ranking) {
    if (!avaliavelNoRanking(loja)) continue;
    const meta = loja.meta as number;
    razoes.push((baseDoRanking(loja) as number) / meta, (loja.superMeta as number) / meta);
    if (loja.metaSonhos !== null) razoes.push(loja.metaSonhos / meta);
  }
  const maior = razoes.length > 0 ? Math.max(...razoes) : 0;
  const escala = Math.min(ESCALA_TETO, Math.max(ESCALA_MIN, maior * 1.05));
  const pct = (r: number) => Math.min(100, Math.max(0, (r / escala) * 100));

  const raias = ranking.map(({ loja, posicao, medalha }): RaiaCorrida => {
    const comum = {
      franchiseId: loja.franchiseId, nome: loja.nome, posicao, medalha, status: loja.status, fase: loja.fase,
    };
    if (!avaliavelNoRanking(loja)) {
      return {
        ...comum, razao: null, base: baseDoRanking(loja), pctRealizado: 0, pctBase: null,
        pctSuper: null, pctSonhos: null, passouDoTeto: false, alvosForaDaEscala: [],
      };
    }
    const meta = loja.meta as number;
    const base = baseDoRanking(loja) as number;
    const razao = base / meta;
    const rSuper = (loja.superMeta as number) / meta;
    const rSonhos = loja.metaSonhos !== null ? loja.metaSonhos / meta : null;
    const alvosForaDaEscala: ('super' | 'sonhos')[] = [];
    if (rSuper > escala) alvosForaDaEscala.push('super');
    if (rSonhos !== null && rSonhos > escala) alvosForaDaEscala.push('sonhos');
    return {
      ...comum,
      razao,
      base,
      pctRealizado: pct(loja.realizado / meta),
      pctBase: pct(razao),
      pctSuper: rSuper > escala ? null : pct(rSuper),
      pctSonhos: rSonhos === null || rSonhos > escala ? null : pct(rSonhos),
      passouDoTeto: razao > escala,
      alvosForaDaEscala,
    };
  });

  return { escala, pctChegada: pct(1), raias, emDisputa: raias.filter((r) => r.razao !== null).length };
}

export function formatarMoeda(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

export function formatarPercentual(razao: number): string {
  const p = Math.round(razao * 100);
  // 99,6% arredondado viraria "100%" numa loja abaixo da meta, ao lado de outra que bateu.
  return razao < 1 && p >= 100 ? '99%' : `${p}%`;
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
