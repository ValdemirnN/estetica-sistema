import {
  ServiceCategory,
  Service,
  Professional,
  Appointment,
  AnamnesisRecord,
  ClinicSettings,
  UserProfile,
  NotificationLog
} from '../types/clinic';

export const INITIAL_CATEGORIES: ServiceCategory[] = [
  {
    id: 'cat-1',
    name: 'Facial & Rejuvenescimento',
    slug: 'facial',
    iconName: 'Sparkles',
    description: 'Protocolos de limpeza, hidratação profunda e renovação celular da pele.'
  },
  {
    id: 'cat-2',
    name: 'Injetáveis & Harmonização',
    slug: 'injetaveis',
    iconName: 'Syringe',
    description: 'Procedimentos avançados com biomédica: Botox, preenchedores e bioestimuladores.'
  },
  {
    id: 'cat-3',
    name: 'Corporal & Modeladora',
    slug: 'corporal',
    iconName: 'Activity',
    description: 'Drenagem linfática pós-operatória, remodelagem corporal e alívio de retenção.'
  },
  {
    id: 'cat-4',
    name: 'Tecnologias & Laser',
    slug: 'laser',
    iconName: 'Zap',
    description: 'Depilação a laser definitiva indolor e clareamento de manchas com tecnologia de ponta.'
  }
];

export const INITIAL_SERVICES: Service[] = [
  {
    id: 'srv-1',
    categoryId: 'cat-1',
    name: 'Limpeza de Pele Profunda com Peeling de Diamante',
    slug: 'limpeza-de-pele-profunda',
    description: 'Remoção de cravos e impurezas com extração cuidadosa, vapor de ozônio, alta frequência e máscara calmante hidroplástica.',
    durationMinutes: 75,
    priceCents: 22000,
    recoveryInfo: 'Evitar exposição solar direta nas 48h seguintes e usar protetor FPS 50+. Não aplicar ácidos por 3 dias.',
    requiresAnamnesis: true,
    badge: 'Mais Procurado'
  },
  {
    id: 'srv-2',
    categoryId: 'cat-2',
    name: 'Toxina Botulínica (Botox) Full Face',
    slug: 'botox-full-face',
    description: 'Suavização de rugas dinâmicas na testa, glabela e pés de galinha com produto importado de primeira linha.',
    durationMinutes: 45,
    priceCents: 145000,
    recoveryInfo: 'Não deitar ou praticar atividades físicas intensas nas primeiras 4 horas após a aplicação.',
    requiresAnamnesis: true,
    badge: 'Destaque VIP'
  },
  {
    id: 'srv-3',
    categoryId: 'cat-2',
    name: 'Preenchimento Labial HidraGloss & Contorno',
    slug: 'preenchimento-labial',
    description: 'Ácido hialurônico de alta pureza para volume natural, correção de assimetrias e hidratação do contorno labial.',
    durationMinutes: 60,
    priceCents: 125000,
    recoveryInfo: 'Pode haver leve edema nos primeiros 2 dias. Evitar bebidas muito quentes nas primeiras 24 horas.',
    requiresAnamnesis: true
  },
  {
    id: 'srv-4',
    categoryId: 'cat-3',
    name: 'Drenagem Linfática Facial & Relaxante',
    slug: 'drenagem-facial',
    description: 'Movimentos suaves e rítmicos que ativam a circulação linfática, desincham o rosto e reduzem bolsas oculares.',
    durationMinutes: 40,
    priceCents: 16000,
    recoveryInfo: 'Ingerir bastante água após a sessão para potencializar a eliminação de toxinas.',
    requiresAnamnesis: false
  },
  {
    id: 'srv-5',
    categoryId: 'cat-2',
    name: 'Bioestimulador de Colágeno (Radiesse/Sculptra)',
    slug: 'bioestimulador-colageno',
    description: 'Tratamento de flacidez dérmica estimulando a neocolagênese natural por até 18 meses com efeito lifting progressivo.',
    durationMinutes: 60,
    priceCents: 240000,
    recoveryInfo: 'Realizar massagem 5-5-5 (5 minutos, 5 vezes ao dia por 5 dias) conforme orientação da biomédica.',
    requiresAnamnesis: true
  },
  {
    id: 'srv-6',
    categoryId: 'cat-4',
    name: 'Depilação a Laser Soprano Titanium (Virilha + Axilas)',
    slug: 'laser-soprano-titanium',
    description: 'Tecnologia 3D com resfriamento térmico de safira para depilação rápida, confortável e compatível com todos os fototipos.',
    durationMinutes: 30,
    priceCents: 28000,
    recoveryInfo: 'Raspar os pelos com lâmina 24h antes. Não arrancar os pelos com cera ou pinça entre as sessões.',
    requiresAnamnesis: true
  },
  {
    id: 'srv-7',
    categoryId: 'cat-3',
    name: 'Massagem Modeladora Dreno-Redutora',
    slug: 'massagem-modeladora',
    description: 'Técnicas manuais vigorosas associadas a cremes termogênicos para contorno da silhueta e redução de retenção hídrica.',
    durationMinutes: 50,
    priceCents: 19000,
    recoveryInfo: 'Mantenha hidratação constante e alimentação equilibrada pós-procedimento.',
    requiresAnamnesis: false
  }
];

const DEFAULT_WEEKLY_HOURS = [
  // Segunda a Sexta: 08:30 às 18:30 (almoço 12:30 às 13:30)
  { dayOfWeek: 1 as const, startTime: '08:30', endTime: '18:30', breakStartTime: '12:30', breakEndTime: '13:30', isActive: true },
  { dayOfWeek: 2 as const, startTime: '08:30', endTime: '18:30', breakStartTime: '12:30', breakEndTime: '13:30', isActive: true },
  { dayOfWeek: 3 as const, startTime: '08:30', endTime: '18:30', breakStartTime: '12:30', breakEndTime: '13:30', isActive: true },
  { dayOfWeek: 4 as const, startTime: '08:30', endTime: '18:30', breakStartTime: '12:30', breakEndTime: '13:30', isActive: true },
  { dayOfWeek: 5 as const, startTime: '08:30', endTime: '18:30', breakStartTime: '12:30', breakEndTime: '13:30', isActive: true },
  // Sábado: 08:30 às 14:00 (sem intervalo de almoço)
  { dayOfWeek: 6 as const, startTime: '08:30', endTime: '14:00', isActive: true },
  // Domingo: Folga
  { dayOfWeek: 0 as const, startTime: '09:00', endTime: '13:00', isActive: false }
];

export const INITIAL_PROFESSIONALS: Professional[] = [
  {
    id: 'prof-1',
    profileId: 'usr-prof-1',
    name: 'Dra. Camila Vasconcellos',
    title: 'Biomédica Esteta & Especialista em Injetáveis',
    registryNumber: 'CRBM-SP 34.892',
    bio: 'Pós-graduada em Harmonização Orofacial e Estética Avançada pelo Instituto IPUPO. Mais de 8 anos de experiência clínica.',
    colorHex: '#ec4899', // Pink / Rosé
    avatarUrl: 'https://images.unsplash.com/photo-1594824813576-0e1a8a29a67a?auto=format&fit=crop&q=80&w=256',
    intervalBufferMinutes: 15,
    isAvailableForAutoAssign: true,
    specialtyServiceIds: ['srv-1', 'srv-2', 'srv-3', 'srv-4', 'srv-5'],
    workingHours: DEFAULT_WEEKLY_HOURS
  },
  {
    id: 'prof-2',
    profileId: 'usr-prof-2',
    name: 'Dra. Beatriz Prado',
    title: 'Fisioterapeuta Dermatofuncional',
    registryNumber: 'CREFITO-3 12.441-F',
    bio: 'Especialista em reabilitação tecidual pós-cirúrgica, remodelamento corporal e tratamentos não-invasivos.',
    colorHex: '#8b5cf6', // Violet
    avatarUrl: 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&q=80&w=256',
    intervalBufferMinutes: 15,
    isAvailableForAutoAssign: true,
    specialtyServiceIds: ['srv-1', 'srv-4', 'srv-7'],
    workingHours: DEFAULT_WEEKLY_HOURS
  },
  {
    id: 'prof-3',
    profileId: 'usr-prof-3',
    name: 'Dra. Larissa Mendes',
    title: 'Farmacêutica Esteta & Laserterapeuta',
    registryNumber: 'CRF-SP 55.109',
    bio: 'Mestrado em Cosmetologia e Tecnologias de Fototerapia. Certificada internacionalmente em lasers de diodo e rejuvenescimento.',
    colorHex: '#06b6d4', // Cyan
    avatarUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=256',
    intervalBufferMinutes: 10,
    isAvailableForAutoAssign: true,
    specialtyServiceIds: ['srv-1', 'srv-4', 'srv-6'],
    workingHours: DEFAULT_WEEKLY_HOURS
  }
];

export const INITIAL_CLIENT: UserProfile = {
  id: 'usr-client-1',
  role: 'CLIENT',
  fullName: 'Juliana Siqueira Barbosa',
  email: 'juliana.siqueira@email.com',
  phone: '+55 (11) 98765-4321',
  cpf: '345.678.901-22',
  birthDate: '1993-06-18',
  avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=256',
  optInWhatsapp: true,
  optInEmail: true,
  lgpdConsentAt: '2026-01-10T14:32:00Z',
  termsVersion: 'v1.0'
};

export const INITIAL_STAFF_USERS: UserProfile[] = [
  {
    id: 'usr-admin-1',
    role: 'ADMIN',
    fullName: 'Renata Albuquerque (Gestora)',
    email: 'gestao@aesthetiqclinic.com.br',
    phone: '+55 (11) 99111-2233',
    avatarUrl: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&q=80&w=256',
    optInWhatsapp: true,
    optInEmail: true,
    lgpdConsentAt: '2025-12-01T08:00:00Z',
    termsVersion: 'v1.0'
  },
  {
    id: 'usr-recep-1',
    role: 'RECEPTIONIST',
    fullName: 'Mariana Costa (Recepção)',
    email: 'recepcao@aesthetiqclinic.com.br',
    phone: '+55 (11) 99222-3344',
    avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=256',
    optInWhatsapp: true,
    optInEmail: true,
    lgpdConsentAt: '2025-12-01T08:00:00Z',
    termsVersion: 'v1.0'
  }
];

export const INITIAL_ANAMNESIS: AnamnesisRecord = {
  id: 'anam-1',
  clientId: 'usr-client-1',
  allergies: 'Alérgica a dipirona e iodo tópica. Sem alergias conhecidas a anestésicos locais como lidocaína.',
  skinType: 'Fototipo III (Fitzpatrick), pele mista com tendência a oleosidade na zona T.',
  medicalConditions: 'Nenhuma doença crônica, tireoide controlada.',
  currentMedications: 'Vitamina C e protetor solar diário.',
  pregnantOrLactating: false,
  hasPacemakerOrImplants: false,
  previousReactions: 'Apresentou leve eritema transitório após peeling químico há 2 anos, resolvido em 24h.',
  filledAt: '2026-02-14T10:00:00Z',
  updatedAt: '2026-02-14T10:00:00Z',
  signatureConsent: true,
  accessLogs: [
    {
      id: 'log-1',
      accessedBy: 'usr-prof-1',
      accessedByName: 'Dra. Camila Vasconcellos',
      accessedAt: '2026-02-14T10:05:00Z',
      action: 'VIEW'
    }
  ]
};

// Gerar datas relativas a hoje para demonstração real
const now = new Date();
const today = new Date(now);
const tomorrow = new Date(now);
tomorrow.setDate(now.getDate() + 1);
const dayAfter = new Date(now);
dayAfter.setDate(now.getDate() + 2);

const formatIso = (d: Date, hours: number, minutes: number) => {
  const copy = new Date(d);
  copy.setHours(hours, minutes, 0, 0);
  return copy.toISOString();
};

const getRelativeDateIso = (daysAgo: number, hours: number, minutes: number) => {
  const d = new Date(now);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
};

export const INITIAL_APPOINTMENTS: Appointment[] = [
  // Agendamento de amanhã da Juliana (Cliente logada)
  {
    id: 'apt-101',
    clientId: 'usr-client-1',
    clientName: 'Juliana Siqueira Barbosa',
    clientPhone: '+55 (11) 98765-4321',
    clientEmail: 'juliana.siqueira@email.com',
    professionalId: 'prof-1',
    serviceId: 'srv-1', // Limpeza de Pele (75 min) - R$ 220
    startTime: formatIso(tomorrow, 10, 0),
    endTime: formatIso(tomorrow, 11, 15),
    bufferEndTime: formatIso(tomorrow, 11, 30),
    status: 'CONFIRMED',
    totalPriceCents: 22000,
    clientNotes: 'Pele um pouco sensibilizada pelo frio.',
    internalStaffNotes: 'Cliente pontual, prefere cabine 01 com música ambiente baixa.',
    statusHistory: [
      {
        status: 'CONFIRMED',
        changedAt: getRelativeDateIso(1, 14, 0),
        changedBy: 'Juliana Siqueira (App Cliente)',
        note: 'Agendamento confirmado online com sucesso.'
      }
    ],
    createdAt: getRelativeDateIso(1, 14, 0)
  },
  {
    id: 'apt-102',
    clientId: 'usr-client-2',
    clientName: 'Patrícia Guimarães',
    clientPhone: '+55 (11) 97654-3210',
    clientEmail: 'patricia.g@gmail.com',
    professionalId: 'prof-1',
    serviceId: 'srv-2', // Toxina Botulínica (45 min) - R$ 1.450
    startTime: formatIso(tomorrow, 14, 0),
    endTime: formatIso(tomorrow, 14, 45),
    bufferEndTime: formatIso(tomorrow, 15, 0),
    status: 'CONFIRMED',
    totalPriceCents: 145000,
    clientNotes: 'Retorno para retoque da glabela.',
    internalStaffNotes: 'Separar frasco de 50U.',
    statusHistory: [
      {
        status: 'CONFIRMED',
        changedAt: getRelativeDateIso(2, 9, 30),
        changedBy: 'Mariana Costa (Recepção)'
      }
    ],
    createdAt: getRelativeDateIso(2, 9, 30)
  },
  {
    id: 'apt-103',
    clientId: 'usr-client-3',
    clientName: 'Carla Nogueira',
    clientPhone: '+55 (11) 96543-2109',
    clientEmail: 'carla.nogueira@hotmail.com',
    professionalId: 'prof-2',
    serviceId: 'srv-7', // Massagem Modeladora (50 min) - R$ 190
    startTime: formatIso(tomorrow, 11, 0),
    endTime: formatIso(tomorrow, 11, 50),
    bufferEndTime: formatIso(tomorrow, 12, 5),
    status: 'CONFIRMED',
    totalPriceCents: 19000,
    statusHistory: [
      {
        status: 'CONFIRMED',
        changedAt: getRelativeDateIso(2, 11, 0),
        changedBy: 'Carla Nogueira (App Cliente)'
      }
    ],
    createdAt: getRelativeDateIso(2, 11, 0)
  },
  {
    id: 'apt-104',
    clientId: 'usr-client-4',
    clientName: 'Fernanda Lima',
    clientPhone: '+55 (11) 95555-1234',
    clientEmail: 'fernanda.lima@uol.com.br',
    professionalId: 'prof-3',
    serviceId: 'srv-6', // Laser Soprano (30 min) - R$ 280
    startTime: formatIso(tomorrow, 16, 0),
    endTime: formatIso(tomorrow, 16, 30),
    bufferEndTime: formatIso(tomorrow, 16, 40),
    status: 'CONFIRMED',
    totalPriceCents: 28000,
    statusHistory: [
      {
        status: 'CONFIRMED',
        changedAt: getRelativeDateIso(1, 10, 0),
        changedBy: 'Mariana Costa (Recepção)'
      }
    ],
    createdAt: getRelativeDateIso(1, 10, 0)
  },

  // Agendamentos de Hoje (Para Faturamento e Ocupação Diária)
  {
    id: 'apt-today-1',
    clientId: 'usr-client-5',
    clientName: 'Amanda Silveira',
    clientPhone: '+55 (11) 94444-2222',
    clientEmail: 'amanda.silveira@gmail.com',
    professionalId: 'prof-1',
    serviceId: 'srv-5', // Bioestimulador de Colágeno - R$ 2.400
    startTime: formatIso(today, 9, 30),
    endTime: formatIso(today, 10, 30),
    bufferEndTime: formatIso(today, 10, 45),
    status: 'COMPLETED',
    totalPriceCents: 240000,
    statusHistory: [{ status: 'COMPLETED', changedAt: formatIso(today, 10, 35), changedBy: 'Dra. Camila' }],
    createdAt: getRelativeDateIso(3, 10, 0)
  },
  {
    id: 'apt-today-2',
    clientId: 'usr-client-6',
    clientName: 'Renato Farias',
    clientPhone: '+55 (11) 93333-5555',
    clientEmail: 'renato.farias@outlook.com',
    professionalId: 'prof-1',
    serviceId: 'srv-3', // Preenchimento Labial - R$ 1.250
    startTime: formatIso(today, 11, 0),
    endTime: formatIso(today, 12, 0),
    bufferEndTime: formatIso(today, 12, 15),
    status: 'COMPLETED',
    totalPriceCents: 125000,
    statusHistory: [{ status: 'COMPLETED', changedAt: formatIso(today, 12, 5), changedBy: 'Dra. Camila' }],
    createdAt: getRelativeDateIso(4, 15, 0)
  },
  {
    id: 'apt-today-3',
    clientId: 'usr-client-7',
    clientName: 'Bianca Toledo',
    clientPhone: '+55 (11) 92222-7777',
    clientEmail: 'bianca.toledo@gmail.com',
    professionalId: 'prof-2',
    serviceId: 'srv-4', // Drenagem Facial - R$ 160
    startTime: formatIso(today, 14, 0),
    endTime: formatIso(today, 14, 40),
    bufferEndTime: formatIso(today, 14, 55),
    status: 'CONFIRMED',
    totalPriceCents: 16000,
    statusHistory: [{ status: 'CONFIRMED', changedAt: getRelativeDateIso(1, 8, 0), changedBy: 'App Cliente' }],
    createdAt: getRelativeDateIso(1, 8, 0)
  },
  {
    id: 'apt-today-4',
    clientId: 'usr-client-8',
    clientName: 'Luciana Martins',
    clientPhone: '+55 (11) 91111-8888',
    clientEmail: 'luciana.m@gmail.com',
    professionalId: 'prof-3',
    serviceId: 'srv-6', // Laser Soprano - R$ 280
    startTime: formatIso(today, 15, 0),
    endTime: formatIso(today, 15, 30),
    bufferEndTime: formatIso(today, 15, 40),
    status: 'CONFIRMED',
    totalPriceCents: 28000,
    statusHistory: [{ status: 'CONFIRMED', changedAt: getRelativeDateIso(2, 10, 0), changedBy: 'Recepção' }],
    createdAt: getRelativeDateIso(2, 10, 0)
  },

  // Histórico Recente (Dias Anteriores para Gráfico Diário de Faturamento)
  {
    id: 'apt-hist-d1',
    clientId: 'usr-client-1',
    clientName: 'Juliana Siqueira Barbosa',
    clientPhone: '+55 (11) 98765-4321',
    clientEmail: 'juliana.siqueira@email.com',
    professionalId: 'prof-1',
    serviceId: 'srv-2', // Toxina Botulínica - R$ 1.450
    startTime: getRelativeDateIso(1, 10, 0),
    endTime: getRelativeDateIso(1, 10, 45),
    bufferEndTime: getRelativeDateIso(1, 11, 0),
    status: 'COMPLETED',
    totalPriceCents: 145000,
    statusHistory: [{ status: 'COMPLETED', changedAt: getRelativeDateIso(1, 11, 0), changedBy: 'Dra. Camila' }],
    createdAt: getRelativeDateIso(10, 9, 0)
  },
  {
    id: 'apt-hist-d2',
    clientId: 'usr-client-9',
    clientName: 'Tatiana Rezende',
    clientPhone: '+55 (11) 98888-1111',
    clientEmail: 'tatiana.r@gmail.com',
    professionalId: 'prof-1',
    serviceId: 'srv-5', // Bioestimulador - R$ 2.400
    startTime: getRelativeDateIso(2, 14, 0),
    endTime: getRelativeDateIso(2, 15, 0),
    bufferEndTime: getRelativeDateIso(2, 15, 15),
    status: 'COMPLETED',
    totalPriceCents: 240000,
    statusHistory: [{ status: 'COMPLETED', changedAt: getRelativeDateIso(2, 15, 10), changedBy: 'Dra. Camila' }],
    createdAt: getRelativeDateIso(12, 10, 0)
  },
  {
    id: 'apt-hist-d3',
    clientId: 'usr-client-10',
    clientName: 'Daniela Campos',
    clientPhone: '+55 (11) 97777-2222',
    clientEmail: 'daniela.c@gmail.com',
    professionalId: 'prof-2',
    serviceId: 'srv-7', // Massagem Modeladora - R$ 190
    startTime: getRelativeDateIso(3, 11, 0),
    endTime: getRelativeDateIso(3, 11, 50),
    bufferEndTime: getRelativeDateIso(3, 12, 5),
    status: 'COMPLETED',
    totalPriceCents: 19000,
    statusHistory: [{ status: 'COMPLETED', changedAt: getRelativeDateIso(3, 12, 0), changedBy: 'Dra. Beatriz' }],
    createdAt: getRelativeDateIso(14, 10, 0)
  },
  {
    id: 'apt-hist-d4',
    clientId: 'usr-client-11',
    clientName: 'Sofia Albuquerque',
    clientPhone: '+55 (11) 96666-3333',
    clientEmail: 'sofia.a@gmail.com',
    professionalId: 'prof-3',
    serviceId: 'srv-6', // Laser Soprano - R$ 280
    startTime: getRelativeDateIso(4, 16, 0),
    endTime: getRelativeDateIso(4, 16, 30),
    bufferEndTime: getRelativeDateIso(4, 16, 40),
    status: 'COMPLETED',
    totalPriceCents: 28000,
    statusHistory: [{ status: 'COMPLETED', changedAt: getRelativeDateIso(4, 16, 35), changedBy: 'Dra. Larissa' }],
    createdAt: getRelativeDateIso(15, 10, 0)
  },
  {
    id: 'apt-hist-d5',
    clientId: 'usr-client-12',
    clientName: 'Helena Duarte',
    clientPhone: '+55 (11) 95555-4444',
    clientEmail: 'helena.d@gmail.com',
    professionalId: 'prof-1',
    serviceId: 'srv-3', // Preenchimento Labial - R$ 1.250
    startTime: getRelativeDateIso(5, 10, 0),
    endTime: getRelativeDateIso(5, 11, 0),
    bufferEndTime: getRelativeDateIso(5, 11, 15),
    status: 'COMPLETED',
    totalPriceCents: 125000,
    statusHistory: [{ status: 'COMPLETED', changedAt: getRelativeDateIso(5, 11, 5), changedBy: 'Dra. Camila' }],
    createdAt: getRelativeDateIso(16, 10, 0)
  },
  {
    id: 'apt-hist-noshow',
    clientId: 'usr-client-13',
    clientName: 'Marcos Vinicius',
    clientPhone: '+55 (11) 94444-5555',
    clientEmail: 'marcos.v@gmail.com',
    professionalId: 'prof-2',
    serviceId: 'srv-4',
    startTime: getRelativeDateIso(3, 15, 0),
    endTime: getRelativeDateIso(3, 15, 40),
    bufferEndTime: getRelativeDateIso(3, 15, 55),
    status: 'NO_SHOW',
    totalPriceCents: 16000,
    statusHistory: [{ status: 'NO_SHOW', changedAt: getRelativeDateIso(3, 16, 0), changedBy: 'Mariana (Recepção)', note: 'Cliente não compareceu e não atendeu ligação.' }],
    createdAt: getRelativeDateIso(10, 10, 0)
  },

  // Histórico Passado da Cliente Juliana (usr-client-1) para seu dashboard de autocuidado
  {
    id: 'apt-juliana-past1',
    clientId: 'usr-client-1',
    clientName: 'Juliana Siqueira Barbosa',
    clientPhone: '+55 (11) 98765-4321',
    clientEmail: 'juliana.siqueira@email.com',
    professionalId: 'prof-1',
    serviceId: 'srv-1', // Limpeza de Pele
    startTime: getRelativeDateIso(35, 14, 0),
    endTime: getRelativeDateIso(35, 15, 15),
    bufferEndTime: getRelativeDateIso(35, 15, 30),
    status: 'COMPLETED',
    totalPriceCents: 22000,
    statusHistory: [{ status: 'COMPLETED', changedAt: getRelativeDateIso(35, 15, 30), changedBy: 'Dra. Camila' }],
    createdAt: getRelativeDateIso(40, 10, 0)
  },
  {
    id: 'apt-juliana-past2',
    clientId: 'usr-client-1',
    clientName: 'Juliana Siqueira Barbosa',
    clientPhone: '+55 (11) 98765-4321',
    clientEmail: 'juliana.siqueira@email.com',
    professionalId: 'prof-3',
    serviceId: 'srv-6', // Laser Soprano
    startTime: getRelativeDateIso(65, 15, 0),
    endTime: getRelativeDateIso(65, 15, 30),
    bufferEndTime: getRelativeDateIso(65, 15, 40),
    status: 'COMPLETED',
    totalPriceCents: 28000,
    statusHistory: [{ status: 'COMPLETED', changedAt: getRelativeDateIso(65, 15, 35), changedBy: 'Dra. Larissa' }],
    createdAt: getRelativeDateIso(70, 10, 0)
  },
  {
    id: 'apt-juliana-past3',
    clientId: 'usr-client-1',
    clientName: 'Juliana Siqueira Barbosa',
    clientPhone: '+55 (11) 98765-4321',
    clientEmail: 'juliana.siqueira@email.com',
    professionalId: 'prof-2',
    serviceId: 'srv-4', // Drenagem Facial
    startTime: getRelativeDateIso(95, 11, 0),
    endTime: getRelativeDateIso(95, 11, 40),
    bufferEndTime: getRelativeDateIso(95, 11, 55),
    status: 'COMPLETED',
    totalPriceCents: 16000,
    statusHistory: [{ status: 'COMPLETED', changedAt: getRelativeDateIso(95, 11, 45), changedBy: 'Dra. Beatriz' }],
    createdAt: getRelativeDateIso(100, 10, 0)
  }
];

export const INITIAL_NOTIFICATIONS: NotificationLog[] = [
  {
    id: 'notif-1',
    appointmentId: 'apt-101',
    recipientName: 'Juliana Siqueira Barbosa',
    recipientAddress: '+5511987654321',
    channel: 'WHATSAPP',
    status: 'DELIVERED',
    templateName: 'appointment_confirmed_v1',
    scheduledFor: new Date(Date.now() - 3600000 * 24).toISOString(),
    sentAt: new Date(Date.now() - 3600000 * 24 + 2000).toISOString(),
    payload: {
      procedimento: 'Limpeza de Pele Profunda',
      data_hora: 'Amanhã às 10:00',
      profissional: 'Dra. Camila Vasconcellos'
    }
  },
  {
    id: 'notif-2',
    appointmentId: 'apt-101',
    recipientName: 'Juliana Siqueira Barbosa',
    recipientAddress: '+5511987654321',
    channel: 'WHATSAPP',
    status: 'QUEUED',
    templateName: 'appointment_reminder_24h',
    scheduledFor: new Date(Date.now() + 3600000 * 2).toISOString(),
    payload: {
      procedimento: 'Limpeza de Pele Profunda',
      lembrete: 'Seu atendimento é amanhã!',
      endereco: 'Av. Paulista, 1842 - Conj. 91 - Bela Vista, SP'
    }
  }
];

export const INITIAL_SETTINGS: ClinicSettings = {
  name: 'Aesthetiq Clínica & Spa',
  phone: '(11) 3288-9000',
  address: 'Av. Paulista, 1842 - Conj. 91 - Jardins / Bela Vista, São Paulo - SP',
  minCancelNoticeHours: 24, // 24 horas de antecedência mínima
  defaultBufferMinutes: 15, // 15 minutos de intervalo de higienização
  autoAssignStrategy: 'ROUND_ROBIN',
  workingDays: [1, 2, 3, 4, 5, 6]
};
