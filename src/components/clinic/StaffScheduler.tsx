import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Filter,
  MessageCircle,
  Plus,
  Repeat,
  Search,
  CalendarClock,
  History
} from 'lucide-react';
import type { BookingInput, NewClientInput } from '../../services/api';
import {
  Appointment,
  AppointmentStatus,
  BusyBlock,
  ClientRecord,
  ClinicSettings,
  Leave,
  Professional,
  Service
} from '../../types/clinic';
import { formatLocalTime } from '../../services/slotCalculator';
import { whatsappLink } from '../../lib/format';
import { addDays, formatLong, formatMonth, formatShort, localDateKey, monthGrid, monthOf, addMonths, startOfWeek, todayKey } from '../../lib/dates';
import { Field, Modal, ghostBtn, inputClass, primaryBtn } from '../admin/ui';
import { NewAppointmentModal, SeriesResult } from './NewAppointmentModal';
import { EditAppointmentModal } from './EditAppointmentModal';
import { OccupancySummary } from './OccupancySummary';

type ViewMode = 'day' | 'week' | 'month';

interface Props {
  appointments: Appointment[];
  clients: ClientRecord[];
  services: Service[];
  professionals: Professional[];
  leaves: Leave[];
  busyBlocks: BusyBlock[];
  settings: ClinicSettings;
  /** Abre o modal de novo agendamento já com este cliente (vindo da lista de clientes). */
  presetClientId?: string | null;
  onPresetConsumed?: () => void;
  onUpdateStatus: (aptId: string, status: AppointmentStatus, note?: string) => Promise<void>;
  onBookSeries: (inputs: BookingInput[], labels: string[]) => Promise<SeriesResult>;
  onReschedule: (aptId: string, startIso: string, professionalId: string | null) => Promise<boolean>;
  onCreateClient: (input: NewClientInput) => Promise<{ clientId: string; temporaryPassword: string }>;
}

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  PENDING: 'Pendente',
  CONFIRMED: 'Confirmado',
  COMPLETED: 'Concluído',
  CANCELLED: 'Cancelado',
  NO_SHOW: 'Não compareceu'
};

const STATUS_STYLE: Record<AppointmentStatus, string> = {
  PENDING: 'bg-slate-700 text-slate-200 border-slate-600',
  CONFIRMED: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  COMPLETED: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30',
  CANCELLED: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
  NO_SHOW: 'bg-amber-500/10 text-amber-400 border-amber-500/30'
};

const WEEKDAYS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

/** Agenda da equipe: dia / semana / mês, filtros, status, remarcação e lembrete por WhatsApp. */
export function StaffScheduler({
  appointments,
  clients,
  services,
  professionals,
  leaves,
  busyBlocks,
  settings,
  presetClientId,
  onPresetConsumed,
  onUpdateStatus,
  onBookSeries,
  onReschedule,
  onCreateClient
}: Props) {
  const [mode, setMode] = useState<ViewMode>('day');
  const [date, setDate] = useState(todayKey());
  const [profFilter, setProfFilter] = useState('ALL');
  const [showClosed, setShowClosed] = useState(false);
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [statusChange, setStatusChange] = useState<{ apt: Appointment; status: AppointmentStatus } | null>(null);
  const [statusNote, setStatusNote] = useState('');
  const [historyApt, setHistoryApt] = useState<Appointment | null>(null);

  // Vindo da lista de clientes ("Agendar"): abre o modal já com o cliente escolhido.
  useEffect(() => {
    if (presetClientId) setShowNew(true);
  }, [presetClientId]);

  const today = todayKey();

  const days = useMemo(() => {
    if (mode === 'day') return [date];
    if (mode === 'week') {
      const s = startOfWeek(date);
      return Array.from({ length: 7 }, (_, i) => addDays(s, i));
    }
    return monthGrid(date).filter((d) => monthOf(d) === monthOf(date));
  }, [mode, date]);

  const q = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      appointments
        .filter((a) => (profFilter === 'ALL' ? true : a.professionalId === profFilter))
        .filter((a) => showClosed || (a.status !== 'CANCELLED' && a.status !== 'NO_SHOW'))
        .filter((a) => !q || a.clientName.toLowerCase().includes(q) || a.clientPhone.replace(/\D/g, '').includes(q.replace(/\D/g, '') || '§'))
        .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [appointments, profFilter, showClosed, q]
  );

  const byDay = useMemo(() => {
    const m = new Map<string, Appointment[]>();
    for (const a of visible) {
      const k = localDateKey(a.startTime);
      (m.get(k) ?? m.set(k, []).get(k)!).push(a);
    }
    return m;
  }, [visible]);

  const inPeriod = useMemo(() => {
    const set = new Set(days);
    return visible.filter((a) => set.has(localDateKey(a.startTime)));
  }, [visible, days]);

  const shift = (dir: -1 | 1) => {
    if (mode === 'day') setDate(addDays(date, dir));
    else if (mode === 'week') setDate(addDays(date, 7 * dir));
    else setDate(addMonths(date, dir));
  };

  const title =
    mode === 'day' ? formatLong(date) : mode === 'week' ? `${formatShort(days[0])} – ${formatShort(days[6])}` : formatMonth(date);

  const requestStatus = (apt: Appointment, status: AppointmentStatus) => {
    if (status === apt.status) return;
    setStatusChange({ apt, status });
    setStatusNote('');
  };

  const reminderLink = (a: Appointment) => {
    const svc = services.find((s) => s.id === a.serviceId);
    const when = `${new Date(a.startTime).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })} às ${formatLocalTime(a.startTime)}`;
    return whatsappLink(
      a.clientPhone,
      `Olá, ${a.clientName.split(' ')[0]}! Lembrando do seu horário${svc ? ` de ${svc.name}` : ''} em ${when} na ${settings.name}. Podemos confirmar?`
    );
  };

  const Row = ({ apt }: { apt: Appointment }) => {
    const svc = services.find((s) => s.id === apt.serviceId);
    const prof = professionals.find((p) => p.id === apt.professionalId);
    const wa = reminderLink(apt);
    const open = apt.status === 'PENDING' || apt.status === 'CONFIRMED';
    return (
      <div className="p-3.5 hover:bg-slate-800/40 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div style={{ backgroundColor: prof?.colorHex || '#ec4899' }} className="w-2 h-11 rounded-full shrink-0" title={prof?.name} />
          <div className="space-y-0.5 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold text-white bg-slate-800 px-1.5 py-0.5 rounded">
                {formatLocalTime(apt.startTime)} – {formatLocalTime(apt.endTime)}
              </span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${STATUS_STYLE[apt.status]}`}>
                {STATUS_LABEL[apt.status]}
              </span>
            </div>
            <div className="text-sm font-bold text-white truncate">
              {apt.clientName} <span className="text-xs font-normal text-slate-400">{apt.clientPhone}</span>
            </div>
            <div className="text-xs text-slate-400">
              <strong className="text-rose-300">{svc?.name ?? 'Procedimento'}</strong> • {prof?.name}
            </div>
            {apt.clientNotes && <p className="text-[11px] text-slate-400">Cliente: {apt.clientNotes}</p>}
            {apt.internalStaffNotes && <p className="text-[11px] text-amber-300/80 whitespace-pre-line">{apt.internalStaffNotes}</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <select
            value={apt.status}
            onChange={(e) => requestStatus(apt, e.target.value as AppointmentStatus)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-rose-500"
            aria-label="Situação do atendimento"
          >
            {(Object.keys(STATUS_LABEL) as AppointmentStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
          {open && (
            <button className={ghostBtn} onClick={() => setEditing(apt)} title="Remarcar">
              <CalendarClock className="w-3.5 h-3.5 text-indigo-300" /> Remarcar
            </button>
          )}
          {open && wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer" className={ghostBtn} title="Enviar lembrete por WhatsApp">
              <MessageCircle className="w-3.5 h-3.5 text-emerald-400" /> Lembrete
            </a>
          )}
          <button className={ghostBtn} onClick={() => setHistoryApt(apt)} title="Histórico de alterações">
            <History className="w-3.5 h-3.5 text-slate-400" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Barra de controle */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button className={ghostBtn} onClick={() => shift(-1)} aria-label="Anterior"><ChevronLeft className="w-3.5 h-3.5" /></button>
          <button className={ghostBtn} onClick={() => setDate(today)}>Hoje</button>
          <button className={ghostBtn} onClick={() => shift(1)} aria-label="Próximo"><ChevronRight className="w-3.5 h-3.5" /></button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={`${inputClass} !w-36`} />
          <h3 className="text-sm font-bold text-white capitalize ml-1 hidden md:block">{title}</h3>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg overflow-hidden border border-slate-800">
            {(['day', 'week', 'month'] as ViewMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 text-xs font-semibold ${mode === m ? 'bg-rose-600 text-white' : 'bg-slate-950 text-slate-400 hover:text-white'}`}
              >
                {m === 'day' ? 'Dia' : m === 'week' ? 'Semana' : 'Mês'}
              </button>
            ))}
          </div>
          <button className={primaryBtn} onClick={() => setShowNew(true)}>
            <Plus className="w-3.5 h-3.5" /> Novo agendamento
          </button>
        </div>
        <h3 className="text-sm font-bold text-white capitalize md:hidden w-full">{title}</h3>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <div className="flex items-center gap-1.5 text-slate-300">
          <Filter className="w-3.5 h-3.5 text-rose-400" />
          <select value={profFilter} onChange={(e) => setProfFilter(e.target.value)} className={`${inputClass} !w-auto`}>
            <option value="ALL">Todas as profissionais</option>
            {professionals.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input className={`${inputClass} pl-8 !w-56`} placeholder="Buscar cliente..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
          <input type="checkbox" className="accent-rose-500" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          Mostrar cancelados e faltas
        </label>
        <span className="ml-auto text-slate-400">
          {inPeriod.length} agendamento(s) no período
        </span>
      </div>

      <OccupancySummary days={days} appointments={visible} professionals={profFilter === 'ALL' ? professionals : professionals.filter((p) => p.id === profFilter)} />

      {/* DIA */}
      {mode === 'day' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-800 bg-slate-950/60 text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <CalendarDays className="w-3.5 h-3.5 text-rose-400" /> {formatLong(date)}
          </div>
          <div className="divide-y divide-slate-800/80">
            {(byDay.get(date) ?? []).map((a) => <Row key={a.id} apt={a} />)}
            {(byDay.get(date) ?? []).length === 0 && <p className="p-6 text-xs text-slate-500 text-center">Nenhum agendamento neste dia.</p>}
          </div>
        </div>
      )}

      {/* SEMANA */}
      {mode === 'week' && (
        <div className="space-y-3">
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            return (
              <div key={d} className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                <button
                  onClick={() => {
                    setDate(d);
                    setMode('day');
                  }}
                  className={`w-full px-4 py-2 border-b border-slate-800 bg-slate-950/60 text-xs font-bold uppercase tracking-wider flex items-center justify-between ${d === today ? 'text-rose-300' : 'text-white'}`}
                >
                  <span className="capitalize">{formatShort(d)}{d === today && ' • hoje'}</span>
                  <span className="text-slate-400 font-normal normal-case">{list.length} agendamento(s)</span>
                </button>
                {list.length > 0 && <div className="divide-y divide-slate-800/80">{list.map((a) => <Row key={a.id} apt={a} />)}</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* MÊS */}
      {mode === 'month' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3">
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase text-slate-500 mb-1">
            {WEEKDAYS.map((w) => <div key={w}>{w}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {monthGrid(date).map((d) => {
              const list = byDay.get(d) ?? [];
              const inMonth = monthOf(d) === monthOf(date);
              return (
                <button
                  key={d}
                  onClick={() => {
                    setDate(d);
                    setMode('day');
                  }}
                  className={`min-h-[64px] rounded-lg border p-1.5 text-left transition-colors ${
                    d === today ? 'border-rose-500/60' : 'border-slate-800'
                  } ${inMonth ? 'bg-slate-950 hover:bg-slate-800' : 'bg-slate-950/40 opacity-50'}`}
                >
                  <div className="text-[11px] text-slate-300">{Number(d.slice(8))}</div>
                  {list.length > 0 && (
                    <div className="mt-1 text-[10px] font-semibold text-rose-300 bg-rose-500/10 rounded px-1 inline-block">{list.length}</div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Modais */}
      {showNew && (
        <NewAppointmentModal
          clients={clients}
          services={services}
          professionals={professionals}
          leaves={leaves}
          busyBlocks={busyBlocks}
          settings={settings}
          initialDate={date}
          initialClientId={presetClientId ?? undefined}
          onClose={() => {
            setShowNew(false);
            onPresetConsumed?.();
          }}
          onBookSeries={onBookSeries}
          onCreateClient={onCreateClient}
        />
      )}

      {editing && (
        <EditAppointmentModal
          appointment={editing}
          service={services.find((s) => s.id === editing.serviceId)}
          professionals={professionals}
          leaves={leaves}
          busyBlocks={busyBlocks}
          settings={settings}
          onClose={() => setEditing(null)}
          onReschedule={onReschedule}
        />
      )}

      {statusChange && (
        <Modal
          title="Alterar situação"
          subtitle={`${statusChange.apt.clientName}: ${STATUS_LABEL[statusChange.apt.status]} → ${STATUS_LABEL[statusChange.status]}`}
          onClose={() => setStatusChange(null)}
          footer={
            <>
              <button className={ghostBtn} onClick={() => setStatusChange(null)}>Cancelar</button>
              <button
                className={primaryBtn}
                onClick={async () => {
                  const { apt, status } = statusChange;
                  setStatusChange(null);
                  await onUpdateStatus(apt.id, status, statusNote);
                }}
              >
                Confirmar
              </button>
            </>
          }
        >
          <Field label="Anotação (opcional)" hint="Fica registrada no histórico do agendamento.">
            <input className={inputClass} value={statusNote} onChange={(e) => setStatusNote(e.target.value)} placeholder="Ex.: cliente avisou que não vem" />
          </Field>
          {(statusChange.status === 'CANCELLED' || statusChange.status === 'COMPLETED' || statusChange.status === 'NO_SHOW') && (
            <p className="text-[11px] text-slate-500 mt-3">Os avisos ainda não enviados deste agendamento saem da fila.</p>
          )}
        </Modal>
      )}

      {historyApt && (
        <Modal title="Histórico do agendamento" subtitle={historyApt.clientName} onClose={() => setHistoryApt(null)}>
          <div className="space-y-1.5 text-[11px] text-slate-400">
            {historyApt.statusHistory.length === 0 && <p>Sem alterações registradas.</p>}
            {historyApt.statusHistory.map((h, i) => (
              <div key={i} className="bg-slate-950 p-2 rounded border border-slate-800/80">
                <strong className="text-white">{STATUS_LABEL[h.status]}</strong> por {h.changedBy} em{' '}
                {new Date(h.changedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
                {h.note ? ` — “${h.note}”` : ''}
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
