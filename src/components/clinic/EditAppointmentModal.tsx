import React, { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Appointment, BusyBlock, ClinicSettings, Leave, Professional, Service } from '../../types/clinic';
import { TimeSlot, formatLocalDate, formatLocalTime } from '../../services/slotCalculator';
import { Field, Modal, ghostBtn, inputClass, primaryBtn } from '../admin/ui';
import { SlotPicker } from './SlotPicker';
import { localDateKey } from '../../lib/dates';

interface Props {
  appointment: Appointment;
  service: Service | undefined;
  professionals: Professional[];
  leaves: Leave[];
  busyBlocks: BusyBlock[];
  settings: ClinicSettings;
  onClose: () => void;
  onReschedule: (aptId: string, startIso: string, professionalId: string | null) => Promise<boolean>;
}

/** Remarcar: nova data/horário e, se quiser, outra profissional. */
export function EditAppointmentModal({ appointment, service, professionals, leaves, busyBlocks, settings, onClose, onReschedule }: Props) {
  const [profId, setProfId] = useState<string>(appointment.professionalId);
  const [date, setDate] = useState(localDateKey(appointment.startTime));
  const [slot, setSlot] = useState<TimeSlot | null>(null);
  const [saving, setSaving] = useState(false);

  // O próprio horário do agendamento não pode bloquear a remarcação dele mesmo.
  const blocks = useMemo(
    () => busyBlocks.filter((b) => !(b.professionalId === appointment.professionalId && b.startTime === appointment.startTime)),
    [busyBlocks, appointment]
  );
  const eligiblePros = professionals.filter((p) => p.isActive && service && p.specialtyServiceIds.includes(service.id));

  const submit = async () => {
    if (!slot) return;
    setSaving(true);
    const ok = await onReschedule(appointment.id, slot.startIso, profId === appointment.professionalId ? null : profId);
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Modal
      title="Remarcar agendamento"
      subtitle={`${appointment.clientName} • ${service?.name ?? ''} • hoje marcado para ${formatLocalDate(appointment.startTime)} às ${formatLocalTime(appointment.startTime)}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className={ghostBtn} onClick={onClose} disabled={saving}>Cancelar</button>
          <button className={primaryBtn} onClick={submit} disabled={!slot || saving}>
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Salvar novo horário
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Profissional">
          <select
            className={inputClass}
            value={profId}
            onChange={(e) => {
              setProfId(e.target.value);
              setSlot(null);
            }}
          >
            {eligiblePros.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </Field>
        <SlotPicker
          service={service}
          professionalId={profId}
          dateStr={date}
          onDateChange={(d) => {
            setDate(d);
            setSlot(null);
          }}
          professionals={professionals}
          busyBlocks={blocks}
          leaves={leaves}
          settings={settings}
          selected={slot}
          onSelect={setSlot}
        />
      </div>
    </Modal>
  );
}
