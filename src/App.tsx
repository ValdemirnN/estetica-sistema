import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import {
  ApiError,
  Catalog,
  bookAppointment,
  cancelMyAppointment,
  emptyAnamnesis,
  fetchAnamnesisOverview,
  fetchAppointments,
  fetchBusyBlocks,
  fetchCatalog,
  fetchClinicPublic,
  fetchMyAnamnesis,
  fetchNotifications,
  fetchProfile,
  isPlatformAdmin,
  joinClinic,
  openAnamnesisAsStaff,
  saveMyAnamnesis,
  signOut,
  updateAppointmentStatus,
  BookingInput
} from './services/api';
import {
  Appointment,
  AnamnesisOverviewItem,
  AnamnesisRecord,
  AppointmentStatus,
  BusyBlock,
  ClinicBranding,
  NotificationLog,
  UserProfile,
  UserRole
} from './types/clinic';
import { ClientView } from './components/ClientView';
import { AdminView } from './components/AdminView';
import { NotificationsView } from './components/NotificationsView';
import { ConcurrencySimulator } from './components/ConcurrencySimulator';
import { AuthScreen } from './components/AuthScreen';
import { PlatformAdmin } from './components/PlatformAdmin';
import { applyTheme, resetTheme } from './lib/theme';
import { isPlatformRoute, resolveClinicSlug } from './lib/tenant';
import { FULL_SQL_SCHEMA } from './mock/sqlSchema';
import {
  Sparkles,
  Calendar,
  Bell,
  Database,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  LogOut,
  Copy,
  Check,
  Smartphone,
  Building2
} from 'lucide-react';

const ROLE_LABEL: Record<UserRole, string> = {
  CLIENT: 'Cliente',
  PROFESSIONAL: 'Corpo Clínico',
  RECEPTIONIST: 'Recepção',
  ADMIN: 'Gestão / Admin'
};

type MainTab = 'client-app' | 'admin-panel' | 'notifications' | 'concurrency' | 'blueprint';

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
  return <ClinicApp key={`${session.user.id}:${clinic.id}`} userId={session.user.id} clinic={clinic} />;
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
  return <PlatformAdmin allowed={allowed} />;
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
  const [myAnamnesis, setMyAnamnesis] = useState<AnamnesisRecord>(() => emptyAnamnesis(userId));
  const [anamnesisOverview, setAnamnesisOverview] = useState<AnamnesisOverviewItem[]>([]);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>('client-app');
  const [isRefreshingNotifs, setIsRefreshingNotifs] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);
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
      const [cat, appts, busy, notifs, anam, plat] = await Promise.all([
        fetchCatalog(clinicId),
        fetchAppointments(clinicId),
        fetchBusyBlocks(clinicId),
        fetchNotifications(clinicId),
        staff ? fetchAnamnesisOverview(clinicId) : fetchMyAnamnesis(clinicId, userId),
        isPlatformAdmin()
      ]);
      setCurrentUser(profile);
      setCatalog(cat);
      setAppointments(appts);
      setBusyBlocks(busy);
      setNotifications(notifs);
      setPlatformAdmin(plat);
      applyTheme(cat.settings.primaryColor);
      if (staff) setAnamnesisOverview(anam as AnamnesisOverviewItem[]);
      else setMyAnamnesis(anam as AnamnesisRecord);
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
      if (document.visibilityState === 'visible' && currentUser) refreshAgenda().catch(() => {});
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

  // 4. Anamnese do próprio cliente
  const handleUpdateAnamnesis = async (updated: Partial<AnamnesisRecord>): Promise<boolean> => {
    try {
      const saved = await saveMyAnamnesis(clinicId, currentUser.id, { ...myAnamnesis, ...updated, signatureConsent: true });
      setMyAnamnesis(saved);
      return true;
    } catch (e) {
      showToast(errMsg(e));
      return false;
    }
  };

  // 5. Equipe abre a ficha: o banco registra o acesso (LGPD) e devolve a ficha com a trilha
  const handleOpenAnamnesis = async (clientId: string): Promise<AnamnesisRecord | null> => {
    try {
      const rec = await openAnamnesisAsStaff(clinicId, clientId);
      setAnamnesisOverview(await fetchAnamnesisOverview(clinicId));
      return rec;
    } catch (e) {
      showToast(errMsg(e));
      return null;
    }
  };

  // 6. Exportação de dados (LGPD, art. 18)
  const handleExportData = () => {
    const data = {
      perfil: currentUser,
      agendamentos: appointments.filter((a) => a.clientId === currentUser.id),
      anamnese: myAnamnesis,
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

  const copySqlCode = () => {
    navigator.clipboard.writeText(FULL_SQL_SCHEMA);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  if (showPlatform && isPlatform) return <PlatformAdmin allowed onBack={() => setShowPlatform(false)} />;

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
              App do Cliente (Mobile-First)
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

            <button
              onClick={() => setMainTab('notifications')}
              className={`px-3.5 py-2 rounded-xl font-semibold transition-all flex items-center gap-2 ${
                mainTab === 'notifications'
                  ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Bell className="w-4 h-4" />
              Notificações WhatsApp & E-mail
              {notifications.filter((n) => n.status === 'QUEUED').length > 0 && (
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              )}
            </button>

            {isPlatform && (
              <button
                onClick={() => setShowPlatform(true)}
                className="px-3.5 py-2 rounded-xl font-semibold transition-all flex items-center gap-2 text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <Building2 className="w-4 h-4" />
                Plataforma (clínicas)
              </button>
            )}

            {isPlatform && (
<button
              onClick={() => setMainTab('concurrency')}
              className={`px-3.5 py-2 rounded-xl font-semibold transition-all flex items-center gap-2 ${
                mainTab === 'concurrency'
                  ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Zap className="w-4 h-4" />
              Teste Concorrência (btree_gist)
            </button>
            )}

            {isPlatform && (
<button
              onClick={() => setMainTab('blueprint')}
              className={`px-3.5 py-2 rounded-xl font-semibold transition-all flex items-center gap-2 ${
                mainTab === 'blueprint'
                  ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Database className="w-4 h-4" />
              Schema & SQL Produção
            </button>
            )}
          </div>
        </div>
      </div>

      {/* Main View Area */}
      <main className="flex-1 max-w-7xl mx-auto px-4 py-6 w-full">
        {mainTab === 'client-app' && !isStaff && (
          <ClientView
            currentUser={currentUser}
            categories={categories}
            services={services}
            professionals={professionals}
            appointments={appointments}
            busyBlocks={busyBlocks}
            leaves={leaves}
            anamnesis={myAnamnesis}
            settings={settings}
            onBookAppointment={handleBookAppointment}
            onCancelAppointment={handleCancelAppointment}
            onUpdateAnamnesis={handleUpdateAnamnesis}
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
            anamnesisOverview={anamnesisOverview}
            onUpdateStatus={handleUpdateStatus}
            onCatalogChanged={reloadCatalog}
            notify={showToast}
            onOpenAnamnesis={handleOpenAnamnesis}
          />
        )}

        {mainTab === 'notifications' && (
          <NotificationsView
            notifications={notifications}
            onRefresh={handleRefreshNotifications}
            isRefreshing={isRefreshingNotifs}
          />
        )}

        {mainTab === 'concurrency' && isPlatform && <ConcurrencySimulator />}

        {mainTab === 'blueprint' && isPlatform && (
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Database className="w-5 h-5 text-indigo-400" />
                  Script SQL DDL de Produção (Pronto para Supabase)
                </h3>
                <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
                  Contém a extensão <code className="text-rose-300">btree_gist</code>, constraints de exclusão para eliminação de double booking, tipos enum, triggers de <code className="text-rose-300">updated_at</code> e estrutura LGPD para auditoria.
                </p>
              </div>
              <button
                onClick={copySqlCode}
                className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition-all flex items-center gap-2 shrink-0 self-start md:self-auto"
              >
                {copiedSql ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copiedSql ? 'SQL Copiado!' : 'Copiar Script Completo'}
              </button>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 font-mono text-xs text-slate-300 max-h-[550px] overflow-y-auto leading-relaxed">
              <pre>{FULL_SQL_SCHEMA}</pre>
            </div>
          </div>
        )}
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
