import React, { Suspense, lazy, useState } from 'react';
import {
  Appointment,
  AppointmentStatus,
  BusyBlock,
  ClientRecord,
  ClinicSettings,
  Leave,
  Professional,
  Service,
  ServiceCategory,
  UserProfile
} from '../../types/clinic';
import type { BookingInput, NewClientInput } from '../../services/api';
import { ViewFallback } from '../ViewFallback';
import { ServicesManager } from './ServicesManager';
import { ProfessionalsManager } from './ProfessionalsManager';
import { ClinicSettingsPanel } from './ClinicSettingsPanel';
import { StaffScheduler } from '../clinic/StaffScheduler';
import { ClientsList } from '../clinic/ClientsList';
import { NewClientModal } from '../clinic/NewClientModal';
import type { SeriesResult } from '../clinic/NewAppointmentModal';
import {
  Calendar as CalendarIcon,
  Users,
  Settings,
  CheckCircle2,
  UserRound,
  Tag,
  BarChart3
} from 'lucide-react';

interface AdminViewProps {
  currentUser: UserProfile;
  clinicId: string;
  appointments: Appointment[];
  categories: ServiceCategory[];
  professionals: Professional[];
  services: Service[];
  leaves: Leave[];
  settings: ClinicSettings;
  clients: ClientRecord[];
  busyBlocks: BusyBlock[];
  onUpdateStatus: (aptId: string, newStatus: AppointmentStatus, note?: string) => Promise<void>;
  /** Recarrega catálogo, profissionais e marca depois de uma edição do dono. */
  onCatalogChanged: () => Promise<void>;
  notify: (msg: string) => void;
  onBookSeries: (inputs: BookingInput[], labels: string[]) => Promise<SeriesResult>;
  onReschedule: (aptId: string, startIso: string, professionalId: string | null) => Promise<boolean>;
  onCreateClient: (input: NewClientInput) => Promise<{ clientId: string; temporaryPassword: string }>;
  onSaveClientNotes: (clientId: string, notes: string) => Promise<void>;
}

type AdminTab = 'dashboard' | 'calendar' | 'services' | 'professionals' | 'clients' | 'settings';

// O dashboard carrega o recharts: fica em chunk próprio.
const AdminDashboard = lazy(() => import('./AdminDashboard').then((m) => ({ default: m.AdminDashboard })));

export function AdminView({
  currentUser,
  clinicId,
  appointments,
  categories,
  professionals,
  services,
  leaves,
  settings,
  clients,
  busyBlocks,
  onUpdateStatus,
  onCatalogChanged,
  notify,
  onBookSeries,
  onReschedule,
  onCreateClient,
  onSaveClientNotes
}: AdminViewProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');
  const isAdmin = currentUser.role === 'ADMIN';
  const [showNewClient, setShowNewClient] = useState(false);
  // Cliente escolhido na lista ("Agendar"): abre a agenda com o novo agendamento já preenchido.
  const [presetClientId, setPresetClientId] = useState<string | null>(null);

  const tabs: { id: AdminTab; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = (
    [
      { id: 'dashboard', label: 'Dashboard & Indicadores', icon: <BarChart3 className="w-3.5 h-3.5" /> },
      { id: 'calendar', label: 'Agenda', icon: <CalendarIcon className="w-3.5 h-3.5" /> },
      { id: 'services', label: 'Procedimentos & Preços', icon: <Tag className="w-3.5 h-3.5" />, adminOnly: true },
      { id: 'professionals', label: 'Profissionais & Horários', icon: <Users className="w-3.5 h-3.5" />, adminOnly: true },
      { id: 'clients', label: 'Clientes', icon: <UserRound className="w-3.5 h-3.5" /> },
      { id: 'settings', label: 'Minha Clínica', icon: <Settings className="w-3.5 h-3.5" />, adminOnly: true }
    ] as { id: AdminTab; label: string; icon: React.ReactNode; adminOnly?: boolean }[]
  ).filter((t) => isAdmin || !t.adminOnly);

  // Passos para a clínica ficar pronta para receber agendamentos (só o dono vê)
  const setupSteps = [
    { done: professionals.some((p) => p.isActive), label: 'Cadastre quem atende', tab: 'professionals' as AdminTab },
    { done: professionals.some((p) => p.isActive && p.workingHours.some((w) => w.isActive)), label: 'Defina os dias e horários de atendimento', tab: 'professionals' as AdminTab },
    { done: services.some((s) => s.isActive), label: 'Cadastre seus procedimentos e preços', tab: 'services' as AdminTab },
    {
      done: services.some((s) => s.isActive && professionals.some((p) => p.isActive && p.specialtyServiceIds.includes(s.id))),
      label: 'Vincule os procedimentos a quem realiza',
      tab: 'services' as AdminTab
    },
    { done: !!settings.logoUrl || settings.primaryColor.toLowerCase() !== '#e11d48', label: 'Personalize logo, cores e textos', tab: 'settings' as AdminTab }
  ];
  const nextStep = setupSteps.find((st) => !st.done);

  return (
    <div className="space-y-6">
      {isAdmin && nextStep && (
        <div className="bg-slate-900 border border-rose-500/30 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-white">Primeiros passos para receber agendamentos</h3>
            <span className="text-[11px] text-slate-400">
              {setupSteps.filter((x) => x.done).length}/{setupSteps.length} concluídos
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {setupSteps.map((st) => (
              <button
                key={st.label}
                onClick={() => setActiveTab(st.tab)}
                className={`flex items-center gap-2 text-left text-xs px-3 py-2 rounded-xl border transition-colors ${
                  st.done
                    ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300'
                    : 'border-slate-700 bg-slate-950 text-slate-200 hover:border-rose-500/50'
                }`}
              >
                {st.done ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <span className="w-4 h-4 rounded-full border border-slate-600 shrink-0" />}
                {st.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Top Admin Sub-bar */}
      <div className="flex flex-wrap items-center justify-between border-b border-slate-800 pb-3 gap-3">
        <div className="flex items-center gap-2 overflow-x-auto max-w-full">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 whitespace-nowrap ${
                activeTab === t.id
                  ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-400">Perfil Ativo:</span>
          <span className="font-semibold text-rose-300 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
            {currentUser.role === 'ADMIN' ? 'Gestão / Dono (Admin)' : currentUser.role === 'PROFESSIONAL' ? 'Corpo Clínico' : 'Recepção'}
          </span>
        </div>
      </div>

      {/* ================= ABA 0: DASHBOARD COM RECHARTS ================= */}
      {activeTab === 'dashboard' && (
        <Suspense fallback={<ViewFallback />}>
          <AdminDashboard
            currentUser={currentUser}
            appointments={appointments}
            professionals={professionals}
            services={services}
          />
        </Suspense>
      )}

      {/* ================= ABA 1: AGENDA ================= */}
      {activeTab === 'calendar' && (
        <StaffScheduler
          appointments={appointments}
          clients={clients}
          services={services}
          professionals={professionals}
          leaves={leaves}
          busyBlocks={busyBlocks}
          settings={settings}
          presetClientId={presetClientId}
          onPresetConsumed={() => setPresetClientId(null)}
          onUpdateStatus={onUpdateStatus}
          onBookSeries={onBookSeries}
          onReschedule={onReschedule}
          onCreateClient={onCreateClient}
        />
      )}

      {/* ================= ABA: PROCEDIMENTOS & PREÇOS ================= */}
      {activeTab === 'services' && isAdmin && (
        <ServicesManager
          clinicId={clinicId}
          categories={categories}
          services={services}
          professionals={professionals}
          onChanged={onCatalogChanged}
          notify={notify}
          goToProfessionals={() => setActiveTab('professionals')}
        />
      )}

      {/* ================= ABA: PROFISSIONAIS & HORÁRIOS ================= */}
      {activeTab === 'professionals' && isAdmin && (
        <ProfessionalsManager
          clinicId={clinicId}
          professionals={professionals}
          services={services}
          leaves={leaves}
          onChanged={onCatalogChanged}
          notify={notify}
        />
      )}

      {/* ================= ABA: CLIENTES ================= */}
      {activeTab === 'clients' && (
        <>
          <ClientsList
            clients={clients}
            appointments={appointments}
            onNewClient={() => setShowNewClient(true)}
            onBook={(id) => {
              setPresetClientId(id);
              setActiveTab('calendar');
            }}
            onSaveNotes={onSaveClientNotes}
            notify={notify}
          />
          {showNewClient && <NewClientModal onClose={() => setShowNewClient(false)} onCreate={onCreateClient} />}
        </>
      )}

      {/* ================= ABA: MINHA CLÍNICA (marca, regras, equipe) ================= */}
      {activeTab === 'settings' && isAdmin && (
        <ClinicSettingsPanel
          clinicId={clinicId}
          settings={settings}
          currentUserId={currentUser.id}
          onChanged={onCatalogChanged}
          notify={notify}
        />
      )}
    </div>
  );
}
