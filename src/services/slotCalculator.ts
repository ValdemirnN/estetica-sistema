import {
  Professional,
  Service,
  Appointment,
  BusyBlock,
  Leave,
  DayOfWeek
} from '../types/clinic';

export interface TimeSlot {
  timeStr: string;        // '14:30' (America/Sao_Paulo)
  startIso: string;       // ISO UTC
  endIso: string;         // ISO UTC
  bufferEndIso: string;   // ISO UTC
  professionalId: string; // The professional who has this slot
  professionalName: string;
  isAvailable: boolean;
}

/**
 * Converte data e hora local de São Paulo para objeto Date UTC
 */
export function parseLocalToUtc(dateStr: string, timeStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes] = timeStr.split(':').map(Number);
  // Em produção, usa biblioteca como date-fns-tz com America/Sao_Paulo (UTC-3)
  // Criamos o Date com o offset fixo de Brasília (-03:00)
  const pad = (n: number) => String(n).padStart(2, '0');
  const isoWithTz = `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:00-03:00`;
  return new Date(isoWithTz);
}

/**
 * Formata um Date para horário legível em São Paulo
 */
export function formatLocalTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  } catch {
    return isoString.slice(11, 16);
  }
}

export function formatLocalDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      weekday: 'short',
      day: '2-digit',
      month: 'short'
    });
  } catch {
    return isoString.slice(0, 10);
  }
}

/**
 * Verifica sobreposição de intervalos temporais [startA, endA) e [startB, endB)
 * Equivalente ao operador && de tsrange do PostgreSQL
 */
export function intervalsOverlap(startA: Date, endA: Date, startB: Date, endB: Date): boolean {
  return startA < endB && endA > startB;
}

/**
 * Calcula horários disponíveis para um profissional ou conjunto de profissionais
 */
export function calculateAvailableSlots(params: {
  selectedProfessionalId: string | 'AUTO_ASSIGN';
  service: Service;
  dateStr: string; // 'YYYY-MM-DD'
  professionals: Professional[];
  appointments: BusyBlock[]; // horários ocupados (de TODOS os clientes, sem dados pessoais)
  leaves?: Leave[];
  customBufferMinutes?: number;
}): TimeSlot[] {
  const {
    selectedProfessionalId,
    service,
    dateStr,
    professionals,
    appointments,
    leaves = [],
    customBufferMinutes
  } = params;

  const targetDate = new Date(`${dateStr}T12:00:00-03:00`);
  const dayOfWeek = targetDate.getDay() as DayOfWeek;

  // Filtrar profissionais qualificados para o serviço
  const eligiblePros = professionals.filter((p) => {
    const handlesService = p.specialtyServiceIds.includes(service.id);
    if (!handlesService) return false;
    if (selectedProfessionalId === 'AUTO_ASSIGN') {
      return p.isAvailableForAutoAssign;
    }
    return p.id === selectedProfessionalId;
  });

  if (eligiblePros.length === 0) return [];

  const now = new Date();
  const allSlotsMap = new Map<string, TimeSlot>();

  // Avaliar slots para cada profissional elegível
  for (const prof of eligiblePros) {
    const workingDay = prof.workingHours.find((wh) => wh.dayOfWeek === dayOfWeek);
    if (!workingDay || !workingDay.isActive) continue;

    const bufferMinutes = customBufferMinutes ?? prof.intervalBufferMinutes ?? 15;
    const durationMinutes = service.durationMinutes;

    const dayStart = parseLocalToUtc(dateStr, workingDay.startTime);
    const dayEnd = parseLocalToUtc(dateStr, workingDay.endTime);

    const breakStart = workingDay.breakStartTime ? parseLocalToUtc(dateStr, workingDay.breakStartTime) : null;
    const breakEnd = workingDay.breakEndTime ? parseLocalToUtc(dateStr, workingDay.breakEndTime) : null;

    // Buscar agendamentos existentes do profissional nesta data (status ativo)
    const profAppointments = appointments.filter(
      (a) => a.professionalId === prof.id && (a.status === 'CONFIRMED' || a.status === 'PENDING')
    );

    // Buscar ausências/folgas do profissional
    const profLeaves = leaves.filter((l) => l.professionalId === prof.id);

    // Passo da grade de horários: a cada 15 ou 30 minutos
    const stepMinutes = 15;
    let currentCursor = new Date(dayStart);

    while (true) {
      const slotStart = new Date(currentCursor);
      const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60000);
      const slotBufferEnd = new Date(slotEnd.getTime() + bufferMinutes * 60000);

      // Não ultrapassar o fim da jornada
      if (slotEnd > dayEnd) break;

      // Slot não pode estar no passado (com margem mínima de 30 minutos a partir de agora)
      const isPast = slotStart.getTime() <= now.getTime() + 30 * 60000;

      // Verifica intervalo de almoço / descanso
      let inBreak = false;
      if (breakStart && breakEnd) {
        if (intervalsOverlap(slotStart, slotEnd, breakStart, breakEnd)) {
          inBreak = true;
        }
      }

      // Verifica colisão com agendamentos existentes (considerando o buffer)
      let hasAppointmentConflict = false;
      for (const apt of profAppointments) {
        const aptStart = new Date(apt.startTime);
        const aptBufferEnd = new Date(apt.bufferEndTime); // Inclui buffer existente
        // Constraint do banco: tsrange(start, buffer_end, '[)') && tsrange(slotStart, slotBufferEnd, '[)')
        if (intervalsOverlap(slotStart, slotBufferEnd, aptStart, aptBufferEnd)) {
          hasAppointmentConflict = true;
          break;
        }
      }

      // Verifica colisão com folgas/férias
      let hasLeaveConflict = false;
      for (const leave of profLeaves) {
        const leaveStart = new Date(leave.startDatetime);
        const leaveEnd = new Date(leave.endDatetime);
        if (intervalsOverlap(slotStart, slotEnd, leaveStart, leaveEnd)) {
          hasLeaveConflict = true;
          break;
        }
      }

      const isAvailable = !isPast && !inBreak && !hasAppointmentConflict && !hasLeaveConflict;

      if (isAvailable) {
        const timeKey = formatLocalTime(slotStart.toISOString());
        // Se ainda não temos esse horário mapeado ou se estamos agregando no modo auto-assign
        if (!allSlotsMap.has(timeKey)) {
          allSlotsMap.set(timeKey, {
            timeStr: timeKey,
            startIso: slotStart.toISOString(),
            endIso: slotEnd.toISOString(),
            bufferEndIso: slotBufferEnd.toISOString(),
            professionalId: prof.id,
            professionalName: prof.name,
            isAvailable: true
          });
        }
      }

      // Avançar cursor
      currentCursor = new Date(currentCursor.getTime() + stepMinutes * 60000);
    }
  }

  // Retornar lista ordenada por horário cronológico
  return Array.from(allSlotsMap.values()).sort((a, b) => a.startIso.localeCompare(b.startIso));
}

/**
 * Validação de política de cancelamento ou remarcação respeitando antecedência mínima
 */
export function checkCancellationEligibility(
  appointment: Appointment,
  minNoticeHours: number = 24
): {
  canCancel: boolean;
  remainingHours: number;
  minNoticeHours: number;
  message: string;
} {
  const now = new Date();
  const aptTime = new Date(appointment.startTime);
  const diffMs = aptTime.getTime() - now.getTime();
  const remainingHours = Math.round((diffMs / (1000 * 60 * 60)) * 10) / 10;

  if (appointment.status === 'CANCELLED') {
    return {
      canCancel: false,
      remainingHours,
      minNoticeHours,
      message: 'Este agendamento já se encontra cancelado.'
    };
  }

  if (appointment.status === 'COMPLETED' || appointment.status === 'NO_SHOW') {
    return {
      canCancel: false,
      remainingHours,
      minNoticeHours,
      message: 'Não é possível alterar agendamentos já finalizados.'
    };
  }

  if (diffMs <= 0) {
    return {
      canCancel: false,
      remainingHours,
      minNoticeHours,
      message: 'O horário do agendamento já passou.'
    };
  }

  if (remainingHours < minNoticeHours) {
    return {
      canCancel: false,
      remainingHours,
      minNoticeHours,
      message: `A política da clínica exige antecedência mínima de ${minNoticeHours}h para cancelamento/remarcação online. Faltam apenas ${remainingHours}h. Entre em contato direto com a recepção.`
    };
  }

  return {
    canCancel: true,
    remainingHours,
    minNoticeHours,
    message: `Cancelamento permitido (faltam ${remainingHours}h para o atendimento; mínimo exigido: ${minNoticeHours}h).`
  };
}
