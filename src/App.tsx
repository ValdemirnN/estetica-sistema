import React, { useState, useEffect } from 'react';
import {
  INITIAL_CATEGORIES,
  INITIAL_SERVICES,
  INITIAL_PROFESSIONALS,
  INITIAL_APPOINTMENTS,
  INITIAL_CLIENT,
  INITIAL_STAFF_USERS,
  INITIAL_ANAMNESIS,
  INITIAL_NOTIFICATIONS,
  INITIAL_SETTINGS
} from './mock/initialData';
import {
  Appointment,
  Professional,
  Service,
  ClinicSettings,
  AnamnesisRecord,
  AppointmentStatus,
  UserProfile,
  NotificationLog
} from './types/clinic';
import { ClientView } from './components/ClientView';
import { AdminView } from './components/AdminView';
import { NotificationsView } from './components/NotificationsView';
import { ConcurrencySimulator } from './components/ConcurrencySimulator';
import { FULL_SQL_SCHEMA } from './mock/sqlSchema';
import {
  Sparkles,
  Calendar,
  Users,
  Bell,
  Database,
  Layers,
  Zap,
  CheckCircle2,
  Copy,
  Check,
  Smartphone,
  Shield,
  Clock,
  ArrowRight
} from 'lucide-react';

export default function App() {
  // Estado dos Dados
  const [appointments, setAppointments] = useState<Appointment[]>(() => {
    const saved = localStorage.getItem('aesthetiq_appointments');
    return saved ? JSON.parse(saved) : INITIAL_APPOINTMENTS;
  });

  const [professionals, setProfessionals] = useState<Professional[]>(() => {
    const saved = localStorage.getItem('aesthetiq_professionals');
    return saved ? JSON.parse(saved) : INITIAL_PROFESSIONALS;
  });

  const [settings, setSettings] = useState<ClinicSettings>(() => {
    const saved = localStorage.getItem('aesthetiq_settings');
    return saved ? JSON.parse(saved) : INITIAL_SETTINGS;
  });

  const [notifications, setNotifications] = useState<NotificationLog[]>(() => {
    const saved = localStorage.getItem('aesthetiq_notifications');
    return saved ? JSON.parse(saved) : INITIAL_NOTIFICATIONS;
  });

  const [anamnesisMap, setAnamnesisMap] = useState<Record<string, AnamnesisRecord>>(() => {
    return {
      'usr-client-1': INITIAL_ANAMNESIS
    };
  });

  // Usuário Atual Logado
  const allUsers: UserProfile[] = [
    INITIAL_CLIENT,
    {
      id: 'usr-prof-1',
      role: 'PROFESSIONAL',
      fullName: 'Dra. Camila Vasconcellos',
      email: 'camila@aesthetiq.com.br',
      phone: '+551199444-5566',
      optInWhatsapp: true,
      optInEmail: true,
      lgpdConsentAt: '2025-10-01T00:00:00Z',
      termsVersion: 'v1.0'
    },
    ...INITIAL_STAFF_USERS
  ];

  const [currentUserId, setCurrentUserId] = useState<string>('usr-client-1');
  const currentUser = allUsers.find((u) => u.id === currentUserId) || INITIAL_CLIENT;

  // Navegação Principal da Aplicação
  const [mainTab, setMainTab] = useState<'client-app' | 'admin-panel' | 'notifications' | 'concurrency' | 'blueprint'>('client-app');

  // Estado para worker cron em execução
  const [isProcessingCron, setIsProcessingCron] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);

  // Persistência automática
  useEffect(() => {
    localStorage.setItem('aesthetiq_appointments', JSON.stringify(appointments));
  }, [appointments]);

  useEffect(() => {
    localStorage.setItem('aesthetiq_professionals', JSON.stringify(professionals));
  }, [professionals]);

  useEffect(() => {
    localStorage.setItem('aesthetiq_settings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem('aesthetiq_notifications', JSON.stringify(notifications));
  }, [notifications]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // 1. Criar novo Agendamento (Com confirmação imediata e fila WhatsApp/Email)
  const handleBookAppointment = (aptData: Partial<Appointment>) => {
    const newId = `apt-${Date.now().toString().slice(-6)}`;
    const newAppointment: Appointment = {
      id: newId,
      clientId: aptData.clientId || currentUser.id,
      clientName: aptData.clientName || currentUser.fullName,
      clientPhone: aptData.clientPhone || currentUser.phone,
      clientEmail: aptData.clientEmail || currentUser.email,
      professionalId: aptData.professionalId!,
      serviceId: aptData.serviceId!,
      startTime: aptData.startTime!,
      endTime: aptData.endTime!,
      bufferEndTime: aptData.bufferEndTime!,
      status: 'CONFIRMED',
      totalPriceCents: aptData.totalPriceCents || 0,
      clientNotes: aptData.clientNotes,
      statusHistory: [
        {
          status: 'CONFIRMED',
          changedAt: new Date().toISOString(),
          changedBy: `${currentUser.fullName} (${currentUser.role})`,
          note: 'Agendamento confirmado online via aplicação.'
        }
      ],
      createdAt: new Date().toISOString()
    };

    setAppointments((prev) => [newAppointment, ...prev]);

    // Enviar notificação imediata de confirmação (WhatsApp Oficial)
    const newNotifImmediate: NotificationLog = {
      id: `notif-${Date.now()}-1`,
      appointmentId: newId,
      recipientName: newAppointment.clientName,
      recipientAddress: newAppointment.clientPhone,
      channel: 'WHATSAPP',
      status: 'DELIVERED',
      templateName: 'appointment_confirmed_instant',
      scheduledFor: new Date().toISOString(),
      sentAt: new Date().toISOString(),
      payload: {
        procedimento: INITIAL_SERVICES.find((s) => s.id === newAppointment.serviceId)?.name,
        horario: newAppointment.startTime
      }
    };

    // Agendar lembrete automático para 24h antes
    const newNotifReminder: NotificationLog = {
      id: `notif-${Date.now()}-2`,
      appointmentId: newId,
      recipientName: newAppointment.clientName,
      recipientAddress: newAppointment.clientPhone,
      channel: 'WHATSAPP',
      status: 'QUEUED',
      templateName: 'appointment_reminder_24h',
      scheduledFor: new Date(new Date(newAppointment.startTime).getTime() - 24 * 3600000).toISOString(),
      payload: {
        procedimento: INITIAL_SERVICES.find((s) => s.id === newAppointment.serviceId)?.name
      }
    };

    setNotifications((prev) => [newNotifImmediate, newNotifReminder, ...prev]);
    showToast('Agendamento confirmado! Mensagem no WhatsApp enviada.');
  };

  // 2. Cancelar Agendamento
  const handleCancelAppointment = (aptId: string, reason: string) => {
    setAppointments((prev) =>
      prev.map((apt) => {
        if (apt.id !== aptId) return apt;
        return {
          ...apt,
          status: 'CANCELLED' as AppointmentStatus,
          cancellationReason: reason,
          cancelledAt: new Date().toISOString(),
          cancelledBy: currentUser.id,
          statusHistory: [
            ...apt.statusHistory,
            {
              status: 'CANCELLED' as AppointmentStatus,
              changedAt: new Date().toISOString(),
              changedBy: currentUser.fullName,
              note: reason || 'Cancelado pelo cliente respeitando antecedência mínima.'
            }
          ]
        };
      })
    );
    showToast('Agendamento cancelado com sucesso.');
  };

  // 3. Atualizar Status com Auditoria
  const handleUpdateStatus = (aptId: string, newStatus: AppointmentStatus, note?: string) => {
    setAppointments((prev) =>
      prev.map((apt) => {
        if (apt.id !== aptId) return apt;
        return {
          ...apt,
          status: newStatus,
          statusHistory: [
            ...apt.statusHistory,
            {
              status: newStatus,
              changedAt: new Date().toISOString(),
              changedBy: `${currentUser.fullName} (${currentUser.role})`,
              note: note || undefined
            }
          ]
        };
      })
    );
    showToast(`Status atualizado para ${newStatus}.`);
  };

  // 4. Atualizar Anamnese
  const handleUpdateAnamnesis = (updated: Partial<AnamnesisRecord>) => {
    setAnamnesisMap((prev) => ({
      ...prev,
      [currentUser.id]: {
        ...(prev[currentUser.id] || INITIAL_ANAMNESIS),
        ...updated,
        updatedAt: new Date().toISOString()
      }
    }));
  };

  // 5. Registrar Acesso LGPD à Anamnese
  const handleRecordAnamnesisAccess = (clientId: string, staffName: string) => {
    setAnamnesisMap((prev) => {
      const record = prev[clientId] || INITIAL_ANAMNESIS;
      return {
        ...prev,
        [clientId]: {
          ...record,
          accessLogs: [
            {
              id: `log-${Date.now()}`,
              accessedBy: currentUser.id,
              accessedByName: staffName,
              accessedAt: new Date().toISOString(),
              action: 'VIEW'
            },
            ...record.accessLogs
          ]
        }
      };
    });
  };

  // 6. Exportação de Dados LGPD
  const handleExportData = () => {
    const data = {
      perfil: currentUser,
      agendamentos: appointments.filter((a) => a.clientId === currentUser.id),
      anamnese: anamnesisMap[currentUser.id] || INITIAL_ANAMNESIS,
      dataExportacao: new Date().toISOString(),
      avisoLegal: 'Exportação em conformidade com o Artigo 18 da LGPD (Portabilidade de Dados Pessoais).'
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aesthetiq_meus_dados_${currentUser.id}.json`;
    a.click();
    showToast('Dados exportados em JSON conforme a LGPD.');
  };

  // 7. Disparar Worker Cron de Lembretes
  const handleTriggerCron = () => {
    setIsProcessingCron(true);
    setTimeout(() => {
      setNotifications((prev) =>
        prev.map((n) => {
          if (n.status === 'QUEUED') {
            return {
              ...n,
              status: 'DELIVERED',
              sentAt: new Date().toISOString()
            };
          }
          return n;
        })
      );
      setIsProcessingCron(false);
      showToast('Worker executado! Todas as notificações pendentes foram enviadas.');
    }, 1000);
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

          {/* Switcher de Perfis de Usuário para Testes Rápidos */}
          <div className="flex items-center gap-2 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <span className="text-[11px] text-slate-400 pl-2 hidden md:block">Simular como:</span>
            <select
              value={currentUserId}
              onChange={(e) => {
                const uid = e.target.value;
                setCurrentUserId(uid);
                const u = allUsers.find((x) => x.id === uid);
                if (u?.role === 'CLIENT') {
                  setMainTab('client-app');
                } else {
                  setMainTab('admin-panel');
                }
              }}
              className="bg-slate-900 text-xs text-white border-0 rounded-lg px-2.5 py-1.5 focus:ring-1 focus:ring-rose-500 font-medium cursor-pointer"
            >
              <option value="usr-client-1">👤 Juliana (Cliente)</option>
              <option value="usr-prof-1">👩‍⚕️ Dra. Camila (Biomédica)</option>
              <option value="usr-recep-1">📋 Mariana (Recepção)</option>
              <option value="usr-admin-1">⚙️ Renata (Gestora/Admin)</option>
            </select>
          </div>
        </div>
      </header>

      {/* Main Tab Navigation Bar */}
      <div className="bg-slate-900 border-b border-slate-800 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-between overflow-x-auto gap-2">
          <div className="flex items-center gap-1 py-2 text-xs">
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
          </div>
        </div>
      </div>

      {/* Main View Area */}
      <main className="flex-1 max-w-7xl mx-auto px-4 py-6 w-full">
        {mainTab === 'client-app' && (
          <ClientView
            currentUser={currentUser}
            categories={INITIAL_CATEGORIES}
            services={INITIAL_SERVICES}
            professionals={professionals}
            appointments={appointments}
            anamnesis={anamnesisMap[currentUser.id] || INITIAL_ANAMNESIS}
            settings={settings}
            onBookAppointment={handleBookAppointment}
            onCancelAppointment={handleCancelAppointment}
            onUpdateAnamnesis={handleUpdateAnamnesis}
            onExportData={handleExportData}
          />
        )}

        {mainTab === 'admin-panel' && (
          <AdminView
            currentUser={currentUser}
            appointments={appointments}
            professionals={professionals}
            services={INITIAL_SERVICES}
            settings={settings}
            anamnesisMap={anamnesisMap}
            onUpdateStatus={handleUpdateStatus}
            onUpdateProfessional={(updatedProf) => {
              setProfessionals((prev) =>
                prev.map((p) => (p.id === updatedProf.id ? updatedProf : p))
              );
              showToast('Profissional atualizada com sucesso!');
            }}
            onUpdateSettings={(newSettings) => {
              setSettings(newSettings);
              showToast('Configurações da clínica salvas!');
            }}
            onRecordAnamnesisAccess={handleRecordAnamnesisAccess}
          />
        )}

        {mainTab === 'notifications' && (
          <NotificationsView
            notifications={notifications}
            onTriggerCronWorker={handleTriggerCron}
            isProcessing={isProcessingCron}
          />
        )}

        {mainTab === 'concurrency' && <ConcurrencySimulator />}

        {mainTab === 'blueprint' && (
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
