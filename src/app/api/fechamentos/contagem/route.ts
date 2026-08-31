import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getPerfilAutenticado } from '../../../../lib/server-auth';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
);

function somarReconciliado(fechamentos: { valor_vendas_dinheiro: number; valor_vendas_cartao: number; valor_vendas_pix: number }[]) {
  return fechamentos.reduce(
    (acc, f) => ({
      dinheiro: acc.dinheiro + Number(f.valor_vendas_dinheiro || 0),
      cartao: acc.cartao + Number(f.valor_vendas_cartao || 0),
      pix: acc.pix + Number(f.valor_vendas_pix || 0),
    }),
    { dinheiro: 0, cartao: 0, pix: 0 }
  );
}

// Sangria/suprimento só afetam o dinheiro físico da gaveta — cartão e PIX não têm gaveta.
function somarMovimentacoesPendentes(movimentacoes: { tipo: string; valor: number }[]) {
  return movimentacoes.reduce(
    (acc, m) => {
      if (m.tipo === 'sangria') return { ...acc, sangrias: acc.sangrias + Number(m.valor) };
      if (m.tipo === 'suprimento') return { ...acc, suprimentos: acc.suprimentos + Number(m.valor) };
      return acc;
    },
    { sangrias: 0, suprimentos: 0 }
  );
}

export async function GET(request: Request) {
    try {
      const perfil = await getPerfilAutenticado();
      if (!perfil) return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 401 });
  
      const { searchParams } = new URL(request.url);
      const data = searchParams.get('data') || new Date().toISOString().slice(0, 10);
  
      const { data: caixas, error: caixasError } = await supabaseAdmin
        .from('pdv_devices')
        .select('id, device_label')
        .eq('franchise_id', perfil.franchiseId)
        .eq('is_active', true)
        .order('device_label');
      if (caixasError) throw new Error(`pdv_devices: ${JSON.stringify(caixasError)}`);
  
      const { data: acumulados, error: acumuladosError } = await supabaseAdmin
        .from('vendas_diarias_pdv')
        .select('pdv_device_id, valor_dinheiro, valor_cartao, valor_pix, atualizado_em')
        .eq('franchise_id', perfil.franchiseId)
        .eq('data_venda', data);
      if (acumuladosError) throw new Error(`vendas_diarias_pdv: ${JSON.stringify(acumuladosError)}`);
  
      const { data: fechamentos, error: fechamentosError } = await supabaseAdmin
        .from('fechamentos_caixa')
        .select('id, pdv_device_id, valor_vendas_dinheiro, valor_vendas_cartao, valor_vendas_pix, valor_esperado, valor_contado, contado_em')
        .eq('franchise_id', perfil.franchiseId)
        .eq('data_fechamento', data)
        .order('contado_em', { ascending: true });
      if (fechamentosError) throw new Error(`fechamentos_caixa: ${JSON.stringify(fechamentosError)}`);

      const caixaIds = (caixas || []).map((c) => c.id);
      const { data: movimentacoesPendentes, error: movimentacoesError } = caixaIds.length
        ? await supabaseAdmin
            .from('movimentacoes_caixa')
            .select('id, pdv_device_id, tipo, valor, motivo, criado_em')
            .in('pdv_device_id', caixaIds)
            .is('fechamento_id', null)
        : { data: [], error: null };
      if (movimentacoesError) throw new Error(`movimentacoes_caixa: ${JSON.stringify(movimentacoesError)}`);

      const acumuladoPorCaixa = new Map((acumulados || []).map((a) => [a.pdv_device_id, a]));
      const fechamentosPorCaixa = new Map<string, typeof fechamentos>();
      for (const f of fechamentos || []) {
        const lista = fechamentosPorCaixa.get(f.pdv_device_id) || [];
        lista.push(f);
        fechamentosPorCaixa.set(f.pdv_device_id, lista);
      }
      const movimentacoesPorCaixa = new Map<string, typeof movimentacoesPendentes>();
      for (const m of movimentacoesPendentes || []) {
        const lista = movimentacoesPorCaixa.get(m.pdv_device_id) || [];
        lista.push(m);
        movimentacoesPorCaixa.set(m.pdv_device_id, lista);
      }

      const resultado = (caixas || []).map((c) => {
        const acumulado = acumuladoPorCaixa.get(c.id) || null;
        const historico = fechamentosPorCaixa.get(c.id) || [];
        const jaReconciliado = somarReconciliado(historico as any);
        const pendentes = movimentacoesPorCaixa.get(c.id) || [];
        const { sangrias, suprimentos } = somarMovimentacoesPendentes(pendentes as any);

        const proximoEsperado = acumulado
          ? {
              dinheiro: Number(acumulado.valor_dinheiro) - jaReconciliado.dinheiro - sangrias + suprimentos,
              cartao: Number(acumulado.valor_cartao) - jaReconciliado.cartao,
              pix: Number(acumulado.valor_pix) - jaReconciliado.pix,
            }
          : null;

        return {
          pdv_device_id: c.id,
          device_label: c.device_label,
          acumulado_atualizado_em: acumulado?.atualizado_em || null,
          proximo_esperado: proximoEsperado
            ? { ...proximoEsperado, total: proximoEsperado.dinheiro + proximoEsperado.cartao + proximoEsperado.pix }
            : null,
          movimentacoes_pendentes: pendentes.map((m: any) => ({
            id: m.id,
            tipo: m.tipo,
            valor: Number(m.valor),
            motivo: m.motivo,
            criado_em: m.criado_em,
          })),
          historico: historico.map((f: any) => ({
            id: f.id,
            valor_esperado: Number(f.valor_esperado),
            valor_contado: Number(f.valor_contado),
            diferenca: Number(f.valor_contado) - Number(f.valor_esperado),
            contado_em: f.contado_em,
          })),
        };
      });
  
      return NextResponse.json({ data, caixas: resultado });
    } catch (err: any) {
        console.error('Erro em GET /api/fechamentos/contagem:', err);
        return NextResponse.json({ error: 'ERRO_INTERNO' }, { status: 500 });
      }
  }

const ContagemSchema = z.object({
  pdv_device_id: z.string().uuid(),
  data_fechamento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  valor_contado: z.number().nonnegative(),
});

export async function POST(request: Request) {
  const perfil = await getPerfilAutenticado();
  if (!perfil) return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 401 });

  const parsed = ContagemSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'DADOS_INVALIDOS', detalhe: parsed.error.flatten() }, { status: 400 });
  }
  const { pdv_device_id, data_fechamento, valor_contado } = parsed.data;

  const { data: dispositivo } = await supabaseAdmin
    .from('pdv_devices')
    .select('id')
    .eq('id', pdv_device_id)
    .eq('franchise_id', perfil.franchiseId)
    .maybeSingle();
  if (!dispositivo) return NextResponse.json({ error: 'CAIXA_NAO_ENCONTRADO' }, { status: 404 });

  // Recalcula o esperado no servidor, no momento do envio — nunca confia em valor vindo do cliente.
  const [{ data: acumulado }, { data: fechamentosAnteriores }, { data: movimentacoesPendentes }] = await Promise.all([
    supabaseAdmin
      .from('vendas_diarias_pdv')
      .select('valor_dinheiro, valor_cartao, valor_pix')
      .eq('franchise_id', perfil.franchiseId)
      .eq('pdv_device_id', pdv_device_id)
      .eq('data_venda', data_fechamento)
      .maybeSingle(),
    supabaseAdmin
      .from('fechamentos_caixa')
      .select('valor_vendas_dinheiro, valor_vendas_cartao, valor_vendas_pix')
      .eq('franchise_id', perfil.franchiseId)
      .eq('pdv_device_id', pdv_device_id)
      .eq('data_fechamento', data_fechamento),
    supabaseAdmin
      .from('movimentacoes_caixa')
      .select('id, tipo, valor')
      .eq('pdv_device_id', pdv_device_id)
      .is('fechamento_id', null),
  ]);

  const jaReconciliado = somarReconciliado((fechamentosAnteriores || []) as any);
  const { sangrias, suprimentos } = somarMovimentacoesPendentes((movimentacoesPendentes || []) as any);
  const esperadoDinheiro = Number(acumulado?.valor_dinheiro || 0) - jaReconciliado.dinheiro - sangrias + suprimentos;
  const esperadoCartao = Number(acumulado?.valor_cartao || 0) - jaReconciliado.cartao;
  const esperadoPix = Number(acumulado?.valor_pix || 0) - jaReconciliado.pix;
  const esperadoTotal = esperadoDinheiro + esperadoCartao + esperadoPix;

  const { data: novoFechamento, error } = await supabaseAdmin
    .from('fechamentos_caixa')
    .insert({
      franchise_id: perfil.franchiseId,
      pdv_device_id,
      data_fechamento,
      pdv_referencia_id: crypto.randomUUID(), // legado — remover quando o agente for reescrito
      valor_vendas_dinheiro: esperadoDinheiro,
      valor_vendas_cartao: esperadoCartao,
      valor_vendas_pix: esperadoPix,
      valor_esperado: esperadoTotal,
      valor_contado,
      contado_por: perfil.userId,
      contado_em: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) return NextResponse.json({ error: 'ERRO_INTERNO', detalhe: error.message }, { status: 500 });

  // Marca as sangrias/suprimentos usadas neste cálculo como reconciliadas, pra não
  // entrarem de novo no próximo fechamento. Não é atômico com o insert acima — se isso
  // falhar, a movimentação fica pendente e será recontada na próxima vez (ver plano).
  const idsMovimentacoes = (movimentacoesPendentes || []).map((m) => m.id);
  if (idsMovimentacoes.length > 0) {
    const { error: marcarError } = await supabaseAdmin
      .from('movimentacoes_caixa')
      .update({ fechamento_id: novoFechamento.id })
      .in('id', idsMovimentacoes);
    if (marcarError) {
      console.error('Falha ao marcar movimentacoes_caixa como reconciliadas:', marcarError, { fechamentoId: novoFechamento.id, idsMovimentacoes });
    }
  }

  return NextResponse.json({ ok: true });
}