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

export function adicionarDias(dataISO: string, dias: number): string {
  const data = new Date(dataISO + 'T00:00:00Z');
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

export function intervaloDoTrimestre(ano: number, trimestre: 1 | 2 | 3 | 4): { inicio: string; fim: string } {
  const mesInicio = (trimestre - 1) * 3 + 1;
  const inicio = `${ano}-${String(mesInicio).padStart(2, '0')}-01`;
  const mesFim = mesInicio + 2;
  const ultimoDia = new Date(ano, mesFim, 0).getDate();
  const fim = `${ano}-${String(mesFim).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
  return { inicio, fim };
}

export function intervaloDoAno(ano: number): { inicio: string; fim: string } {
  return { inicio: `${ano}-01-01`, fim: `${ano}-12-31` };
}
