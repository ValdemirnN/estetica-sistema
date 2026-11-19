import React, { useMemo } from 'react';
import {
  AgendaStatus,
  Appointment,
  Service,
  ServiceCategory,
  Professional,
  UserProfile
} from '../../types/clinic';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid
} from 'recharts';
import {
  Sparkles,
  Calendar,
  Clock,
  Heart,
  Award,
  ChevronRight,
  ShieldCheck,
  CheckCircle2,
  CalendarCheck,
  CalendarPlus,
  Smile
} from 'lucide-react';
import { formatLocalDate, formatLocalTime } from '../../services/slotCalculator';
import {
  DueStatus,
  careMinutes,
  categoryMix,
  dueText,
  intervalText,
  monthlySessions,
  preventiveSchedule
} from '../../services/clientInsights';
import { EmptyState, InlineError } from '../StateBlocks';

interface ClientDashboardProps {
  currentUser: UserProfile;
  appointments: Appointment[];
  categories: ServiceCategory[];
  services: Service[];
  professionals: Professional[];
  agendaStatus: AgendaStatus;
  onRetry: () => void;
  onNavigateToBooking: () => void;
  onNavigateToAppointments: () => void;
  /** Abre o agendamento já com o procedimento escolhido. */
  onBookService: (serviceId: string) => void;
}

const MIX_COLORS = ['#ec4899', '#8b5cf6', '#10b981', '#06b6d4', '#f59e0b', '#64748b'];

const DUE_STYLE: Record<DueStatus, { badge: string; label: string }> = {
  overdue: { badge: 'text-rose-300 bg-rose-500/10 border-rose-500/30', label: 'Atrasado' },
  today: { badge: 'text-amber-300 bg-amber-500/10 border-amber-500/30', label: 'Hoje' },
  soon: { badge: 'text-amber-300 bg-amber-500/10 border-amber-500/30', label: 'Em breve' },
  upcoming: { badge: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30', label: 'No prazo' }
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function formatCareTime(minutes: number): string {
  const total = Math.round(minutes);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function ClientDashboard({
  currentUser,
  appointments,
  categories,
  services,
  professionals,
  agendaStatus,
  onRetry,
  onNavigateToBooking,
  onNavigateToAppointments,
  onBookService
}: ClientDashboardProps) {
  // Só os agendamentos desta cliente
  const clientApts = useMemo(() => {
    return appointments.filter((a) => a.clientId === currentUser.id);
  }, [appointments, currentUser.id]);

  const upcomingApt = useMemo(() => {
    const now = new Date();
    return clientApts
      .filter((a) => a.status === 'CONFIRMED' && new Date(a.startTime) >= now)
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())[0];
  }, [clientApts]);

  const futureCount = useMemo(() => {
    const now = new Date();
    return clientApts.filter((a) => a.status === 'CONFIRMED' && new Date(a.startTime) >= now).length;
  }, [clientApts]);

  const completedCount = useMemo(() => clientApts.filter((a) => a.status === 'COMPLETED').length, [clientApts]);

  // Tudo abaixo é calculado dos agendamentos reais (sem valores fixos nem mínimos forçados).
  const totalCareMinutes = useMemo(() => careMinutes(clientApts, currentUser.id), [clientApts, currentUser.id]);
  const monthlyData = useMemo(() => monthlySessions(clientApts, currentUser.id), [clientApts, currentUser.id]);
  const mixData = useMemo(
    () => categoryMix(clientApts, currentUser.id, services, categories),
    [clientApts, currentUser.id, services, categories]
  );
  const schedule = useMemo(
    () => preventiveSchedule(clientApts, currentUser.id, services),
    [clientApts, currentUser.id, services]
  );
  const hasMonthlyData = monthlyData.some((m) => m.sessions > 0);

  const upcomingService = upcomingApt
    ? services.find((s) => s.id === upcomingApt.serviceId)
    : null;
  const upcomingProf = upcomingApt
    ? professionals.find((p) => p.id === upcomingApt.professionalId)
    : null;

  return (
    <div className="space-y-6">
      {agendaStatus === 'error' && (
        <InlineError
          text="Não foi possível atualizar seus agendamentos. O que aparece abaixo pode estar desatualizado."
          onRetry={onRetry}
        />
      )}

      {/* Banner de Boas-Vindas Personalizado */}
      <div className="bg-gradient-to-r from-rose-950/40 via-slate-900 to-indigo-950/40 border border-rose-500/20 rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold bg-rose-500/10 text-rose-300 border border-rose-500/30">
            <Heart className="w-3 h-3 text-rose-400 fill-rose-400" /> Meu Espaço de Autocuidado
          </span>
          <h2 className="text-xl md:text-2xl font-bold text-white tracking-tight">
            Olá, {currentUser.fullName.split(' ')[0]}! Sua jornada de beleza e bem-estar
          </h2>
          <p className="text-xs text-slate-300 max-w-xl leading-relaxed">
            Acompanhe o histórico dos seus procedimentos, manutenções preventivas e tempo dedicado à sua autoestima.
          </p>
        </div>

        <button
          onClick={onNavigateToBooking}
          className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 text-white text-xs font-semibold shadow-lg shadow-rose-600/30 transition-all flex items-center justify-center gap-2 shrink-0 self-start md:self-auto"
        >
          <Sparkles className="w-4 h-4" />
          Agendar Novo Procedimento
        </button>
      </div>

      {/* Cards de Métricas Pessoais do Cliente */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Sessões Realizadas</span>
            <span className="p-2 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20">
              <Sparkles className="w-4 h-4" />
            </span>
          </div>
          <div className="text-2xl font-bold font-mono text-white">
            {plural(completedCount, 'procedimento', 'procedimentos')}
          </div>
          <p className="text-[11px] text-slate-400">Atendimentos concluídos</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Tempo de Autocuidado</span>
            <span className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Clock className="w-4 h-4" />
            </span>
          </div>
          <div className="text-2xl font-bold font-mono text-white">
            {formatCareTime(totalCareMinutes)}
          </div>
          <p className="text-[11px] text-emerald-400">Dedicado ao seu bem-estar</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Próximos Agendamentos</span>
            <span className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Award className="w-4 h-4" />
            </span>
          </div>
          <div className="text-2xl font-bold font-mono text-amber-300">
            {plural(futureCount, 'agendamento', 'agendamentos')}
          </div>
          <p className="text-[11px] text-slate-400">
            {futureCount === 0 ? 'Nenhum horário reservado' : 'Já reservados para você'}
          </p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Privacidade</span>
            <span className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <ShieldCheck className="w-4 h-4" />
            </span>
          </div>
          <div className="text-sm font-bold text-white flex items-center gap-1.5 pt-1">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Dados Protegidos
          </div>
          <p className="text-[11px] text-slate-400">Protegido sob a LGPD</p>
        </div>
      </div>

      {/* Próximo Agendamento em Destaque */}
      {upcomingApt && upcomingService && (
        <div className="bg-gradient-to-r from-slate-900 via-rose-950/20 to-slate-900 border border-rose-500/30 rounded-2xl p-5 md:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                Próximo Atendimento Confirmado
              </span>
              <span className="text-xs text-slate-400">
                com {upcomingProf?.name}
              </span>
            </div>
            <h3 className="text-lg font-bold text-white">{upcomingService.name}</h3>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
              <span className="flex items-center gap-1 text-rose-300 font-semibold">
                <Calendar className="w-3.5 h-3.5" />
                {formatLocalDate(upcomingApt.startTime)}
              </span>
              <span>•</span>
              <span className="flex items-center gap-1 font-mono text-white">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                {formatLocalTime(upcomingApt.startTime)} às {formatLocalTime(upcomingApt.endTime)}
              </span>
              <span>•</span>
              <span className="text-slate-400">Duração: {upcomingService.durationMinutes} min</span>
            </div>
          </div>

          <button
            onClick={onNavigateToAppointments}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold transition-colors flex items-center gap-1.5 self-start md:self-auto shrink-0"
          >
            Gerenciar Agendamento
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Gráficos: frequência (últimos 6 meses) e mix por categoria */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <CalendarCheck className="w-4 h-4 text-rose-400" />
              Frequência de Cuidados (Mês a Mês)
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">Atendimentos concluídos nos últimos 6 meses</p>
          </div>

          {hasMonthlyData ? (
            <div className="h-64 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="label" stroke="#64748b" fontSize={11} />
                  <YAxis stroke="#64748b" fontSize={11} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#090d16', borderColor: '#334155', borderRadius: '12px', fontSize: '12px' }}
                    labelFormatter={(_, items) => (items?.[0]?.payload as { fullLabel?: string } | undefined)?.fullLabel ?? ''}
                    formatter={(value: any) => [plural(Number(value), 'atendimento', 'atendimentos'), 'Concluídos']}
                  />
                  <Bar dataKey="sessions" fill="#ec4899" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState
              icon={<CalendarCheck className="w-5 h-5" />}
              title="Nenhum atendimento concluído nos últimos 6 meses"
              text="Quando você concluir um procedimento, sua frequência aparece aqui."
              actionLabel="Agendar"
              onAction={onNavigateToBooking}
            />
          )}
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Smile className="w-4 h-4 text-indigo-400" />
              Seus Procedimentos Favoritos
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">Atendimentos concluídos, por categoria</p>
          </div>

          {mixData.length > 0 ? (
            <div className="h-64 w-full flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={mixData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={5} dataKey="value" nameKey="name">
                    {mixData.map((slice, index) => (
                      <Cell key={slice.categoryId} fill={MIX_COLORS[index % MIX_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: '#090d16', borderColor: '#334155', borderRadius: '12px', fontSize: '12px' }}
                    formatter={(value: any) => [plural(Number(value), 'atendimento', 'atendimentos'), 'Total']}
                  />
                  <Legend
                    verticalAlign="bottom"
                    height={36}
                    formatter={(value) => <span className="text-[11px] text-slate-300">{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState
              icon={<Smile className="w-5 h-5" />}
              title="Você ainda não tem procedimentos concluídos"
              text="Depois do seu primeiro atendimento, mostramos aqui as categorias que você mais faz."
              actionLabel="Agendar"
              onAction={onNavigateToBooking}
            />
          )}
        </div>
      </div>

      {/* Cronograma preventivo: intervalo definido pela clínica + seu último atendimento */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
        <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-rose-400" />
          Seu Cronograma Preventivo de Manutenções
        </h4>

        {schedule.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {schedule.map((item) => {
              const style = DUE_STYLE[item.status];
              return (
                <div key={item.serviceId} className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-2 flex flex-col">
                  <div className="flex items-start justify-between gap-2 text-xs font-semibold text-white">
                    <span>{item.name}</span>
                    <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full border ${style.badge}`}>{style.label}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {dueText(item)} · retorno {intervalText(item.intervalDays)}. Último atendimento em{' '}
                    {new Date(`${item.lastDoneKey}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}.
                  </p>
                  <button
                    onClick={() => onBookService(item.serviceId)}
                    className="mt-auto self-start px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-[11px] font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <CalendarPlus className="w-3.5 h-3.5" />
                    Agendar retorno
                  </button>
                </div>
              );
            })}
          </div>
        ) : completedCount === 0 ? (
          <EmptyState
            icon={<Sparkles className="w-5 h-5" />}
            title="Seu cronograma ainda está vazio"
            text="Depois do seu primeiro atendimento, avisamos aqui quando for a hora de voltar."
            actionLabel="Agendar"
            onAction={onNavigateToBooking}
          />
        ) : (
          <EmptyState
            icon={<CheckCircle2 className="w-5 h-5" />}
            title="Nenhum retorno recomendado por enquanto"
            text="Quando algum procedimento seu estiver perto da hora de repetir, ele aparece aqui."
          />
        )}
      </div>
    </div>
  );
}
