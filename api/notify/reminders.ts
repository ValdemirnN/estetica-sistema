/// <reference types="node" />
import { Req, Res, adminClient, escapeHtml, header } from '../_lib/http';

/**
 * GET/POST /api/notify/reminders
 * Worker da fila `notifications_log`: envia por e-mail (Resend) o que está QUEUED e já venceu.
 * Chamado por um agendador (Vercel Cron, GitHub Actions, cron-job.org...) com
 *   Authorization: Bearer <CRON_SECRET>
 *
 * Variáveis (Vercel → Settings → Environment Variables, sem prefixo VITE_):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, RESEND_API_KEY, EMAIL_FROM
 *
 * WhatsApp: ainda não há envio automático. Avisos de canal WHATSAPP caem para e-mail quando o cliente
 * aceitou e-mail; sem isso, ficam na fila (a equipe pode mandar o lembrete pelo botão de WhatsApp da agenda).
 */

const BATCH = 50;

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });

function buildEmail(template: string, p: Record<string, any>) {
  const clinica = escapeHtml(String(p.clinica ?? 'Clínica'));
  const proc = escapeHtml(String(p.procedimento ?? 'atendimento'));
  const prof = p.profissional ? ` com ${escapeHtml(String(p.profissional))}` : '';
  const when = p.horario ? escapeHtml(fmtWhen(String(p.horario))) : '';

  const lines: Record<string, { subject: string; text: string }> = {
    appointment_confirmed_instant: {
      subject: `Agendamento confirmado — ${p.clinica ?? ''}`,
      text: `Seu horário de <strong>${proc}</strong>${prof} está confirmado para <strong>${when}</strong>.`
    },
    appointment_rescheduled: {
      subject: `Seu horário foi remarcado — ${p.clinica ?? ''}`,
      text: `Seu horário de <strong>${proc}</strong>${prof} foi remarcado para <strong>${when}</strong>.`
    },
    appointment_reminder_24h: {
      subject: `Lembrete: seu horário é amanhã — ${p.clinica ?? ''}`,
      text: `Lembrando do seu horário de <strong>${proc}</strong>${prof}: <strong>${when}</strong>.`
    }
  };
  const l = lines[template] ?? {
    subject: `Aviso — ${p.clinica ?? ''}`,
    text: `Você tem um aviso sobre <strong>${proc}</strong>${when ? ` em <strong>${when}</strong>` : ''}.`
  };
  return {
    subject: l.subject,
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#222"><p>Olá!</p><p>${l.text}</p><p>— ${clinica}</p></div>`
  };
}

async function sendEmail(to: string, subject: string, html: string): Promise<{ id?: string; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return { error: 'RESEND_API_KEY / EMAIL_FROM não configurados.' };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html })
  });
  const body: any = await r.json().catch(() => ({}));
  if (!r.ok) return { error: body?.message || `Resend respondeu ${r.status}` };
  return { id: body?.id };
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: 'CRON_SECRET não configurado no servidor.' });
  if (header(req, 'authorization') !== `Bearer ${secret}`) return res.status(401).json({ error: 'Não autorizado.' });

  try {
    const sb = adminClient();
    const { data: rows, error } = await sb
      .from('notifications_log')
      .select('id, channel, template_name, recipient_address, payload, recipient:profiles!notifications_log_recipient_id_fkey(email, opt_in_email)')
      .eq('status', 'QUEUED')
      .lte('scheduled_for', new Date().toISOString())
      .order('scheduled_for')
      .limit(BATCH);
    if (error) return res.status(500).json({ error: error.message });

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const n of rows ?? []) {
      const rec: any = (n as any).recipient;
      const payload = (n.payload ?? {}) as Record<string, any>;

      // Endereço de e-mail: o do próprio aviso, ou (WhatsApp) o e-mail do cliente se ele aceitou e-mail.
      const to = n.channel === 'EMAIL' ? n.recipient_address : rec?.opt_in_email ? rec?.email : null;
      if (!to) {
        skipped++;
        continue;
      }

      // Reserva a linha antes de enviar (evita envio duplicado se duas execuções se cruzarem).
      const { data: claimed } = await sb
        .from('notifications_log')
        .update({ status: 'SENT', sent_at: new Date().toISOString() })
        .eq('id', n.id)
        .eq('status', 'QUEUED')
        .select('id');
      if (!claimed?.length) continue;

      if (payload.horario && new Date(String(payload.horario)).getTime() < Date.now()) {
        await sb.from('notifications_log').update({ status: 'FAILED', error_message: 'O horário do atendimento já passou.' }).eq('id', n.id);
        failed++;
        continue;
      }

      const mail = buildEmail(n.template_name, payload);
      const r = await sendEmail(to, mail.subject, mail.html);
      if (r.error) {
        await sb.from('notifications_log').update({ status: 'FAILED', error_message: r.error, sent_at: null }).eq('id', n.id);
        failed++;
      } else {
        await sb
          .from('notifications_log')
          .update({
            provider_message_id: r.id ?? null,
            error_message: n.channel === 'WHATSAPP' ? 'Enviado por e-mail (sem envio automático de WhatsApp).' : null
          })
          .eq('id', n.id);
        sent++;
      }
    }

    return res.status(200).json({ processed: rows?.length ?? 0, sent, failed, skipped });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Erro inesperado.' });
  }
}
