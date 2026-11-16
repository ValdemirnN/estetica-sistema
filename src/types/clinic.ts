export type UserRole = 'CLIENT' | 'PROFESSIONAL' | 'RECEPTIONIST' | 'ADMIN';

export type AppointmentStatus = 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0=Sunday, 1=Monday...

export type NotificationChannel = 'WHATSAPP' | 'EMAIL';

export type NotificationStatus = 'QUEUED' | 'SENT' | 'FAILED' | 'DELIVERED' | 'READ';

export interface UserProfile {
  id: string;
  role: UserRole;
  fullName: string;
  email: string;
  phone: string;
  cpf?: string;
  birthDate?: string;
  avatarUrl?: string;
  optInWhatsapp: boolean;
  optInEmail: boolean;
  lgpdConsentAt: string;
  termsVersion: string;
}

export interface ServiceCategory {
  id: string;
  name: string;
  slug: string;
  iconName: string;
  description: string;
}

export interface Service {
  id: string;
  categoryId: string;
  name: string;
  slug: string;
  description: string;
  durationMinutes: number;
  priceCents: number;
  recoveryInfo: string;
  requiresAnamnesis: boolean;
  imageUrl?: string;
  badge?: string;
}

export interface WorkingHours {
  dayOfWeek: DayOfWeek;
  startTime: string; // '09:00'
  endTime: string;   // '18:00'
  breakStartTime?: string; // '12:30'
  breakEndTime?: string;   // '13:30'
  isActive: boolean;
}

export interface Professional {
  id: string;
  profileId: string;
  name: string;
  title: string;
  registryNumber: string; // ex: 'CRBM-SP 34.892'
  bio: string;
  colorHex: string;
  avatarUrl: string;
  intervalBufferMinutes: number;
  isAvailableForAutoAssign: boolean;
  specialtyServiceIds: string[];
  workingHours: WorkingHours[];
}

export interface Leave {
  id: string;
  professionalId: string;
  startDatetime: string; // ISO
  endDatetime: string;   // ISO
  reason: string;
}

export interface StatusAuditEntry {
  status: AppointmentStatus;
  changedAt: string;
  changedBy: string; // User name or ID
  note?: string;
}

export interface Appointment {
  id: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  professionalId: string;
  serviceId: string;
  startTime: string;     // ISO UTC
  endTime: string;       // ISO UTC
  bufferEndTime: string; // ISO UTC (startTime + duration + buffer)
  status: AppointmentStatus;
  totalPriceCents: number;
  clientNotes?: string;
  internalStaffNotes?: string;
  cancellationReason?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  statusHistory: StatusAuditEntry[];
  createdAt: string;
}

export interface AnamnesisAccessLog {
  id: string;
  accessedBy: string;
  accessedByName: string;
  accessedAt: string;
  action: 'VIEW' | 'UPDATE' | 'EXPORT';
}

export interface AnamnesisRecord {
  id: string;
  clientId: string;
  allergies: string;
  skinType: string;
  medicalConditions: string;
  currentMedications: string;
  pregnantOrLactating: boolean;
  hasPacemakerOrImplants: boolean;
  previousReactions: string;
  filledAt: string;
  updatedAt: string;
  signatureConsent: boolean;
  accessLogs: AnamnesisAccessLog[];
}

export interface NotificationLog {
  id: string;
  appointmentId: string;
  recipientName: string;
  recipientAddress: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  templateName: string;
  scheduledFor: string;
  sentAt?: string;
  errorMessage?: string;
  payload: Record<string, any>;
}

export interface ClinicSettings {
  name: string;
  phone: string;
  address: string;
  minCancelNoticeHours: number; // Antecedência mínima para cancelar/remarcar (ex: 2h ou 24h)
  defaultBufferMinutes: number; // Intervalo de higienização padrão
  autoAssignStrategy: 'ROUND_ROBIN' | 'LEAST_BUSY';
  workingDays: number[];
}

/** Janela ocupada de um profissional (sem dados pessoais), usada para calcular horários livres. */
export interface BusyBlock {
  professionalId: string;
  startTime: string;     // ISO UTC
  bufferEndTime: string; // ISO UTC
  status: AppointmentStatus;
}

/** Item da lista de prontuários da equipe (sem dados de saúde). */
export interface AnamnesisOverviewItem {
  clientId: string;
  clientName: string;
  updatedAt: string;
  accessCount: number;
}
