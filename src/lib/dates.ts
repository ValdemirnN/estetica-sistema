/** Datas da agenda sempre no fuso de Brasília, como chaves 'YYYY-MM-DD'. */
const TZ = 'America/Sao_Paulo';

const fmtKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** ISO UTC -> 'YYYY-MM-DD' em Brasília */
export const localDateKey = (iso: string | Date) => fmtKey.format(typeof iso === 'string' ? new Date(iso) : iso);

export const todayKey = () => localDateKey(new Date());

/** Soma dias a uma chave de data (usa meio-dia UTC para não escorregar de dia). */
export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days, 12));
  return dt.toISOString().slice(0, 10);
}

/** 0 = domingo ... 6 = sábado */
export function weekdayOf(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

/** Segunda-feira da semana da data. */
export function startOfWeek(key: string): string {
  const wd = weekdayOf(key);
  return addDays(key, wd === 0 ? -6 : 1 - wd);
}

export const monthOf = (key: string) => key.slice(0, 7);

export function addMonths(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, 1, 12));
  return dt.toISOString().slice(0, 10);
}

/** Todas as datas visíveis num calendário mensal (semanas completas, começando na segunda). */
export function monthGrid(key: string): string[] {
  const first = `${monthOf(key)}-01`;
  const start = startOfWeek(first);
  const out: string[] = [];
  for (let i = 0; i < 42; i++) out.push(addDays(start, i));
  const lastRowStart = out[35];
  return monthOf(lastRowStart) !== monthOf(first) && new Date(lastRowStart) > new Date(first) ? out.slice(0, 35) : out;
}

export function formatLong(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('pt-BR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: '2-digit',
    month: 'long'
  });
}

export function formatShort(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('pt-BR', {
    timeZone: 'UTC',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit'
  });
}

export function formatMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1, 12)).toLocaleDateString('pt-BR', { timeZone: 'UTC', month: 'long', year: 'numeric' });
}
