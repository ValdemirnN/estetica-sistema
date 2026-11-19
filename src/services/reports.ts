import { Appointment, ClientRecord, Professional, Service, WorkingHours } from '../types/clinic';
import { addDays, addMonths, localDateKey, monthOf, weekdayOf } from '../lib/dates';
import { dayDiff } from './clientInsights';

/**
 * Relatórios do dono. Funções puras (sem React, sem rede): recebem os agendamentos reais
 * e devolvem números. Datas sempre em Brasília ('YYYY-MM-DD'), período inclusivo nas duas pontas.
 *
 * Regras (as mesmas valem para a tela e para o CSV):
 *  - Faturamento = soma dos atendimentos CONCLUÍDOS (COMPLETED). O que ainda vai acontecer
 *    (PENDING/CONFIRMED) aparece à parte, como "previsto".
 *  - Ticket médio = faturamento / atendimentos concluídos.
 *  - No-show (%) = faltas / (concluídos + faltas): só conta quem tinha o horário reservado e
 *    o dia já passou. Cancelamentos não entram (o horário foi liberado).
 *  - Ocupação = minutos reservados (PENDING, CONFIRMED, COMPLETED, NO_SHOW) / minutos de jornada
 *    (menos almoço e ausências) no período.
 *  - Cliente novo = o primeiro atendimento concluído dele, em toda a história, caiu no período.
 *    Recorrente = já tinha atendimento concluído antes do período.
 */

const ATTENDED = 'COMPLETED';
const BOOKED_STATUSES = new Set(['PENDING', 'CONFIRMED', 'COMPLETED', 'NO_SHOW']);

// ---------------------------------------------------------------------------
// Períodos
// ---------------------------------------------------------------------------

export interface DateRange {
  /** 'YYYY-MM-DD', inclusive */
  from: string;
  /** 'YYYY-MM-DD', inclusive */
  to: string;
}

export type PeriodPreset = 'today' | 'last7' | 'last30' | 'thisMonth' | 'lastMonth' | 'last90' | 'thisYear' | 'custom';

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  today: 'Hoje',
  last7: 'Últimos 7 dias',
  last30: 'Últimos 30 dias',
  thisMonth: 'Este mês',
  lastMonth: 'Mês passado',
  last90: 'Últimos 90 dias',
  thisYear: 'Este ano',
  custom: 'Personalizado'
};

export function presetRange(preset: Exclude<PeriodPreset, 'custom'>, today: string): DateRange {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'last7':
      return { from: addDays(today, -6), to: today };
    case 'last30':
      return { from: addDays(today, -29), to: today };
    case 'last90':
      return { from: addDays(today, -89), to: today };
    case 'thisMonth':
      return { from: `${monthOf(today)}-01`, to: today };
    case 'lastMonth': {
      const first = `${monthOf(today)}-01`;
      return { from: addMonths(first, -1), to: addDays(first, -1) };
    }
    case 'thisYear':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}

/** Período imediatamente anterior, com o mesmo número de dias (para comparar "vs. período anterior"). */
export function previousRange(r: DateRange): DateRange {
  const days = dayDiff(r.from, r.to) + 1;
  return { from: addDays(r.from, -days), to: addDays(r.from, -1) };
}

export const isValidRange = (r: DateRange) =>
  /^\d{4}-\d{2}-\d{2}$/.test(r.from) && /^\d{4}-\d{2}-\d{2}$/.test(r.to) && r.from <= r.to;

const inRange = (key: string, r: DateRange) => key >= r.from && key <= r.to;

const dateOf = (a: Appointment) => localDateKey(a.startTime);

// ---------------------------------------------------------------------------
// Relatório principal
// ---------------------------------------------------------------------------

export interface Kpis {
  /** Centavos recebidos (atendimentos concluídos). */
  revenueCents: number;
  /** Centavos ainda por vir (pendentes/confirmados com data de hoje em diante). */
  forecastCents: number;
  completed: number;
  noShows: number;
  cancelled: number;
  /** Agendamentos marcados no período, em qualquer situação. */
  scheduled: number;
  avgTicketCents: number;
  /** 0–100, uma casa decimal. */
  noShowRate: number;
  uniqueClients: number;
  newClients: number;
  returningClients: number;
}

export interface SeriesPoint {
  /** Chave do ponto: 'YYYY-MM-DD' (dia), 'YYYY-MM-DD' da segunda-feira (semana) ou 'YYYY-MM' (mês). */
  key: string;
  label: string;
  revenueCents: number;
  completed: number;
}

export interface ProcedureRow {
  serviceId: string;
  name: string;
  count: number;
  revenueCents: number;
  /** Participação no faturamento do período (0–100). */
  share: number;
}

export interface ProfessionalRow {
  professionalId: string;
  name: string;
  completed: number;
  noShows: number;
  revenueCents: number;
  avgTicketCents: number;
  bookedMinutes: number;
  capacityMinutes: number;
  /** 0–100, null quando a profissional não tem jornada no período. */
  occupancy: number | null;
}

export interface Report {
  range: DateRange;
  kpis: Kpis;
  series: SeriesPoint[];
  granularity: 'day' | 'week' | 'month';
  procedures: ProcedureRow[];
  professionals: ProfessionalRow[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Quantos dias o período tem. */
export const rangeDays = (r: DateRange) => dayDiff(r.from, r.to) + 1;

function pickGranularity(r: DateRange): 'day' | 'week' | 'month' {
  const d = rangeDays(r);
  if (d <= 31) return 'day';
  if (d <= 120) return 'week';
  return 'month';
}

function startOfWeekKey(key: string): string {
  const wd = weekdayOf(key);
  return addDays(key, wd === 0 ? -6 : 1 - wd);
}

function bucketKey(key: string, g: 'day' | 'week' | 'month'): string {
  if (g === 'day') return key;
  if (g === 'week') return startOfWeekKey(key);
  return monthOf(key);
}

function bucketLabel(key: string, g: 'day' | 'week' | 'month'): string {
  if (g === 'month') {
    const [y, m] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1, 12))
      .toLocaleDateString('pt-BR', { timeZone: 'UTC', month: 'short', year: '2-digit' })
      .replace('.', '');
  }
  const [y, m, d] = key.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('pt-BR', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit'
  });
  return g === 'week' ? `sem. ${base}` : base;
}

/** Todos os baldes do período, em ordem (inclusive os vazios, para o gráfico não "pular" datas). */
function bucketsOf(r: DateRange, g: 'day' | 'week' | 'month'): string[] {
  const out: string[] = [];
  for (let k = r.from; k <= r.to; k = addDays(k, 1)) {
    const b = bucketKey(k, g);
    if (out[out.length - 1] !== b) out.push(b);
  }
  return out;
}

/** Minutos entre dois 'HH:MM'. */
const minutesBetween = (a: string, b: string) => {
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  return Math.max(0, bh * 60 + bm - (ah * 60 + am));
};

function dayCapacityMinutes(h: WorkingHours): number {
  if (!h.isActive) return 0;
  let m = minutesBetween(h.startTime, h.endTime);
  if (h.breakStartTime && h.breakEndTime) m -= minutesBetween(h.breakStartTime, h.breakEndTime);
  return Math.max(0, m);
}

/** Minutos de jornada de uma profissional no período (sem almoço). Ausências cadastradas não são descontadas aqui. */
export function capacityMinutes(pro: Professional, r: DateRange): number {
  const byDay = new Map<number, number>();
  for (const h of pro.workingHours) byDay.set(h.dayOfWeek, (byDay.get(h.dayOfWeek) ?? 0) + dayCapacityMinutes(h));
  let total = 0;
  for (let k = r.from; k <= r.to; k = addDays(k, 1)) total += byDay.get(weekdayOf(k)) ?? 0;
  return total;
}

const minutesOf = (a: Appointment) =>
  Math.max(0, Math.round((new Date(a.endTime).getTime() - new Date(a.startTime).getTime()) / 60000));

/**
 * Primeiro atendimento CONCLUÍDO de cada cliente (chave de data), em toda a história.
 * Serve para separar clientes novos de recorrentes.
 */
export function firstAttendedByClient(appointments: Appointment[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of appointments) {
    if (a.status !== ATTENDED) continue;
    const k = dateOf(a);
    const cur = m.get(a.clientId);
    if (!cur || k < cur) m.set(a.clientId, k);
  }
  return m;
}

export function buildReport(
  appointments: Appointment[],
  services: Service[],
  professionals: Professional[],
  range: DateRange,
  today: string
): Report {
  const inPeriod = appointments.filter((a) => inRange(dateOf(a), range));
  const completed = inPeriod.filter((a) => a.status === ATTENDED);
  const noShows = inPeriod.filter((a) => a.status === 'NO_SHOW');
  const cancelled = inPeriod.filter((a) => a.status === 'CANCELLED');
  const forecast = inPeriod.filter(
    (a) => (a.status === 'PENDING' || a.status === 'CONFIRMED') && dateOf(a) >= today
  );

  const revenueCents = completed.reduce((s, a) => s + a.totalPriceCents, 0);
  const forecastCents = forecast.reduce((s, a) => s + a.totalPriceCents, 0);
  const attendedOrMissed = completed.length + noShows.length;

  // Clientes novos x recorrentes (entre quem foi atendido no período)
  const first = firstAttendedByClient(appointments);
  const clientsInPeriod = new Set(completed.map((a) => a.clientId));
  let newClients = 0;
  for (const id of clientsInPeriod) {
    const f = first.get(id);
    if (f && inRange(f, range)) newClients += 1;
  }

  const kpis: Kpis = {
    revenueCents,
    forecastCents,
    completed: completed.length,
    noShows: noShows.length,
    cancelled: cancelled.length,
    scheduled: inPeriod.length,
    avgTicketCents: completed.length ? Math.round(revenueCents / completed.length) : 0,
    noShowRate: attendedOrMissed ? round1((noShows.length / attendedOrMissed) * 100) : 0,
    uniqueClients: clientsInPeriod.size,
    newClients,
    returningClients: clientsInPeriod.size - newClients
  };

  // Série no tempo
  const granularity = pickGranularity(range);
  const buckets = new Map<string, SeriesPoint>();
  for (const k of bucketsOf(range, granularity)) {
    buckets.set(k, { key: k, label: bucketLabel(k, granularity), revenueCents: 0, completed: 0 });
  }
  for (const a of completed) {
    const p = buckets.get(bucketKey(dateOf(a), granularity));
    if (!p) continue;
    p.revenueCents += a.totalPriceCents;
    p.completed += 1;
  }

  // Top procedimentos (por faturamento; empate = mais atendimentos)
  const byService = new Map<string, { count: number; revenueCents: number }>();
  for (const a of completed) {
    const cur = byService.get(a.serviceId) ?? { count: 0, revenueCents: 0 };
    cur.count += 1;
    cur.revenueCents += a.totalPriceCents;
    byService.set(a.serviceId, cur);
  }
  const serviceName = new Map(services.map((s) => [s.id, s.name]));
  const procedures: ProcedureRow[] = [...byService.entries()]
    .map(([serviceId, v]) => ({
      serviceId,
      name: serviceName.get(serviceId) ?? 'Procedimento removido',
      count: v.count,
      revenueCents: v.revenueCents,
      share: revenueCents ? round1((v.revenueCents / revenueCents) * 100) : 0
    }))
    .sort((x, y) => y.revenueCents - x.revenueCents || y.count - x.count || x.name.localeCompare(y.name, 'pt-BR'));

  // Por profissional (inclui quem não atendeu no período, para a ocupação aparecer zerada)
  const rows: ProfessionalRow[] = professionals.map((pro) => {
    const mine = inPeriod.filter((a) => a.professionalId === pro.id);
    const done = mine.filter((a) => a.status === ATTENDED);
    const missed = mine.filter((a) => a.status === 'NO_SHOW');
    const rev = done.reduce((s, a) => s + a.totalPriceCents, 0);
    const booked = mine.filter((a) => BOOKED_STATUSES.has(a.status)).reduce((s, a) => s + minutesOf(a), 0);
    const capacity = capacityMinutes(pro, range);
    return {
      professionalId: pro.id,
      name: pro.name,
      completed: done.length,
      noShows: missed.length,
      revenueCents: rev,
      avgTicketCents: done.length ? Math.round(rev / done.length) : 0,
      bookedMinutes: booked,
      capacityMinutes: capacity,
      occupancy: capacity > 0 ? Math.min(100, round1((booked / capacity) * 100)) : null
    };
  });
  // Agendamentos de profissional que já foi removido do cadastro não somem do total
  const knownPros = new Set(professionals.map((p) => p.id));
  const orphan = inPeriod.filter((a) => !knownPros.has(a.professionalId) && a.status === ATTENDED);
  if (orphan.length) {
    const rev = orphan.reduce((s, a) => s + a.totalPriceCents, 0);
    rows.push({
      professionalId: 'removed',
      name: 'Profissional removido',
      completed: orphan.length,
      noShows: 0,
      revenueCents: rev,
      avgTicketCents: Math.round(rev / orphan.length),
      bookedMinutes: 0,
      capacityMinutes: 0,
      occupancy: null
    });
  }
  rows.sort((a, b) => b.revenueCents - a.revenueCents || a.name.localeCompare(b.name, 'pt-BR'));

  return { range, kpis, series: [...buckets.values()], granularity, procedures, professionals: rows };
}

/** Variação percentual entre dois valores. null = não há base de comparação. */
export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return round1(((current - previous) / previous) * 100);
}

// ---------------------------------------------------------------------------
// Comissão
// ---------------------------------------------------------------------------

export interface CommissionRow {
  professionalId: string;
  name: string;
  completed: number;
  revenueCents: number;
  /** Percentual configurado (0–100). */
  pct: number;
  commissionCents: number;
}

/** Comissão = faturamento concluído da profissional no período x percentual dela. */
export function buildCommissions(report: Report, pctByProfessional: Map<string, number>): CommissionRow[] {
  return report.professionals
    .filter((p) => p.professionalId !== 'removed')
    .map((p) => {
      const pct = pctByProfessional.get(p.professionalId) ?? 0;
      return {
        professionalId: p.professionalId,
        name: p.name,
        completed: p.completed,
        revenueCents: p.revenueCents,
        pct,
        commissionCents: Math.round((p.revenueCents * pct) / 100)
      };
    });
}

// ---------------------------------------------------------------------------
// Clientes inativos
// ---------------------------------------------------------------------------

export interface InactiveClient {
  client: ClientRecord;
  /** Chave da última visita concluída; null = nunca foi atendido. */
  lastVisit: string | null;
  /** Dias desde a última visita (ou desde o cadastro, se nunca foi atendido). */
  daysAway: number;
  completedCount: number;
}

/**
 * Cliente inativo = cadastro ativo, sem nenhum agendamento futuro e sem atendimento concluído
 * há `minDays` dias ou mais. Quem nunca foi atendido entra se o cadastro tem `minDays` dias ou mais.
 * Ordem: há mais tempo sem voltar primeiro.
 */
export function inactiveClients(
  clients: ClientRecord[],
  appointments: Appointment[],
  today: string,
  minDays = 60
): InactiveClient[] {
  const last = new Map<string, string>();
  const count = new Map<string, number>();
  const hasFuture = new Set<string>();
  for (const a of appointments) {
    const k = dateOf(a);
    if (a.status === ATTENDED) {
      if (!last.get(a.clientId) || k > last.get(a.clientId)!) last.set(a.clientId, k);
      count.set(a.clientId, (count.get(a.clientId) ?? 0) + 1);
    }
    if ((a.status === 'PENDING' || a.status === 'CONFIRMED') && k >= today) hasFuture.add(a.clientId);
  }

  const out: InactiveClient[] = [];
  for (const c of clients) {
    if (!c.isActive || hasFuture.has(c.id)) continue;
    const lastVisit = last.get(c.id) ?? null;
    const reference = lastVisit ?? localDateKey(c.createdAt);
    const daysAway = dayDiff(reference, today);
    if (daysAway < minDays) continue;
    out.push({ client: c, lastVisit, daysAway, completedCount: count.get(c.id) ?? 0 });
  }
  return out.sort((a, b) => b.daysAway - a.daysAway || a.client.fullName.localeCompare(b.client.fullName, 'pt-BR'));
}

// ---------------------------------------------------------------------------
// Aniversariantes
// ---------------------------------------------------------------------------

export interface Birthday {
  client: ClientRecord;
  /** Dia e mês do aniversário, 'MM-DD'. */
  monthDay: string;
  /** Próxima data em que cai (hoje, se for hoje), 'YYYY-MM-DD'. */
  nextDate: string;
  /** Dias até o aniversário (0 = hoje). */
  inDays: number;
  /** Idade que a pessoa completa (null se o ano de nascimento não for confiável). */
  turns: number | null;
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Próxima ocorrência de MM-DD a partir de `today`. Quem nasceu em 29/02 comemora em 28/02 nos anos não bissextos. */
function nextOccurrence(monthDay: string, today: string): string {
  const y = Number(today.slice(0, 4));
  const at = (year: number) => {
    if (monthDay === '02-29' && !isLeap(year)) return `${year}-02-28`;
    return `${year}-${monthDay}`;
  };
  const thisYear = at(y);
  return thisYear >= today ? thisYear : at(y + 1);
}

/** Aniversariantes dos próximos `withinDays` dias (hoje incluído), do mais próximo ao mais distante. */
export function upcomingBirthdays(clients: ClientRecord[], today: string, withinDays = 30): Birthday[] {
  const out: Birthday[] = [];
  for (const c of clients) {
    if (!c.isActive || !c.birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(c.birthDate)) continue;
    const monthDay = c.birthDate.slice(5);
    const month = Number(monthDay.slice(0, 2));
    const day = Number(monthDay.slice(3));
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    const next = nextOccurrence(monthDay, today);
    const inDays = dayDiff(today, next);
    if (inDays > withinDays) continue;
    const birthYear = Number(c.birthDate.slice(0, 4));
    const turns = birthYear > 1900 ? Number(next.slice(0, 4)) - birthYear : null;
    out.push({ client: c, monthDay, nextDate: next, inDays, turns: turns !== null && turns >= 0 ? turns : null });
  }
  return out.sort((a, b) => a.inDays - b.inDays || a.client.fullName.localeCompare(b.client.fullName, 'pt-BR'));
}

/** Aniversariantes de um mês específico (1–12), por dia do mês. */
export function birthdaysOfMonth(clients: ClientRecord[], month: number): { client: ClientRecord; day: number }[] {
  const out: { client: ClientRecord; day: number }[] = [];
  for (const c of clients) {
    if (!c.isActive || !c.birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(c.birthDate)) continue;
    if (Number(c.birthDate.slice(5, 7)) !== month) continue;
    out.push({ client: c, day: Number(c.birthDate.slice(8, 10)) });
  }
  return out.sort((a, b) => a.day - b.day || a.client.fullName.localeCompare(b.client.fullName, 'pt-BR'));
}

// ---------------------------------------------------------------------------
// CSV (compatível com o Excel em português: ponto e vírgula, UTF-8 com BOM, vírgula decimal)
// ---------------------------------------------------------------------------

/**
 * Protege contra "injeção de fórmula": uma célula que começa com = + - @ (ou tab/CR) seria
 * executada pelo Excel. Nomes de clientes vêm de cadastro livre, então prefixamos com apóstrofo.
 */
function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(';'));
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

/** Centavos -> "1234,50" (número puro, para o Excel somar). */
export const centsToDecimal = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

/** 'YYYY-MM-DD' -> 'DD/MM/YYYY' */
export const brDate = (key: string | null | undefined) => {
  if (!key) return '';
  const [y, m, d] = key.split('-');
  return `${d}/${m}/${y}`;
};

/** Baixa um texto como arquivo .csv no navegador. */
export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
