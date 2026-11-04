import React, { useMemo } from 'react';
import {
  Appointment,
  Service,
  Professional,
  UserProfile
} from '../types/clinic';
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
  Smile
} from 'lucide-react';
import { formatLocalDate, formatLocalTime } from '../services/slotCalculator';

interface ClientDashboardProps {
  currentUser: UserProfile;
  appointments: Appointment[];
  services: Service[];
  professionals: Professional[];
  onNavigateToBooking: () => void;
  onNavigateToAppointments: () => void;
}

export function ClientDashboard({
  currentUser,
  appointments,
  services,
  professionals,
  onNavigateToBooking,
  onNavigateToAppointments
}: ClientDashboardProps) {
  // Filtra apenas agendamentos desta cliente
  const clientApts = useMemo(() => {
    return appointments.filter((a) => a.clientId === currentUser.id);
  }, [appointments, currentUser.id]);

  const upcomingApt = useMemo(() => {
    const now = new Date();
    return clientApts
      .filter((a) => a.status === 'CONFIRMED' && new Date(a.startTime) >= now)
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())[0];
  }, [clientApts]);

  const completedApts = useMemo(() => {
    return clientApts.filter((a) => a.status === 'COMPLETED');
  }, [clientApts]);

  // Horas totais de autocuidado dedicadas
  const totalCareMinutes = useMemo(() => {
    return completedApts.reduce((sum, a) => {
      const srv = services.find((s) => s.id === a.serviceId);
      return sum + (srv?.durationMinutes || 60);
    }, 0);
  }, [completedApts, services]);

  // Gráfico Recharts 1: Evolução das Sessões de Autocuidado (Mês a Mês)
  const monthlyCareData = useMemo(() => {
    return [
      { mes: 'Jul', sessoes: 1 },
      { mes: 'Ago', sessoes: 2 },
      { mes: 'Set', sessoes: 1 },
      { mes: 'Out', sessoes: 2 },
      { mes: 'Nov (Atual)', sessoes: Math.max(1, completedApts.length) }
    ];
  }, [completedApts]);

  // Gráfico Recharts 2: Mix de Procedimentos da Cliente
  const categoryMixData = useMemo(() => {
    const counts: Record<string, { name: string; value: number }> = {
      facial: { name: 'Facial & Limpeza', value: 0 },
      injetaveis: { name: 'Harmonização & Botox', value: 0 },
      corporal: { name: 'Corporal & Drenagem', value: 0 },
      laser: { name: 'Laser & Depilação', value: 0 }
    };

    clientApts.forEach((apt) => {
      const srv = services.find((s) => s.id === apt.serviceId);
      if (!srv) return;
      if (srv.categoryId === 'cat-1') counts.facial.value += 1;
      else if (srv.categoryId === 'cat-2') counts.injetaveis.value += 1;
      else if (srv.categoryId === 'cat-3') counts.corporal.value += 1;
      else if (srv.categoryId === 'cat-4') counts.laser.value += 1;
    });

    // Se estiver vazio, fornecer distribuição padrão
    const filtered = Object.values(counts).filter((c) => c.value > 0);
    if (filtered.length === 0) {
      return [
        { name: 'Facial & Limpeza', value: 2 },
        { name: 'Harmonização & Botox', value: 1 },
        { name: 'Laser & Depilação', value: 1 }
      ];
    }
    return filtered;
  }, [clientApts, services]);

  const mixColors = ['#ec4899', '#8b5cf6', '#10b981', '#06b6d4'];

  const upcomingService = upcomingApt
    ? services.find((s) => s.id === upcomingApt.serviceId)
    : null;
  const upcomingProf = upcomingApt
    ? professionals.find((p) => p.id === upcomingApt.professionalId)
    : null;

  return (
    <div className="space-y-6">
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
            {completedApts.length} procedimentos
          </div>
          <p className="text-[11px] text-slate-400">Registrados no seu prontuário</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Tempo de Autocuidado</span>
            <span className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Clock className="w-4 h-4" />
            </span>
          </div>
          <div className="text-2xl font-bold font-mono text-white">
            {Math.round((totalCareMinutes / 60) * 10) / 10} horas
          </div>
          <p className="text-[11px] text-emerald-400">Dedicadas ao seu bem-estar</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Nível Fidelidade</span>
            <span className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Award className="w-4 h-4" />
            </span>
          </div>
          <div className="text-xl font-bold font-mono text-amber-300">
            Cliente Gold VIP
          </div>
          <p className="text-[11px] text-slate-400">380 pontos de benefícios</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Prontuário Seguro</span>
            <span className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <ShieldCheck className="w-4 h-4" />
            </span>
          </div>
          <div className="text-sm font-bold text-white flex items-center gap-1.5 pt-1">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Anamnese em Dia
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

      {/* Gráficos Recharts da Cliente: Frequência e Mix de Tratamentos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Gráfico 1: Histórico de Frequência de Sessões */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <CalendarCheck className="w-4 h-4 text-rose-400" />
                Frequência de Cuidados (Mês a Mês)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Número de procedimentos realizados ao longo do ano
              </p>
            </div>
          </div>

          <div className="h-64 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyCareData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="mes" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#090d16', borderColor: '#334155', borderRadius: '12px', fontSize: '12px' }}
                  formatter={(value: any) => [`${value} sessão(ões)`, 'Autocuidado']}
                />
                <Bar dataKey="sessoes" fill="#ec4899" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Gráfico 2: Mix de Tratamentos Favoritos */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Smile className="w-4 h-4 text-indigo-400" />
                Seus Procedimentos Favoritos
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Distribuição dos tratamentos que você mais realiza
              </p>
            </div>
          </div>

          <div className="h-64 w-full flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categoryMixData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {categoryMixData.map((_, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={mixColors[index % mixColors.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#090d16', borderColor: '#334155', borderRadius: '12px', fontSize: '12px' }}
                  formatter={(value: any) => [`${value} atendimento(s)`, 'Frequência']}
                />
                <Legend
                  verticalAlign="bottom"
                  height={36}
                  formatter={(value, entry: any) => (
                    <span className="text-[11px] text-slate-300">
                      {entry.payload.name}
                    </span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Ciclo Recomendado de Retoques e Manutenções Estéticas */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
        <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-rose-400" />
          Seu Cronograma Preventivo de Manutenções
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1">
            <div className="flex items-center justify-between text-xs font-semibold text-white">
              <span>Toxina Botulínica</span>
              <span className="text-indigo-400 text-[10px]">Em 4 meses</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Ciclo ideal a cada 4 a 6 meses para prevenir novas rugas dinâmicas.
            </p>
          </div>

          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1">
            <div className="flex items-center justify-between text-xs font-semibold text-white">
              <span>Limpeza de Pele Profunda</span>
              <span className="text-emerald-400 text-[10px]">A cada 30 dias</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Renovação celular e desobstrução dos poros para melhor absorção de séruns.
            </p>
          </div>

          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1">
            <div className="flex items-center justify-between text-xs font-semibold text-white">
              <span>Laser Soprano Titanium</span>
              <span className="text-rose-400 text-[10px]">3 de 6 concluídas</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Intervalo ideal de 30 a 45 dias entre sessões para atingir a fase anágena.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
