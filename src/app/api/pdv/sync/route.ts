import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// ATENÇÃO: Como o agente da loja física não faz login com e-mail e senha (não tem sessão),
// nós precisamos usar a SERVICE_ROLE_KEY. Ela funciona como um acesso "Admin" no Supabase,
// permitindo gravar o dado ignorando o RLS. A segurança é feita pelo nosso token abaixo.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false }
});

export async function POST(request: Request) {
  try {
    // 1. Valida o Token de Segurança (Autenticação do Agente)
    const pdvToken = request.headers.get('x-pdv-token');
    
    // Simulação de banco de tokens (Em produção, você consultaria o banco de dados)
    const TOKENS_FRANQUIAS: Record<string, string> = {
      'pdv_token_matriz_123': '11111111-1111-1111-1111-111111111111', // ID da Loja 01
      'pdv_token_ubatuba_456': '22222222-2222-2222-2222-222222222222', // ID da Loja 02
    };

    const franquiaId = pdvToken ? TOKENS_FRANQUIAS[pdvToken] : null;

    if (!franquiaId) {
      return NextResponse.json({ error: 'Acesso Negado: Token PDV inválido.' }, { status: 401 });
    }

    // 2. Recebe os dados do script da loja
    const fechamento = await request.json();

    // 3. Upsert Idempotente no Supabase
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
      }, { onConflict: 'franchise_id, pdv_referencia_id' }); // <== O truque de mestre aqui

    if (error) throw error;

    return NextResponse.json({ ok: true, message: 'Fechamento sincronizado com sucesso!' });

  } catch (error: any) {
    console.error('Erro na sincronização do PDV:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}