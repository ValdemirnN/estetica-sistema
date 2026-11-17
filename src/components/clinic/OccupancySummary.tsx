import React, { useMemo } from 'react';
import { Appointment, Professional } from '../../types/clinic';
import { localDateKey, weekdayOf } from '../../lib/dates';

interface Props {
  days: string[]; // 'YYYY-MM-DD'
  appointments: Appointment[];
  professionals: Professional[];
}

const toMin = (t?: string) => {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

/** Ocupação por profissional no período: minutos agendados ÷ minutos de jornada (sem descontar ausências). */
export function OccupancySummary({ days, appointments, professionals }: Props) {
  const rows = useMemo(() => {
    const set = new Set(days);
    return professionals
      .filter((p) => p.isActive)
      .map((p) => {
        let available = 0;
        for (const d of days) {
          const wh = p.workingHours.find((w) => w.dayOfWeek === weekdayOf(d) && w.isActive);
          if (wh) available += toMin(wh.endTime) - toMin(wh.startTime) - (wh.breakStartTime && wh.breakEndTime ? toMin(wh.breakEndTime) - toMin(wh.breakStartTime) : 0);
        }
        const booked = appointments
          .filter((a) => a.professionalId === p.id && ['PENDING', 'CONFIRMED', 'COMPLETED'].includes(a.status) && set.has(localDateKey(a.startTime)))
          .reduce((sum, a) => sum + (new Date(a.endTime).getTime() - new Date(a.startTime).getTime()) / 60000, 0);
        return { p, available, booked, pct: available > 0 ? Math.min(100, Math.round((booked / available) * 100)) : 0 };
      })
      .filter((r) => r.available > 0 || r.booked > 0);
  }, [days, appointments, professionals]);

  if (rows.length === 0) return null;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2.5">
      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Ocupação no período</span>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2.5">
        {rows.map(({ p, available, booked, pct }) => (
          <div key={p.id} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-200 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.colorHex }} />
                {p.name}
              </span>
              <span className="text-slate-400 font-mono">
                {Math.round(booked / 6) / 10}h de {Math.round(available / 6) / 10}h • {pct}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: p.colorHex }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
