// Mapeamento compartilhado entre middleware.ts (gate de acesso por rota) e a navegação
// mobile (MobileTabBar) — um único lugar pra manter rota<->tela em sincronia.
export const ROTA_PARA_TELA: Record<string, string> = {
  '/dashboard': 'dashboard',
  '/tesouraria': 'tesouraria',
  '/vendas': 'vendas_pdv',
  '/produtos': 'produtos',
  '/dre': 'dre',
  '/dp': 'dp',
  '/configuracoes': 'configuracoes',
  '/franquias': 'franquias',
};

// Rota conhecida de cada tela — usada como destino quando o usuário tenta acessar uma
// tela sem permissão, mandando pra primeira tela que o papel dele realmente tem.
export const TELA_PARA_ROTA: Record<string, string> = {
  dashboard: '/dashboard',
  tesouraria: '/tesouraria/pagar',
  vendas_pdv: '/vendas',
  produtos: '/produtos',
  dre: '/dre',
  dp: '/dp',
  configuracoes: '/configuracoes',
  franquias: '/franquias',
};
