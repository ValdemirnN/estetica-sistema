import React, { useMemo, useState } from 'react';
import { Loader2, Repeat } from 'lucide-react';
import type { BookingInput, NewClientInput } from '../../services/api';
import { BusyBlock, ClientRecord, ClinicSettings, Leave, Professional, Service } from '../../types/clinic';
import { TimeSlot, formatLocalTime } from '../../services/slotCalculator';
import { Field, Modal, ghostBtn, inputClass, primaryBtn } from '../admin/ui';
import { ClientSearchSelector } from './ClientSearchSelector';
import { NewClientModal } from './NewClientModal';
import { SlotPicker } from './SlotPicker';
import { addDays, todayKey } from '../../lib/dates';

export interface SeriesResult {
  booked: number;
  failures: string[];
}

interface Props {
  clients: ClientRecord[];
  services: Service[];
  professionals: Professional[];
  leaves: Leave[];
  busyBlocks: BusyBlock[];
  settings: ClinicSettings;
  initialDate?: string;
  initialClientId?: string;
  onClose: () => void;
  onBookSeries: (inputs: BookingInput[], labels: string[]) => Promise<SeriesResult>;
  onCreateClient: (input: NewClientInput) => Promise<{ clientId: string; temporaryPassword: string }>;
}

/** Novo agendamento pela equipe, com repetição semanal opcional. */
export function NewAppointmentModal({
  clients,
  services,
  professionals,
  leaves,
  busyBlocks,
  settings,
  initialDate,
  initialClientId,
  onClose,
  onBookSeries,
  onCreateClient
}: Props) {
  const [clientId, setClientId] = useState(initialClientId ?? '');
  const [serviceId, setServiceId] = useState('');
  const [profId, setProfId] = useState<string | 'AUTO_ASSIGN'>('AUTO_ASSIGN');
  const [date, setDate] = useState(initialDate && initialDate >= todayKey() ? initialDate : addDays(todayKey(), 1));
  const [slot, setSlot] = useState<TimeSlot | null>(null);
  const [notes, setNotes] = useState('');
  const [repeat, setRepeat] = useState(false);
  const [weeks, setWeeks] = useState(4);
  const [saving, setSaving] = useState(false);
  const [failures, setFailures] = useState<string[] | null>(null);
  const [showNewClient, setShowNewClient] = useState(false);

  const bookable = useMemo(
    () => services.filter((s) => s.isActive && professionals.some((p) => p.isActive && p.specialtyServiceIds.includes(s.id))),
    [services, professionals]
  );
  const service = bookable.find((s) => s.id === serviceId);
  const eligiblePros = professionals.filter((p) => p.isActive && service && p.specialtyServiceIds.includes(service.id));

  const submit = async () => {
    if (!clientId || !service || !slot) return;
    const count = repeat ? weeks : 1;
    const inputs: BookingInput[] = [];
    const labels: string[] = [];
    for (let i = 0; i < count; i++) {
      const start = new Date(new Date(slot.startIso).getTime() + i * 7 * 86400000).toISOString();
      inputs.push({
        serviceId: service.id,
        startIso: start,
        professionalId: profId === 'AUTO_ASSIGN' ? null : profId,
        notes: notes.trim() || undefined,
        clientId
      });
      labels.push(
        `${new Date(start).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })} às ${formatLocalTime(start)}`
      );
    }
    setSaving(true);
    try {
      const r = await onBookSeries(inputs, labels);
      if (r.failures.length === 0) onClose();
      else setFailures(r.failures);
    } finally {
      setSaving(false);
    }
  };

  const canSubmit = !!clientId && !!service && !!slot && !saving;

  return (
    <>
      <Modal
        title="Novo agendamento"
        subtitle="O banco confere jornada, ausências e conflito de horário."
        size="lg"
        onClose={onClose}
        footer={
          failures ? (
            <button className={primaryBtn} onClick={onClose}>Fechar</button>
          ) : (
            <>
              <button className={ghostBtn} onClick={onClose} disabled={saving}>Cancelar</button>
              <button className={primaryBtn} onClick={submit} disabled={!canSubmit}>
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {repeat ? `Agendar ${weeks} semanas` : 'Confirmar agendamento'}
              </button>
            </>
          )
        }
      >
        {failures ? (
          <div className="space-y-2 text-xs">
            <p className="text-amber-300">Alguns horários não puderam ser agendados (os demais foram confirmados):</p>
            <ul className="list-disc pl-5 text-slate-300 space-y-1">
              {failures.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="space-y-4">
            <Field label="Cliente *">
              <ClientSearchSelector clients={clients} value={clientId} onChange={setClientId} onCreateNew={() => setShowNewClient(true)} />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Procedimento *">
                <select
                  className={inputClass}
                  value={serviceId}
                  onChange={(e) => {
                    setServiceId(e.target.value);
                    setProfId('AUTO_ASSIGN');
                    setSlot(null);
                  }}
                >
                  <option value="">Selecione...</option>
                  {bookable.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} — {s.durationMinutes} min
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Profissional">
                <select
                  className={inputClass}
                  value={profId}
                  disabled={!service}
                  onChange={(e) => {
                    setProfId(e.target.value);
                    setSlot(null);
                  }}
                >
                  <option value="AUTO_ASSIGN">Primeira disponível</option>
                  {eligiblePros.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </Field>
            </div>

            <SlotPicker
              service={service}
              professionalId={profId}
              dateStr={date}
              onDateChange={(d) => {
                setDate(d);
                setSlot(null);
              }}
              professionals={professionals}
              busyBlocks={busyBlocks}
              leaves={leaves}
              settings={settings}
              selected={slot}
              onSelect={setSlot}
            />

            <Field label="Observação (opcional)">
              <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} />
            </Field>

            <div className="border-t border-slate-800 pt-3 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                <input type="checkbox" className="accent-rose-500" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
                <Repeat className="w-3.5 h-3.5 text-rose-400" /> Repetir toda semana
              </label>
              {repeat && (
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  por
                  <select className={`${inputClass} !w-20`} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
                    {[2, 3, 4, 5, 6, 8, 10, 12].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                  semanas (mesmo dia e horário)
                </label>
              )}
            </div>
          </div>
        )}
      </Modal>

      {showNewClient && (
        <NewClientModal onClose={() => setShowNewClient(false)} onCreate={onCreateClient} onCreated={(id) => setClientId(id)} />
      )}
    </>
  );
}
