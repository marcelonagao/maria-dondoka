export function hojeBrasilia(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

export function dataParaTimestampBrasilia(data: string): string {
  return `${data}T12:00:00-03:00`;
}

export function mesAtualBrasilia(): string {
  return hojeBrasilia().slice(0, 7);
}
