import { NextResponse } from 'next/server';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { createHmac, timingSafeEqual } from 'crypto';
import { FORMAS_PAGAMENTO } from '../../../../lib/formasPagamento';

interface LojaDireta {
  nome: string;
  dbHost?: string;
  dbUser?: string;
  dbPass?: string;
  dbName?: string;
  pdvToken?: string;
  pdvSecret?: string;
}

const LOJAS_DIRETAS: LojaDireta[] = [
  {
    nome: 'Loja1-Caraguatatuba',
    dbHost: process.env.LOJA1_DB_HOST,
    dbUser: process.env.LOJA1_DB_USER,
    dbPass: process.env.LOJA1_DB_PASS,
    dbName: process.env.LOJA1_DB_NAME,
    pdvToken: process.env.LOJA1_PDV_TOKEN,
    pdvSecret: process.env.LOJA1_PDV_SECRET,
  },
  {
    nome: 'Loja4-Jacarei',
    dbHost: process.env.LOJA4_DB_HOST,
    dbUser: process.env.LOJA4_DB_USER,
    dbPass: process.env.LOJA4_DB_PASS,
    dbName: process.env.LOJA4_DB_NAME,
    pdvToken: process.env.LOJA4_PDV_TOKEN,
    pdvSecret: process.env.LOJA4_PDV_SECRET,
  },
];

// Mapeamento de `conta` documentado em docs/pdv-sync-vendas-itens.md (tabela `conta`
// do A7 Pharma, confirmado em produção) — mesmo mapeamento que o script PHP usa.
const CONTA_PARA_FORMA_PAGAMENTO: Record<number, (typeof FORMAS_PAGAMENTO)[number]> = {
  1: 'dinheiro',
  8: 'cartao_debito',
  9: 'cartao_credito',
  10: 'venda_internet',
  11: 'deposito',
  12: 'pix',
};

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

interface ItemRow extends RowDataPacket {
  auto: number;
  venda_referencia: string | null;
  produto_codigo_pdv: string;
  produto_sku: string | null;
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

function safeCompare(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

async function sincronizarLoja(loja: LojaDireta, origin: string) {
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
        forma_pagamento: CONTA_PARA_FORMA_PAGAMENTO[Number(r.conta)],
        valor: Number(r.total),
      }))
      .filter((f): f is { usuario: string; forma_pagamento: (typeof FORMAS_PAGAMENTO)[number]; valor: number } => f.forma_pagamento !== undefined);

    const [retiradasRows] = await conexao.query<RetiradaRow[]>(
      `SELECT auto, valor, historico, usuario
       FROM movimento
       WHERE data = CURDATE() AND es = 'S' AND conta = 1`
    );
    const retiradas = retiradasRows.map((r) => ({
      origem_id: String(r.auto),
      valor: Number(r.valor),
      motivo: r.historico || 'Sangria',
      usuario: String(r.usuario),
    }));

    const [itensRows] = await conexao.query<ItemRow[]>(
      `SELECT
         mp.auto,
         SUBSTRING_INDEX(SUBSTRING_INDEX(mp.historico, 'vd:', -1), ' ', 1) AS venda_referencia,
         mp.produto AS produto_codigo_pdv,
         p.referencia AS produto_sku,
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
       WHERE mp.es = 'S'
         AND mp.historico LIKE 'Saida vd:%'
         AND (mp.cancelado IS NULL OR mp.cancelado = 0)
         AND mp.data = CURDATE()`
    );
    const itens = itensRows.map((item) => ({
      venda_referencia: String(item.venda_referencia ?? item.auto),
      produto_codigo_pdv: String(item.produto_codigo_pdv),
      produto_sku: item.produto_sku,
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

    const payload = { data: hoje, formas, retiradas, itens };
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

    return { data: hoje, formas: formas.length, retiradas: retiradas.length, itens: itens.length };
  } finally {
    await conexao.end();
  }
}

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') || '';
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeCompare(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 401 });
  }

  const origin = new URL(request.url).origin;

  const resultados = await Promise.allSettled(LOJAS_DIRETAS.map((loja) => sincronizarLoja(loja, origin)));

  const relatorio = LOJAS_DIRETAS.map((loja, i) => {
    const resultado = resultados[i];
    if (resultado.status === 'fulfilled') {
      return { loja: loja.nome, ok: true, ...resultado.value };
    }
    const mensagem = resultado.reason instanceof Error ? resultado.reason.message : String(resultado.reason);
    console.error(`[sync-lojas-diretas] falha em ${loja.nome}:`, mensagem);
    return { loja: loja.nome, ok: false, erro: mensagem };
  });

  return NextResponse.json({ ok: true, resultados: relatorio });
}
