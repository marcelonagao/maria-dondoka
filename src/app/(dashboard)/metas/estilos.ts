import { AcompanhamentoLoja } from '../../../lib/metas';

// Cores com contraste AA em fundo branco (orange-700 ≈ 5,2:1, green-800 ≈ 7:1). O estado
// nunca depende só da cor: sempre há ícone e texto.
// Sonhos = conquista: rosa da marca, um tom abaixo (#D1007C, 5,25:1) porque o #EC008C puro dá
// 4,25:1 e reprova AA em texto pequeno. O rosa-escuro (pink-800) lia como vermelho de alerta.
export const ESTILO_STATUS = {
  sonho: 'text-white bg-[#D1007C] border-[#D1007C]',
  super: 'text-green-800 bg-green-50 border-green-200',
  meta: 'text-green-800 bg-green-50 border-green-200',
  abaixo: 'text-orange-800 bg-orange-50 border-orange-200',
  sem_meta: 'text-stone-700 bg-stone-100 border-stone-200',
  sem_base: 'text-stone-700 bg-stone-100 border-stone-200',
  futuro: 'text-stone-700 bg-stone-100 border-stone-200',
} as const;

// Só a classe de texto, para quem não desenha o selo (a corrida escreve o percentual na cor do estado).
export const COR_TEXTO_STATUS = {
  sonho: 'text-[#D1007C]',
  super: 'text-green-800',
  meta: 'text-green-800',
  abaixo: 'text-orange-800',
  sem_meta: 'text-stone-700',
  sem_base: 'text-stone-700',
  futuro: 'text-stone-700',
} as const;

// Só precisa de status e fase: a corrida não carrega a loja inteira e usa o mesmo rótulo do card.
export function rotuloStatus(l: Pick<AcompanhamentoLoja, 'status' | 'fase'>): string {
  const fechado = l.fase === 'fechado';
  switch (l.status) {
    case 'sonho': return fechado ? '★ Meta dos sonhos batida' : '★ No ritmo da meta dos sonhos';
    case 'super': return fechado ? '✓ Super meta batida' : '✓ No ritmo da super meta';
    case 'meta': return fechado ? '✓ Meta batida' : '✓ No ritmo da meta';
    case 'abaixo': return fechado ? '▼ Meta não batida' : '▼ Abaixo da meta';
    case 'sem_base': return 'Projeção em breve';
    case 'futuro': return 'Mês ainda não começou';
    default: return 'Sem meta cadastrada';
  }
}
