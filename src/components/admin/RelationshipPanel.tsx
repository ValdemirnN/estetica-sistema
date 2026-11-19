import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarPlus, Cake, Clock, Download, Loader2, MessageCircle, Plus, UserX, Check, X, Phone } from 'lucide-react';
import {
  Appointment,
  ClientRecord,
  Professional,
  Service,
  WaitlistEntry,
  WaitlistPeriod,
  WaitlistStatus
} from '../../types/clinic';
import { todayKey } from '../../lib/dates';
import { whatsappLink } from '../../lib/format';
import { addToWaitlist, fetchWaitlist, setWaitlistStatus } from '../../services/api';
import { ViewFallback } from '../ViewFallback';
import { ClientSearchSelector } from '../clinic/ClientSearchSelector';
import { Field, Modal, errMsg, ghostBtn, inputClass, primaryBtn } from './ui';
import { brDate, birthdaysOfMonth, downloadCsv, inactiveClients, toCsv, upcomingBirthdays } from '../../services/reports';

interface Props {
  clinicId: string;
  clinicName: string;
  clients: ClientRecord[];
  appointments: Appointment[];
  services: Service[];
  professionals: Professional[];
  notify: (msg: string) => void;
  /** Abre a agenda já com o cliente escolhido. */
  onBook: (clientId: string) => void;
  onNewClient: () => void;
}

type Section = 'inactive' | 'birthdays' | 'waitlist';

const PERIOD_PT: Record<WaitlistPeriod, string> = {
  ANY: 'Qualquer horário',
  MORNING: 'Manhã',
  AFTERNOON: 'Tarde',
  EVENING: 'Noite'
};

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? '';

export function RelationshipPanel(props: Props) {
  const [section, setSection] = useState<Section>('inactive');
  const [waitCount, setWaitCount] = useState<number | null>(null);

  const tabs: { id: Section; label: string; icon: React.ReactNode }[] = [
    { id: 'inactive', label: 'Clientes inativos', icon: <UserX className="w-3.5 h-3.5" /> },
    { id: 'birthdays', label: 'Aniversariantes', icon: <Cake className="w-3.5 h-3.5" /> },
    { id: 'waitlist', label: waitCount ? `Lista de espera (${waitCount})` : 'Lista de espera', icon: <Clock className="w-3.5 h-3.5" /> }
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setSection(t.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 whitespace-nowrap transition-colors ${
              section === t.id ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {section === 'inactive' && <InactiveList {...props} />}
      {section === 'birthdays' && <BirthdaysList {...props} />}
      {section === 'waitlist' && <WaitlistSection {...props} onCount={setWaitCount} />}
    </div>
  );
}

const cardClass = 'bg-slate-900 border border-slate-800 rounded-2xl';

function WhatsAppBtn({ phone, message }: { phone: string; message: string }) {
  const link = whatsappLink(phone, message);
  if (!link) return <span className="text-[11px] text-slate-500">sem telefone válido</span>;
  return (
    <a href={link} target="_blank" rel="noopener noreferrer" className={ghostBtn} title="Abrir conversa no WhatsApp">
      <MessageCircle className="w-3.5 h-3.5 text-emerald-400" /> WhatsApp
    </a>
  );
}

// ---------------------------------------------------------------------------
// Inativos
// ---------------------------------------------------------------------------

function InactiveList({ clinicName, clients, appointments, onBook }: Props) {
  const [minDays, setMinDays] = useState(60);
  const today = todayKey();
  const list = useMemo(() => inactiveClients(clients, appointments, today, minDays), [clients, appointments, today, minDays]);

  const exportCsv = () =>
    downloadCsv(
      `clientes_inativos_${minDays}_dias_${today}`,
      toCsv(
        ['Cliente', 'Telefone', 'E-mail', 'Última visita', 'Dias sem vir', 'Atendimentos concluídos'],
        list.map((i) => [i.client.fullName, i.client.phone, i.client.email, brDate(i.lastVisit), i.daysAway, i.completedCount])
      )
    );

  return (
    <div className="space-y-3">
      <div className={`${cardClass} p-4 flex flex-wrap items-end justify-between gap-3`}>
        <div>
          <h3 className="text-base font-bold text-white">Clientes inativos ({list.length})</h3>
          <p className="text-xs text-slate-400 mt-0.5 max-w-xl">
            Sem atendimento concluído há {minDays} dias ou mais e sem nenhum horário marcado. Quem nunca foi atendido aparece depois de {minDays} dias de cadastro.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="text-xs">
            <span className="text-slate-300 font-semibold block mb-1">Sem vir há</span>
            <select className={inputClass} value={minDays} onChange={(e) => setMinDays(Number(e.target.value))}>
              {[30, 60, 90, 120, 180].map((d) => (
                <option key={d} value={d}>
                  {d} dias ou mais
                </option>
              ))}
            </select>
          </label>
          <button className={ghostBtn} onClick={exportCsv} disabled={list.length === 0}>
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
        </div>
      </div>

      <div className={`${cardClass} divide-y divide-slate-800/80 overflow-hidden`}>
        {list.length === 0 && <p className="p-5 text-xs text-slate-500">Nenhum cliente inativo com esse critério. 🎉</p>}
        {list.map((i) => (
          <div key={i.client.id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <h4 className="text-sm font-bold text-white truncate">{i.client.fullName}</h4>
              <p className="text-xs text-slate-400">{[i.client.phone, i.client.email].filter(Boolean).join(' • ') || 'Sem contato cadastrado'}</p>
              <p className="text-[11px] text-slate-500">
                {i.lastVisit ? `Última visita em ${brDate(i.lastVisit)} • ` : 'Nunca foi atendido • '}
                <b className="text-amber-300">{i.daysAway} dias</b>
                {i.lastVisit ? ' sem vir' : ' de cadastro'}
                {i.completedCount > 0 && ` • ${i.completedCount} atendimento(s) no total`}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <WhatsAppBtn
                phone={i.client.phone}
                message={`Olá, ${firstName(i.client.fullName)}! Aqui é da ${clinicName}. Sentimos sua falta! Que tal agendar um horário para cuidar de você?`}
              />
              <button className={primaryBtn} onClick={() => onBook(i.client.id)}>
                <CalendarPlus className="w-3.5 h-3.5" /> Agendar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aniversariantes
// ---------------------------------------------------------------------------

function BirthdaysList({ clinicName, clients }: Props) {
  const today = todayKey();
  const [mode, setMode] = useState<'next' | 'month'>('next');
  const [month, setMonth] = useState(Number(today.slice(5, 7)));

  const withBirthDate = clients.filter((c) => c.isActive && c.birthDate).length;
  const next = useMemo(() => upcomingBirthdays(clients, today, 30), [clients, today]);
  const ofMonth = useMemo(() => birthdaysOfMonth(clients, month), [clients, month]);

  const rows =
    mode === 'next'
      ? next.map((b) => ({
          client: b.client,
          date: `${b.monthDay.slice(3)}/${b.monthDay.slice(0, 2)}`,
          badge: b.inDays === 0 ? 'Hoje! 🎂' : b.inDays === 1 ? 'Amanhã' : `em ${b.inDays} dias`,
          highlight: b.inDays === 0,
          turns: b.turns
        }))
      : ofMonth.map((b) => ({
          client: b.client,
          date: `${String(b.day).padStart(2, '0')}/${String(month).padStart(2, '0')}`,
          badge: '',
          highlight: month === Number(today.slice(5, 7)) && b.day === Number(today.slice(8, 10)),
          turns: null as number | null
        }));

  const exportCsv = () =>
    downloadCsv(
      mode === 'next' ? `aniversariantes_proximos_30_dias_${today}` : `aniversariantes_${MONTHS[month - 1]}`,
      toCsv(
        ['Cliente', 'Aniversário (dia/mês)', 'Telefone', 'E-mail'],
        rows.map((r) => [r.client.fullName, r.date, r.client.phone, r.client.email])
      )
    );

  return (
    <div className="space-y-3">
      <div className={`${cardClass} p-4 flex flex-wrap items-end justify-between gap-3`}>
        <div>
          <h3 className="text-base font-bold text-white">Aniversariantes</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {withBirthDate} de {clients.filter((c) => c.isActive).length} clientes ativos têm a data de nascimento cadastrada.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex rounded-lg overflow-hidden border border-slate-800 text-xs font-semibold">
            <button className={`px-3 py-2 ${mode === 'next' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`} onClick={() => setMode('next')}>
              Próximos 30 dias
            </button>
            <button className={`px-3 py-2 ${mode === 'month' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`} onClick={() => setMode('month')}>
              Por mês
            </button>
          </div>
          {mode === 'month' && (
            <select className={inputClass + ' !w-auto'} value={month} aria-label="Mês" onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          )}
          <button className={ghostBtn} onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
        </div>
      </div>

      <div className={`${cardClass} divide-y divide-slate-800/80 overflow-hidden`}>
        {rows.length === 0 && (
          <p className="p-5 text-xs text-slate-500">
            {withBirthDate === 0
              ? 'Nenhum cliente com data de nascimento cadastrada. Peça a data no cadastro para ativar esta lista.'
              : 'Nenhum aniversariante neste período.'}
          </p>
        )}
        {rows.map((r) => (
          <div key={r.client.id} className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${r.highlight ? 'bg-rose-500/5' : ''}`}>
            <div className="min-w-0">
              <h4 className="text-sm font-bold text-white truncate">{r.client.fullName}</h4>
              <p className="text-xs text-slate-400">
                {r.date}
                {r.turns !== null && ` • faz ${r.turns} anos`}
                {r.badge && <span className={`ml-2 font-semibold ${r.highlight ? 'text-rose-300' : 'text-slate-300'}`}>{r.badge}</span>}
              </p>
            </div>
            <WhatsAppBtn
              phone={r.client.phone}
              message={`Feliz aniversário, ${firstName(r.client.fullName)}! 🎉 A equipe da ${clinicName} deseja um dia lindo para você!`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lista de espera
// ---------------------------------------------------------------------------

function WaitlistSection({
  clinicId,
  clinicName,
  clients,
  services,
  professionals,
  notify,
  onBook,
  onNewClient,
  onCount
}: Props & { onCount: (n: number) => void }) {
  const [entries, setEntries] = useState<WaitlistEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await fetchWaitlist(clinicId);
      setEntries(list);
      onCount(list.length);
      setError(null);
    } catch (e) {
      setError(errMsg(e));
      setEntries((prev) => prev ?? []);
    }
  }, [clinicId, onCount]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (id: string, status: WaitlistStatus) => {
    setBusyId(id);
    try {
      await setWaitlistStatus(clinicId, id, status);
      await load();
    } catch (e) {
      notify(errMsg(e));
    } finally {
      setBusyId(null);
    }
  };

  if (entries === null) return <ViewFallback />;

  const when = (e: WaitlistEntry) => {
    if (e.desiredFrom && e.desiredTo) return `${brDate(e.desiredFrom)} a ${brDate(e.desiredTo)}`;
    if (e.desiredFrom) return `a partir de ${brDate(e.desiredFrom)}`;
    if (e.desiredTo) return `até ${brDate(e.desiredTo)}`;
    return 'qualquer data';
  };

  return (
    <div className="space-y-3">
      <div className={`${cardClass} p-4 flex flex-wrap items-center justify-between gap-3`}>
        <div>
          <h3 className="text-base font-bold text-white">Lista de espera ({entries.length})</h3>
          <p className="text-xs text-slate-400 mt-0.5 max-w-xl">
            Clientes que queriam um horário que não havia. Quando surgir uma vaga, chame pelo WhatsApp e agende; o pedido mais antigo aparece primeiro.
          </p>
        </div>
        <button className={primaryBtn} onClick={() => setAdding(true)}>
          <Plus className="w-3.5 h-3.5" /> Adicionar à lista
        </button>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs rounded-xl p-3 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      <div className={`${cardClass} divide-y divide-slate-800/80 overflow-hidden`}>
        {entries.length === 0 && !error && <p className="p-5 text-xs text-slate-500">Ninguém na lista de espera.</p>}
        {entries.map((e) => (
          <div key={e.id} className="p-4 space-y-3">
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="text-sm font-bold text-white">{e.clientName}</h4>
                  {e.status === 'CONTACTED' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">Já contatado</span>
                  )}
                </div>
                <p className="text-xs text-slate-300">
                  {e.serviceName} • {e.professionalName ?? 'qualquer profissional'}
                </p>
                <p className="text-[11px] text-slate-500">
                  {when(e)} • {PERIOD_PT[e.period]} • na lista desde {new Date(e.createdAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
                </p>
                {e.notes && <p className="text-[11px] text-amber-300/80">Obs.: {e.notes}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <WhatsAppBtn
                  phone={e.clientPhone}
                  message={`Olá, ${firstName(e.clientName)}! Aqui é da ${clinicName}. Surgiu uma vaga para ${e.serviceName}. Ainda tem interesse?`}
                />
                {e.status === 'WAITING' && (
                  <button className={ghostBtn} disabled={busyId === e.id} onClick={() => act(e.id, 'CONTACTED')}>
                    <Phone className="w-3.5 h-3.5" /> Marcar contatado
                  </button>
                )}
                <button className={primaryBtn} disabled={busyId === e.id} onClick={() => onBook(e.clientId)}>
                  <CalendarPlus className="w-3.5 h-3.5" /> Agendar
                </button>
                <button
                  className={ghostBtn}
                  disabled={busyId === e.id}
                  onClick={() => act(e.id, 'BOOKED')}
                  title="Já marquei o horário: tirar da lista"
                >
                  <Check className="w-3.5 h-3.5" /> Já agendado
                </button>
                <button className={ghostBtn} disabled={busyId === e.id} onClick={() => act(e.id, 'CANCELLED')} title="Tirar da lista">
                  <X className="w-3.5 h-3.5" /> Remover
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {adding && (
        <AddWaitlistModal
          clinicId={clinicId}
          clients={clients}
          services={services}
          professionals={professionals}
          onClose={() => setAdding(false)}
          onNewClient={() => {
            setAdding(false);
            onNewClient();
          }}
          onAdded={async () => {
            setAdding(false);
            notify('Cliente adicionado à lista de espera.');
            await load();
          }}
        />
      )}
    </div>
  );
}

function AddWaitlistModal({
  clinicId,
  clients,
  services,
  professionals,
  onClose,
  onNewClient,
  onAdded
}: {
  clinicId: string;
  clients: ClientRecord[];
  services: Service[];
  professionals: Professional[];
  onClose: () => void;
  onNewClient: () => void;
  onAdded: () => Promise<void>;
}) {
  const activeServices = services.filter((s) => s.isActive);
  const [clientId, setClientId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [professionalId, setProfessionalId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [period, setPeriod] = useState<WaitlistPeriod>('ANY');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Só oferece quem faz o procedimento escolhido
  const eligible = professionals.filter(
    (p) => p.isActive && (!serviceId || p.specialtyServiceIds.length === 0 || p.specialtyServiceIds.includes(serviceId))
  );

  const submit = async () => {
    setError(null);
    if (!clientId) return setError('Escolha o cliente.');
    if (!serviceId) return setError('Escolha o procedimento.');
    if (from && to && to < from) return setError('A data final não pode ser anterior à inicial.');
    setSaving(true);
    try {
      await addToWaitlist(clinicId, { clientId, serviceId, professionalId: professionalId || undefined, desiredFrom: from || undefined, desiredTo: to || undefined, period, notes: notes.trim() });
      await onAdded();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Adicionar à lista de espera"
      subtitle="Não registre informações de saúde nas observações."
      onClose={onClose}
      footer={
        <>
          <button className={ghostBtn} onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button className={primaryBtn} onClick={submit} disabled={saving}>
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Adicionar
          </button>
        </>
      }
    >
      <Field label="Cliente">
        <ClientSearchSelector clients={clients} value={clientId} onChange={setClientId} onCreateNew={onNewClient} />
      </Field>
      <Field label="Procedimento">
        <select
          className={inputClass}
          value={serviceId}
          onChange={(e) => {
            setServiceId(e.target.value);
            setProfessionalId('');
          }}
        >
          <option value="">Selecione…</option>
          {activeServices.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Profissional" hint="Deixe em branco para aceitar qualquer uma.">
        <select className={inputClass} value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}>
          <option value="">Qualquer profissional</option>
          {eligible.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="A partir de">
          <input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Até">
          <input type="date" className={inputClass} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      <Field label="Período do dia">
        <select className={inputClass} value={period} onChange={(e) => setPeriod(e.target.value as WaitlistPeriod)}>
          {(Object.keys(PERIOD_PT) as WaitlistPeriod[]).map((p) => (
            <option key={p} value={p}>
              {PERIOD_PT[p]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Observação (opcional)">
        <textarea className={inputClass} rows={2} maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      {error && <p className="text-[11px] text-rose-300">{error}</p>}
    </Modal>
  );
}
