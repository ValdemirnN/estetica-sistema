import React, { useState } from 'react';
import {
  Appointment,
  Professional,
  Service,
  ClinicSettings,
  AnamnesisOverviewItem,
  AnamnesisRecord,
  AppointmentStatus,
  UserProfile
} from '../types/clinic';
import { formatLocalDate, formatLocalTime } from '../services/slotCalculator';
import { AdminDashboard } from './AdminDashboard';
import {
  Calendar as CalendarIcon,
  Clock,
  User,
  Users,
  Settings,
  Shield,
  CheckCircle2,
  XCircle,
  AlertOctagon,
  FileText,
  Sliders,
  ChevronLeft,
  ChevronRight,
  Filter,
  Plus,
  Eye,
  MessageSquare,
  Lock,
  History,
  BarChart3
} from 'lucide-react';

interface AdminViewProps {
  currentUser: UserProfile;
  appointments: Appointment[];
  professionals: Professional[];
  services: Service[];
  settings: ClinicSettings;
  anamnesisOverview: AnamnesisOverviewItem[]; // lista sem dados de saúde
  onUpdateStatus: (aptId: string, newStatus: AppointmentStatus, note?: string) => void;
  onUpdateProfessional: (prof: Professional) => void;
  onUpdateSettings: (newSettings: ClinicSettings) => void;
  /** Abre a ficha; o banco registra o acesso na trilha de auditoria (LGPD). */
  onOpenAnamnesis: (clientId: string) => Promise<AnamnesisRecord | null>;
}

export function AdminView({
  currentUser,
  appointments,
  professionals,
  services,
  settings,
  anamnesisOverview,
  onUpdateStatus,
  onUpdateProfessional,
  onUpdateSettings,
  onOpenAnamnesis
}: AdminViewProps) {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'calendar' | 'professionals' | 'clients' | 'settings'>('dashboard');
  const [selectedProfFilter, setSelectedProfFilter] = useState<string>('ALL');
  const [viewMode, setViewMode] = useState<'daily' | 'weekly'>('daily');

  // Estado para visualização de ficha de anamnese
  const [viewingAnamnesis, setViewingAnamnesis] = useState<AnamnesisRecord | null>(null);

  // Estado para modal de alteração de status
  const [statusModalApt, setStatusModalApt] = useState<Appointment | null>(null);
  const [selectedNewStatus, setSelectedNewStatus] = useState<AppointmentStatus>('COMPLETED');
  const [statusChangeNote, setStatusChangeNote] = useState('');

  // Configurações formulário
  const [formSettings, setFormSettings] = useState<ClinicSettings>(settings);

  // Filtro de agendamentos por profissional
  const filteredAppointments = appointments.filter((apt) => {
    if (selectedProfFilter === 'ALL') return true;
    return apt.professionalId === selectedProfFilter;
  });

  const getStatusBadge = (status: AppointmentStatus) => {
    switch (status) {
      case 'CONFIRMED':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">Confirmado</span>;
      case 'COMPLETED':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/10 text-indigo-300 border border-indigo-500/30">Concluído</span>;
      case 'CANCELLED':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/30">Cancelado</span>;
      case 'NO_SHOW':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">No-Show</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-700 text-slate-300">Pendente</span>;
    }
  };

  const handleOpenAnamnesis = async (clientId: string) => {
    const record = await onOpenAnamnesis(clientId);
    if (record) setViewingAnamnesis(record);
  };

  const isAdmin = currentUser.role === 'ADMIN';

  const handleApplyStatusChange = () => {
    if (!statusModalApt) return;
    onUpdateStatus(statusModalApt.id, selectedNewStatus, statusChangeNote);
    setStatusModalApt(null);
    setStatusChangeNote('');
  };

  return (
    <div className="space-y-6">
      {/* Top Admin Sub-bar */}
      <div className="flex flex-wrap items-center justify-between border-b border-slate-800 pb-3 gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${
              activeTab === 'dashboard'
                ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            Dashboard & Indicadores
          </button>
          <button
            onClick={() => setActiveTab('calendar')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${
              activeTab === 'calendar'
                ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <CalendarIcon className="w-3.5 h-3.5" />
            Agenda Clínica
          </button>
          <button
            onClick={() => setActiveTab('professionals')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${
              activeTab === 'professionals'
                ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Profissionais & Horários
          </button>
          <button
            onClick={() => setActiveTab('clients')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${
              activeTab === 'clients'
                ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            Fichas & Anamnese
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${
              activeTab === 'settings'
                ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            Regras de Negócio
          </button>
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
        <AdminDashboard
          currentUser={currentUser}
          appointments={appointments}
          professionals={professionals}
          services={services}
        />
      )}

      {/* ================= ABA 1: AGENDA CLÍNICA ================= */}
      {activeTab === 'calendar' && (
        <div className="space-y-4">
          {/* Filtros e Controles da Agenda */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs text-slate-300">
                <Filter className="w-3.5 h-3.5 text-rose-400" />
                <span>Profissional:</span>
              </div>
              <select
                value={selectedProfFilter}
                onChange={(e) => setSelectedProfFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-rose-500"
              >
                <option value="ALL">Todas as Profissionais ({professionals.length})</option>
                {professionals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400">Total de Agendamentos:</span>
              <span className="font-mono font-bold text-white bg-slate-800 px-2.5 py-0.5 rounded">
                {filteredAppointments.length}
              </span>
            </div>
          </div>

          {/* Lista de Atendimentos da Agenda */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <span className="text-xs font-bold text-white uppercase tracking-wider">
                Fluxo de Atendimento em Tempo Real
              </span>
              <span className="text-xs text-slate-400">Clique para alterar status ou auditar</span>
            </div>

            <div className="divide-y divide-slate-800/80">
              {filteredAppointments.map((apt) => {
                const srv = services.find((s) => s.id === apt.serviceId);
                const prof = professionals.find((p) => p.id === apt.professionalId);

                return (
                  <div
                    key={apt.id}
                    className="p-4 hover:bg-slate-800/40 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    <div className="flex items-start gap-4">
                      {/* Cor do Profissional */}
                      <div
                        style={{ backgroundColor: prof?.colorHex || '#ec4899' }}
                        className="w-2.5 h-12 rounded-full shrink-0"
                        title={prof?.name}
                      />

                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          {getStatusBadge(apt.status)}
                          <span className="text-xs font-mono text-slate-400">
                            {formatLocalDate(apt.startTime)}
                          </span>
                          <span className="text-xs font-mono font-bold text-white bg-slate-800 px-1.5 py-0.5 rounded">
                            {formatLocalTime(apt.startTime)} - {formatLocalTime(apt.endTime)}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-white">{apt.clientName}</h4>
                          <span className="text-xs text-slate-400">({apt.clientPhone})</span>
                        </div>

                        <div className="text-xs text-slate-300 flex items-center gap-2">
                          <strong className="text-rose-300">{srv?.name}</strong>
                          <span>•</span>
                          <span className="text-slate-400">Profissional: {prof?.name}</span>
                        </div>

                        {apt.internalStaffNotes && (
                          <p className="text-[11px] text-amber-300/80 bg-amber-950/20 px-2 py-0.5 rounded border border-amber-900/40 max-w-lg">
                            Nota interna: {apt.internalStaffNotes}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end md:self-center shrink-0">
                      <button
                        onClick={() => handleOpenAnamnesis(apt.clientId)}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 flex items-center gap-1.5 transition-colors"
                        title="Visualizar ficha de anamnese com log LGPD"
                      >
                        <Eye className="w-3.5 h-3.5 text-indigo-400" />
                        Anamnese
                      </button>

                      <button
                        onClick={() => {
                          setStatusModalApt(apt);
                          setSelectedNewStatus(apt.status);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white flex items-center gap-1.5 transition-all shadow-md shadow-rose-600/20"
                      >
                        <Sliders className="w-3.5 h-3.5" />
                        Mudar Status
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ================= ABA 2: PROFISSIONAIS & HORÁRIOS ================= */}
      {activeTab === 'professionals' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Users className="w-4 h-4 text-rose-400" /> Corpo Clínico & Gestão de Cabines
            </h3>
            <span className="text-xs text-slate-400">
              Controle de jornadas, buffers de higienização e especialidades
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {professionals.map((prof) => (
              <div
                key={prof.id}
                className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <img
                      src={prof.avatarUrl}
                      alt={prof.name}
                      className="w-12 h-12 rounded-xl object-cover border border-slate-700"
                    />
                    <div>
                      <h4 className="font-bold text-white text-sm">{prof.name}</h4>
                      <p className="text-xs text-slate-400">{prof.title}</p>
                      <span className="text-[10px] text-rose-400 font-mono">{prof.registryNumber}</span>
                    </div>
                  </div>

                  <div className="space-y-2 text-xs bg-slate-950 p-3 rounded-xl border border-slate-800">
                    <div className="flex justify-between text-slate-300">
                      <span>Intervalo pós-atendimento (Buffer):</span>
                      <strong className="text-emerald-400">{prof.intervalBufferMinutes} min</strong>
                    </div>
                    <div className="flex justify-between text-slate-300">
                      <span>Distribuição Automática ("Primeiro Disp."):</span>
                      <strong className={prof.isAvailableForAutoAssign ? 'text-emerald-400' : 'text-slate-500'}>
                        {prof.isAvailableForAutoAssign ? 'Ativo' : 'Inativo'}
                      </strong>
                    </div>
                    <div className="flex justify-between text-slate-300">
                      <span>Procedimentos habilitados:</span>
                      <span className="text-white font-mono">{prof.specialtyServiceIds.length} serviços</span>
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800 flex justify-between items-center text-xs">
                  <span className="text-slate-500">Jornada Seg-Sáb</span>
                  {isAdmin && <button
                    onClick={() => {
                      const newBuffer = prof.intervalBufferMinutes === 15 ? 20 : 15;
                      onUpdateProfessional({
                        ...prof,
                        intervalBufferMinutes: newBuffer
                      });
                    }}
                    className="text-rose-400 hover:text-rose-300 font-semibold"
                  >
                    Alternar Buffer ({prof.intervalBufferMinutes}m)
                  </button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ================= ABA 3: FICHAS DE CLIENTES & ANAMNESE ================= */}
      {activeTab === 'clients' && (
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <h3 className="text-base font-bold text-white mb-2 flex items-center gap-2">
              <FileText className="w-4 h-4 text-rose-400" /> Prontuários & Fichas de Anamnese
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Acesso protegido e auditado conforme exigido pelo Artigo 11 da LGPD para dados sensíveis de saúde.
            </p>

            <div className="divide-y divide-slate-800">
              {anamnesisOverview.length === 0 && (
                <p className="py-3 text-xs text-slate-500">Nenhuma ficha de anamnese preenchida ainda.</p>
              )}
              {anamnesisOverview.map((item) => (
                <div key={item.clientId} className="py-3 flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-white">{item.clientName}</h4>
                    <p className="text-xs text-slate-400">
                      Última atualização: {new Date(item.updatedAt).toLocaleDateString('pt-BR')} • {item.accessCount} acessos registrados
                    </p>
                  </div>
                  <button
                    onClick={() => handleOpenAnamnesis(item.clientId)}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white flex items-center gap-1.5 transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Abrir Ficha Completa
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================= ABA 4: CONFIGURAÇÕES & REGRAS DE NEGÓCIO ================= */}
      {activeTab === 'settings' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-2xl mx-auto space-y-5">
          <div className="border-b border-slate-800 pb-3">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Settings className="w-4 h-4 text-rose-400" /> Parâmetros de Funcionamento da Clínica
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Políticas de cancelamento, intervalo padrão e algoritmos de concorrência.
            </p>
          </div>

          <div className="space-y-4 text-xs">
            <div>
              <label className="text-slate-300 font-semibold block mb-1">
                Antecedência Mínima para Cancelamento / Remarcação (Horas):
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={1}
                  max={72}
                  value={formSettings.minCancelNoticeHours}
                  onChange={(e) => setFormSettings({ ...formSettings, minCancelNoticeHours: Number(e.target.value) })}
                  className="w-24 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-rose-500"
                />
                <span className="text-slate-400">
                  horas antes do atendimento (Clientes não conseguem cancelar online abaixo deste prazo).
                </span>
              </div>
            </div>

            <div>
              <label className="text-slate-300 font-semibold block mb-1">
                Intervalo Padrão entre Atendimentos (Buffer de Higienização):
              </label>
              <div className="flex items-center gap-3">
                <select
                  value={formSettings.defaultBufferMinutes}
                  onChange={(e) => setFormSettings({ ...formSettings, defaultBufferMinutes: Number(e.target.value) })}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-rose-500"
                >
                  <option value={10}>10 minutos</option>
                  <option value={15}>15 minutos (Padrão)</option>
                  <option value={20}>20 minutos</option>
                  <option value={30}>30 minutos</option>
                </select>
                <span className="text-slate-400">Garante tempo de esterilização entre pacientes.</span>
              </div>
            </div>

            <div>
              <label className="text-slate-300 font-semibold block mb-1">
                Estratégia do "Primeiro Disponível":
              </label>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-300">
                <strong className="text-rose-400">Distribuição Justa (Round-Robin com Least-Busy):</strong>
                <p className="text-[11px] text-slate-400 mt-1">
                  Distribui os agendamentos automáticos priorizando a profissional com menor número de sessões na semana, equilibrando a comissão e o faturamento da equipe.
                </p>
              </div>
            </div>

            <div className="pt-3 flex justify-end">
              <button
                disabled={!isAdmin}
                title={isAdmin ? undefined : 'Apenas o perfil Admin pode alterar as regras da clínica'}
                onClick={() => onUpdateSettings(formSettings)}
                className={`px-5 py-2.5 rounded-xl font-semibold transition-all ${
                  isAdmin
                    ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-600/30'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                }`}
              >
                Salvar Regras da Clínica
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: ALTERAR STATUS & AUDITORIA ================= */}
      {statusModalApt && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-rose-400" /> Alterar Status do Agendamento
                </h3>
                <p className="text-xs text-slate-400">Cliente: {statusModalApt.clientName}</p>
              </div>
              <button onClick={() => setStatusModalApt(null)} className="text-slate-400 hover:text-white">
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <label className="text-xs text-slate-300 font-semibold block">Novo Status:</label>
              <div className="grid grid-cols-2 gap-2">
                {(['CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as AppointmentStatus[]).map((st) => (
                  <button
                    key={st}
                    onClick={() => setSelectedNewStatus(st)}
                    className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-all ${
                      selectedNewStatus === st
                        ? 'bg-rose-600 text-white border-rose-500 shadow-md'
                        : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {st === 'CONFIRMED' ? 'Confirmado' : st === 'COMPLETED' ? 'Concluído' : st === 'CANCELLED' ? 'Cancelado' : 'No-Show'}
                  </button>
                ))}
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Nota de Auditoria (Quem / Por quê):</label>
                <input
                  type="text"
                  placeholder="Ex: Cliente compareceu e realizou o protocolo completo..."
                  value={statusChangeNote}
                  onChange={(e) => setStatusChangeNote(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-rose-500"
                />
              </div>

              {/* Histórico de Alterações */}
              {statusModalApt.statusHistory.length > 0 && (
                <div className="border-t border-slate-800 pt-3">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2 flex items-center gap-1">
                    <History className="w-3 h-3 text-indigo-400" /> Trilha de Auditoria Deste Agendamento
                  </span>
                  <div className="max-h-24 overflow-y-auto space-y-1.5 text-[11px] text-slate-400">
                    {statusModalApt.statusHistory.map((hist, idx) => (
                      <div key={idx} className="bg-slate-950 p-1.5 rounded border border-slate-800/80">
                        <strong className="text-white">{hist.status}</strong> alterado por {hist.changedBy} em{' '}
                        {new Date(hist.changedAt).toLocaleTimeString('pt-BR')} {hist.note ? `("${hist.note}")` : ''}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setStatusModalApt(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-xs font-semibold text-slate-300"
              >
                Cancelar
              </button>
              <button
                onClick={handleApplyStatusChange}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white shadow-md shadow-rose-600/30"
              >
                Salvar Alteração
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: VISUALIZAÇÃO DE ANAMNESE AUDITADA ================= */}
      {viewingAnamnesis && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Shield className="w-4 h-4 text-emerald-400" /> Ficha de Anamnese (LGPD Auditada)
                </h3>
                <p className="text-xs text-slate-400">Acesso registrado em tempo real no log de auditoria</p>
              </div>
              <button onClick={() => setViewingAnamnesis(null)} className="text-slate-400 hover:text-white">
                ✕
              </button>
            </div>

            {(() => {
              const rec = viewingAnamnesis;
              return (
                <div className="space-y-3 text-xs">
                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                    <span className="text-slate-400 font-semibold block mb-0.5">Alergias:</span>
                    <p className="text-white">{rec.allergies || 'Nenhuma alergia relatada.'}</p>
                  </div>

                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                    <span className="text-slate-400 font-semibold block mb-0.5">Tipo de Pele / Fototipo:</span>
                    <p className="text-white">{rec.skinType || 'Padrão não especificado.'}</p>
                  </div>

                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                    <span className="text-slate-400 font-semibold block mb-0.5">Medicamentos Contínuos:</span>
                    <p className="text-white">{rec.currentMedications || 'Nenhum'}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                      <span className="text-slate-400 block text-[11px]">Gestante / Lactante:</span>
                      <strong className={rec.pregnantOrLactating ? 'text-amber-400' : 'text-slate-300'}>
                        {rec.pregnantOrLactating ? 'Sim (Contraindicação)' : 'Não'}
                      </strong>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                      <span className="text-slate-400 block text-[11px]">Marcapasso / Implante:</span>
                      <strong className={rec.hasPacemakerOrImplants ? 'text-rose-400' : 'text-slate-300'}>
                        {rec.hasPacemakerOrImplants ? 'Sim (Atenção)' : 'Não'}
                      </strong>
                    </div>
                  </div>

                  <div className="border-t border-slate-800 pt-3">
                    <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                      Trilha de Auditoria de Acesso (LGPD Art. 6º e 11)
                    </h5>
                    <div className="space-y-1 max-h-24 overflow-y-auto text-[11px] text-slate-400">
                      {rec.accessLogs.map((l) => (
                        <div key={l.id} className="bg-slate-950 p-1.5 rounded border border-slate-800/80">
                          {l.action} realizado por <strong>{l.accessedByName}</strong> em {new Date(l.accessedAt).toLocaleString('pt-BR')}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setViewingAnamnesis(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-xs font-semibold text-white"
              >
                Fechar Ficha
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
