import React, { useMemo, useState } from 'react';
import { CalendarClock, Loader2, X } from 'lucide-react';
import { Appointment, BusyBlock, ClinicSettings, Leave, Professional, Service } from '../../types/clinic';
import { TimeSlot, formatLocalDate, formatLocalTime } from '../../services/slotCalculator';
import { SlotPicker } from '../clinic/SlotPicker';
import { Field, inputClass } from '../admin/ui';
import { addDays, todayKey } from '../../lib/dates';

interface Props {
  appointment: Appointment;
  service: Service | undefined;
  professionals: Professional[];
  busyBlocks: BusyBlock[];
  leaves: Leave[];
  settings: ClinicSettings;
  onClose: () => void;
  /** Devolve true se remarcou (o App já mostra o motivo quando falha). */
  onConfirm: (startIso: string, professionalId: string) => Promise<boolean>;
}

/** Remarcação pelo cliente. A antecedência mínima e os conflitos são conferidos de novo no banco. */
export function RescheduleModal({ appointment, service, professionals, busyBlocks, leaves, settings, onClose, onConfirm }: Props) {
  const [profChoice, setProfChoice] = useState<string | 'AUTO_ASSIGN'>(appointment.professionalId);
  const [dateStr, setDateStr] = useState(addDays(todayKey(), 1));
  const [slot, setSlot] = useState<TimeSlot | null>(null);
  const [saving, setSaving] = useState(false);

  const eligibleProfs = useMemo(
    () => professionals.filter((p) => p.isActive && !!service && p.specialtyServiceIds.includes(service.id)),
    [professionals, service]
  );

  // O horário atual do próprio agendamento não pode bloquear a nova grade (ex.: adiantar 30 min).
  const otherBusy = useMemo(
    () =>
      busyBlocks.filter(
        (b) =>
          !(
            b.professionalId === appointment.professionalId &&
            b.startTime === appointment.startTime &&
            b.bufferEndTime === appointment.bufferEndTime
          )
      ),
    [busyBlocks, appointment]
  );

  const submit = async () => {
    if (!slot || saving) return;
    setSaving(true);
    try {
      if (await onConfirm(slot.startIso, slot.professionalId)) onClose();
      else setSlot(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2 text-white font-bold text-base">
            <CalendarClock className="w-5 h-5 text-rose-400" /> Remarcar agendamento
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Fechar">
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">
          <strong className="text-white">{service?.name ?? 'Procedimento'}</strong> — hoje marcado para{' '}
          {formatLocalDate(appointment.startTime)} às {formatLocalTime(appointment.startTime)}. A remarcação online é
          permitida até {settings.minCancelNoticeHours}h antes do horário atual.
        </p>

        <Field label="Profissional">
          <select
            className={inputClass}
            value={profChoice}
            onChange={(e) => {
              setProfChoice(e.target.value);
              setSlot(null);
            }}
          >
            {eligibleProfs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.id === appointment.professionalId ? ' (atual)' : ''}
              </option>
            ))}
            <option value="AUTO_ASSIGN">Primeiro disponível</option>
          </select>
        </Field>

        <SlotPicker
          service={service}
          professionalId={profChoice}
          dateStr={dateStr}
          onDateChange={(d) => {
            setDateStr(d);
            setSlot(null);
          }}
          professionals={professionals}
          busyBlocks={otherBusy}
          leaves={leaves}
          settings={settings}
          selected={slot}
          onSelect={setSlot}
        />

        {slot && (
          <p className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3">
            Novo horário: <strong>{formatLocalDate(slot.startIso)}</strong> às <strong>{slot.timeStr}</strong> ({slot.professionalName})
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300">
            Manter horário atual
          </button>
          <button
            disabled={!slot || saving}
            onClick={submit}
            className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Confirmar remarcação
          </button>
        </div>
      </div>
    </div>
  );
}
