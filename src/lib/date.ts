export function hojeBrasilia(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

export function dataParaTimestampBrasilia(data: string): string {
  return `${data}T12:00:00-03:00`;
}

export function mesAtualBrasilia(): string {
  return hojeBrasilia().slice(0, 7);
}

export function intervaloDoMes(mesAno: string): { inicio: string; fim: string } {
  const [ano, mes] = mesAno.split('-').map(Number);
  const inicio = `${mesAno}-01`;
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const fim = `${mesAno}-${String(ultimoDia).padStart(2, '0')}`;
  return { inicio, fim };
}
