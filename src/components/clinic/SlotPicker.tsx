import React, { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { BusyBlock, ClinicSettings, Leave, Professional, Service } from '../../types/clinic';
import { TimeSlot, calculateAvailableSlots, formatLocalTime } from '../../services/slotCalculator';
import { Field, inputClass } from '../admin/ui';
import { todayKey } from '../../lib/dates';

interface Props {
  service: Service | undefined;
  professionalId: string | 'AUTO_ASSIGN';
  dateStr: string;
  onDateChange: (d: string) => void;
  professionals: Professional[];
  busyBlocks: BusyBlock[];
  leaves: Leave[];
  settings: ClinicSettings;
  selected: TimeSlot | null;
  onSelect: (s: TimeSlot) => void;
}

/** Escolha de dia + horário livre. Usa o mesmo cálculo do app do cliente (slotCalculator). */
export function SlotPicker({
  service,
  professionalId,
  dateStr,
  onDateChange,
  professionals,
  busyBlocks,
  leaves,
  settings,
  selected,
  onSelect
}: Props) {
  const slots = useMemo(
    () =>
      service
        ? calculateAvailableSlots({
            selectedProfessionalId: professionalId,
            service,
            dateStr,
            professionals,
            appointments: busyBlocks,
            leaves,
            customBufferMinutes: settings.defaultBufferMinutes,
            stepMinutes: settings.slotStepMinutes
          })
        : [],
    [service, professionalId, dateStr, professionals, busyBlocks, leaves, settings]
  );

  return (
    <div className="space-y-2">
      <Field label="Data">
        <input type="date" className={inputClass} min={todayKey()} value={dateStr} onChange={(e) => onDateChange(e.target.value)} />
      </Field>
      <div>
        <span className="text-xs text-slate-300 font-semibold block mb-1">
          Horários livres {service && <span className="text-slate-500 font-normal">({slots.length})</span>}
        </span>
        {!service ? (
          <p className="text-[11px] text-slate-500">Escolha o procedimento para ver os horários.</p>
        ) : slots.length === 0 ? (
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-[11px] text-slate-400 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            Nenhum horário livre neste dia. Tente outra data ou outra profissional.
          </div>
        ) : (
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5 max-h-44 overflow-y-auto p-0.5">
            {slots.map((s) => (
              <button
                type="button"
                key={`${s.startIso}-${s.professionalId}`}
                onClick={() => onSelect(s)}
                title={`${s.timeStr} às ${formatLocalTime(s.endIso)} — ${s.professionalName}`}
                className={`py-1.5 rounded-lg text-xs font-mono font-semibold border transition-all ${
                  selected?.startIso === s.startIso
                    ? 'bg-rose-600 text-white border-rose-500'
                    : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-rose-500/50 hover:text-white'
                }`}
              >
                {s.timeStr}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
