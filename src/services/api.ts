import { supabase } from '../lib/supabase';
import {
  ClientRecord,
  Appointment,
  AppointmentStatus,
  BusyBlock,
  ClinicBranding,
  ClinicSettings,
  DayOfWeek,
  Leave,
  NotificationLog,
  PlatformClinic,
  Professional,
  Service,
  ServiceCategory,
  TeamInvite,
  TeamMember,
  UserProfile,
  UserRole,
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
    options: {
      data: { full_name: params.fullName, phone: params.phone },
      // O e-mail de confirmação volta para a MESMA clínica em que a pessoa se cadastrou.
      emailRedirectTo: `${window.location.origin}${window.location.pathname}${window.location.search}`
    }
  });
  if (error) throw new ApiError(error.message);
  return { needsEmailConfirmation: !data.session };
}

export async function signOut() {
  await supabase.auth.signOut();
}

// ---------------------------------------------------------------------------
// Clínica (tenant)
// ---------------------------------------------------------------------------

function mapBranding(r: any): ClinicBranding {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    tagline: r.tagline ?? '',
    heroBadge: r.hero_badge ?? '',
    heroTitle: r.hero_title ?? '',
    heroSubtitle: r.hero_subtitle ?? '',
    logoUrl: r.logo_url || undefined,
    primaryColor: r.primary_color ?? '#e11d48',
    phone: r.phone ?? '',
    whatsapp: r.whatsapp ?? '',
    address: r.address ?? '',
    isActive: r.is_active
  };
}

/** Marca pública da clínica (tela de login e tema), disponível antes de qualquer sessão. */
export async function fetchClinicPublic(slug: string): Promise<ClinicBranding | null> {
  const { data, error } = await supabase.rpc('get_clinic_public', { p_slug: slug });
  if (error) fail(error, 'Clínica');
  return data ? mapBranding(data) : null;
}

/** Cria o vínculo do usuário com a clínica (cliente, ou o papel do convite) e devolve o papel. */
export async function joinClinic(clinicId: string): Promise<UserRole> {
  const { data, error } = await supabase.rpc('join_clinic', { p_clinic_id: clinicId });
  if (error) fail(error, 'Clínica');
  return data as UserRole;
}

export async function isPlatformAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_platform_admin');
  if (error) return false;
  return data === true;
}

// ---------------------------------------------------------------------------
// Perfil
// ---------------------------------------------------------------------------

/** O papel é POR CLÍNICA: vem do vínculo (joinClinic), não do perfil global. */
export async function fetchProfile(userId: string, role: UserRole): Promise<UserProfile> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) fail(error, 'Perfil');
  if (!data) throw new ApiError('Perfil não encontrado. Se o cadastro acabou de ser feito, tente novamente em instantes.');
  return {
    id: data.id,
    role,
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
// Catálogo, profissionais, configurações (leitura liberada a membros da clínica)
// ---------------------------------------------------------------------------

export interface Catalog {
  categories: ServiceCategory[];
  services: Service[];
  professionals: Professional[];
  leaves: Leave[];
  settings: ClinicSettings;
}

export async function fetchCatalog(clinicId: string): Promise<Catalog> {
  const [cats, svcs, pros, leaves, clinic] = await Promise.all([
    supabase.from('service_categories').select('*').eq('clinic_id', clinicId).order('display_order').order('name'),
    supabase.from('services').select('*').eq('clinic_id', clinicId).order('name'),
    supabase
      .from('professionals')
      .select('*, professional_working_hours(*), professional_services(service_id)')
      .eq('clinic_id', clinicId)
      .order('name'),
    supabase
      .from('professional_leaves')
      .select('*')
      .eq('clinic_id', clinicId)
      .gte('end_datetime', new Date().toISOString())
      .order('start_datetime'),
    supabase.from('clinics').select('*').eq('id', clinicId).maybeSingle()
  ]);

  if (cats.error) fail(cats.error, 'Categorias');
  if (svcs.error) fail(svcs.error, 'Serviços');
  if (pros.error) fail(pros.error, 'Profissionais');
  if (leaves.error) fail(leaves.error, 'Ausências');
  if (clinic.error) fail(clinic.error, 'Clínica');
  if (!clinic.data) {
    throw new ApiError('Clínica não encontrada ou sem acesso. Aplique a migration 20261117000100_multi_clinic.sql.');
  }

  return {
    categories: cats.data.map(
      (c): ServiceCategory => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        iconName: c.icon_name,
        description: c.description ?? '',
        displayOrder: c.display_order ?? 0,
        isActive: c.is_active
      })
    ),
    services: svcs.data.map(
      (s): Service => ({
        id: s.id,
        categoryId: s.category_id,
        name: s.name,
        slug: s.slug,
        description: s.description ?? '',
        durationMinutes: s.duration_minutes,
        priceCents: s.price_cents,
        recoveryInfo: s.recovery_info ?? '',
        imageUrl: s.image_url ?? undefined,
        badge: s.badge ?? undefined,
        isActive: s.is_active
      })
    ),
    professionals: pros.data.map(
      (p): Professional => ({
        id: p.id,
        profileId: p.profile_id ?? '',
        name: p.name ?? 'Profissional',
        title: p.title ?? '',
        registryNumber: p.registry_number ?? '',
        bio: p.bio ?? '',
        colorHex: p.color_hex,
        avatarUrl: p.avatar_url ?? '',
        intervalBufferMinutes: p.interval_buffer_minutes,
        isAvailableForAutoAssign: p.is_available_for_auto_assign,
        isActive: p.is_active,
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
      })
    ),
    leaves: leaves.data.map(
      (l): Leave => ({
        id: l.id,
        professionalId: l.professional_id,
        startDatetime: l.start_datetime,
        endDatetime: l.end_datetime,
        reason: l.reason ?? ''
      })
    ),
    settings: mapSettings(clinic.data)
  };
}

function mapSettings(r: any): ClinicSettings {
  return {
    ...mapBranding(r),
    minCancelNoticeHours: r.min_cancel_notice_hours,
    defaultBufferMinutes: r.default_buffer_minutes,
    slotStepMinutes: r.slot_step_minutes ?? 15,
    autoAssignStrategy: r.auto_assign_strategy,
    workingDays: r.working_days
  };
}

// ---------------------------------------------------------------------------
// Escritas administrativas (RLS: somente ADMIN DA CLÍNICA).
// Uma escrita bloqueada por RLS NÃO gera erro no Supabase: volta 0 linhas.
// Por isso conferimos as linhas afetadas.
// ---------------------------------------------------------------------------

const NOT_ALLOWED = 'Você não tem permissão para esta alteração (apenas o administrador da clínica).';

/** Traduz erros comuns de banco para mensagens que o dono da clínica entende. */
function adminFail(error: { message: string; code?: string }, context: string): never {
  if (error.code === '23503') {
    throw new ApiError(
      `${context}: este item já está em uso (por exemplo, em agendamentos). Em vez de excluir, use "Desativar" para escondê-lo dos clientes sem perder o histórico.`,
      error.code
    );
  }
  if (error.code === '23505') throw new ApiError(`${context}: já existe um item com esse nome.`, error.code);
  fail(error, context);
}

const slugify = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'item';

const uniqueSlug = (text: string) => `${slugify(text)}-${Math.random().toString(36).slice(2, 6)}`;

// --- Clínica: marca e regras ---

export async function updateClinic(clinicId: string, s: ClinicSettings): Promise<void> {
  const { data, error } = await supabase
    .from('clinics')
    .update({
      name: s.name.trim(),
      tagline: s.tagline.trim(),
      hero_badge: s.heroBadge.trim(),
      hero_title: s.heroTitle.trim(),
      hero_subtitle: s.heroSubtitle.trim(),
      logo_url: s.logoUrl || null,
      primary_color: s.primaryColor,
      phone: s.phone.trim(),
      whatsapp: s.whatsapp.trim(),
      address: s.address.trim(),
      min_cancel_notice_hours: s.minCancelNoticeHours,
      default_buffer_minutes: s.defaultBufferMinutes,
      slot_step_minutes: s.slotStepMinutes,
      auto_assign_strategy: s.autoAssignStrategy
    })
    .eq('id', clinicId)
    .select('id');
  if (error) adminFail(error, 'Configurações');
  if (!data?.length) throw new ApiError(NOT_ALLOWED);
}

// --- Imagens (logo, fotos): Supabase Storage, pasta = id da clínica ---

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export async function uploadClinicImage(clinicId: string, file: File): Promise<string> {
  if (!IMAGE_TYPES.includes(file.type)) throw new ApiError('Use uma imagem PNG, JPG ou WebP.');
  if (file.size > 2 * 1024 * 1024) throw new ApiError('A imagem deve ter no máximo 2 MB.');
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${clinicId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from('clinic-assets').upload(path, file, {
    contentType: file.type,
    cacheControl: '31536000'
  });
  if (error) {
    if (/bucket not found/i.test(error.message)) {
      throw new ApiError('O armazenamento de imagens ainda não foi criado. Aplique a migration multi-clínica no Supabase.');
    }
    throw new ApiError(`Não foi possível enviar a imagem: ${error.message}`);
  }
  return supabase.storage.from('clinic-assets').getPublicUrl(path).data.publicUrl;
}

// --- Categorias ---

export interface CategoryInput {
  id?: string;
  name: string;
  description: string;
  displayOrder: number;
  isActive: boolean;
}

export async function saveCategory(clinicId: string, c: CategoryInput): Promise<void> {
  const row = {
    name: c.name.trim(),
    description: c.description.trim() || null,
    display_order: c.displayOrder,
    is_active: c.isActive
  };
  if (c.id) {
    const { data, error } = await supabase.from('service_categories').update(row).eq('id', c.id).select('id');
    if (error) adminFail(error, 'Categoria');
    if (!data?.length) throw new ApiError(NOT_ALLOWED);
  } else {
    const { error } = await supabase
      .from('service_categories')
      .insert({ ...row, clinic_id: clinicId, slug: uniqueSlug(c.name) });
    if (error) adminFail(error, 'Categoria');
  }
}

export async function deleteCategory(id: string): Promise<void> {
  const { data, error } = await supabase.from('service_categories').delete().eq('id', id).select('id');
  if (error) {
    if (error.code === '23503') {
      throw new ApiError('Esta categoria ainda tem procedimentos. Mova ou exclua os procedimentos antes, ou apenas desative a categoria.');
    }
    adminFail(error, 'Categoria');
  }
  if (!data?.length) throw new ApiError(NOT_ALLOWED);
}

// --- Procedimentos ---

export interface ServiceInput {
  id?: string;
  categoryId: string;
  name: string;
  description: string;
  durationMinutes: number;
  priceCents: number;
  recoveryInfo: string;
  badge: string;
  imageUrl: string;
  isActive: boolean;
  /** Profissionais que realizam este procedimento (sem isso, ele não aparece com horários). */
  professionalIds: string[];
}

async function syncServiceProfessionals(clinicId: string, serviceId: string, professionalIds: string[]) {
  const { data: current, error } = await supabase
    .from('professional_services')
    .select('professional_id')
    .eq('service_id', serviceId);
  if (error) adminFail(error, 'Procedimento');
  const have = new Set((current ?? []).map((r: any) => r.professional_id as string));
  const want = new Set(professionalIds);

  const toAdd = [...want].filter((id) => !have.has(id));
  const toRemove = [...have].filter((id) => !want.has(id));

  if (toAdd.length) {
    const { error: e } = await supabase
      .from('professional_services')
      .insert(toAdd.map((professional_id) => ({ clinic_id: clinicId, professional_id, service_id: serviceId })));
    if (e) adminFail(e, 'Profissionais do procedimento');
  }
  if (toRemove.length) {
    const { error: e } = await supabase
      .from('professional_services')
      .delete()
      .eq('service_id', serviceId)
      .in('professional_id', toRemove);
    if (e) adminFail(e, 'Profissionais do procedimento');
  }
}

export async function saveService(clinicId: string, s: ServiceInput): Promise<void> {
  const row = {
    category_id: s.categoryId,
    name: s.name.trim(),
    description: s.description.trim() || null,
    duration_minutes: s.durationMinutes,
    price_cents: s.priceCents,
    recovery_info: s.recoveryInfo.trim() || null,
    badge: s.badge.trim() || null,
    image_url: s.imageUrl || null,
    is_active: s.isActive
  };

  let serviceId = s.id;
  if (serviceId) {
    const { data, error } = await supabase.from('services').update(row).eq('id', serviceId).select('id');
    if (error) adminFail(error, 'Procedimento');
    if (!data?.length) throw new ApiError(NOT_ALLOWED);
  } else {
    const { data, error } = await supabase
      .from('services')
      .insert({ ...row, clinic_id: clinicId, slug: uniqueSlug(s.name) })
      .select('id')
      .single();
    if (error) adminFail(error, 'Procedimento');
    serviceId = data.id as string;
  }
  await syncServiceProfessionals(clinicId, serviceId!, s.professionalIds);
}

export async function deleteService(id: string): Promise<void> {
  const { data, error } = await supabase.from('services').delete().eq('id', id).select('id');
  if (error) adminFail(error, 'Procedimento');
  if (!data?.length) throw new ApiError(NOT_ALLOWED);
}

// --- Profissionais, jornada e ausências ---

export interface ProfessionalInput {
  id?: string;
  name: string;
  title: string;
  registryNumber: string;
  bio: string;
  colorHex: string;
  avatarUrl: string;
  intervalBufferMinutes: number;
  isAvailableForAutoAssign: boolean;
  isActive: boolean;
  serviceIds: string[];
  workingHours: WorkingHours[];
}

const DAY_TO_DB: Record<number, string> = {
  0: 'SUNDAY', 1: 'MONDAY', 2: 'TUESDAY', 3: 'WEDNESDAY', 4: 'THURSDAY', 5: 'FRIDAY', 6: 'SATURDAY'
};

/** Jornada inicial de quem acabou de ser cadastrada: seg–sex 09:00–18:00 com almoço, sábado fechado. */
export function defaultWorkingHours(): WorkingHours[] {
  return ([0, 1, 2, 3, 4, 5, 6] as DayOfWeek[]).map((d) => ({
    dayOfWeek: d,
    startTime: '09:00',
    endTime: '18:00',
    breakStartTime: '12:00',
    breakEndTime: '13:00',
    isActive: d >= 1 && d <= 5
  }));
}

export async function saveProfessional(clinicId: string, p: ProfessionalInput): Promise<string> {
  const row = {
    name: p.name.trim(),
    title: p.title.trim() || null,
    registry_number: p.registryNumber.trim() || null,
    bio: p.bio.trim() || null,
    color_hex: p.colorHex,
    avatar_url: p.avatarUrl || null,
    interval_buffer_minutes: p.intervalBufferMinutes,
    is_available_for_auto_assign: p.isAvailableForAutoAssign,
    is_active: p.isActive
  };

  let id = p.id;
  if (id) {
    const { data, error } = await supabase.from('professionals').update(row).eq('id', id).select('id');
    if (error) adminFail(error, 'Profissional');
    if (!data?.length) throw new ApiError(NOT_ALLOWED);
  } else {
    const { data, error } = await supabase
      .from('professionals')
      .insert({ ...row, clinic_id: clinicId })
      .select('id')
      .single();
    if (error) adminFail(error, 'Profissional');
    id = data.id as string;
  }

  // Procedimentos que ela realiza
  const { data: current, error: curErr } = await supabase
    .from('professional_services')
    .select('service_id')
    .eq('professional_id', id!);
  if (curErr) adminFail(curErr, 'Profissional');
  const have = new Set((current ?? []).map((r: any) => r.service_id as string));
  const want = new Set(p.serviceIds);
  const toAdd = [...want].filter((x) => !have.has(x));
  const toRemove = [...have].filter((x) => !want.has(x));
  if (toAdd.length) {
    const { error } = await supabase
      .from('professional_services')
      .insert(toAdd.map((service_id) => ({ clinic_id: clinicId, professional_id: id, service_id })));
    if (error) adminFail(error, 'Procedimentos da profissional');
  }
  if (toRemove.length) {
    const { error } = await supabase
      .from('professional_services')
      .delete()
      .eq('professional_id', id!)
      .in('service_id', toRemove);
    if (error) adminFail(error, 'Procedimentos da profissional');
  }

  // Jornada semanal: uma linha por dia (upsert)
  for (const w of p.workingHours) {
    if (w.isActive && w.startTime >= w.endTime) {
      throw new ApiError('Em cada dia de atendimento, o horário de início deve ser antes do fim.');
    }
    const hasBreak = !!w.breakStartTime && !!w.breakEndTime;
    if (w.isActive && hasBreak && !(w.breakStartTime! < w.breakEndTime! && w.breakStartTime! >= w.startTime && w.breakEndTime! <= w.endTime)) {
      throw new ApiError('O intervalo (almoço) precisa estar dentro do horário de atendimento do dia.');
    }
  }
  const { error: whErr } = await supabase.from('professional_working_hours').upsert(
    p.workingHours.map((w) => {
      const hasBreak = !!w.breakStartTime && !!w.breakEndTime;
      return {
        clinic_id: clinicId,
        professional_id: id,
        day_of_week: DAY_TO_DB[w.dayOfWeek],
        start_time: w.startTime,
        end_time: w.endTime,
        break_start_time: hasBreak ? w.breakStartTime : null,
        break_end_time: hasBreak ? w.breakEndTime : null,
        is_active: w.isActive
      };
    }),
    { onConflict: 'professional_id,day_of_week' }
  );
  if (whErr) adminFail(whErr, 'Jornada');

  return id!;
}

export async function deleteProfessional(id: string): Promise<void> {
  const { data, error } = await supabase.from('professionals').delete().eq('id', id).select('id');
  if (error) adminFail(error, 'Profissional');
  if (!data?.length) throw new ApiError(NOT_ALLOWED);
}

export async function addLeave(
  clinicId: string,
  professionalId: string,
  startIso: string,
  endIso: string,
  reason: string
): Promise<void> {
  if (new Date(startIso) >= new Date(endIso)) throw new ApiError('A data/hora final precisa ser depois da inicial.');
  const { error } = await supabase.from('professional_leaves').insert({
    clinic_id: clinicId,
    professional_id: professionalId,
    start_datetime: startIso,
    end_datetime: endIso,
    reason: reason.trim() || null
  });
  if (error) adminFail(error, 'Bloqueio de agenda');
}

export async function deleteLeave(id: string): Promise<void> {
  const { data, error } = await supabase.from('professional_leaves').delete().eq('id', id).select('id');
  if (error) adminFail(error, 'Bloqueio de agenda');
  if (!data?.length) throw new ApiError(NOT_ALLOWED);
}

// --- Equipe e acessos ---

export async function fetchTeam(clinicId: string): Promise<{ members: TeamMember[]; invites: TeamInvite[] }> {
  const [m, i] = await Promise.all([
    supabase
      .from('clinic_members')
      .select('user_id, role, is_active, profile:profiles!clinic_members_user_id_fkey(full_name, email)')
      .eq('clinic_id', clinicId)
      .neq('role', 'CLIENT')
      .order('created_at'),
    supabase.from('clinic_invites').select('id, email, role').eq('clinic_id', clinicId).order('created_at')
  ]);
  if (m.error) fail(m.error, 'Equipe');
  if (i.error) fail(i.error, 'Convites');
  return {
    members: (m.data ?? []).map((r: any) => ({
      userId: r.user_id,
      fullName: r.profile?.full_name ?? 'Usuário',
      email: r.profile?.email ?? '',
      role: r.role,
      isActive: r.is_active
    })),
    invites: (i.data ?? []).map((r: any) => ({ id: r.id, email: r.email, role: r.role }))
  };
}

/** 'MEMBER' = já tinha conta e o papel valeu na hora; 'INVITED' = vale quando se cadastrar. */
export async function inviteMember(clinicId: string, email: string, role: UserRole): Promise<'MEMBER' | 'INVITED'> {
  const { data, error } = await supabase.rpc('invite_member', { p_clinic_id: clinicId, p_email: email, p_role: role });
  if (error) fail(error, 'Equipe');
  return data as 'MEMBER' | 'INVITED';
}

export async function setMemberAccess(clinicId: string, userId: string, role: UserRole, active = true): Promise<void> {
  const { error } = await supabase.rpc('set_member_access', {
    p_clinic_id: clinicId,
    p_user_id: userId,
    p_role: role,
    p_active: active
  });
  if (error) fail(error, 'Equipe');
}

export async function revokeInvite(inviteId: string): Promise<void> {
  const { error } = await supabase.from('clinic_invites').delete().eq('id', inviteId);
  if (error) fail(error, 'Convite');
}

// --- Plataforma (dono do SaaS) ---

export async function platformListClinics(): Promise<PlatformClinic[]> {
  const { data, error } = await supabase.rpc('platform_list_clinics');
  if (error) fail(error, 'Clínicas');
  return ((data ?? []) as any[]).map(
    (c): PlatformClinic => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      primaryColor: c.primary_color,
      isActive: c.is_active,
      createdAt: c.created_at,
      members: Number(c.members),
      appointments30d: Number(c.appointments_30d),
      owners: c.owners ?? [],
      pendingOwnerInvites: c.pending_owner_invites ?? []
    })
  );
}

export async function platformCreateClinic(params: {
  slug: string;
  name: string;
  ownerEmail: string;
  primaryColor: string;
  phone: string;
}): Promise<void> {
  const { error } = await supabase.rpc('create_clinic', {
    p_slug: params.slug,
    p_name: params.name,
    p_owner_email: params.ownerEmail,
    p_primary_color: params.primaryColor,
    p_phone: params.phone
  });
  if (error) fail(error, 'Nova clínica');
}

export async function platformSetClinicActive(clinicId: string, active: boolean): Promise<void> {
  const { data, error } = await supabase.from('clinics').update({ is_active: active }).eq('id', clinicId).select('id');
  if (error) fail(error, 'Clínica');
  if (!data?.length) throw new ApiError('Sem permissão para alterar esta clínica.');
}

// ---------------------------------------------------------------------------
// Agendamentos
// ---------------------------------------------------------------------------

const APPOINTMENT_SELECT =
  '*, client:profiles!appointments_client_id_fkey(full_name, phone, email), ' +
  'history:appointment_status_history(status, changed_at, changed_by_name, note)';

/** Cliente recebe só os próprios agendamentos; equipe recebe todos (RLS decide). */
export async function fetchAppointments(clinicId: string): Promise<Appointment[]> {
  const { data, error } = await supabase
    .from('appointments')
    .select(APPOINTMENT_SELECT)
    .eq('clinic_id', clinicId)
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
export async function fetchBusyBlocks(clinicId: string, daysAhead = 60): Promise<BusyBlock[]> {
  const from = new Date();
  const to = new Date(from.getTime() + daysAhead * 86400000);
  const { data, error } = await supabase.rpc('get_busy_slots', {
    p_clinic_id: clinicId,
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

/** Equipe remarca um agendamento (data/horário e, opcionalmente, outra profissional). O banco valida jornada, ausência e conflito. */
export async function rescheduleAppointment(
  appointmentId: string,
  startIso: string,
  professionalId: string | null
): Promise<void> {
  const { error } = await supabase.rpc('reschedule_appointment', {
    p_appointment_id: appointmentId,
    p_start_time: startIso,
    p_professional_id: professionalId
  });
  if (error) fail(error, 'Remarcação');
}

// ---------------------------------------------------------------------------
// Clientes (cadastro básico, sem dados de saúde)
// ---------------------------------------------------------------------------

/** Equipe: lista os clientes da clínica. */
export async function fetchClients(clinicId: string): Promise<ClientRecord[]> {
  const { data, error } = await supabase.rpc('staff_list_clients', { p_clinic_id: clinicId });
  if (error) fail(error, 'Clientes');
  return (data ?? []).map(
    (r: any): ClientRecord => ({
      id: r.client_id,
      fullName: r.full_name,
      phone: r.phone ?? '',
      email: r.email ?? '',
      cpf: r.cpf ?? undefined,
      birthDate: r.birth_date ?? undefined,
      isActive: r.is_active,
      createdAt: r.created_at,
      staffNotes: r.staff_notes ?? ''
    })
  );
}

export async function saveClientNotes(clinicId: string, clientId: string, notes: string): Promise<void> {
  const { error } = await supabase.rpc('staff_set_client_notes', {
    p_clinic_id: clinicId,
    p_client_id: clientId,
    p_notes: notes
  });
  if (error) fail(error, 'Observação do cliente');
}

export interface NewClientInput {
  fullName: string;
  phone: string;
  email: string;
  cpf?: string;
  birthDate?: string;
  notes?: string;
  optInWhatsapp: boolean;
  optInEmail: boolean;
}

/**
 * Equipe cadastra um cliente. Criar a conta de login exige a chave service_role, que NUNCA vai ao
 * navegador: quem faz isso é a rota serverless /api/admin/create-client, que confere se quem chama
 * é equipe (ADMIN/RECEPTIONIST) da clínica. Devolve a senha provisória (mostrada uma única vez).
 */
export async function createClientAsStaff(
  clinicId: string,
  input: NewClientInput
): Promise<{ clientId: string; temporaryPassword: string }> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new ApiError('Sessão expirada. Entre novamente.');

  let res: Response;
  try {
    res = await fetch('/api/admin/create-client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ clinicId, ...input })
    });
  } catch {
    throw new ApiError('Não foi possível falar com o servidor. Verifique sua conexão.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      body?.error ||
        (res.status === 404
          ? 'A rota /api/admin/create-client não existe neste ambiente. Ela só funciona publicada na Vercel (ou com "vercel dev").'
          : 'Não foi possível cadastrar o cliente.')
    );
  }
  return { clientId: body.clientId as string, temporaryPassword: body.temporaryPassword as string };
}

/** Primeiro acesso de um cliente cadastrado pela equipe: troca a senha provisória. */
export async function completeFirstAccess(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword, data: { must_change_password: false } });
  if (error) throw new ApiError(error.message);
}

// ---------------------------------------------------------------------------
// Notificações (fila gravada no banco; o envio é feito por um worker externo)
// ---------------------------------------------------------------------------

export async function fetchNotifications(clinicId: string): Promise<NotificationLog[]> {
  const { data, error } = await supabase
    .from('notifications_log')
    .select('*, recipient:profiles!notifications_log_recipient_id_fkey(full_name)')
    .eq('clinic_id', clinicId)
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
