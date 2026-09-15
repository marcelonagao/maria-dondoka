export interface CategoriaNo {
  id: string;
  nome: string;
  categoria_pai_id: string | null;
}

// O plano de contas tem 3 níveis reais, não 2. Subir um nível só
// (`coalesce(categoria_pai_id, id)`) devolve a resposta errada no terceiro nível — por isso
// existe a função SQL recursiva `categoria_raiz(id)` no banco. Este módulo é o equivalente
// em JS, compartilhado entre o DRE e o lançamento de despesa, que antes tinham duas lógicas
// divergentes de hierarquia.

function indexarPorId(categorias: CategoriaNo[]): Map<string, CategoriaNo> {
  return new Map(categorias.map((c) => [c.id, c]));
}

// O `visitados` protege contra ciclo (pai que aponta pra descendente) — sem isso, um dado
// inconsistente no banco trava a aba do usuário num laço infinito.
function subirAteRaiz(
  porId: Map<string, CategoriaNo>,
  contaId: string | null
): CategoriaNo[] {
  const caminho: CategoriaNo[] = [];
  const visitados = new Set<string>();
  let atual = contaId;

  while (atual && !visitados.has(atual)) {
    visitados.add(atual);
    const no = porId.get(atual);
    if (!no) break;
    caminho.unshift(no);
    atual = no.categoria_pai_id;
  }

  return caminho;
}

export function resolverRaiz(categorias: CategoriaNo[], contaId: string | null): string | null {
  const caminho = subirAteRaiz(indexarPorId(categorias), contaId);
  return caminho.length > 0 ? caminho[0].id : null;
}

export function caminhoCompleto(categorias: CategoriaNo[], contaId: string | null): string {
  return subirAteRaiz(indexarPorId(categorias), contaId)
    .map((c) => c.nome)
    .join(' › ');
}

// Só nós folha entram como opção: lançar despesa numa categoria intermediária quebra a
// consolidação por categoria-raiz do DRE. O rótulo traz o caminho inteiro pra desambiguar
// filhas homônimas de pais diferentes (ex: "Impostos › Federais" vs "Taxas › Federais").
export function opcoesDeCategoria(
  categorias: CategoriaNo[]
): { value: string; label: string }[] {
  const porId = indexarPorId(categorias);
  const temFilho = new Set(
    categorias.map((c) => c.categoria_pai_id).filter((id): id is string => !!id)
  );

  return categorias
    .filter((c) => !temFilho.has(c.id))
    .map((c) => ({
      value: c.id,
      label: subirAteRaiz(porId, c.id)
        .map((n) => n.nome)
        .join(' › '),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}
