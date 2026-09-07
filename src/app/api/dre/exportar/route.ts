import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import * as XLSX from 'xlsx';
import { getPerfilAutenticado } from '../../../../lib/server-auth';

interface DespesaCategoria {
  categoria_id: string;
  categoria: string;
  valor: number;
}

interface ResultadoDRE {
  receita_bruta: number;
  deducoes: number;
  receita_liquida: number;
  custos: number;
  lucro_bruto: number;
  despesas_por_categoria: DespesaCategoria[];
  despesas_total: number;
  resultado_liquido: number;
  quantidade_vendas: number;
  ticket_medio: number;
}

export async function POST(request: Request) {
  const perfil = await getPerfilAutenticado();
  if (!perfil) return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 401 });
  if (!perfil.telasPermitidas.includes('dre')) {
    return NextResponse.json({ error: 'NAO_AUTORIZADO' }, { status: 403 });
  }

  const { franchiseId, dataInicio, dataFim } = await request.json();
  if (typeof dataInicio !== 'string' || typeof dataFim !== 'string') {
    return NextResponse.json({ error: 'DADOS_INVALIDOS' }, { status: 400 });
  }

  // Client autenticado pelo cookie da sessão (não service_role) — a RPC é security
  // invoker, precisa rodar com o RLS de quem chamou, não com acesso irrestrito.
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() { /* leitura apenas */ },
      },
    }
  );

  const { data, error } = await supabase.rpc('calcular_resultado_dre', {
    p_franchise_id: franchiseId || null,
    p_data_inicio: dataInicio,
    p_data_fim: dataFim,
  });
  if (error) {
    return NextResponse.json({ error: 'ERRO_INTERNO', detalhe: error.message }, { status: 500 });
  }
  const resultado = data as ResultadoDRE;

  const formatNumero = (v: number) => Number(v.toFixed(2));

  const linhasKpi = [
    ['KPI', 'Valor'],
    ['Faturamento Bruto', formatNumero(resultado.receita_bruta)],
    ['Quantidade de Vendas', resultado.quantidade_vendas],
    ['Ticket Médio', formatNumero(resultado.ticket_medio)],
    ['Custo (CMV)', formatNumero(resultado.custos)],
    ['Impostos', formatNumero(
      resultado.despesas_por_categoria.find((d) => d.categoria_id === '175f9ea8-647a-4ed4-af46-633d273c226d')?.valor || 0
    )],
  ];

  const linhasDre: (string | number)[][] = [
    ['Linha', 'Valor'],
    ['Receita Bruta', formatNumero(resultado.receita_bruta)],
    ['(-) Deduções', formatNumero(resultado.deducoes)],
    ['= Receita Líquida', formatNumero(resultado.receita_liquida)],
    ['(-) Custos (CMV)', formatNumero(resultado.custos)],
    ['= Lucro Bruto', formatNumero(resultado.lucro_bruto)],
    ['(-) Despesas Operacionais', formatNumero(resultado.despesas_total)],
    ...resultado.despesas_por_categoria.map((d) => [`  ${d.categoria}`, formatNumero(d.valor)]),
    ['= Resultado Líquido', formatNumero(resultado.resultado_liquido)],
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(linhasKpi), 'KPIs');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(linhasDre), 'DRE');

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="DRE_${dataInicio}_a_${dataFim}.xlsx"`,
    },
  });
}
