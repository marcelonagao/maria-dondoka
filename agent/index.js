import 'dotenv/config';
import mysql from 'mysql2/promise';
import { createHmac } from 'crypto';
import cron from 'node-cron';

const {
  MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE,
  WEBHOOK_URL, PDV_TOKEN, PDV_SECRET, SYNC_INTERVAL_CRON,
} = process.env;

function sign(body, timestamp) {
  return createHmac('sha256', PDV_SECRET).update(`${timestamp}.${body}`).digest('hex');
}

async function sendFechamento(fechamento) {
  const body = JSON.stringify(fechamento);
  const timestamp = Date.now().toString();

  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-pdv-token': PDV_TOKEN,
      'x-pdv-signature': sign(body, timestamp),
      'x-pdv-timestamp': timestamp,
    },
    body,
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Webhook retornou ${res.status}: ${errBody}`);
  }
  return res.json();
}

async function syncPendentes() {
  const conn = await mysql.createConnection({
    host: MYSQL_HOST, user: MYSQL_USER, password: MYSQL_PASSWORD, database: MYSQL_DATABASE,
  });

  try {
    // Ajuste esta query para o schema real do seu PDV.
    // A ideia: só pegar fechamentos ainda não marcados como enviados.
    const [rows] = await conn.execute(
      `SELECT id, data_fechamento AS data, valor_dinheiro AS dinheiro,
              valor_cartao AS cartao, valor_pix AS pix,
              valor_esperado AS esperado, valor_contado AS contado
       FROM fechamentos_caixa
       WHERE sincronizado = 0
       ORDER BY data_fechamento ASC
       LIMIT 50`
    );

    console.log(`[${new Date().toISOString()}] ${rows.length} fechamento(s) pendente(s)`);

    for (const row of rows) {
      try {
        await sendFechamento(row);
        await conn.execute('UPDATE fechamentos_caixa SET sincronizado = 1 WHERE id = ?', [row.id]);
        console.log(`  ✓ enviado: ${row.id}`);
      } catch (err) {
        // Não marca como sincronizado — o upsert do servidor garante idempotência,
        // então é seguro tentar de novo no próximo ciclo.
        console.error(`  ✗ falhou: ${row.id} — ${err.message}`);
      }
    }
  } finally {
    await conn.end();
  }
}

console.log(`Agente PDV iniciado. Agenda: ${SYNC_INTERVAL_CRON}`);
cron.schedule(SYNC_INTERVAL_CRON, () => {
  syncPendentes().catch((err) => console.error('Erro no ciclo de sync:', err));
});

syncPendentes().catch((err) => console.error('Erro no ciclo inicial:', err));