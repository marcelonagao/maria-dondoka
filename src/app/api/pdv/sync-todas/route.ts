import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getPerfilAutenticado } from '../../../../lib/server-auth';
import { LOJAS_DIRETAS, sincronizarLoja } from '../../../../lib/lojasDiretas';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
);

// Orçamento por loja. O plano Hobby da Vercel corta a função em 10s, e as 8 lojas rodam em
// paralelo — então cada uma tem ~7s antes de ser abortada. Loja que não responde a tempo
// não é falha: o script PHP continua rodando do lado dele e o dado entra pelo webhook
// alguns segundos depois. A resposta diferencia os dois casos pra UI não mentir.
const ORCAMENTO_MS = 7_000;

export async function POST(request: Request) {
  // Marco para a tela: loja só conta como atualizada se o último envio for posterior a isto.
  // Vem do servidor para não depender do relógio do navegador.
  const iniciadoEm = new Date().toISOString();
  const perfil = await getPerfilAutenticado();
  if (!perfil) return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 401 });
  if (perfil.escopo !== 'todas_franquias') {
    return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 403 });
  }

  const origin = new URL(request.url).origin;

  const { data: franquias, error } = await supabaseAdmin
    .from('franchises')
    .select('id, name, sync_url')
    .eq('is_active', true);
  if (error) {
    console.error('Erro ao listar franquias para sincronizar:', error);
    return NextResponse.json({ error: 'ERRO_INTERNO' }, { status: 500 });
  }

  // As 7 lojas do script PHP compartilham UMA URL (o script percorre todas). Chamada uma vez só
  // por clique, não uma por loja: 7 cópias do script em paralelo martelariam os 7 bancos.
  // A URL leva a chave do script, então fica em variável de ambiente, nunca na tabela
  // franchises (que o navegador do sócio lê).
  const loteUrl = process.env.PDV_SYNC_LOTE_URL;
  const disparos = new Map<string, Promise<{ status: 'sincronizada' | 'em_andamento' | 'falhou'; detalhe?: string }>>();
  const disparar = (url: string) => {
    let p = disparos.get(url);
    if (!p) {
      p = (async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), ORCAMENTO_MS);
        try {
          const res = await fetch(url, { signal: controller.signal });
          return res.ok
            ? { status: 'sincronizada' as const }
            : { status: 'falhou' as const, detalhe: `HTTP ${res.status}` };
        } catch (err: any) {
          // Abort é o caso normal de script lento, não erro — o PHP segue rodando lá.
          if (err?.name === 'AbortError') return { status: 'em_andamento' as const };
          console.error('Erro ao disparar script de sincronização:', err?.message);
          return { status: 'falhou' as const, detalhe: 'Não foi possível contatar o script da loja.' };
        } finally {
          clearTimeout(timeoutId);
        }
      })();
      disparos.set(url, p);
    }
    return p;
  };

  const tarefas = (franquias || []).map(async (franquia) => {
    const direta = LOJAS_DIRETAS.find((l) => l.franchiseId === franquia.id);

    if (direta) {
      try {
        const resultado = await sincronizarLoja(direta, origin);
        return { loja: franquia.name, status: 'sincronizada' as const, itens: resultado.itens };
      } catch (err: any) {
        console.error(`Erro ao sincronizar ${franquia.name}:`, err);
        return { loja: franquia.name, status: 'falhou' as const, detalhe: err?.message };
      }
    }

    const url = franquia.sync_url || loteUrl;
    if (!url) {
      return { loja: franquia.name, status: 'sem_url' as const };
    }
    return { loja: franquia.name, ...(await disparar(url)) };
  });

  const resultados = (await Promise.allSettled(tarefas)).map((r) =>
    r.status === 'fulfilled' ? r.value : { loja: '?', status: 'falhou' as const }
  );

  return NextResponse.json({ ok: true, iniciadoEm, resultados });
}

// Estado da sincronização para a tela acompanhar: último envio aceito pelo webhook de cada loja
// ativa (pdv_devices.last_sync_at, gravado a cada chamada aceita, mesmo vazia). Fica neste
// arquivo e não numa rota nova porque o plano Hobby da Vercel limita a 12 funções.
export async function GET() {
  const perfil = await getPerfilAutenticado();
  if (!perfil) return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 401 });
  if (perfil.escopo !== 'todas_franquias') {
    return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 403 });
  }

  const [franquias, dispositivos] = await Promise.all([
    supabaseAdmin.from('franchises').select('id, name').eq('is_active', true).order('name'),
    supabaseAdmin.from('pdv_devices').select('franchise_id, last_sync_at').eq('is_active', true),
  ]);
  if (franquias.error || dispositivos.error) {
    console.error('Erro ao ler estado da sincronização:', franquias.error || dispositivos.error);
    return NextResponse.json({ error: 'ERRO_INTERNO' }, { status: 500 });
  }

  // Uma franquia pode ter mais de um dispositivo ativo; vale o envio mais recente.
  const ultimo = new Map<string, string>();
  (dispositivos.data || []).forEach((d) => {
    if (!d.last_sync_at) return;
    const atual = ultimo.get(d.franchise_id);
    if (!atual || d.last_sync_at > atual) ultimo.set(d.franchise_id, d.last_sync_at);
  });

  return NextResponse.json({
    lojas: (franquias.data || []).map((f) => ({ id: f.id, nome: f.name, ultimoEnvio: ultimo.get(f.id) ?? null })),
  });
}
