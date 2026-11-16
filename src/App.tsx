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
  fetchClinicName,
  fetchMyAnamnesis,
  fetchNotifications,
  fetchProfile,
  openAnamnesisAsStaff,
  saveMyAnamnesis,
  signOut,
  updateAppointmentStatus,
  updateProfessional,
  updateSettings,
  BookingInput
} from './services/api';
import {
  Appointment,
  AnamnesisOverviewItem,
  AnamnesisRecord,
  AppointmentStatus,
  BusyBlock,
  ClinicSettings,
  NotificationLog,
  Professional,
  UserProfile,
  UserRole
} from './types/clinic';
import { ClientView } from './components/ClientView';
import { AdminView } from './components/AdminView';
import { NotificationsView } from './components/NotificationsView';
import { ConcurrencySimulator } from './components/ConcurrencySimulator';
import { AuthScreen } from './components/AuthScreen';
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
  Smartphone
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

/** Decide entre tela de login e o sistema, conforme a sessão do Supabase Auth. */
function AuthGate() {
  const [session, setSession] = useState<Session | null | undefined>(undefined); // undefined = carregando
  const [clinicName, setClinicName] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session === null) fetchClinicName().then(setClinicName).catch(() => {});
  }, [session]);

  if (session === undefined) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }
  if (session === null) return <AuthScreen clinicName={clinicName} />;
  // key = id do usuário: trocar de conta remonta o sistema e descarta dados da conta anterior.
  return <ClinicApp key={session.user.id} userId={session.user.id} />;
}

function ClinicApp({ userId }: { userId: string }) {
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
      const profile = await fetchProfile(userId);
      const staff = profile.role !== 'CLIENT';
      const [cat, appts, busy, notifs, anam] = await Promise.all([
        fetchCatalog(),
        fetchAppointments(),
        fetchBusyBlocks(),
        fetchNotifications(),
        staff ? fetchAnamnesisOverview() : fetchMyAnamnesis(userId)
      ]);
      setCurrentUser(profile);
      setCatalog(cat);
      setAppointments(appts);
      setBusyBlocks(busy);
      setNotifications(notifs);
      if (staff) setAnamnesisOverview(anam as AnamnesisOverviewItem[]);
      else setMyAnamnesis(anam as AnamnesisRecord);
      setMainTab((prev) => (staff && prev === 'client-app' ? 'admin-panel' : prev));
    } catch (e) {
      setLoadError(errMsg(e));
    }
  }, [userId]);

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
    const [appts, busy, notifs] = await Promise.all([fetchAppointments(), fetchBusyBlocks(), fetchNotifications()]);
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
      const saved = await saveMyAnamnesis(currentUser.id, { ...myAnamnesis, ...updated, signatureConsent: true });
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
      const rec = await openAnamnesisAsStaff(clientId);
      setAnamnesisOverview(await fetchAnamnesisOverview());
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
    a.download = `aesthetiq_meus_dados_${currentUser.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Dados exportados em JSON conforme a LGPD.');
  };

  // 7. Admin: profissional e configurações
  const handleUpdateProfessional = async (updated: Professional) => {
    try {
      await updateProfessional(updated);
      setCatalog(await fetchCatalog());
      showToast('Profissional atualizada com sucesso!');
    } catch (e) {
      showToast(errMsg(e));
    }
  };

  const handleUpdateSettings = async (newSettings: ClinicSettings) => {
    try {
      await updateSettings(newSettings);
      setCatalog(await fetchCatalog());
      showToast('Configurações da clínica salvas!');
    } catch (e) {
      showToast(errMsg(e));
    }
  };

  // 8. Notificações: a fila está no banco; aqui só recarregamos o que há nela.
  const handleRefreshNotifications = async () => {
    setIsRefreshingNotifs(true);
    try {
      setNotifications(await fetchNotifications());
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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-rose-500 selection:text-white">
      {/* Top Header Global */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          {/* Logo & Marca da Clínica */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-pink-500 via-rose-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-pink-500/20">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg text-white tracking-tight">
                  {settings.name}
                </span>
                <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-semibold">
                  Produção Ativa
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                Agendamento Biomédico & Gestão de Cabines
              </p>
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

            {currentUser.role === 'ADMIN' && (
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

            {currentUser.role === 'ADMIN' && (
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
            appointments={appointments}
            professionals={professionals}
            services={services}
            settings={settings}
            anamnesisOverview={anamnesisOverview}
            onUpdateStatus={handleUpdateStatus}
            onUpdateProfessional={handleUpdateProfessional}
            onUpdateSettings={handleUpdateSettings}
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

        {mainTab === 'concurrency' && currentUser.role === 'ADMIN' && <ConcurrencySimulator />}

        {mainTab === 'blueprint' && currentUser.role === 'ADMIN' && (
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
        {settings.name} • Sistema de Agendamento Estético • Arquitetura Supabase + FastAPI Serverless + Vercel
      </footer>
    </div>
  );
}
