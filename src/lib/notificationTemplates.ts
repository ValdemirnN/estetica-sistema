/**
 * Modelos de aviso (WhatsApp e e-mail). Sem dependências: o MESMO arquivo vive em
 * `api/_lib/templates.ts` (worker) e em `src/lib/notificationTemplates.ts` (prévia do painel).
 * Se mudar um, copie para o outro.
 *
 * WhatsApp: os textos abaixo precisam estar cadastrados e APROVADOS na Meta (categoria UTILITY, idioma pt_BR),
 * com o MESMO nome do modelo e as 5 variáveis na mesma ordem:
 *   {{1}} primeiro nome · {{2}} clínica · {{3}} procedimento · {{4}} data e hora · {{5}} profissional
 */

export type TemplateKey =
  | 'appointment_confirmed_instant'
  | 'appointment_rescheduled'
  | 'appointment_reminder_24h'
  | 'appointment_reminder_2h';

export const TEMPLATE_KEYS: TemplateKey[] = [
  'appointment_confirmed_instant',
  'appointment_rescheduled',
  'appointment_reminder_24h',
  'appointment_reminder_2h'
];

export const TEMPLATE_LABEL: Record<TemplateKey, string> = {
  appointment_confirmed_instant: 'Confirmação do agendamento',
  appointment_rescheduled: 'Remarcação',
  appointment_reminder_24h: 'Lembrete 24h antes',
  appointment_reminder_2h: 'Lembrete 2h antes'
};

export const WHATSAPP_BODIES: Record<TemplateKey, string> = {
  appointment_confirmed_instant:
    'Olá, {{1}}! Seu agendamento na {{2}} está confirmado. Procedimento: {{3}}. Data e hora: {{4}}. Profissional: {{5}}. Até lá!',
  appointment_rescheduled:
    'Olá, {{1}}! Seu agendamento na {{2}} foi remarcado. Procedimento: {{3}}. Novo horário: {{4}}. Profissional: {{5}}. Qualquer dúvida, é só responder.',
  appointment_reminder_24h:
    'Olá, {{1}}! Lembrete: amanhã você tem um horário na {{2}}. Procedimento: {{3}}. Data e hora: {{4}}. Profissional: {{5}}. Para remarcar ou cancelar, use o link de agendamento da clínica.',
  appointment_reminder_2h:
    'Olá, {{1}}! Seu horário na {{2}} é daqui a pouco. Procedimento: {{3}}. Data e hora: {{4}}. Profissional: {{5}}. Esperamos você!'
};

export const isTemplateKey = (t: string): t is TemplateKey => (TEMPLATE_KEYS as string[]).includes(t);

export interface TemplateData {
  /** Nome completo do cliente (usamos só o primeiro). */
  clientName: string;
  clinica: string;
  procedimento: string;
  /** ISO do início do atendimento. */
  horario: string;
  profissional: string;
}

/** "quarta-feira, 25/11 às 14:30" (Brasília) */
export function formatWhen(iso: string): string {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('weekday')}, ${g('day')}/${g('month')} às ${g('hour')}:${g('minute')}`;
}

/** A Meta recusa variáveis vazias, com quebra de linha/tabulação ou 4+ espaços seguidos. */
const cleanParam = (v: string) =>
  v.replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim().slice(0, 500) || '-';

export const firstName = (full: string) => (full || '').trim().split(/\s+/)[0] || 'cliente';

/** As 5 variáveis do modelo, na ordem. */
export function whatsappParams(d: TemplateData): string[] {
  return [firstName(d.clientName), d.clinica, d.procedimento, formatWhen(d.horario), d.profissional || 'nossa equipe'].map(cleanParam);
}

/** Texto final da mensagem (para a prévia do painel). */
export function renderWhatsapp(template: TemplateKey, d: TemplateData): string {
  const params = whatsappParams(d);
  return WHATSAPP_BODIES[template].replace(/\{\{(\d)\}\}/g, (_, i) => params[Number(i) - 1] ?? '');
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SUBJECTS: Record<TemplateKey, string> = {
  appointment_confirmed_instant: 'Agendamento confirmado',
  appointment_rescheduled: 'Seu horário foi remarcado',
  appointment_reminder_24h: 'Lembrete: seu horário é amanhã',
  appointment_reminder_2h: 'Lembrete: seu horário é daqui a pouco'
};

const INTROS: Record<TemplateKey, string> = {
  appointment_confirmed_instant: 'Seu agendamento está confirmado.',
  appointment_rescheduled: 'Seu agendamento foi remarcado.',
  appointment_reminder_24h: 'Lembrete: amanhã você tem um horário conosco.',
  appointment_reminder_2h: 'Seu horário é daqui a pouco. Esperamos você!'
};

/** E-mail (assunto, HTML e texto simples). Todo valor dinâmico é escapado. */
export function renderEmail(template: string, d: TemplateData): { subject: string; html: string; text: string } {
  const key = isTemplateKey(template) ? template : null;
  const intro = key ? INTROS[key] : 'Você tem um aviso sobre o seu agendamento.';
  const subject = `${key ? SUBJECTS[key] : 'Aviso'} — ${d.clinica}`;
  const when = formatWhen(d.horario);
  const rows: [string, string][] = [
    ['Procedimento', d.procedimento],
    ['Data e hora', when],
    ['Profissional', d.profissional || 'nossa equipe']
  ];
  const footer =
    'Você recebe este aviso porque tem um agendamento nesta clínica. Para deixar de receber, ajuste suas preferências em “Meus Dados & Privacidade”, na sua conta.';
  const html =
    `<div style="font-family:Arial,sans-serif;font-size:15px;color:#222;max-width:520px">` +
    `<p>Olá, ${esc(firstName(d.clientName))}!</p><p>${esc(intro)}</p>` +
    `<table style="border-collapse:collapse;font-size:14px">` +
    rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${esc(k)}</td><td style="padding:4px 0"><strong>${esc(v)}</strong></td></tr>`).join('') +
    `</table><p>— ${esc(d.clinica)}</p>` +
    `<p style="font-size:12px;color:#888;margin-top:24px">${esc(footer)}</p></div>`;
  const text =
    `Olá, ${firstName(d.clientName)}!\n\n${intro}\n\n` +
    rows.map(([k, v]) => `${k}: ${v}`).join('\n') +
    `\n\n— ${d.clinica}\n\n${footer}`;
  return { subject, html, text };
}
