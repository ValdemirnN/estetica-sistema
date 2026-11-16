import React, { useState } from 'react';
import {
  Service,
  ServiceCategory,
  Professional,
  Appointment,
  AnamnesisRecord,
  BusyBlock,
  ClinicSettings,
  Leave,
  UserProfile
} from '../types/clinic';
import type { BookingInput } from '../services/api';
import {
  calculateAvailableSlots,
  checkCancellationEligibility,
  formatLocalDate,
  formatLocalTime,
  TimeSlot
} from '../services/slotCalculator';
import { ClientDashboard } from './ClientDashboard';
import {
  Calendar,
  Clock,
  Sparkles,
  User,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  ArrowLeft,
  X,
  Phone,
  Mail,
  FileText,
  Download,
  Trash2,
  Info,
  CalendarCheck,
  RotateCcw,
  LayoutDashboard
} from 'lucide-react';

interface ClientViewProps {
  currentUser: UserProfile;
  categories: ServiceCategory[];
  services: Service[];
  professionals: Professional[];
  appointments: Appointment[];
  busyBlocks: BusyBlock[]; // horários ocupados de todos os clientes (sem dados pessoais)
  leaves: Leave[];
  anamnesis: AnamnesisRecord;
  settings: ClinicSettings;
  /** Retorna o id do agendamento criado, ou null se falhou (o App já mostra o motivo). */
  onBookAppointment: (input: BookingInput) => Promise<string | null>;
  onCancelAppointment: (aptId: string, reason: string) => Promise<boolean>;
  onUpdateAnamnesis: (updated: Partial<AnamnesisRecord>) => Promise<boolean>;
  onExportData: () => void;
}

export function ClientView({
  currentUser,
  categories,
  services,
  professionals,
  appointments,
  busyBlocks,
  leaves,
  anamnesis,
  settings,
  onBookAppointment,
  onCancelAppointment,
  onUpdateAnamnesis,
  onExportData
}: ClientViewProps) {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'catalog' | 'my-appointments' | 'anamnesis'>('dashboard');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedService, setSelectedService] = useState<Service | null>(null);

  // Wizard de Agendamento
  const [bookingStep, setBookingStep] = useState<1 | 2 | 3 | 4>(1); // 1: Profissional, 2: Data/Hora, 3: Anamnese/Consentimento, 4: Confirmação
  const [selectedProfId, setSelectedProfId] = useState<string | 'AUTO_ASSIGN'>('AUTO_ASSIGN');

  // Próximos 7 dias para seleção rápida
  const getDates = () => {
    const list = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      list.push({
        dateStr: iso,
        label: d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })
      });
    }
    return list;
  };
  const dateOptions = getDates();
  const [selectedDate, setSelectedDate] = useState<string>(dateOptions[1].dateStr); // Começa em amanhã
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [clientNotes, setClientNotes] = useState('');
  const [isBooking, setIsBooking] = useState(false);
  const [bookedAptId, setBookedAptId] = useState<string | null>(null);

  // Anamnese Form State
  const [anamnesisAllergies, setAnamnesisAllergies] = useState(anamnesis.allergies);
  const [anamnesisMedications, setAnamnesisMedications] = useState(anamnesis.currentMedications);
  const [anamnesisPregnant, setAnamnesisPregnant] = useState(anamnesis.pregnantOrLactating);
  const [anamnesisPacemaker, setAnamnesisPacemaker] = useState(anamnesis.hasPacemakerOrImplants);
  const [lgpdConsentChecked, setLgpdConsentChecked] = useState(true);

  // Modal de Cancelamento
  const [cancellingApt, setCancellingApt] = useState<Appointment | null>(null);
  const [cancelReasonInput, setCancelReasonInput] = useState('');

  // Meus agendamentos do usuário logado
  const myAppointments = appointments
    .filter((a) => a.clientId === currentUser.id)
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

  // Cálculo de slots disponíveis em tempo real
  const availableSlots = selectedService
    ? calculateAvailableSlots({
        selectedProfessionalId: selectedProfId,
        service: selectedService,
        dateStr: selectedDate,
        professionals,
        appointments: busyBlocks,
        leaves,
        customBufferMinutes: settings.defaultBufferMinutes
      })
    : [];

  const handleStartBooking = (service: Service) => {
    setSelectedService(service);
    setSelectedSlot(null);
    setBookingStep(1);
  };

  const handleConfirmBooking = async () => {
    if (!selectedService || !selectedSlot || isBooking) return;
    setIsBooking(true);
    try {
      // 1) Salva a ficha de anamnese (precisa existir antes do atendimento)
      const anamnesisSaved = await onUpdateAnamnesis({
        allergies: anamnesisAllergies,
        currentMedications: anamnesisMedications,
        pregnantOrLactating: anamnesisPregnant,
        hasPacemakerOrImplants: anamnesisPacemaker
      });
      if (!anamnesisSaved) return;

      // 2) Agenda. Com "primeiro disponível", o banco escolhe a profissional (distribuição justa)
      //    e valida jornada, ausências e conflito de horário de forma atômica.
      const newId = await onBookAppointment({
        serviceId: selectedService.id,
        startIso: selectedSlot.startIso,
        professionalId: selectedProfId === 'AUTO_ASSIGN' ? null : selectedSlot.professionalId,
        notes: clientNotes.trim() || undefined
      });

      if (newId) {
        setBookedAptId(newId);
        setBookingStep(4);
      } else {
        // Horário pode ter sido tomado: volta para escolher outro (a grade já foi atualizada)
        setSelectedSlot(null);
        setBookingStep(2);
      }
    } finally {
      setIsBooking(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Sub-navegação do Cliente */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setActiveTab('dashboard');
              setSelectedService(null);
            }}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${
              activeTab === 'dashboard'
                ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <LayoutDashboard className="w-3.5 h-3.5" />
            Meu Dashboard
          </button>
          <button
            onClick={() => {
              setActiveTab('catalog');
              setSelectedService(null);
            }}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${
              activeTab === 'catalog'
                ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Catálogo & Agendamento
          </button>
          <button
            onClick={() => setActiveTab('my-appointments')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 relative ${
              activeTab === 'my-appointments'
                ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <CalendarCheck className="w-3.5 h-3.5" />
            Meus Agendamentos
            {myAppointments.filter((a) => a.status === 'CONFIRMED').length > 0 && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('anamnesis')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${
              activeTab === 'anamnesis'
                ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            Ficha & Privacidade (LGPD)
          </button>
        </div>

        <div className="text-xs text-slate-400 hidden sm:flex items-center gap-2">
          <span>Olá, <strong className="text-white">{currentUser.fullName.split(' ')[0]}</strong></span>
        </div>
      </div>

      {/* ================= ABA 0: DASHBOARD PESSOAL DO CLIENTE ================= */}
      {activeTab === 'dashboard' && !selectedService && (
        <ClientDashboard
          currentUser={currentUser}
          appointments={appointments}
          services={services}
          professionals={professionals}
          onNavigateToBooking={() => {
            setActiveTab('catalog');
            setSelectedService(null);
          }}
          onNavigateToAppointments={() => {
            setActiveTab('my-appointments');
          }}
        />
      )}

      {/* ================= ABA 1: CATÁLOGO & AGENDAMENTO ================= */}
      {activeTab === 'catalog' && !selectedService && (
        <div className="space-y-6">
          {/* Hero Banner Estético */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-rose-950/40 via-slate-900 to-indigo-950/40 border border-rose-500/20 p-6 md:p-8">
            <div className="max-w-2xl">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-300 border border-rose-500/30 mb-3">
                <Sparkles className="w-3 h-3 text-rose-400" /> Experiência Clínica Premium
              </span>
              <h1 className="text-2xl md:text-3xl font-bold text-white tracking-tight">
                Realce sua beleza natural com protocolos biomédicos exclusivos
              </h1>
              <p className="text-xs md:text-sm text-slate-300 mt-2 leading-relaxed">
                Agendamento 100% online com confirmação imediata via WhatsApp. Selecione seu procedimento abaixo e encontre os melhores horários.
              </p>
            </div>
          </div>

          {/* Filtro por Categoria */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
            <button
              onClick={() => setSelectedCategory('all')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                selectedCategory === 'all'
                  ? 'bg-white text-slate-950 font-bold'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              Todos os Procedimentos ({services.length})
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                  selectedCategory === cat.id
                    ? 'bg-rose-500 text-white font-bold shadow-md shadow-rose-500/30'
                    : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {/* Grid de Procedimentos */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {services
              .filter((s) => selectedCategory === 'all' || s.categoryId === selectedCategory)
              .map((service) => (
                <div
                  key={service.id}
                  className="bg-slate-900 border border-slate-800 hover:border-rose-500/40 rounded-2xl p-5 flex flex-col justify-between transition-all group hover:shadow-xl hover:shadow-rose-500/5"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="font-bold text-white text-base group-hover:text-rose-300 transition-colors">
                        {service.name}
                      </h3>
                      {service.badge && (
                        <span className="text-[10px] bg-rose-500/20 text-rose-300 border border-rose-500/30 px-2 py-0.5 rounded-full font-semibold shrink-0">
                          {service.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed mb-4">
                      {service.description}
                    </p>

                    <div className="flex items-center gap-4 text-xs text-slate-300 mb-4 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-rose-400" />
                        <span>{service.durationMinutes} min</span>
                      </div>
                      <div className="w-px h-3 bg-slate-800" />
                      <div className="font-semibold text-white">
                        {(service.priceCents / 100).toLocaleString('pt-BR', {
                          style: 'currency',
                          currency: 'BRL'
                        })}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleStartBooking(service)}
                    className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 text-white text-xs font-semibold shadow-md shadow-rose-600/20 transition-all flex items-center justify-center gap-1.5"
                  >
                    Agendar Horário
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ================= WIZARD DE AGENDAMENTO ================= */}
      {selectedService && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 md:p-7 max-w-3xl mx-auto space-y-6">
          {/* Header do Wizard */}
          <div className="flex items-center justify-between pb-4 border-b border-slate-800">
            <button
              onClick={() => {
                if (bookingStep === 1) setSelectedService(null);
                else setBookingStep((prev) => (prev - 1) as any);
              }}
              className="text-xs text-slate-400 hover:text-white flex items-center gap-1 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              {bookingStep === 1 ? 'Voltar ao Catálogo' : 'Voltar'}
            </button>
            <div className="text-xs font-mono text-slate-400">
              Passo {bookingStep} de 4
            </div>
          </div>

          {/* Resumo do Procedimento Escolhido */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="text-[10px] uppercase font-bold text-rose-400 tracking-wider">Procedimento Escolhido</span>
              <h2 className="text-base font-bold text-white">{selectedService.name}</h2>
              <div className="flex items-center gap-3 text-xs text-slate-400 mt-1">
                <span>Duração: {selectedService.durationMinutes} minutos</span>
                <span>•</span>
                <span>Buffer pós: +{settings.defaultBufferMinutes} min higienização</span>
              </div>
            </div>
            <div className="text-right">
              <span className="text-lg font-bold text-white">
                {(selectedService.priceCents / 100).toLocaleString('pt-BR', {
                  style: 'currency',
                  currency: 'BRL'
                })}
              </span>
            </div>
          </div>

          {/* PASSO 1: Escolha de Profissional ou Primeiro Disponível */}
          {bookingStep === 1 && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-white">Escolha com quem prefere ser atendida:</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Opção Primeiro Disponível */}
                <div
                  onClick={() => setSelectedProfId('AUTO_ASSIGN')}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    selectedProfId === 'AUTO_ASSIGN'
                      ? 'bg-rose-500/10 border-rose-500 text-white shadow-lg shadow-rose-500/10'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-rose-400 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" /> Primeiro Disponível (Recomendado)
                    </span>
                    {selectedProfId === 'AUTO_ASSIGN' && <CheckCircle2 className="w-4 h-4 text-rose-400" />}
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Mostra o maior número de horários livres. O sistema distribui equitativamente entre as biomédicas e esteticistas habilitadas.
                  </p>
                </div>

                {/* Profissionais Específicos */}
                {professionals
                  .filter((p) => p.specialtyServiceIds.includes(selectedService.id))
                  .map((prof) => (
                    <div
                      key={prof.id}
                      onClick={() => setSelectedProfId(prof.id)}
                      className={`p-4 rounded-xl border cursor-pointer transition-all flex items-start gap-3 ${
                        selectedProfId === prof.id
                          ? 'bg-rose-500/10 border-rose-500 text-white shadow-lg shadow-rose-500/10'
                          : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <img
                        src={prof.avatarUrl}
                        alt={prof.name}
                        className="w-10 h-10 rounded-full object-cover border border-slate-700"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold text-white truncate">{prof.name}</h4>
                          {selectedProfId === prof.id && <CheckCircle2 className="w-4 h-4 text-rose-400 shrink-0" />}
                        </div>
                        <p className="text-[11px] text-slate-400 truncate">{prof.title}</p>
                        <span className="text-[10px] text-rose-400 font-mono mt-1 block">
                          {prof.registryNumber}
                        </span>
                      </div>
                    </div>
                  ))}
              </div>

              <div className="pt-4 flex justify-end">
                <button
                  onClick={() => setBookingStep(2)}
                  className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-md shadow-rose-600/30 transition-all flex items-center gap-1.5"
                >
                  Continuar para Horários
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* PASSO 2: Calendário e Horários em Tempo Real */}
          {bookingStep === 2 && (
            <div className="space-y-5">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-2">
                  1. Escolha a Data:
                </label>
                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
                  {dateOptions.map((opt) => (
                    <button
                      key={opt.dateStr}
                      onClick={() => {
                        setSelectedDate(opt.dateStr);
                        setSelectedSlot(null);
                      }}
                      className={`px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-all border ${
                        selectedDate === opt.dateStr
                          ? 'bg-white text-slate-950 border-white font-bold shadow-md'
                          : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-slate-300">
                    2. Horários Livres em Tempo Real (Horário de Brasília):
                  </label>
                  <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    {availableSlots.length} horários disponíveis
                  </span>
                </div>

                {availableSlots.length === 0 ? (
                  <div className="bg-slate-950 p-6 rounded-xl border border-slate-800 text-center space-y-2">
                    <AlertTriangle className="w-6 h-6 text-amber-400 mx-auto" />
                    <p className="text-xs text-slate-300 font-medium">Nenhum horário livre nesta data.</p>
                    <p className="text-[11px] text-slate-500">
                      Tente selecionar outro dia acima ou escolha "Primeiro Disponível" para ver a grade de outras profissionais.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 max-h-60 overflow-y-auto p-1">
                    {availableSlots.map((slot) => {
                      const isSelected = selectedSlot?.startIso === slot.startIso;
                      return (
                        <button
                          key={slot.startIso}
                          onClick={() => setSelectedSlot(slot)}
                          className={`py-2 px-1 rounded-xl text-xs font-mono font-semibold transition-all border text-center ${
                            isSelected
                              ? 'bg-rose-600 text-white border-rose-500 shadow-md shadow-rose-600/40 ring-2 ring-rose-400/30'
                              : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-rose-500/50 hover:text-white'
                          }`}
                        >
                          {slot.timeStr}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {selectedSlot && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center justify-between text-xs text-emerald-300">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>
                      Horário selecionado: <strong>{selectedSlot.timeStr}</strong> às{' '}
                      <strong>{formatLocalTime(selectedSlot.endIso)}</strong> ({selectedSlot.professionalName})
                    </span>
                  </div>
                </div>
              )}

              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  Observações para a equipe (opcional):
                </label>
                <input
                  type="text"
                  placeholder="Ex: Primeira vez fazendo esse procedimento, pele sensível..."
                  value={clientNotes}
                  onChange={(e) => setClientNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-rose-500"
                />
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  disabled={!selectedSlot}
                  onClick={() => setBookingStep(3)}
                  className={`px-5 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 ${
                    selectedSlot
                      ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-600/30'
                      : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  Próximo: Anamnese e Consentimento
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* PASSO 3: Ficha de Anamnese Simplificada e LGPD */}
          {bookingStep === 3 && (
            <div className="space-y-4">
              <div className="bg-indigo-950/30 border border-indigo-500/30 rounded-xl p-4">
                <h3 className="text-xs font-bold text-indigo-300 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4" /> Anamnese Estética Simplificada (Art. 11 LGPD - Dados Sensíveis de Saúde)
                </h3>
                <p className="text-[11px] text-slate-300 mt-1 leading-relaxed">
                  Para sua segurança biológica e personalização do protocolo, confirme seus dados médicos prévios:
                </p>
              </div>

              <div className="space-y-3 bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs">
                <div>
                  <label className="text-slate-300 block mb-1">Possui alguma alergia a medicamentos ou cosméticos?</label>
                  <input
                    type="text"
                    value={anamnesisAllergies}
                    onChange={(e) => setAnamnesisAllergies(e.target.value)}
                    placeholder="Ex: Iodo, dipirona, látex, ácidos..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-rose-500"
                  />
                </div>

                <div>
                  <label className="text-slate-300 block mb-1">Medicamentos em uso contínuo:</label>
                  <input
                    type="text"
                    value={anamnesisMedications}
                    onChange={(e) => setAnamnesisMedications(e.target.value)}
                    placeholder="Ex: Roacutan/Isotretinoína, anticoagulantes, corticoides..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-rose-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <label className="flex items-center gap-2 cursor-pointer bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                    <input
                      type="checkbox"
                      checked={anamnesisPregnant}
                      onChange={(e) => setAnamnesisPregnant(e.target.checked)}
                      className="rounded accent-rose-500"
                    />
                    <span className="text-slate-300 text-xs">Está grávida ou amamentando</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                    <input
                      type="checkbox"
                      checked={anamnesisPacemaker}
                      onChange={(e) => setAnamnesisPacemaker(e.target.checked)}
                      className="rounded accent-rose-500"
                    />
                    <span className="text-slate-300 text-xs">Possui marcapasso ou implantes metálicos</span>
                  </label>
                </div>

                <div className="pt-3 border-t border-slate-800">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={lgpdConsentChecked}
                      onChange={(e) => setLgpdConsentChecked(e.target.checked)}
                      className="mt-0.5 rounded accent-rose-500"
                    />
                    <span className="text-[11px] text-slate-400 leading-relaxed">
                      Concordo com o tratamento dos meus dados de saúde e autorizo a equipe técnica a ter acesso para realização segura do procedimento, com base na Lei Geral de Proteção de Dados (Lei 13.709/2018).
                    </span>
                  </label>
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  disabled={!lgpdConsentChecked || isBooking}
                  onClick={handleConfirmBooking}
                  className={`px-6 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 ${
                    lgpdConsentChecked && !isBooking
                      ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30'
                      : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {isBooking ? 'Confirmando...' : 'Confirmar Agendamento'}
                </button>
              </div>
            </div>
          )}

          {/* PASSO 4: Sucesso e Notificações Emitidas */}
          {bookingStep === 4 && (
            <div className="py-6 text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-emerald-500/20 text-emerald-400 mx-auto flex items-center justify-center border border-emerald-500/30">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-white">Agendamento Confirmado com Sucesso!</h3>
              <p className="text-xs text-slate-300 max-w-md mx-auto leading-relaxed">
                Sua reserva foi gravada no banco com garantia de concorrência. A confirmação e um lembrete 24h antes foram colocados na fila de envio.
              </p>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 max-w-sm mx-auto text-left text-xs space-y-1.5">
                <div className="text-slate-400">Procedimento: <strong className="text-white">{selectedService.name}</strong></div>
                <div className="text-slate-400">Data e Hora: <strong className="text-white">{selectedDate} às {selectedSlot?.timeStr}</strong></div>
                <div className="text-slate-400">Profissional: <strong className="text-white">{professionals.find((p) => p.id === appointments.find((a) => a.id === bookedAptId)?.professionalId)?.name ?? selectedSlot?.professionalName}</strong></div>
                <div className="text-slate-400">Contato: <strong className="text-emerald-400">{currentUser.phone || currentUser.email}</strong></div>
              </div>

              <div className="pt-2">
                <button
                  onClick={() => {
                    setSelectedService(null);
                    setActiveTab('my-appointments');
                  }}
                  className="px-6 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold transition-all"
                >
                  Ver Meus Agendamentos
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================= ABA 2: MEUS AGENDAMENTOS ================= */}
      {activeTab === 'my-appointments' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <CalendarCheck className="w-4 h-4 text-rose-400" /> Histórico e Agendamentos Futuros
            </h2>
            <span className="text-xs text-slate-400">
              Política: Cancelamento online permitido até {settings.minCancelNoticeHours}h antes
            </span>
          </div>

          {myAppointments.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center space-y-3">
              <Calendar className="w-8 h-8 text-slate-600 mx-auto" />
              <p className="text-sm text-slate-300 font-medium">Você ainda não possui agendamentos.</p>
              <button
                onClick={() => setActiveTab('catalog')}
                className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-semibold"
              >
                Conhecer Procedimentos
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {myAppointments.map((apt) => {
                const srv = services.find((s) => s.id === apt.serviceId);
                const prof = professionals.find((p) => p.id === apt.professionalId);
                const eligibility = checkCancellationEligibility(apt, settings.minCancelNoticeHours);

                const statusColor =
                  apt.status === 'CONFIRMED'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : apt.status === 'COMPLETED'
                    ? 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30'
                    : apt.status === 'CANCELLED'
                    ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                    : 'bg-amber-500/10 text-amber-400 border-amber-500/30';

                const statusLabel =
                  apt.status === 'CONFIRMED'
                    ? 'Confirmado'
                    : apt.status === 'COMPLETED'
                    ? 'Concluído'
                    : apt.status === 'CANCELLED'
                    ? 'Cancelado'
                    : 'No-show';

                return (
                  <div
                    key={apt.id}
                    className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold border ${statusColor}`}>
                          {statusLabel}
                        </span>
                        <span className="text-xs text-slate-400">
                          ID: <code className="font-mono text-slate-300">{apt.id.slice(0, 7)}</code>
                        </span>
                      </div>
                      <h3 className="text-base font-bold text-white">{srv?.name || 'Procedimento'}</h3>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
                        <span className="flex items-center gap-1 text-rose-300">
                          <Calendar className="w-3.5 h-3.5" />
                          {formatLocalDate(apt.startTime)}
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1 font-mono text-white">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          {formatLocalTime(apt.startTime)} às {formatLocalTime(apt.endTime)}
                        </span>
                        <span>•</span>
                        <span className="text-slate-400">Com {prof?.name}</span>
                      </div>

                      {apt.cancellationReason && (
                        <p className="text-xs text-rose-300/80 bg-rose-950/20 p-2 rounded border border-rose-900/40">
                          Motivo do cancelamento: {apt.cancellationReason}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
                      {apt.status === 'CONFIRMED' && (
                        <>
                          <button
                            onClick={() => {
                              if (eligibility.canCancel) {
                                setCancellingApt(apt);
                                setCancelReasonInput('');
                              } else {
                                alert(eligibility.message);
                              }
                            }}
                            className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all border ${
                              eligibility.canCancel
                                ? 'bg-slate-800 text-rose-300 border-rose-500/20 hover:bg-rose-500/10'
                                : 'bg-slate-900 text-slate-500 border-slate-800 cursor-not-allowed'
                            }`}
                            title={eligibility.message}
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            Cancelar / Remarcar
                          </button>
                        </>
                      )}

                      <div className="text-right pl-2 hidden md:block">
                        <span className="text-xs font-bold text-white">
                          {(apt.totalPriceCents / 100).toLocaleString('pt-BR', {
                            style: 'currency',
                            currency: 'BRL'
                          })}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ================= ABA 3: FICHA DE ANAMNESE & LGPD ================= */}
      {activeTab === 'anamnesis' && (
        <div className="space-y-5 max-w-3xl mx-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-rose-400" /> Ficha de Anamnese & Direitos LGPD
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Seus dados de saúde são armazenados de forma criptografada sob o Artigo 11 da LGPD.
                </p>
              </div>
              <button
                onClick={onExportData}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 flex items-center gap-1.5 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Exportar Dados (JSON)
              </button>
            </div>

            <div className="space-y-3 bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs">
              <div>
                <span className="text-slate-400 font-semibold block mb-1">Alergias Registradas:</span>
                <p className="text-white bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                  {anamnesis.allergies || 'Nenhuma alergia informada.'}
                </p>
              </div>
              <div>
                <span className="text-slate-400 font-semibold block mb-1">Tipo de Pele / Fototipo:</span>
                <p className="text-white bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                  {anamnesis.skinType || 'Não avaliado ainda.'}
                </p>
              </div>
              <div>
                <span className="text-slate-400 font-semibold block mb-1">Medicamentos em Uso:</span>
                <p className="text-white bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                  {anamnesis.currentMedications || 'Nenhum medicamento contínuo.'}
                </p>
              </div>
            </div>

            {/* Trilha de Auditoria LGPD */}
            <div className="border-t border-slate-800 pt-4">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-indigo-400" />
                Log de Acesso aos Seus Dados de Saúde (Transparência Ativa)
              </h4>
              <div className="space-y-2">
                {anamnesis.accessLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px] text-slate-400 flex items-center justify-between"
                  >
                    <span>
                      Visualizado por: <strong className="text-slate-200">{log.accessedByName}</strong>
                    </span>
                    <span className="font-mono text-slate-500">
                      {new Date(log.accessedAt).toLocaleString('pt-BR')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmação de Cancelamento com Validação */}
      {cancellingApt && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2 text-rose-400 font-bold text-base">
                <AlertTriangle className="w-5 h-5" />
                Confirmar Cancelamento
              </div>
              <button
                onClick={() => setCancellingApt(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Tem certeza que deseja cancelar seu agendamento de{' '}
              <strong className="text-white">
                {services.find((s) => s.id === cancellingApt.serviceId)?.name}
              </strong>{' '}
              marcado para {formatLocalDate(cancellingApt.startTime)} às {formatLocalTime(cancellingApt.startTime)}?
            </p>

            <div>
              <label className="text-xs text-slate-400 block mb-1">Motivo do cancelamento (opcional):</label>
              <textarea
                rows={2}
                value={cancelReasonInput}
                onChange={(e) => setCancelReasonInput(e.target.value)}
                placeholder="Ex: Imprevisto no trabalho, remarcando para outra semana..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-rose-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setCancellingApt(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300"
              >
                Manter Agendamento
              </button>
              <button
                onClick={async () => {
                  const ok = await onCancelAppointment(cancellingApt.id, cancelReasonInput);
                  if (ok) {
                    setCancellingApt(null);
                    setCancelReasonInput('');
                  }
                }}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white shadow-md shadow-rose-600/30"
              >
                Confirmar Cancelamento
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
