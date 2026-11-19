/// <reference types="node" />
import type { SupabaseClient } from '@supabase/supabase-js';
import { Req, Res, adminClient, header } from '../_lib/http';
import { TemplateData, isTemplateKey, renderEmail, whatsappParams } from '../_lib/templates';
import { emailConfigured, normalizePhone, sendEmailMessage, sendWhatsappTemplate, whatsappConfigured } from '../_lib/providers';

/**
 * GET/POST /api/notify/reminders
 * Worker da fila `notifications_log`. Chamado a cada 10-15 min por um agendador com
 *   Authorization: Bearer <CRON_SECRET>
 * (GitHub Actions: .github/workflows/notify-worker.yml; Vercel Cron no plano Pro; cron-job.org...).
 *
 * O que faz com cada aviso vencido (reservado antes por claim_notifications, sem duplicar):
 *   1. Descarta (SKIPPED) se o agendamento não está mais ativo, o horário passou ou o cliente fez opt-out.
 *   2. WhatsApp (modelo aprovado na Meta) se o aviso é de WhatsApp, o cliente aceitou e o provedor está configurado.
 *   3. Falha temporária -> tenta de novo com espera crescente (5, 15 e 45 min; no máximo 4 tentativas).
 *   4. Falha definitiva (ou tentativas esgotadas) -> e-mail, se o cliente aceitou e-mail (fallback); senão FAILED.
 *   5. O status DELIVERED/READ chega depois pelo webhook /api/notify/whatsapp-webhook.
 *
 * Variáveis (Vercel -> Settings -> Environment Variables, sem prefixo VITE_):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET
 *   WhatsApp: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID (opcionais: WHATSAPP_TEMPLATE_LANG=pt_BR, WHATSAPP_API_VERSION=v21.0)
 *   E-mail:   RESEND_API_KEY, EMAIL_FROM
 *
 * Garantia: pelo menos uma vez. Um aviso só pode sair em duplicidade se o worker cair entre a resposta do
 * provedor e a gravação no banco (a reserva expira em 10 min); o Resend ainda barra o e-mail repetido.
 */

const CHUNK = 5;
const MAX_LOOPS = 20;
const BUDGET_MS = 8000;
const MAX_ATTEMPTS = 4;
const BACKOFF_MIN = [5, 15, 45];

interface Counters {
  claimed: number;
  sent: number;
  fallback: number;
  retried: number;
  failed: number;
  skipped: number;
}

type Notif = {
  id: string;
  appointment_id: string | null;
  recipient_id: string;
  channel: 'WHATSAPP' | 'EMAIL';
  template_name: string;
  payload: Record<string, any> | null;
  retry_count: number;
};

const nowIso = () => new Date().toISOString();
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Erro inesperado.');

async function finish(sb: SupabaseClient, id: string, patch: Record<string, unknown>) {
  const { error } = await sb
    .from('notifications_log')
    .update({ locked_at: null, ...patch })
    .eq('id', id)
    .eq('status', 'QUEUED');
  if (error) console.error('[notify] falha ao gravar resultado', id, error.message);
}

async function processOne(sb: SupabaseClient, n: Notif, c: Counters) {
  const skip = async (reason: string) => {
    await finish(sb, n.id, { status: 'SKIPPED', error_message: reason });
    c.skipped++;
  };
  const fail = async (reason: string) => {
    await finish(sb, n.id, { status: 'FAILED', error_message: reason });
    c.failed++;
  };
  const retry = async (reason: string, extra: Record<string, unknown> = {}, baseCount = n.retry_count) => {
    const attempt = baseCount + 1;
    if (attempt >= MAX_ATTEMPTS) return false;
    const wait = BACKOFF_MIN[Math.min(attempt - 1, BACKOFF_MIN.length - 1)];
    await finish(sb, n.id, {
      retry_count: attempt,
      scheduled_for: new Date(Date.now() + wait * 60000).toISOString(),
      error_message: `Tentativa ${attempt}: ${reason}`,
      ...extra
    });
    c.retried++;
    return true;
  };

  const [{ data: profile }, { data: apt }] = await Promise.all([
    sb.from('profiles').select('full_name, phone, email, opt_in_whatsapp, opt_in_email, is_active').eq('id', n.recipient_id).maybeSingle(),
    n.appointment_id
      ? sb.from('appointments').select('status, start_time').eq('id', n.appointment_id).maybeSingle()
      : Promise.resolve({ data: null as any })
  ]);

  // 1) Ainda faz sentido enviar?
  if (!apt) return skip('Agendamento não encontrado.');
  if (!['PENDING', 'CONFIRMED'].includes(apt.status)) return skip('O agendamento não está mais ativo.');
  if (new Date(apt.start_time).getTime() <= Date.now()) return skip('O horário do atendimento já passou.');
  const planned = n.payload?.horario ? new Date(String(n.payload.horario)).getTime() : NaN;
  if (Number.isFinite(planned) && Math.abs(planned - new Date(apt.start_time).getTime()) > 60000) {
    return skip('O horário do agendamento mudou depois que este aviso foi criado.');
  }
  if (!profile || !profile.is_active) return skip('Cadastro do cliente inativo.');

  // 2) Opt-out (conferido AGORA, não quando o aviso entrou na fila)
  const wantsWa = !!profile.opt_in_whatsapp && !!profile.phone && !!normalizePhone(profile.phone);
  const wantsMail = !!profile.opt_in_email && !!profile.email;
  if (n.channel === 'EMAIL' && !wantsMail) return skip('Cliente optou por não receber e-mails.');
  if (n.channel === 'WHATSAPP' && !wantsWa && !wantsMail) return skip('Cliente optou por não receber avisos.');

  const data: TemplateData = {
    clientName: profile.full_name,
    clinica: String(n.payload?.clinica ?? 'Clínica'),
    procedimento: String(n.payload?.procedimento ?? 'atendimento'),
    horario: apt.start_time,
    profissional: String(n.payload?.profissional ?? '')
  };

  const sendMail = async (fromWhatsapp: string | null): Promise<void> => {
    const channelPatch = fromWhatsapp
      ? { channel: 'EMAIL', recipient_address: profile.email, fallback_from: 'WHATSAPP' }
      : {};
    if (!emailConfigured()) {
      await fail(fromWhatsapp ? `WhatsApp: ${fromWhatsapp}. E-mail não configurado.` : 'E-mail não configurado.');
      return;
    }
    const mail = renderEmail(n.template_name, data);
    const r = await sendEmailMessage({ to: profile.email, ...mail, idempotencyKey: `notif-${n.id}` });
    if (r.ok) {
      await finish(sb, n.id, {
        status: 'SENT',
        sent_at: nowIso(),
        provider_message_id: r.id ?? null,
        error_message: fromWhatsapp ? `WhatsApp falhou (${fromWhatsapp}); enviado por e-mail.` : null,
        ...channelPatch
      });
      c.sent++;
      if (fromWhatsapp) c.fallback++;
      return;
    }
    // No fallback, as tentativas de e-mail contam do zero (as do WhatsApp já foram gastas).
    if (r.retryable && (await retry(r.error, channelPatch, fromWhatsapp ? 0 : n.retry_count))) return;
    await fail(fromWhatsapp ? `WhatsApp: ${fromWhatsapp}. E-mail: ${r.error}` : r.error);
  };

  // 3) E-mail direto
  if (n.channel === 'EMAIL') return sendMail(null);

  // 4) WhatsApp (se possível); senão cai para e-mail
  const waReady = wantsWa && whatsappConfigured() && isTemplateKey(n.template_name);
  if (!waReady) {
    if (!wantsMail) return fail('WhatsApp indisponível (não configurado ou sem modelo) e o cliente não aceita e-mail.');
    const why = !wantsWa ? 'cliente sem WhatsApp ativo' : !whatsappConfigured() ? 'WhatsApp não configurado' : 'modelo sem versão de WhatsApp';
    return sendMail(why);
  }

  const wa = await sendWhatsappTemplate({
    to: normalizePhone(profile.phone)!,
    template: n.template_name,
    variables: whatsappParams(data)
  });
  if (wa.ok) {
    await finish(sb, n.id, { status: 'SENT', sent_at: nowIso(), provider_message_id: wa.id ?? null, error_message: null });
    c.sent++;
    return;
  }
  if (wa.retryable && (await retry(wa.error))) return;
  if (wantsMail) return sendMail(wa.error);
  return fail(wa.error);
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: 'CRON_SECRET não configurado no servidor.' });
  if (header(req, 'authorization') !== `Bearer ${secret}`) return res.status(401).json({ error: 'Não autorizado.' });

  const started = Date.now();
  const c: Counters = { claimed: 0, sent: 0, fallback: 0, retried: 0, failed: 0, skipped: 0 };
  try {
    const sb = adminClient();
    for (let i = 0; i < MAX_LOOPS && Date.now() - started < BUDGET_MS; i++) {
      const { data, error } = await sb.rpc('claim_notifications', { p_limit: CHUNK });
      if (error) return res.status(500).json({ error: error.message, ...c });
      const rows = (data ?? []) as Notif[];
      if (!rows.length) break;
      c.claimed += rows.length;
      await Promise.all(
        rows.map((n) =>
          processOne(sb, n, c).catch(async (e) => {
            // Nunca deixa um aviso preso: volta para a fila com espera, ou falha se acabaram as tentativas.
            console.error('[notify] erro ao processar', n.id, errText(e));
            const attempt = n.retry_count + 1;
            if (attempt >= MAX_ATTEMPTS) {
              await finish(sb, n.id, { status: 'FAILED', error_message: errText(e) });
              c.failed++;
            } else {
              await finish(sb, n.id, {
                retry_count: attempt,
                scheduled_for: new Date(Date.now() + BACKOFF_MIN[Math.min(attempt - 1, 2)] * 60000).toISOString(),
                error_message: `Tentativa ${attempt}: ${errText(e)}`
              });
              c.retried++;
            }
          })
        )
      );
    }
    return res.status(200).json({ ...c, whatsapp: whatsappConfigured(), email: emailConfigured(), ms: Date.now() - started });
  } catch (e) {
    return res.status(500).json({ error: errText(e), ...c });
  }
}
