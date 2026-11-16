import { supabase } from '../lib/supabase';
import {
  AnamnesisAccessLog,
  AnamnesisOverviewItem,
  AnamnesisRecord,
  Appointment,
  AppointmentStatus,
  BusyBlock,
  ClinicSettings,
  DayOfWeek,
  Leave,
  NotificationLog,
  Professional,
  Service,
  ServiceCategory,
  UserProfile,
  WorkingHours
} from '../types/clinic';

/** Erro do banco já com mensagem legível (as RPCs levantam mensagens em português). */
export class ApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

function fail(error: { message: string; code?: string }, context: string): never {
  // 42P01 = tabela inexistente → migrations não foram aplicadas
  if (error.code === '42P01' || error.code === 'PGRST205' || error.code === 'PGRST202') {
    throw new ApiError(
      `${context}: o banco ainda não tem as tabelas/funções esperadas. Aplique as migrations em supabase/migrations.`,
      error.code
    );
  }
  throw new ApiError(error.message, error.code);
}

const DAY_FROM_DB: Record<string, DayOfWeek> = {
  SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6
};

const hhmm = (t?: string | null) => (t ? t.slice(0, 5) : undefined);

// ---------------------------------------------------------------------------
// Autenticação
// ---------------------------------------------------------------------------

export async function signIn(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (/invalid login credentials/i.test(error.message)) throw new ApiError('E-mail ou senha incorretos.');
    if (/email not confirmed/i.test(error.message)) throw new ApiError('Confirme seu e-mail antes de entrar (veja sua caixa de entrada).');
    throw new ApiError(error.message);
  }
}

/** Retorna true se o projeto exige confirmação por e-mail (não há sessão imediata). */
export async function signUp(params: { email: string; password: string; fullName: string; phone: string }) {
  const { data, error } = await supabase.auth.signUp({
    email: params.email,
    password: params.password,
    options: { data: { full_name: params.fullName, phone: params.phone } }
  });
  if (error) throw new ApiError(error.message);
  return { needsEmailConfirmation: !data.session };
}

export async function signOut() {
  await supabase.auth.signOut();
}

// ---------------------------------------------------------------------------
// Perfil
// ---------------------------------------------------------------------------

export async function fetchProfile(userId: string): Promise<UserProfile> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) fail(error, 'Perfil');
  if (!data) throw new ApiError('Perfil não encontrado. Se o cadastro acabou de ser feito, tente novamente em instantes.');
  return {
    id: data.id,
    role: data.role,
    fullName: data.full_name,
    email: data.email,
    phone: data.phone ?? '',
    cpf: data.cpf ?? undefined,
    birthDate: data.birth_date ?? undefined,
    avatarUrl: data.avatar_url || undefined,
    optInWhatsapp: data.opt_in_whatsapp,
    optInEmail: data.opt_in_email,
    lgpdConsentAt: data.lgpd_consent_at,
    termsVersion: data.lgpd_terms_version
  };
}

// ---------------------------------------------------------------------------
// Catálogo, profissionais, configurações (leitura liberada a qualquer usuário logado)
// ---------------------------------------------------------------------------

export interface Catalog {
  categories: ServiceCategory[];
  services: Service[];
  professionals: Professional[];
  leaves: Leave[];
  settings: ClinicSettings;
}

export async function fetchCatalog(): Promise<Catalog> {
  const [cats, svcs, pros, leaves, settings] = await Promise.all([
    supabase.from('service_categories').select('*').eq('is_active', true).order('display_order'),
    supabase.from('services').select('*').eq('is_active', true).order('name'),
    supabase
      .from('professionals')
      .select('*, professional_working_hours(*), professional_services(service_id)')
      .order('name'),
    supabase.from('professional_leaves').select('*').gte('end_datetime', new Date().toISOString()),
    supabase.from('clinic_settings').select('*').maybeSingle()
  ]);

  if (cats.error) fail(cats.error, 'Categorias');
  if (svcs.error) fail(svcs.error, 'Serviços');
  if (pros.error) fail(pros.error, 'Profissionais');
  if (leaves.error) fail(leaves.error, 'Ausências');
  if (settings.error) fail(settings.error, 'Configurações');
  if (!settings.data) {
    throw new ApiError('Configurações da clínica não encontradas. Aplique a migration 20261116000100_app_integration.sql.');
  }

  return {
    categories: cats.data.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      iconName: c.icon_name,
      description: c.description ?? ''
    })),
    services: svcs.data.map((s) => ({
      id: s.id,
      categoryId: s.category_id,
      name: s.name,
      slug: s.slug,
      description: s.description ?? '',
      durationMinutes: s.duration_minutes,
      priceCents: s.price_cents,
      recoveryInfo: s.recovery_info ?? '',
      requiresAnamnesis: s.requires_anamnesis,
      imageUrl: s.image_url ?? undefined,
      badge: s.badge ?? undefined
    })),
    professionals: pros.data.map((p) => ({
      id: p.id,
      profileId: p.profile_id,
      name: p.name ?? 'Profissional',
      title: p.title ?? '',
      registryNumber: p.registry_number ?? '',
      bio: p.bio ?? '',
      colorHex: p.color_hex,
      avatarUrl: p.avatar_url ?? '',
      intervalBufferMinutes: p.interval_buffer_minutes,
      isAvailableForAutoAssign: p.is_available_for_auto_assign,
      specialtyServiceIds: (p.professional_services ?? []).map((x: { service_id: string }) => x.service_id),
      workingHours: (p.professional_working_hours ?? []).map(
        (w: any): WorkingHours => ({
          dayOfWeek: DAY_FROM_DB[w.day_of_week],
          startTime: hhmm(w.start_time)!,
          endTime: hhmm(w.end_time)!,
          breakStartTime: hhmm(w.break_start_time),
          breakEndTime: hhmm(w.break_end_time),
          isActive: w.is_active
        })
      )
    })),
    leaves: leaves.data.map((l) => ({
      id: l.id,
      professionalId: l.professional_id,
      startDatetime: l.start_datetime,
      endDatetime: l.end_datetime,
      reason: l.reason ?? ''
    })),
    settings: mapSettings(settings.data)
  };
}

function mapSettings(r: any): ClinicSettings {
  return {
    name: r.name,
    phone: r.phone,
    address: r.address,
    minCancelNoticeHours: r.min_cancel_notice_hours,
    defaultBufferMinutes: r.default_buffer_minutes,
    autoAssignStrategy: r.auto_assign_strategy,
    workingDays: r.working_days
  };
}

/** Só o nome da clínica; usado na tela de login, antes de qualquer dado privado. */
export async function fetchClinicName(): Promise<string | null> {
  const { data } = await supabase.from('clinic_settings').select('name').maybeSingle();
  return data?.name ?? null;
}

// ---------------------------------------------------------------------------
// Escritas administrativas (RLS: somente ADMIN).
// Uma escrita bloqueada por RLS NÃO gera erro no Supabase: volta 0 linhas.
// Por isso conferimos as linhas afetadas.
// ---------------------------------------------------------------------------

const NOT_ALLOWED = 'Você não tem permissão para esta alteração (apenas o perfil Admin).';

export async function updateProfessional(prof: Professional): Promise<void> {
  const { data, error } = await supabase
    .from('professionals')
    .update({
      name: prof.name,
      title: prof.title,
      bio: prof.bio,
      registry_number: prof.registryNumber,
      color_hex: prof.colorHex,
      avatar_url: prof.avatarUrl || null,
      interval_buffer_minutes: prof.intervalBufferMinutes,
      is_available_for_auto_assign: prof.isAvailableForAutoAssign
    })
    .eq('id', prof.id)
    .select('id');
  if (error) fail(error, 'Profissional');
  if (!data?.length) throw new ApiError(NOT_ALLOWED);
}

export async function updateSettings(s: ClinicSettings): Promise<void> {
  const { data, error } = await supabase
    .from('clinic_settings')
    .update({
      name: s.name,
      phone: s.phone,
      address: s.address,
      min_cancel_notice_hours: s.minCancelNoticeHours,
      default_buffer_minutes: s.defaultBufferMinutes,
      auto_assign_strategy: s.autoAssignStrategy,
      working_days: s.workingDays
    })
    .eq('id', true)
    .select('id');
  if (error) fail(error, 'Configurações');
  if (!data?.length) throw new ApiError(NOT_ALLOWED);
}

// ---------------------------------------------------------------------------
// Agendamentos
// ---------------------------------------------------------------------------

const APPOINTMENT_SELECT =
  '*, client:profiles!appointments_client_id_fkey(full_name, phone, email), ' +
  'history:appointment_status_history(status, changed_at, changed_by_name, note)';

/** Cliente recebe só os próprios agendamentos; equipe recebe todos (RLS decide). */
export async function fetchAppointments(): Promise<Appointment[]> {
  const { data, error } = await supabase
    .from('appointments')
    .select(APPOINTMENT_SELECT)
    .order('start_time', { ascending: false });
  if (error) fail(error, 'Agendamentos');

  return (data ?? []).map((a: any): Appointment => ({
    id: a.id,
    clientId: a.client_id,
    clientName: a.client?.full_name ?? 'Cliente',
    clientPhone: a.client?.phone ?? '',
    clientEmail: a.client?.email ?? '',
    professionalId: a.professional_id,
    serviceId: a.service_id,
    startTime: a.start_time,
    endTime: a.end_time,
    bufferEndTime: a.buffer_end_time,
    status: a.status,
    totalPriceCents: a.total_price_cents,
    clientNotes: a.client_notes ?? undefined,
    internalStaffNotes: a.internal_staff_notes ?? undefined,
    cancellationReason: a.cancellation_reason ?? undefined,
    cancelledAt: a.cancelled_at ?? undefined,
    cancelledBy: a.cancelled_by ?? undefined,
    statusHistory: (a.history ?? [])
      .map((h: any) => ({
        status: h.status as AppointmentStatus,
        changedAt: h.changed_at,
        changedBy: h.changed_by_name ?? 'Sistema',
        note: h.note ?? undefined
      }))
      .sort((x: any, y: any) => x.changedAt.localeCompare(y.changedAt)),
    createdAt: a.created_at
  }));
}

/** Horários ocupados de todos os profissionais, sem dados pessoais (para a grade de horários). */
export async function fetchBusyBlocks(daysAhead = 60): Promise<BusyBlock[]> {
  const from = new Date();
  const to = new Date(from.getTime() + daysAhead * 86400000);
  const { data, error } = await supabase.rpc('get_busy_slots', {
    p_from: from.toISOString(),
    p_to: to.toISOString()
  });
  if (error) fail(error, 'Horários ocupados');
  return (data ?? []).map((b: any) => ({
    professionalId: b.professional_id,
    startTime: b.start_time,
    bufferEndTime: b.buffer_end_time,
    status: 'CONFIRMED' as AppointmentStatus
  }));
}

export interface BookingInput {
  serviceId: string;
  startIso: string;
  /** null = "primeiro disponível" (o banco escolhe com distribuição justa) */
  professionalId: string | null;
  notes?: string;
  /** Equipe agendando em nome de um cliente */
  clientId?: string;
}

/** Retorna o id do agendamento. Erro com code '23P01' = horário acabou de ser tomado. */
export async function bookAppointment(input: BookingInput): Promise<string> {
  const { data, error } = await supabase.rpc('book_appointment', {
    p_service_id: input.serviceId,
    p_start_time: input.startIso,
    p_professional_id: input.professionalId,
    p_client_notes: input.notes ?? null,
    p_client_id: input.clientId ?? null
  });
  if (error) fail(error, 'Agendamento');
  return data as string;
}

export async function cancelMyAppointment(appointmentId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_my_appointment', {
    p_appointment_id: appointmentId,
    p_reason: reason || null
  });
  if (error) fail(error, 'Cancelamento');
}

export async function updateAppointmentStatus(
  appointmentId: string,
  status: AppointmentStatus,
  note?: string
): Promise<void> {
  const { error } = await supabase.rpc('update_appointment_status', {
    p_appointment_id: appointmentId,
    p_status: status,
    p_note: note || null
  });
  if (error) fail(error, 'Status');
}

// ---------------------------------------------------------------------------
// Anamnese (dados sensíveis — LGPD)
// ---------------------------------------------------------------------------

export function emptyAnamnesis(clientId: string): AnamnesisRecord {
  const now = new Date().toISOString();
  return {
    id: '',
    clientId,
    allergies: '',
    skinType: '',
    medicalConditions: '',
    currentMedications: '',
    pregnantOrLactating: false,
    hasPacemakerOrImplants: false,
    previousReactions: '',
    filledAt: now,
    updatedAt: now,
    signatureConsent: false,
    accessLogs: []
  };
}

function mapAnamnesis(r: any, logs: any[] = []): AnamnesisRecord {
  return {
    id: r.id,
    clientId: r.client_id,
    allergies: r.allergies ?? '',
    skinType: r.skin_type ?? '',
    medicalConditions: r.medical_conditions ?? '',
    currentMedications: r.current_medications ?? '',
    pregnantOrLactating: r.pregnant_or_lactating,
    hasPacemakerOrImplants: r.has_pacemaker_or_implants,
    previousReactions: r.previous_aesthetic_reactions ?? '',
    filledAt: r.filled_at,
    updatedAt: r.updated_at,
    signatureConsent: r.signature_consent,
    accessLogs: logs.map(
      (l): AnamnesisAccessLog => ({
        id: l.id,
        accessedBy: l.accessed_by,
        accessedByName: l.accessed_by_name ?? 'Equipe',
        accessedAt: l.accessed_at,
        action: l.action
      })
    )
  };
}

/** Ficha do próprio cliente (ou ficha vazia se ainda não preencheu). */
export async function fetchMyAnamnesis(userId: string): Promise<AnamnesisRecord> {
  const { data, error } = await supabase.from('anamnesis_records').select('*').eq('client_id', userId).maybeSingle();
  if (error) fail(error, 'Anamnese');
  return data ? mapAnamnesis(data) : emptyAnamnesis(userId);
}

export async function saveMyAnamnesis(userId: string, a: Partial<AnamnesisRecord>): Promise<AnamnesisRecord> {
  const row = {
    client_id: userId,
    allergies: a.allergies ?? '',
    skin_type: a.skinType ?? '',
    medical_conditions: a.medicalConditions ?? '',
    current_medications: a.currentMedications ?? '',
    pregnant_or_lactating: a.pregnantOrLactating ?? false,
    has_pacemaker_or_implants: a.hasPacemakerOrImplants ?? false,
    previous_aesthetic_reactions: a.previousReactions ?? '',
    signature_consent: a.signatureConsent ?? true
  };
  const { data, error } = await supabase
    .from('anamnesis_records')
    .upsert(row, { onConflict: 'client_id' })
    .select('*')
    .single();
  if (error) fail(error, 'Anamnese');
  return mapAnamnesis(data);
}

/** Equipe: lista de prontuários, sem conteúdo de saúde. */
export async function fetchAnamnesisOverview(): Promise<AnamnesisOverviewItem[]> {
  const { data, error } = await supabase.rpc('staff_list_anamnesis');
  if (error) fail(error, 'Prontuários');
  return (data ?? []).map((r: any) => ({
    clientId: r.client_id,
    clientName: r.client_name,
    updatedAt: r.updated_at,
    accessCount: Number(r.access_count)
  }));
}

/** Equipe: abre a ficha. O banco registra o acesso no log de auditoria automaticamente. */
export async function openAnamnesisAsStaff(clientId: string): Promise<AnamnesisRecord | null> {
  const { data, error } = await supabase.rpc('staff_view_anamnesis', { p_client_id: clientId });
  if (error) fail(error, 'Prontuário');
  if (!data) return null;
  return mapAnamnesis(data, data.access_logs ?? []);
}

// ---------------------------------------------------------------------------
// Notificações (fila gravada no banco; o envio é feito por um worker externo)
// ---------------------------------------------------------------------------

export async function fetchNotifications(): Promise<NotificationLog[]> {
  const { data, error } = await supabase
    .from('notifications_log')
    .select('*, recipient:profiles!notifications_log_recipient_id_fkey(full_name)')
    .order('scheduled_for', { ascending: false })
    .limit(200);
  if (error) fail(error, 'Notificações');
  return (data ?? []).map((n: any): NotificationLog => ({
    id: n.id,
    appointmentId: n.appointment_id ?? '',
    recipientName: n.recipient?.full_name ?? 'Cliente',
    recipientAddress: n.recipient_address,
    channel: n.channel,
    status: n.status,
    templateName: n.template_name,
    scheduledFor: n.scheduled_for,
    sentAt: n.sent_at ?? undefined,
    errorMessage: n.error_message ?? undefined,
    payload: n.payload ?? {}
  }));
}
