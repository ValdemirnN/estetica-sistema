export type UserRole = 'CLIENT' | 'PROFESSIONAL' | 'RECEPTIONIST' | 'ADMIN';

export type AppointmentStatus = 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0=Sunday, 1=Monday...

/** Situação do carregamento dos agendamentos (usada para mostrar "Tentar de novo"). */
export type AgendaStatus = 'ready' | 'refreshing' | 'error';

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
  displayOrder: number;
  isActive: boolean;
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
  imageUrl?: string;
  badge?: string;
  /** Dias entre um atendimento e o retorno recomendado (definido pelo dono). Sem valor = sem retorno. */
  returnIntervalDays?: number;
  isActive: boolean;
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
  isActive: boolean;
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

/** Dados públicos da clínica (marca): disponíveis antes do login. */
export interface ClinicBranding {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  heroBadge: string;
  heroTitle: string;
  heroSubtitle: string;
  logoUrl?: string;
  primaryColor: string; // '#e11d48'
  phone: string;
  whatsapp: string;
  address: string;
  isActive: boolean;
  /** Link de agendamento aberto aos clientes. Falso = só a equipe entra (a clínica ainda está sendo configurada). */
  bookingPublished: boolean;
}

/** Marca + regras de negócio da clínica (o dono edita tudo isto no painel). */
export interface ClinicSettings extends ClinicBranding {
  minCancelNoticeHours: number; // Antecedência mínima para cancelar/remarcar (ex: 2h ou 24h)
  defaultBufferMinutes: number; // Intervalo de higienização padrão
  slotStepMinutes: number; // De quantos em quantos minutos a grade de horários é oferecida
  autoAssignStrategy: 'ROUND_ROBIN' | 'LEAST_BUSY';
  workingDays: number[];
  /** Jornada padrão para novos profissionais (carregada pelo modelo). Sem valor = padrão do app. */
  defaultWorkingHours?: WorkingHours[];
}

/** Pessoa da equipe (ou convite pendente) mostrada na tela "Equipe e acessos". */
export interface TeamMember {
  userId: string;
  fullName: string;
  email: string;
  role: UserRole;
  isActive: boolean;
}

export interface TeamInvite {
  id: string;
  email: string;
  role: UserRole;
}

/** Linha do painel da plataforma (dono do SaaS). */
export interface PlatformClinic {
  id: string;
  slug: string;
  name: string;
  primaryColor: string;
  isActive: boolean;
  bookingPublished: boolean;
  createdAt: string;
  members: number;
  appointments30d: number;
  owners: string[];
  pendingOwnerInvites: string[];
}

/** Janela ocupada de um profissional (sem dados pessoais), usada para calcular horários livres. */
export interface BusyBlock {
  professionalId: string;
  startTime: string;     // ISO UTC
  bufferEndTime: string; // ISO UTC
  status: AppointmentStatus;
}

/** Cliente da clínica (cadastro básico; sem dados de saúde). */
export interface ClientRecord {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  cpf?: string;
  birthDate?: string;
  isActive: boolean;
  createdAt: string;
  /** Observação interna da equipe (o cliente não vê). */
  staffNotes: string;
}
