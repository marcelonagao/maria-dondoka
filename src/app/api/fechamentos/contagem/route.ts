import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getPerfilAutenticado } from '../../../../lib/server-auth';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
);

function acumularPorForma(linhas: { forma_pagamento: string; valor: number }[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const l of linhas) {
    mapa.set(l.forma_pagamento, (mapa.get(l.forma_pagamento) || 0) + Number(l.valor));
  }
  return mapa;
}

// Sangria/suprimento só afetam o dinheiro físico da gaveta — as demais formas não têm gaveta.
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

function calcularEsperadoPorForma(
  acumulado: Map<string, number>,
  jaReconciliado: Map<string, number>,
  sangrias: number,
  suprimentos: number
): Map<string, number> {
  const formas = new Set(Array.from(acumulado.keys()).concat(Array.from(jaReconciliado.keys())));
  const esperado = new Map<string, number>();
  formas.forEach((forma) => {
    const ajuste = forma === 'dinheiro' ? sangrias - suprimentos : 0;
    esperado.set(forma, (acumulado.get(forma) || 0) - (jaReconciliado.get(forma) || 0) - ajuste);
  });
  return esperado;
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
      .from('vendas_diarias_formas_pagamento')
      .select('pdv_device_id, forma_pagamento, valor, atualizado_em')
      .eq('franchise_id', perfil.franchiseId)
      .eq('data_venda', data);
    if (acumuladosError) throw new Error(`vendas_diarias_formas_pagamento: ${JSON.stringify(acumuladosError)}`);

    const { data: fechamentos, error: fechamentosError } = await supabaseAdmin
      .from('fechamentos_caixa')
      .select('id, pdv_device_id, contado_em, funcionario_id')
      .eq('franchise_id', perfil.franchiseId)
      .eq('data_fechamento', data)
      .order('contado_em', { ascending: true });
    if (fechamentosError) throw new Error(`fechamentos_caixa: ${JSON.stringify(fechamentosError)}`);

    const fechamentoIds = (fechamentos || []).map((f) => f.id);
    const { data: formasFechamentos, error: formasFechamentosError } = fechamentoIds.length
      ? await supabaseAdmin
          .from('fechamentos_formas_pagamento')
          .select('fechamento_id, forma_pagamento, valor_esperado, valor_contado')
          .in('fechamento_id', fechamentoIds)
      : { data: [], error: null };
    if (formasFechamentosError) throw new Error(`fechamentos_formas_pagamento: ${JSON.stringify(formasFechamentosError)}`);

    const { data: funcionarios, error: funcionariosError } = await supabaseAdmin
      .from('funcionarios')
      .select('id, nome')
      .eq('franchise_id', perfil.franchiseId);
    if (funcionariosError) throw new Error(`funcionarios: ${JSON.stringify(funcionariosError)}`);
    const nomePorFuncionario = new Map((funcionarios || []).map((f) => [f.id, f.nome]));

    const caixaIds = (caixas || []).map((c) => c.id);
    const { data: movimentacoesPendentes, error: movimentacoesError } = caixaIds.length
      ? await supabaseAdmin
          .from('movimentacoes_caixa')
          .select('id, pdv_device_id, tipo, valor, motivo, criado_em')
          .in('pdv_device_id', caixaIds)
          .is('fechamento_id', null)
      : { data: [], error: null };
    if (movimentacoesError) throw new Error(`movimentacoes_caixa: ${JSON.stringify(movimentacoesError)}`);

    const formasPorFechamento = new Map<string, typeof formasFechamentos>();
    for (const f of formasFechamentos || []) {
      const lista = formasPorFechamento.get(f.fechamento_id) || [];
      lista.push(f);
      formasPorFechamento.set(f.fechamento_id, lista);
    }

    const acumuladoPorCaixa = new Map<string, { forma_pagamento: string; valor: number }[]>();
    const atualizadoEmPorCaixa = new Map<string, string>();
    for (const a of acumulados || []) {
      const lista = acumuladoPorCaixa.get(a.pdv_device_id) || [];
      lista.push({ forma_pagamento: a.forma_pagamento, valor: Number(a.valor) });
      acumuladoPorCaixa.set(a.pdv_device_id, lista);
      const atual = atualizadoEmPorCaixa.get(a.pdv_device_id);
      if (!atual || a.atualizado_em > atual) atualizadoEmPorCaixa.set(a.pdv_device_id, a.atualizado_em);
    }

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
      const acumuladoLinhas = acumuladoPorCaixa.get(c.id) || [];
      const acumuladoMapa = acumularPorForma(acumuladoLinhas);
      const historico = fechamentosPorCaixa.get(c.id) || [];

      const jaReconciliadoLinhas = historico.flatMap((f: any) =>
        (formasPorFechamento.get(f.id) || []).map((ff: any) => ({ forma_pagamento: ff.forma_pagamento, valor: Number(ff.valor_esperado) }))
      );
      const jaReconciliadoMapa = acumularPorForma(jaReconciliadoLinhas);

      const pendentes = movimentacoesPorCaixa.get(c.id) || [];
      const { sangrias, suprimentos } = somarMovimentacoesPendentes(pendentes as any);

      let proximoEsperado: { dinheiro: number; formas_informativas: { forma_pagamento: string; valor: number }[]; total: number } | null = null;
      if (acumuladoLinhas.length > 0) {
        const esperadoPorForma = calcularEsperadoPorForma(acumuladoMapa, jaReconciliadoMapa, sangrias, suprimentos);
        const dinheiro = esperadoPorForma.get('dinheiro') || 0;
        const formasInformativas = Array.from(esperadoPorForma.entries())
          .filter(([forma]) => forma !== 'dinheiro')
          .map(([forma_pagamento, valor]) => ({ forma_pagamento, valor }));
        const total = Array.from(esperadoPorForma.values()).reduce((acc, v) => acc + v, 0);
        proximoEsperado = { dinheiro, formas_informativas: formasInformativas, total };
      }

      return {
        pdv_device_id: c.id,
        device_label: c.device_label,
        acumulado_atualizado_em: atualizadoEmPorCaixa.get(c.id) || null,
        proximo_esperado: proximoEsperado,
        movimentacoes_pendentes: pendentes.map((m: any) => ({
          id: m.id,
          tipo: m.tipo,
          valor: Number(m.valor),
          motivo: m.motivo,
          criado_em: m.criado_em,
        })),
        historico: historico.map((f: any) => {
          const formasDoFechamento = (formasPorFechamento.get(f.id) || []).map((ff: any) => ({
            forma_pagamento: ff.forma_pagamento,
            valor_esperado: Number(ff.valor_esperado),
            valor_contado: ff.valor_contado === null ? null : Number(ff.valor_contado),
          }));
          const dinheiroForma = formasDoFechamento.find((ff) => ff.forma_pagamento === 'dinheiro');
          const valorEsperado = dinheiroForma?.valor_esperado || 0;
          const valorContado = dinheiroForma?.valor_contado || 0;
          return {
            id: f.id,
            valor_esperado: valorEsperado,
            valor_contado: valorContado,
            diferenca: valorContado - valorEsperado,
            contado_em: f.contado_em,
            funcionario_nome: f.funcionario_id ? nomePorFuncionario.get(f.funcionario_id) || null : null,
            formas: formasDoFechamento,
          };
        }),
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
  valor_contado_dinheiro: z.number().nonnegative(),
  funcionario_id: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  const perfil = await getPerfilAutenticado();
  if (!perfil) return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 401 });

  const parsed = ContagemSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'DADOS_INVALIDOS', detalhe: parsed.error.flatten() }, { status: 400 });
  }
  const { pdv_device_id, data_fechamento, valor_contado_dinheiro, funcionario_id } = parsed.data;

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
      .from('vendas_diarias_formas_pagamento')
      .select('forma_pagamento, valor')
      .eq('franchise_id', perfil.franchiseId)
      .eq('pdv_device_id', pdv_device_id)
      .eq('data_venda', data_fechamento),
    supabaseAdmin
      .from('fechamentos_caixa')
      .select('id, fechamentos_formas_pagamento(forma_pagamento, valor_esperado)')
      .eq('franchise_id', perfil.franchiseId)
      .eq('pdv_device_id', pdv_device_id)
      .eq('data_fechamento', data_fechamento),
    supabaseAdmin
      .from('movimentacoes_caixa')
      .select('id, tipo, valor')
      .eq('pdv_device_id', pdv_device_id)
      .is('fechamento_id', null),
  ]);

  const acumuladoMapa = acumularPorForma(
    (acumulado || []).map((a: any) => ({ forma_pagamento: a.forma_pagamento, valor: Number(a.valor) }))
  );
  const jaReconciliadoLinhas = (fechamentosAnteriores || []).flatMap((f: any) =>
    (f.fechamentos_formas_pagamento || []).map((ff: any) => ({ forma_pagamento: ff.forma_pagamento, valor: Number(ff.valor_esperado) }))
  );
  const jaReconciliadoMapa = acumularPorForma(jaReconciliadoLinhas);
  const { sangrias, suprimentos } = somarMovimentacoesPendentes((movimentacoesPendentes || []) as any);
  const esperadoPorForma = calcularEsperadoPorForma(acumuladoMapa, jaReconciliadoMapa, sangrias, suprimentos);
  const esperadoDinheiro = esperadoPorForma.get('dinheiro') || 0;

  const { data: novoFechamento, error } = await supabaseAdmin
    .from('fechamentos_caixa')
    .insert({
      franchise_id: perfil.franchiseId,
      pdv_device_id,
      data_fechamento,
      pdv_referencia_id: crypto.randomUUID(), // legado — remover quando o agente for reescrito
      valor_esperado: esperadoDinheiro,
      valor_contado: valor_contado_dinheiro,
      contado_por: perfil.userId,
      contado_em: new Date().toISOString(),
      funcionario_id: funcionario_id || null,
    })
    .select('id')
    .single();

  if (error) return NextResponse.json({ error: 'ERRO_INTERNO', detalhe: error.message }, { status: 500 });

  if (esperadoPorForma.size > 0) {
    const { error: formasError } = await supabaseAdmin
      .from('fechamentos_formas_pagamento')
      .insert(
        Array.from(esperadoPorForma.entries()).map(([forma_pagamento, valor_esperado]) => ({
          fechamento_id: novoFechamento.id,
          forma_pagamento,
          valor_esperado,
          valor_contado: forma_pagamento === 'dinheiro' ? valor_contado_dinheiro : null,
        }))
      );
    if (formasError) {
      console.error('Falha ao gravar fechamentos_formas_pagamento:', formasError, { fechamentoId: novoFechamento.id });
    }
  }

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
