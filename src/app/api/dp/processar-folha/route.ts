import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getPerfilAutenticado } from '../../../../lib/server-auth';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
);

// Mesma condição da RLS de DP: tela liberada + (papel Full/Administrativo ou sócio).
// Dado sensível (salário, dado pessoal) — checagem redundante aqui de propósito, já que
// esta rota usa o client de service_role (bypassa RLS por completo).
function temAcessoDp(perfil: NonNullable<Awaited<ReturnType<typeof getPerfilAutenticado>>>) {
  return (
    perfil.telasPermitidas.includes('dp') &&
    (perfil.roleNome === 'Full' || perfil.roleNome === 'Administrativo' || perfil.isSocio)
  );
}

function normalizarCnpj(cnpj: string): string {
  return cnpj.replace(/\D/g, '');
}

const FERRAMENTA_EXTRACAO = {
  name: 'extrair_funcionarios',
  description:
    'Registra os funcionários extraídos do recibo de folha de pagamento, um item por funcionário único, já deduplicado.',
  input_schema: {
    type: 'object',
    properties: {
      funcionarios: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            cnpj: { type: 'string', description: "CNPJ da empresa associada a este funcionário, exatamente como aparece no documento (ex: '67.055.166/0001-86')." },
            codigo_folha: { type: 'string', description: "Campo 'Código' do funcionário." },
            nome: { type: 'string' },
            cargo: { type: 'string' },
            cbo: { type: 'string' },
            admissao: { type: 'string', description: 'Data de admissão no formato YYYY-MM-DD (o documento traz DD/MM/YYYY — converta).' },
            salario_base: { type: 'number', description: "Campo 'Salário Base' do rodapé." },
            total_vencimentos: { type: 'number', description: "Campo 'Total de Vencimentos'." },
            total_descontos: { type: 'number', description: "Campo 'Total de Descontos'." },
            valor_liquido: { type: 'number', description: "Campo 'Valor Líquido'." },
            inss_empregado: {
              type: 'number',
              description:
                "Valor da LINHA de desconto com código 998, descrição \"I.N.S.S.\" na tabela de itens do recibo. NÃO é o campo \"Sal. Contr. INSS\" do rodapé (esse é a base de cálculo do INSS, não o valor descontado).",
            },
            fgts_mes: { type: 'number', description: "Campo 'F.G.T.S do Mês' do rodapé." },
          },
          required: ['cnpj', 'codigo_folha', 'nome', 'total_vencimentos', 'total_descontos', 'valor_liquido'],
        },
      },
    },
    required: ['funcionarios'],
  },
};

const PROMPT_EXTRACAO = `Este documento é um recibo de folha de pagamento mensal (um ou mais funcionários).

Regras importantes:
1. Cada funcionário aparece REPETIDO no documento (uma via da empresa + uma via do funcionário, às vezes uma terceira via em formato de tabela) — extraia cada funcionário só UMA vez. Use o campo "Código" pra identificar duplicatas: mesmo código = mesmo funcionário, não crie dois itens.
2. Cada bloco de funcionário tem um CNPJ associado (linha "CNPJ: ..." perto do nome da empresa) — extraia esse CNPJ exatamente como aparece, mesmo que seja igual pra todos os funcionários deste arquivo. Documentos futuros podem misturar funcionários de CNPJs diferentes no mesmo arquivo.
3. Não existe campo de CPF neste layout — nunca invente ou infira um CPF.
4. "inss_empregado" é a linha de DESCONTO com código 998 e descrição "I.N.S.S." na tabela de itens (Código/Descrição/Referência/Vencimentos/Descontos) — não confundir com "Sal. Contr. INSS", que aparece no rodapé e é a base de cálculo (normalmente maior que o salário), não o valor descontado.
5. Ignore qualquer texto solto que não seja dado de folha (ex: mensagens de aniversário).
6. Datas de admissão vêm como DD/MM/AAAA no documento — converta para AAAA-MM-DD.

Use a ferramenta "extrair_funcionarios" para registrar o resultado.`;

export async function POST(request: Request) {
  const perfil = await getPerfilAutenticado();
  if (!perfil) return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 401 });
  if (!temAcessoDp(perfil)) return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 403 });

  const formData = await request.formData();
  const arquivo = formData.get('arquivo');
  const competencia = formData.get('competencia');

  if (!(arquivo instanceof File) || typeof competencia !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(competencia)) {
    return NextResponse.json({ error: 'DADOS_INVALIDOS' }, { status: 400 });
  }

  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const base64 = Buffer.from(bytes).toString('base64');

  const caminhoArquivo = `${crypto.randomUUID()}-${arquivo.name}`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from('folhas-pagamento')
    .upload(caminhoArquivo, bytes, { contentType: 'application/pdf' });
  if (uploadError) {
    return NextResponse.json({ error: 'ERRO_UPLOAD', detalhe: uploadError.message }, { status: 500 });
  }

  const { data: competenciaRow, error: competenciaError } = await supabaseAdmin
    .from('folha_pagamento_competencias')
    .insert({ competencia, arquivo_original_path: caminhoArquivo, status: 'processando' })
    .select('id')
    .single();
  if (competenciaError) {
    return NextResponse.json({ error: 'ERRO_INTERNO', detalhe: competenciaError.message }, { status: 500 });
  }

  try {
    const respostaAnthropic = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 8192,
        tools: [FERRAMENTA_EXTRACAO],
        tool_choice: { type: 'tool', name: 'extrair_funcionarios' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
              { type: 'text', text: PROMPT_EXTRACAO },
            ],
          },
        ],
      }),
    });

    if (!respostaAnthropic.ok) {
      const corpoErro = await respostaAnthropic.text();
      throw new Error(`Anthropic API retornou ${respostaAnthropic.status}: ${corpoErro}`);
    }

    const dadosResposta = await respostaAnthropic.json();
    const usoFerramenta = (dadosResposta.content || []).find((bloco: any) => bloco.type === 'tool_use');
    if (!usoFerramenta) {
      throw new Error('Resposta da Anthropic não incluiu o uso de ferramenta esperado.');
    }

    const funcionariosExtraidos: any[] = usoFerramenta.input?.funcionarios || [];

    const { data: franquias } = await supabaseAdmin.from('franchises').select('id, cnpj');
    const mapaCnpj = new Map(
      (franquias || [])
        .filter((f) => f.cnpj)
        .map((f) => [normalizarCnpj(f.cnpj as string), f.id])
    );

    const itens = funcionariosExtraidos.map((item) => ({
      competencia_id: competenciaRow.id,
      franchise_id: mapaCnpj.get(normalizarCnpj(item.cnpj || '')) || null,
      cnpj_extraido: item.cnpj || '',
      codigo_folha: item.codigo_folha,
      nome: item.nome,
      cargo: item.cargo || null,
      cbo: item.cbo || null,
      admissao: item.admissao || null,
      salario_base: item.salario_base ?? null,
      total_vencimentos: item.total_vencimentos,
      total_descontos: item.total_descontos,
      valor_liquido: item.valor_liquido,
      inss_empregado: item.inss_empregado ?? null,
      fgts_mes: item.fgts_mes ?? null,
      raw_json: item,
    }));

    if (itens.length > 0) {
      const { error: itensError } = await supabaseAdmin.from('folha_pagamento_itens').insert(itens);
      if (itensError) throw new Error(itensError.message);
    }

    await supabaseAdmin
      .from('folha_pagamento_competencias')
      .update({ status: 'aguardando_revisao' })
      .eq('id', competenciaRow.id);

    return NextResponse.json({ ok: true, competencia_id: competenciaRow.id, total_itens: itens.length });
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err);
    console.error('Erro ao processar folha de pagamento:', mensagem);
    await supabaseAdmin
      .from('folha_pagamento_competencias')
      .update({ status: 'erro', erro_detalhe: mensagem })
      .eq('id', competenciaRow.id);
    return NextResponse.json({ error: 'ERRO_EXTRACAO', detalhe: mensagem }, { status: 500 });
  }
}
