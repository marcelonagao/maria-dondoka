import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { LOJAS_DIRETAS, sincronizarLoja } from '../../../../lib/lojasDiretas';

function safeCompare(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
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
