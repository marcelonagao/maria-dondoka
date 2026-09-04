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

// Schema no formato exigido pela API do Gemini (tipos em maiúsculo, não o JSON Schema padrão).
const FERRAMENTA_EXTRACAO = {
  name: 'extrair_funcionarios',
  description:
    'Registra os funcionários extraídos do recibo de folha de pagamento, um item por funcionário único, já deduplicado.',
  parameters: {
    type: 'OBJECT',
    properties: {
      funcionarios: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            cnpj: { type: 'STRING', description: "CNPJ da empresa associada a este funcionário, exatamente como aparece no documento (ex: '67.055.166/0001-86')." },
            codigo_folha: { type: 'STRING', description: "Campo 'Código' do funcionário." },
            nome: { type: 'STRING' },
            cargo: { type: 'STRING' },
            cbo: { type: 'STRING' },
            admissao: { type: 'STRING', description: 'Data de admissão no formato YYYY-MM-DD (o documento traz DD/MM/YYYY — converta).' },
            salario_base: { type: 'NUMBER', description: "Campo 'Salário Base' do rodapé." },
            total_vencimentos: { type: 'NUMBER', description: "Campo 'Total de Vencimentos'." },
            total_descontos: { type: 'NUMBER', description: "Campo 'Total de Descontos'." },
            valor_liquido: { type: 'NUMBER', description: "Campo 'Valor Líquido'." },
            inss_empregado: {
              type: 'NUMBER',
              description:
                "Valor da LINHA de desconto com código 998, descrição \"I.N.S.S.\" na tabela de itens do recibo. NÃO é o campo \"Sal. Contr. INSS\" do rodapé (esse é a base de cálculo do INSS, não o valor descontado).",
            },
            fgts_mes: { type: 'NUMBER', description: "Campo 'F.G.T.S do Mês' do rodapé." },
            horas_extras_qtd: { type: 'NUMBER', description: "Coluna Referência da linha de código 205 \"HORAS EXTRAS 60%\" — quantidade de horas, não o valor em R$." },
            horas_extras_valor: { type: 'NUMBER', description: "Coluna Vencimentos da linha de código 205 \"HORAS EXTRAS 60%\" — valor em R$." },
            reflexo_dsr_valor: { type: 'NUMBER', description: "Coluna Vencimentos da linha de código 250 \"REFLEXO EXTRAS DSR\" — valor em R$." },
          },
          required: ['cnpj', 'codigo_folha', 'nome', 'total_vencimentos', 'total_descontos', 'valor_liquido'],
        },
      },
    },
    required: ['funcionarios'],
  },
};

// Mesmo schema da FERRAMENTA_EXTRACAO, mas no formato padrão de JSON Schema (tipos em
// minúsculo) exigido pela Anthropic — Gemini usa tipos em maiúsculo, não são compatíveis.
const FERRAMENTA_EXTRACAO_ANTHROPIC = {
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
            horas_extras_qtd: { type: 'number', description: "Coluna Referência da linha de código 205 \"HORAS EXTRAS 60%\" — quantidade de horas, não o valor em R$." },
            horas_extras_valor: { type: 'number', description: "Coluna Vencimentos da linha de código 205 \"HORAS EXTRAS 60%\" — valor em R$." },
            reflexo_dsr_valor: { type: 'number', description: "Coluna Vencimentos da linha de código 250 \"REFLEXO EXTRAS DSR\" — valor em R$." },
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
7. Horas extras: código 205 "HORAS EXTRAS 60%" tem quantidade de horas na coluna Referência (→ horas_extras_qtd) e valor em R$ na coluna Vencimentos (→ horas_extras_valor). Código 250 "REFLEXO EXTRAS DSR" tem o valor em R$ na coluna Vencimentos (→ reflexo_dsr_valor). Se o funcionário não tiver essas linhas no período, deixe os campos de fora.

Use a ferramenta "extrair_funcionarios" para registrar o resultado.`;

async function extrairComAnthropic(base64: string): Promise<any[]> {
  const resposta = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY || '',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
            { type: 'text', text: PROMPT_EXTRACAO },
          ],
        },
      ],
      tools: [FERRAMENTA_EXTRACAO_ANTHROPIC],
      tool_choice: { type: 'tool', name: 'extrair_funcionarios' },
    }),
  });

  if (!resposta.ok) {
    const corpoErro = await resposta.text();
    throw new Error(`Anthropic API retornou ${resposta.status}: ${corpoErro}`);
  }

  const dados = await resposta.json();
  const usoFerramenta = (dados.content || []).find((bloco: any) => bloco.type === 'tool_use');
  if (!usoFerramenta) {
    throw new Error('Resposta da Anthropic não incluiu o uso de ferramenta esperado.');
  }
  return usoFerramenta.input?.funcionarios || [];
}

async function extrairComGemini(base64: string): Promise<any[]> {
  const modelo = 'gemini-3.6-flash';
  const respostaGemini = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { inline_data: { mime_type: 'application/pdf', data: base64 } },
              { text: PROMPT_EXTRACAO },
            ],
          },
        ],
        tools: [{ function_declarations: [FERRAMENTA_EXTRACAO] }],
        tool_config: { function_calling_config: { mode: 'ANY', allowed_function_names: ['extrair_funcionarios'] } },
      }),
    }
  );

  if (!respostaGemini.ok) {
    const corpoErro = await respostaGemini.text();
    throw new Error(`Gemini API retornou ${respostaGemini.status}: ${corpoErro}`);
  }

  const dadosResposta = await respostaGemini.json();
  const partes = dadosResposta.candidates?.[0]?.content?.parts || [];
  const usoFerramenta = partes.find((parte: any) => parte.functionCall)?.functionCall;
  if (!usoFerramenta) {
    throw new Error('Resposta do Gemini não incluiu o uso de ferramenta esperado.');
  }
  return usoFerramenta.args?.funcionarios || [];
}

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
    // Anthropic é o provedor principal (já pago, mais confiável) — Gemini entra só como
    // fallback gratuito se a Anthropic falhar (indisponibilidade, limite, etc).
    let funcionariosExtraidos: any[];
    try {
      funcionariosExtraidos = await extrairComAnthropic(base64);
    } catch (erroAnthropic) {
      console.error('Extração via Anthropic falhou, tentando Gemini como fallback:', erroAnthropic);
      try {
        funcionariosExtraidos = await extrairComGemini(base64);
      } catch (erroGemini) {
        const mensagemAnthropic = erroAnthropic instanceof Error ? erroAnthropic.message : String(erroAnthropic);
        const mensagemGemini = erroGemini instanceof Error ? erroGemini.message : String(erroGemini);
        throw new Error(`Anthropic: ${mensagemAnthropic} | Gemini (fallback): ${mensagemGemini}`);
      }
    }

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
      horas_extras_qtd: item.horas_extras_qtd ?? null,
      horas_extras_valor: item.horas_extras_valor ?? null,
      reflexo_dsr_valor: item.reflexo_dsr_valor ?? null,
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
