import type { SupabaseClient } from '@supabase/supabase-js';

// A API do Supabase limita a 1000 linhas por resposta por padrão. Meses com
// sincronização granular de vendas passam facilmente disso (~13 mil itens/mês em
// produção), então uma única chamada .select() trunca silenciosamente o resultado —
// sem erro, só menos linhas — inflando CMV/receita pra baixo no DRE. Pagina com
// .range() até não haver mais linhas.
const TAMANHO_PAGINA = 1000;

export async function buscarTodosVendasItens<T = Record<string, unknown>>(
  supabaseClient: SupabaseClient,
  campos: string,
  inicio: string,
  fim?: string
): Promise<T[]> {
  const linhas: T[] = [];
  let pagina = 0;

  while (true) {
    const de = pagina * TAMANHO_PAGINA;
    const ate = de + TAMANHO_PAGINA - 1;
    let query = supabaseClient
      .from('vendas_itens')
      .select(campos)
      .gte('data_venda', inicio);
    if (fim) query = query.lte('data_venda', fim);
    const { data, error } = await query.range(de, ate);

    if (error) throw error;

    linhas.push(...((data || []) as T[]));
    if (!data || data.length < TAMANHO_PAGINA) break;
    pagina++;
  }

  return linhas;
}
