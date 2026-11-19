import { Appointment, Service, ServiceCategory } from '../types/clinic';
import { addDays, addMonths, localDateKey, monthOf } from '../lib/dates';

/**
 * Cálculos do painel do cliente. Funções puras (sem React, sem rede): recebem os
 * agendamentos reais e a "data de agora" e devolvem o que o painel mostra.
 * Todas as datas são tratadas no fuso de Brasília (America/Sao_Paulo).
 */

const completedOf = (appointments: Appointment[], clientId: string) =>
  appointments.filter((a) => a.clientId === clientId && a.status === 'COMPLETED');

/** Diferença em dias entre duas chaves 'YYYY-MM-DD' (b - a). */
export function dayDiff(a: string, b: string): number {
  const [ya, ma, da] = a.split('-').map(Number);
  const [yb, mb, db] = b.split('-').map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

// ---------------------------------------------------------------------------
// 1. Atendimentos concluídos por mês (últimos N meses, incluindo o atual)
// ---------------------------------------------------------------------------

export interface MonthlyPoint {
  /** 'YYYY-MM' */
  key: string;
  /** Rótulo curto do eixo: 'nov' (ou 'nov/26' quando a série cruza dois anos). */
  label: string;
  /** Rótulo completo para o tooltip: 'novembro de 2026'. */
  fullLabel: string;
  sessions: number;
}

export function monthlySessions(
  appointments: Appointment[],
  clientId: string,
  now: Date = new Date(),
  months = 6
): MonthlyPoint[] {
  const currentFirst = `${monthOf(localDateKey(now))}-01`;
  const firsts = Array.from({ length: months }, (_, i) => addMonths(currentFirst, i - (months - 1)));

  const counts = new Map<string, number>();
  for (const a of completedOf(appointments, clientId)) {
    const key = monthOf(localDateKey(a.startTime));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const spansYears = monthOf(firsts[0]).slice(0, 4) !== monthOf(firsts[firsts.length - 1]).slice(0, 4);
  return firsts.map((first) => {
    const [y, m] = first.split('-').map(Number);
    const ref = new Date(Date.UTC(y, m - 1, 1, 12));
    const short = ref.toLocaleDateString('pt-BR', { timeZone: 'UTC', month: 'short' }).replace('.', '');
    const key = monthOf(first);
    return {
      key,
      label: spansYears ? `${short}/${String(y).slice(2)}` : short,
      fullLabel: ref.toLocaleDateString('pt-BR', { timeZone: 'UTC', month: 'long', year: 'numeric' }),
      sessions: counts.get(key) ?? 0
    };
  });
}

// ---------------------------------------------------------------------------
// 2. Mix de procedimentos por categoria (id real, nome vindo do banco)
// ---------------------------------------------------------------------------

export interface CategorySlice {
  categoryId: string;
  name: string;
  value: number;
}

export function categoryMix(
  appointments: Appointment[],
  clientId: string,
  services: Service[],
  categories: ServiceCategory[]
): CategorySlice[] {
  const serviceById = new Map(services.map((s) => [s.id, s]));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  const counts = new Map<string, number>();
  for (const a of completedOf(appointments, clientId)) {
    const service = serviceById.get(a.serviceId);
    if (!service) continue;
    counts.set(service.categoryId, (counts.get(service.categoryId) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([categoryId, value]) => ({ categoryId, name: categoryName.get(categoryId) ?? 'Outros', value }))
    .sort((x, y) => y.value - x.value || x.name.localeCompare(y.name, 'pt-BR'));
}

// ---------------------------------------------------------------------------
// 3. Tempo dedicado (duração real dos atendimentos concluídos)
// ---------------------------------------------------------------------------

export function careMinutes(appointments: Appointment[], clientId: string): number {
  return completedOf(appointments, clientId).reduce((sum, a) => {
    const minutes = (new Date(a.endTime).getTime() - new Date(a.startTime).getTime()) / 60_000;
    return sum + (Number.isFinite(minutes) && minutes > 0 ? minutes : 0);
  }, 0);
}

// ---------------------------------------------------------------------------
// 4. Cronograma preventivo: intervalo do procedimento + último atendimento do cliente
// ---------------------------------------------------------------------------

export type DueStatus = 'overdue' | 'today' | 'soon' | 'upcoming';

export interface PreventiveItem {
  serviceId: string;
  name: string;
  intervalDays: number;
  lastDoneKey: string;
  dueKey: string;
  /** Negativo = atrasado. */
  daysUntilDue: number;
  status: DueStatus;
}

/** "Em breve" = vence em até este número de dias. */
export const SOON_DAYS = 14;

export function preventiveSchedule(
  appointments: Appointment[],
  clientId: string,
  services: Service[],
  now: Date = new Date()
): PreventiveItem[] {
  const today = localDateKey(now);
  const mine = appointments.filter((a) => a.clientId === clientId);

  // Procedimentos que o cliente já tem marcado: não precisa lembrar do retorno.
  const alreadyBooked = new Set(
    mine
      .filter((a) => (a.status === 'CONFIRMED' || a.status === 'PENDING') && new Date(a.startTime) >= now)
      .map((a) => a.serviceId)
  );

  // Último atendimento concluído de cada procedimento.
  const lastDone = new Map<string, string>();
  for (const a of mine) {
    if (a.status !== 'COMPLETED') continue;
    const key = localDateKey(a.startTime);
    const prev = lastDone.get(a.serviceId);
    if (!prev || key > prev) lastDone.set(a.serviceId, key);
  }

  const items: PreventiveItem[] = [];
  for (const service of services) {
    const interval = service.returnIntervalDays;
    const last = lastDone.get(service.id);
    if (!service.isActive || !interval || interval < 1 || !last || alreadyBooked.has(service.id)) continue;

    const dueKey = addDays(last, interval);
    const daysUntilDue = dayDiff(today, dueKey);
    const status: DueStatus =
      daysUntilDue < 0 ? 'overdue' : daysUntilDue === 0 ? 'today' : daysUntilDue <= SOON_DAYS ? 'soon' : 'upcoming';
    items.push({ serviceId: service.id, name: service.name, intervalDays: interval, lastDoneKey: last, dueKey, daysUntilDue, status });
  }

  return items.sort((x, y) => x.dueKey.localeCompare(y.dueKey) || x.name.localeCompare(y.name, 'pt-BR'));
}

/** Texto curto do prazo: 'Hoje', 'Em 5 dias', 'Em 3 meses', 'Atrasado há 12 dias'. */
export function dueText(item: Pick<PreventiveItem, 'daysUntilDue'>): string {
  const d = item.daysUntilDue;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (d === 0) return 'Hoje';
  if (d < 0) return `Atrasado há ${plural(-d, 'dia', 'dias')}`;
  if (d <= 60) return `Em ${plural(d, 'dia', 'dias')}`;
  return `Em ${plural(Math.round(d / 30), 'mês', 'meses')}`;
}

/** Texto do intervalo configurado: 'a cada 30 dias', 'a cada 4 meses'. */
export function intervalText(days: number): string {
  if (days % 30 === 0 && days >= 60) return `a cada ${days / 30} meses`;
  return days === 1 ? 'todo dia' : `a cada ${days} dias`;
}
