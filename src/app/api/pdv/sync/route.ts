import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Inicializa o cliente forçando a utilização do SERVICE_ROLE_KEY
// ATENÇÃO: As chaves devem estar perfeitamente configuradas na Vercel
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Cria o cliente como "Admin" ignorando o RLS
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false
  }
});

export async function POST(request: Request) {
  try {
    // 1. Valida o Token do PDV Local (Segurança)
    const pdvToken = request.headers.get('x-pdv-token');
    
    // Tokens das franquias
    const TOKENS_FRANQUIAS: Record<string, string> = {
      'pdv_token_matriz_123': '11111111-1111-1111-1111-111111111111', 
      'pdv_token_ubatuba_456': '22222222-2222-2222-2222-222222222222', 
    };

    const franquiaId = pdvToken ? TOKENS_FRANQUIAS[pdvToken] : null;

    if (!franquiaId) {
      return NextResponse.json({ error: 'Acesso Negado: Token PDV inválido.' }, { status: 401 });
    }

    const fechamento = await request.json();

    // 2. Insere os dados como Administrador
    const { error } = await supabaseAdmin
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
      // Retorna o erro exato do banco de dados para o console
      throw new Error(error.message);
    }

    return NextResponse.json({ ok: true, message: 'Fechamento sincronizado!' });

  } catch (error: any) {
    console.error('Falha na rota /api/pdv/sync:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}