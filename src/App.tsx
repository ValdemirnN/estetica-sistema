import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import {
  ApiError,
  Catalog,
  bookAppointment,
  cancelMyAppointment,
  createClientAsStaff,
  fetchAppointments,
  fetchBusyBlocks,
  fetchCatalog,
  fetchClients,
  fetchClinicPublic,
  fetchNotifications,
  fetchProfile,
  isPlatformAdmin,
  joinClinic,
  rescheduleAppointment,
  saveClientNotes,
  signOut,
  updateAppointmentStatus,
  BookingInput,
  NewClientInput
} from './services/api';
import {
  Appointment,
  AppointmentStatus,
  BusyBlock,
  ClientRecord,
  ClinicBranding,
  AgendaStatus,
  NotificationLog,
  UserProfile,
  UserRole
} from './types/clinic';
import { AuthScreen } from './components/auth/AuthScreen';
import { FirstAccessPasswordModal } from './components/auth/FirstAccessPasswordModal';
import type { SeriesResult } from './components/clinic/NewAppointmentModal';
import { ViewFallback } from './components/ViewFallback';
import { applyTheme, resetTheme } from './lib/theme';
import { isPlatformRoute, resolveClinicSlug } from './lib/tenant';
import {
  Sparkles,
  Calendar,
  Bell,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  LogOut,
  Smartphone,
  Building2
} from 'lucide-react';

// Telas carregadas sob demanda: cada perfil baixa só o que usa.
const ClientView = lazy(() => import('./components/client/ClientView').then((m) => ({ default: m.ClientView })));
const AdminView = lazy(() => import('./components/admin/AdminView').then((m) => ({ default: m.AdminView })));
const NotificationsView = lazy(() => import('./components/NotificationsView').then((m) => ({ default: m.NotificationsView })));
const PlatformAdmin = lazy(() => import('./components/PlatformAdmin').then((m) => ({ default: m.PlatformAdmin })));

const ROLE_LABEL: Record<UserRole, string> = {
  CLIENT: 'Cliente',
  PROFESSIONAL: 'Corpo Clínico',
  RECEPTIONIST: 'Recepção',
  ADMIN: 'Gestão / Admin'
};

type MainTab = 'client-app' | 'admin-panel' | 'notifications';

/** Tela mostrada quando as variáveis do Supabase não foram configuradas. */
function MissingConfig() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6 font-sans">
      <div className="max-w-lg bg-slate-900 border border-amber-500/40 rounded-2xl p-6 space-y-3">
        <h1 className="text-base font-bold text-white flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-400" /> Supabase não configurado
        </h1>
        <p className="text-xs text-slate-300 leading-relaxed">
          Crie um arquivo <code className="text-rose-300">.env</code> na raiz do projeto (veja{' '}
          <code className="text-rose-300">.env.example</code>) com a URL e a chave <strong>anon</strong> do seu projeto
          (Supabase → Project Settings → API) e reinicie o servidor:
        </p>
        <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-[11px] text-slate-300 overflow-x-auto">{`VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...`}</pre>
      </div>
    </div>
  );
}

export default function App() {
  if (!isSupabaseConfigured) return <MissingConfig />;
  return <AuthGate />;
}

/** Decide entre login e sistema, conforme a clínica do endereço e a sessão do Supabase Auth. */
function AuthGate() {
  const slug = React.useMemo(resolveClinicSlug, []);
  const platformRoute = React.useMemo(isPlatformRoute, []);
  const [session, setSession] = useState<Session | null | undefined>(undefined); // undefined = carregando
  const [clinic, setClinic] = useState<ClinicBranding | null | undefined>(slug ? undefined : null);
  const [clinicError, setClinicError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!slug) return;
    fetchClinicPublic(slug)
      .then((c) => {
        setClinic(c);
        if (c) {
          applyTheme(c.primaryColor);
          document.title = c.name;
        }
      })
      .catch((e) => setClinicError(e instanceof Error ? e.message : 'Erro ao carregar a clínica.'));
    return () => resetTheme();
  }, [slug]);

  const Spinner = (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">
      <Loader2 className="w-6 h-6 animate-spin" />
    </div>
  );

  if (clinicError) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md bg-slate-900 border border-rose-500/40 rounded-2xl p-6 text-xs text-slate-300">{clinicError}</div>
      </div>
    );
  }
  if (session === undefined || clinic === undefined) return Spinner;

  // Endereço de uma clínica que não existe
  if (slug && clinic === null) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-2 text-center">
          <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" />
          <h1 className="text-base font-bold text-white">Clínica não encontrada</h1>
          <p className="text-xs text-slate-300">Confira o endereço que você recebeu. Não existe uma clínica chamada “{slug}”.</p>
        </div>
      </div>
    );
  }
  if (clinic && !clinic.isActive) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-2 text-center">
          <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" />
          <h1 className="text-base font-bold text-white">{clinic.name}</h1>
          <p className="text-xs text-slate-300">O agendamento online desta clínica está temporariamente indisponível. Entre em contato diretamente.</p>
          {clinic.phone && <p className="text-xs text-slate-400">{clinic.phone}</p>}
        </div>
      </div>
    );
  }

  if (session === null) return <AuthScreen clinic={clinic} platform={platformRoute} />;

  // Sem clínica no endereço: só o administrador da plataforma tem o que fazer aqui.
  if (!clinic) return <PlatformGate />;

  // key = usuário + clínica: trocar de conta remonta o sistema e descarta dados da anterior.
  return (
    <>
      <ClinicApp key={`${session.user.id}:${clinic.id}`} userId={session.user.id} clinic={clinic} />
      {/* Cliente cadastrado pela equipe entra com senha provisória e precisa trocá-la. */}
      {session.user.user_metadata?.must_change_password === true && (
        <FirstAccessPasswordModal onDone={() => {}} onSignOut={() => signOut()} />
      )}
    </>
  );
}

function PlatformGate() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    isPlatformAdmin().then(setAllowed);
  }, []);
  if (allowed === null) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }
  return (
    <Suspense fallback={<ViewFallback />}>
      <PlatformAdmin allowed={allowed} />
    </Suspense>
  );
}

function ClinicApp({ userId, clinic }: { userId: string; clinic: ClinicBranding }) {
  const clinicId = clinic.id;
  const [platformAdmin, setPlatformAdmin] = useState(false);
  const [showPlatform, setShowPlatform] = useState(false);
  // ---- Dados (todos vêm do Supabase) ----
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [busyBlocks, setBusyBlocks] = useState<BusyBlock[]>([]);
  const [notifications, setNotifications] = useState<NotificationLog[]>([]);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [agendaStatus, setAgendaStatus] = useState<AgendaStatus>('ready');

  const [loadError, setLoadError] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>('client-app');
  const [isRefreshingNotifs, setIsRefreshingNotifs] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const isStaff = !!currentUser && currentUser.role !== 'CLIENT';

  const showToast = (msg: string) => {
    setToastMessage(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMessage(null), 4000);
  };
  const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado. Tente novamente.');

  // ---- Carga inicial ----
  const loadAll = useCallback(async () => {
    setLoadError(null);
    try {
      // Cria o vínculo com a clínica (cliente, ou o papel do convite) e devolve o papel NESTA clínica.
      const role = await joinClinic(clinicId);
      const profile = await fetchProfile(userId, role);
      const staff = role !== 'CLIENT';
      const [cat, appts, busy, notifs, clientList, plat] = await Promise.all([
        fetchCatalog(clinicId),
        fetchAppointments(clinicId),
        fetchBusyBlocks(clinicId),
        fetchNotifications(clinicId),
        staff ? fetchClients(clinicId) : Promise.resolve([] as ClientRecord[]),
        isPlatformAdmin()
      ]);
      setCurrentUser(profile);
      setCatalog(cat);
      setAppointments(appts);
      setBusyBlocks(busy);
      setNotifications(notifs);
      setPlatformAdmin(plat);
      applyTheme(cat.settings.primaryColor);
      setClients(clientList);
      setMainTab((prev) => (staff && prev === 'client-app' ? 'admin-panel' : prev));
    } catch (e) {
      setLoadError(errMsg(e));
    }
  }, [userId, clinicId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Ao voltar para a aba do navegador, atualiza agenda e horários ocupados
  // (outros clientes podem ter agendado enquanto isso).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && currentUser) reloadAgenda();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  });

  const refreshAgenda = async () => {
    const [appts, busy, notifs] = await Promise.all([
      fetchAppointments(clinicId),
      fetchBusyBlocks(clinicId),
      fetchNotifications(clinicId)
    ]);
    setAppointments(appts);
    setBusyBlocks(busy);
    setNotifications(notifs);
  };

  // Atualiza a agenda e registra o resultado, para o painel mostrar "Tentar de novo" se falhar.
  const reloadAgenda = async () => {
    setAgendaStatus('refreshing');
    try {
      await refreshAgenda();
      setAgendaStatus('ready');
    } catch {
      setAgendaStatus('error');
    }
  };

  const handleSignOut = async () => {
    await signOut(); // AuthGate volta para o login
  };

  if (loadError) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6 font-sans">
        <div className="max-w-lg bg-slate-900 border border-rose-500/40 rounded-2xl p-6 space-y-3">
          <h1 className="text-base font-bold text-white flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-rose-400" /> Não foi possível carregar os dados
          </h1>
          <p className="text-xs text-slate-300 leading-relaxed">{loadError}</p>
          <div className="flex gap-2">
            <button onClick={loadAll} className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white">
              Tentar novamente
            </button>
            <button onClick={handleSignOut} className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white">
              Sair
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!currentUser || !catalog) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  const { categories, services, leaves, settings } = catalog;
  const isPlatform = platformAdmin;
  const professionals = catalog.professionals;

  // ---- Ações ----

  // 1. Agendar. A validação (jornada, ausências, preço, conflito) é feita no banco.
  const handleBookAppointment = async (input: BookingInput): Promise<string | null> => {
    try {
      const id = await bookAppointment(input);
      await refreshAgenda();
      showToast('Agendamento confirmado! Os lembretes entraram na fila de notificações.');
      return id;
    } catch (e) {
      // 23P01 = outro cliente pegou o horário no mesmo instante: atualiza a grade.
      if (e instanceof ApiError && e.code === '23P01') await refreshAgenda().catch(() => {});
      showToast(errMsg(e));
      return null;
    }
  };

  // 2. Cancelar (a antecedência mínima é conferida no banco)
  const handleCancelAppointment = async (aptId: string, reason: string): Promise<boolean> => {
    try {
      await cancelMyAppointment(aptId, reason);
      await refreshAgenda();
      showToast('Agendamento cancelado com sucesso.');
      return true;
    } catch (e) {
      showToast(errMsg(e));
      return false;
    }
  };

  // 3. Status (equipe). O histórico de auditoria é gravado por trigger.
  const handleUpdateStatus = async (aptId: string, newStatus: AppointmentStatus, note?: string) => {
    try {
      await updateAppointmentStatus(aptId, newStatus, note);
      await refreshAgenda();
      showToast(`Status atualizado para ${newStatus}.`);
    } catch (e) {
      showToast(errMsg(e));
    }
  };

  // 4. Equipe agenda para um cliente (uma vez ou repetindo toda semana).
  //    Cada horário é validado no banco; os que falham são devolvidos para a equipe ver o motivo.
  const handleBookSeries = async (inputs: BookingInput[], labels: string[]): Promise<SeriesResult> => {
    let booked = 0;
    const failures: string[] = [];
    for (let i = 0; i < inputs.length; i++) {
      try {
        await bookAppointment(inputs[i]);
        booked++;
      } catch (e) {
        failures.push(`${labels[i]}: ${errMsg(e)}`);
      }
    }
    await refreshAgenda().catch(() => {});
    if (booked > 0) showToast(booked === 1 ? 'Agendamento confirmado.' : `${booked} agendamentos confirmados.`);
    return { booked, failures };
  };

  // 5. Equipe remarca
  const handleReschedule = async (aptId: string, startIso: string, professionalId: string | null): Promise<boolean> => {
    try {
      await rescheduleAppointment(aptId, startIso, professionalId);
      await refreshAgenda();
      showToast('Agendamento remarcado. O cliente será avisado pela fila de notificações.');
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === '23P01') await refreshAgenda().catch(() => {});
      showToast(errMsg(e));
      return false;
    }
  };

  // 5b. Equipe cadastra cliente (a conta é criada pela rota serverless) e recarrega a lista
  const handleCreateClient = async (input: NewClientInput) => {
    const r = await createClientAsStaff(clinicId, input);
    setClients(await fetchClients(clinicId));
    return r;
  };

  const handleSaveClientNotes = async (clientId: string, notes: string) => {
    await saveClientNotes(clinicId, clientId, notes);
    setClients(await fetchClients(clinicId));
  };

  // 6. Exportação de dados (LGPD, art. 18)
  const handleExportData = () => {
    const data = {
      perfil: currentUser,
      agendamentos: appointments.filter((a) => a.clientId === currentUser.id),
      dataExportacao: new Date().toISOString(),
      avisoLegal: 'Exportação em conformidade com o Artigo 18 da LGPD (Portabilidade de Dados Pessoais).'
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meus_dados_${settings.slug}_${currentUser.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Dados exportados em JSON conforme a LGPD.');
  };

  // 7. Admin: depois de qualquer edição do dono (procedimentos, profissionais, marca), recarrega tudo.
  const reloadCatalog = async () => {
    const cat = await fetchCatalog(clinicId);
    setCatalog(cat);
    applyTheme(cat.settings.primaryColor);
    document.title = cat.settings.name;
  };

  // 8. Notificações: a fila está no banco; aqui só recarregamos o que há nela.
  const handleRefreshNotifications = async () => {
    setIsRefreshingNotifs(true);
    try {
      setNotifications(await fetchNotifications(clinicId));
    } catch (e) {
      showToast(errMsg(e));
    } finally {
      setIsRefreshingNotifs(false);
    }
  };

  if (showPlatform && isPlatform) {
    return (
      <Suspense fallback={<ViewFallback />}>
        <PlatformAdmin allowed onBack={() => setShowPlatform(false)} />
      </Suspense>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-rose-500 selection:text-white">
      {/* Top Header Global */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          {/* Logo & Marca da Clínica */}
          <div className="flex items-center gap-3">
            {settings.logoUrl ? (
              <img src={settings.logoUrl} alt={settings.name} className="w-10 h-10 rounded-xl object-cover border border-slate-700" />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-pink-500 via-rose-500 to-rose-700 flex items-center justify-center text-white shadow-lg shadow-rose-500/20">
                <Sparkles className="w-5 h-5" />
              </div>
            )}
            <div>
              <span className="font-bold text-lg text-white tracking-tight">{settings.name}</span>
              {settings.tagline && <p className="text-[11px] text-slate-400 hidden sm:block">{settings.tagline}</p>}
            </div>
          </div>

          {/* Usuário logado */}
          <div className="flex items-center gap-3 bg-slate-950 pl-3 pr-1 py-1 rounded-xl border border-slate-800">
            <div className="text-right leading-tight">
              <div className="text-xs text-white font-semibold">{currentUser.fullName}</div>
              <div className="text-[10px] text-slate-400">{ROLE_LABEL[currentUser.role]}</div>
            </div>
            <button
              onClick={handleSignOut}
              title="Sair"
              className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs text-slate-300 hover:text-white flex items-center gap-1.5 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sair
            </button>
          </div>
        </div>
      </header>

      {/* Main Tab Navigation Bar */}
      <div className="bg-slate-900 border-b border-slate-800 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-between overflow-x-auto gap-2">
          <div className="flex items-center gap-1 py-2 text-xs">
            {!isStaff && (
<button
              onClick={() => setMainTab('client-app')}
              className={`px-3.5 py-2 rounded-xl font-semibold transition-all flex items-center gap-2 ${
                mainTab === 'client-app'
                  ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Smartphone className="w-4 h-4" />
              Minha Área
            </button>
            )}

            {isStaff && (
<button
              onClick={() => setMainTab('admin-panel')}
              className={`px-3.5 py-2 rounded-xl font-semibold transition-all flex items-center gap-2 ${
                mainTab === 'admin-panel'
                  ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Calendar className="w-4 h-4" />
              Painel Administrativo
            </button>
            )}

            {isStaff && (
            <button
              onClick={() => setMainTab('notifications')}
              className={`px-3.5 py-2 rounded-xl font-semibold transition-all flex items-center gap-2 ${
                mainTab === 'notifications'
                  ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Bell className="w-4 h-4" />
              Central de Comunicação
              {notifications.filter((n) => n.status === 'QUEUED').length > 0 && (
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              )}
            </button>
            )}

            {isPlatform && (
              <button
                onClick={() => setShowPlatform(true)}
                className="px-3.5 py-2 rounded-xl font-semibold transition-all flex items-center gap-2 text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <Building2 className="w-4 h-4" />
                Plataforma (clínicas)
              </button>
            )}

          </div>
        </div>
      </div>

      {/* Main View Area */}
      <main className="flex-1 max-w-7xl mx-auto px-4 py-6 w-full">
        <Suspense fallback={<ViewFallback />}>
        {mainTab === 'client-app' && !isStaff && (
          <ClientView
            currentUser={currentUser}
            categories={categories}
            services={services}
            professionals={professionals}
            appointments={appointments}
            busyBlocks={busyBlocks}
            leaves={leaves}
            settings={settings}
            agendaStatus={agendaStatus}
            onRetryAgenda={reloadAgenda}
            onBookAppointment={handleBookAppointment}
            onCancelAppointment={handleCancelAppointment}
            onExportData={handleExportData}
          />
        )}

        {mainTab === 'admin-panel' && isStaff && (
          <AdminView
            currentUser={currentUser}
            clinicId={clinicId}
            appointments={appointments}
            categories={categories}
            professionals={professionals}
            services={services}
            leaves={leaves}
            settings={settings}
            clients={clients}
            busyBlocks={busyBlocks}
            onUpdateStatus={handleUpdateStatus}
            onCatalogChanged={reloadCatalog}
            notify={showToast}
            onBookSeries={handleBookSeries}
            onReschedule={handleReschedule}
            onCreateClient={handleCreateClient}
            onSaveClientNotes={handleSaveClientNotes}
          />
        )}

        {mainTab === 'notifications' && isStaff && (
          <NotificationsView
            sample={(() => {
              const next = appointments
                .filter((a) => a.status === 'CONFIRMED' && new Date(a.startTime) >= new Date())
                .sort((a, b) => a.startTime.localeCompare(b.startTime))[0];
              if (!next) return null;
              return {
                clientName: next.clientName,
                serviceName: services.find((x) => x.id === next.serviceId)?.name ?? '',
                professionalName: professionals.find((x) => x.id === next.professionalId)?.name ?? '',
                startTime: next.startTime
              };
            })()}
            clinicName={settings.name}
            clinicAddress={settings.address}
            notifications={notifications}
            onRefresh={handleRefreshNotifications}
            isRefreshing={isRefreshingNotifs}
          />
        )}
        </Suspense>
      </main>

      {/* Floating Toast Feedback */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white border border-rose-500/40 px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-2.5 text-xs animate-bounce">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-900/60 py-4 text-center text-xs text-slate-500">
        {settings.name}
        {settings.address && <> • {settings.address}</>}
        {settings.phone && <> • {settings.phone}</>}
      </footer>
    </div>
  );
}
