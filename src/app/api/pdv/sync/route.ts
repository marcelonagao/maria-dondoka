import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

    // 🕵️ DETETIVE 1: Verifica se a chave existe e se tem o formato JWT correto
    if (!supabaseServiceKey) {
      return NextResponse.json({ error: 'CHAVE_AUSENTE', detalhe: 'A variável SUPABASE_SERVICE_ROLE_KEY não foi encontrada na Vercel.' }, { status: 500 });
    }
    if (!supabaseServiceKey.startsWith('eyJ')) {
      return NextResponse.json({ error: 'CHAVE_INVALIDA', detalhe: 'A chave configurada não é um JWT válido (não começa com eyJ).' }, { status: 500 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
    });

    const pdvToken = request.headers.get('x-pdv-token');
    const TOKENS_FRANQUIAS: Record<string, string> = {
      'pdv_token_matriz_123': '11111111-1111-1111-1111-111111111111', 
    };

    const franquiaId = pdvToken ? TOKENS_FRANQUIAS[pdvToken] : null;

    if (!franquiaId) {
      return NextResponse.json({ error: 'TOKEN_INVALIDO', detalhe: 'O x-pdv-token enviado não pertence a nenhuma loja.' }, { status: 401 });
    }

    const fechamento = await request.json();

    // 🕵️ DETETIVE 2: Tenta salvar no Supabase
    const { error, data } = await supabaseAdmin
      .from('fechamentos_caixa')
      .upsert({
        franchise_id: franquiaId,
        pdv_referencia_id: fechamento.id,
        data_fechamento: fechamento.data,
        valor_vendas_dinheiro: fechamento.dinheiro || 0,
        valor_vendas_cartao: fechamento.cartao || 0,
        valor_vendas_pix: fechamento.pix || 0,
        valor_esperado: fechamento.esperado || 0,
        valor_contado: fechamento.contado || 0,
        raw_payload: fechamento
      }, { onConflict: 'franchise_id, pdv_referencia_id' });

    if (error) {
      // Devolve o erro exato do banco de dados
      return NextResponse.json({ error: 'ERRO_BANCO_DE_DADOS', detalhe: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, message: 'Fechamento sincronizado com sucesso!' });

  } catch (error: any) {
    return NextResponse.json({ error: 'ERRO_DESCONHECIDO', detalhe: error.message }, { status: 500 });
  }
}