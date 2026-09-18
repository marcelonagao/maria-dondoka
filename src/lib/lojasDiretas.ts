import mysql, { type RowDataPacket } from 'mysql2/promise';
import { createHmac } from 'crypto';
import { FORMAS_PAGAMENTO } from './formasPagamento';

type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number];

export interface LojaDireta {
  nome: string;
  franchiseId?: string;
  dbHost?: string;
  dbUser?: string;
  dbPass?: string;
  dbName?: string;
  pdvToken?: string;
  pdvSecret?: string;
  // Mapeamento de `conta` NÃO é igual entre lojas — confirmado com a tabela `conta` real
  // de cada uma (Loja4 tem 8/9 e 10/12 invertidos em relação a Loja1). Cada loja carrega
  // o seu próprio, nunca uma constante global.
  mapaContaForma: Record<number, FormaPagamento>;
}

// Lojas sem barreira de IP (ver docs/pdv-sync-vendas-itens.md) — sincronizadas direto por
// nós (cron + botão "Sincronizar agora"), sem o script PHP que as outras franquias usam.
export const LOJAS_DIRETAS: LojaDireta[] = [
  {
    nome: 'Loja1-Caraguatatuba',
    franchiseId: process.env.LOJA1_FRANCHISE_ID,
    dbHost: process.env.LOJA1_DB_HOST,
    dbUser: process.env.LOJA1_DB_USER,
    dbPass: process.env.LOJA1_DB_PASS,
    dbName: process.env.LOJA1_DB_NAME,
    pdvToken: process.env.LOJA1_PDV_TOKEN,
    pdvSecret: process.env.LOJA1_PDV_SECRET,
    mapaContaForma: {
      1: 'dinheiro',
      8: 'cartao_debito',
      9: 'cartao_credito',
      10: 'venda_internet',
      11: 'deposito',
      12: 'pix',
    },
  },
  {
    nome: 'Loja4-Jacarei',
    franchiseId: process.env.LOJA4_FRANCHISE_ID,
    dbHost: process.env.LOJA4_DB_HOST,
    dbUser: process.env.LOJA4_DB_USER,
    dbPass: process.env.LOJA4_DB_PASS,
    dbName: process.env.LOJA4_DB_NAME,
    pdvToken: process.env.LOJA4_PDV_TOKEN,
    pdvSecret: process.env.LOJA4_PDV_SECRET,
    mapaContaForma: {
      1: 'dinheiro',
      8: 'cartao_credito',
      9: 'cartao_debito',
      10: 'pix',
      11: 'deposito',
      12: 'venda_internet',
    },
  },
];

interface FormaRow extends RowDataPacket {
  usuario: string;
  conta: number;
  total: string | number;
}

interface RetiradaRow extends RowDataPacket {
  auto: number;
  valor: string | number;
  historico: string | null;
  usuario: string;
}

interface TransacaoRow extends RowDataPacket {
  auto: number;
  conta: number;
  valor: string | number;
  usuario: string;
  historico: string | null;
}

interface ItemRow extends RowDataPacket {
  auto: number;
  venda_referencia: string | null;
  produto_codigo_pdv: string;
  produto_sku: string | null;
  produto_nome: string | null;
  produto_linha: string | null;
  marca: string | null;
  quantidade: string | number;
  valor_unitario: string | number;
  valor_total: string | number;
  custo_unitario: string | number;
  aliquota_icm: string | number | null;
  usuario: string | null;
  vendedor: string | null;
}

interface HojeRow extends RowDataPacket {
  hoje: string;
}

export async function sincronizarLoja(loja: LojaDireta, origin: string) {
  if (!loja.dbHost || !loja.dbUser || !loja.dbPass || !loja.dbName || !loja.pdvToken || !loja.pdvSecret) {
    throw new Error('Variáveis de ambiente ausentes para esta loja');
  }

  const conexao = await mysql.createConnection({
    host: loja.dbHost,
    user: loja.dbUser,
    password: loja.dbPass,
    database: loja.dbName,
    connectTimeout: 10_000,
    // Datas como string ('YYYY-MM-DD'), não Date do JS — evita qualquer conversão de
    // fuso entre o servidor MySQL da loja e a função serverless (que roda em UTC).
    dateStrings: true,
  });

  try {
    // Data "de verdade" vem do próprio MySQL da loja, não de `new Date()` aqui — garante
    // que o campo `data` do payload bate exatamente com o CURDATE() usado nas 3 queries
    // abaixo, mesmo que o fuso do servidor da loja seja diferente do da função serverless.
    const [[{ hoje }]] = await conexao.query<HojeRow[]>('SELECT CURDATE() AS hoje');

    const [formasRows] = await conexao.query<FormaRow[]>(
      `SELECT usuario, conta, COALESCE(SUM(valor), 0) AS total
       FROM movimento
       WHERE data = CURDATE() AND es = 'E'
       GROUP BY usuario, conta`
    );
    const formas = formasRows
      .map((r) => ({
        usuario: String(r.usuario),
        forma_pagamento: loja.mapaContaForma[Number(r.conta)],
        valor: Number(r.total),
      }))
      .filter((f): f is { usuario: string; forma_pagamento: FormaPagamento; valor: number } => f.forma_pagamento !== undefined);

    const [retiradasRows] = await conexao.query<RetiradaRow[]>(
      `SELECT auto, valor, historico, usuario
       FROM movimento
       WHERE data = CURDATE() AND es = 'S' AND conta = 1`
    );
    const retiradas = retiradasRows.map((r) => ({
      origem_id: String(r.auto),
      // `movimento` grava saída de caixa (es='S') com valor negativo — o schema de
      // /api/pdv/sync exige positive(), então sem abs() aqui QUALQUER retirada negativa
      // rejeita o payload inteiro (formas + retiradas + itens juntos, é uma validação só).
      valor: Math.abs(Number(r.valor)),
      motivo: r.historico || 'Sangria',
      usuario: String(r.usuario),
    }));

    // Transações individuais das formas não-dinheiro (cartão/pix/etc) — mesmos contas do
    // mapaContaForma da loja, exceto 1 (dinheiro, que só existe agregado em `formas`).
    // Usadas na conciliação linha a linha em /vendas, separado do total agregado.
    const [transacoesRows] = await conexao.query<TransacaoRow[]>(
      `SELECT auto, conta, valor, usuario, historico
       FROM movimento
       WHERE data = CURDATE() AND es = 'E' AND conta IN (8, 9, 10, 11, 12)
       ORDER BY conta, auto`
    );
    const transacoes = transacoesRows
      .map((r) => ({
        usuario: String(r.usuario),
        forma_pagamento: loja.mapaContaForma[Number(r.conta)],
        valor: Number(r.valor),
        origem_id: String(r.auto),
        historico: r.historico,
      }))
      .filter(
        (t): t is { usuario: string; forma_pagamento: FormaPagamento; valor: number; origem_id: string; historico: string | null } =>
          t.forma_pagamento !== undefined
      );

    // `produtos.descrição` (COM acento/cedilha no nome da coluna, por isso a crase escapada)
    // é o nome real do produto. Existe também uma `descricao` sem acento na mesma tabela —
    // essa fica como '*' em parte das linhas, não usar, apesar do nome mais "limpo"
    // (confirmado com SHOW COLUMNS + amostra em Loja1 e Loja4, 2026-09-15).
    //
    // A categoria vem de `linhas` (36 registros: MAQUIAGEM, PERFUMES, ESMALTES...), via
    // `produtos.linha`, que está preenchido em 100% do catálogo. Existe um `produtos.nomelinha`
    // já desnormalizado, mas ele só tem valor em 85% das linhas — por isso o join.
    //
    // Guardamos o NOME, não o id: cada franquia tem seu MySQL com auto_increment próprio, e
    // o id 156 que é MAQUIAGEM aqui não é garantia de ser MAQUIAGEM em outra loja. Consolidar
    // as 8 por id misturaria categoria silenciosamente (SHOW COLUMNS em Loja4, 2026-09-16).
    //
    // Dois prefixos de histórico são venda real: "Saida vd:9279 ..." e
    // "sd ins:Saida vd:9279 ..." — a MESMA venda, com parte dos itens gravados com o prefixo
    // extra. Filtrando só o primeiro, o sync perdia ~40% dos itens na Loja4 e 16–72% nas
    // outras, e o faturamento do dashboard ficava abaixo do caixa. Confirmado venda a venda em
    // 17/09/2026: com os dois prefixos, 230 de 230 vendas fecham com `movimento`.
    // A extração de venda_referencia (depois do último 'vd:') já funciona para os dois.
    const [itensRows] = await conexao.query<ItemRow[]>(
      `SELECT
         mp.auto,
         SUBSTRING_INDEX(SUBSTRING_INDEX(mp.historico, 'vd:', -1), ' ', 1) AS venda_referencia,
         mp.produto AS produto_codigo_pdv,
         p.referencia AS produto_sku,
         p.\`descrição\` AS produto_nome,
         l.\`descrição\` AS produto_linha,
         mp.marca,
         mp.qtd AS quantidade,
         mp.unitario AS valor_unitario,
         mp.vlr_total AS valor_total,
         mp.custo AS custo_unitario,
         p.icm AS aliquota_icm,
         mp.usuario,
         mp.vendedor
       FROM movprods mp
       LEFT JOIN produtos p ON p.codigo = mp.produto
       LEFT JOIN linhas l ON l.linha = p.linha
       WHERE mp.es = 'S'
         AND (mp.historico LIKE 'Saida vd:%' OR mp.historico LIKE 'sd ins:Saida vd:%')
         AND (mp.cancelado IS NULL OR mp.cancelado = 0)
         AND mp.data = CURDATE()`
    );
    const itens = itensRows.map((item) => ({
      venda_referencia: String(item.venda_referencia ?? item.auto),
      produto_codigo_pdv: String(item.produto_codigo_pdv),
      produto_sku: item.produto_sku,
      produto_nome: item.produto_nome,
      produto_linha: item.produto_linha,
      marca: item.marca,
      quantidade: Number(item.quantidade),
      valor_unitario: Number(item.valor_unitario),
      valor_total: Number(item.valor_total),
      custo_unitario: Number(item.custo_unitario),
      aliquota_icm: item.aliquota_icm !== null ? Number(item.aliquota_icm) : null,
      usuario: item.usuario,
      vendedor: item.vendedor,
      origem_id: String(item.auto),
    }));

    const payload = { data: hoje, formas, retiradas, transacoes, itens };
    const body = JSON.stringify(payload);
    const timestamp = Date.now().toString();
    const signature = createHmac('sha256', loja.pdvSecret).update(`${timestamp}.${body}`).digest('hex');

    const res = await fetch(`${origin}/api/pdv/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-pdv-token': loja.pdvToken,
        'x-pdv-signature': signature,
        'x-pdv-timestamp': timestamp,
      },
      body,
    });

    const respostaTexto = await res.text();
    if (!res.ok) throw new Error(`/api/pdv/sync retornou ${res.status}: ${respostaTexto}`);

    return { data: hoje, formas: formas.length, retiradas: retiradas.length, transacoes: transacoes.length, itens: itens.length };
  } finally {
    await conexao.end();
  }
}
