/// <reference types="node" />
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Req, Res, adminClient, header } from '../_lib/http';

/**
 * Webhook do WhatsApp Cloud API: recebe o status de entrega das mensagens.
 *   GET  -> verificação do endpoint (Meta envia hub.mode, hub.verify_token, hub.challenge).
 *   POST -> statuses sent/delivered/read/failed, assinados com X-Hub-Signature-256 (HMAC-SHA256 do corpo bruto).
 *
 * Configure na Meta (App -> WhatsApp -> Configuration -> Webhook):
 *   URL de retorno: https://SEU-DOMINIO/api/notify/whatsapp-webhook   Token de verificação: WHATSAPP_VERIFY_TOKEN
 *   Assine o campo "messages".
 * Variáveis: WHATSAPP_VERIFY_TOKEN, META_APP_SECRET (Segredo do app), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Status só avançam (SENT -> DELIVERED -> READ); nunca voltam. Se a Meta avisar que a mensagem FALHOU depois
 * de aceita (ex.: número sem WhatsApp), o aviso volta para a fila como e-mail (fallback), se o cliente aceitou.
 */

// O corpo precisa chegar bruto para conferir a assinatura.
export const config = { api: { bodyParser: false } };

async function rawBody(req: Req): Promise<string> {
  const r: any = req;
  if (typeof r.body === 'string') return r.body;
  if (Buffer.isBuffer(r.body)) return r.body.toString('utf8');
  const chunks: Buffer[] = [];
  for await (const ch of r) chunks.push(Buffer.isBuffer(ch) ? ch : Buffer.from(ch));
  return Buffer.concat(chunks).toString('utf8');
}

function validSignature(raw: string, signature: string, secret: string): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(raw, 'utf8').digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const token = process.env.WHATSAPP_VERIFY_TOKEN;
    const q = req.query ?? {};
    if (token && first(q['hub.mode']) === 'subscribe' && first(q['hub.verify_token']) === token) {
      return res.status(200).send(first(q['hub.challenge']));
    }
    return res.status(403).json({ error: 'Verificação recusada.' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  const secret = process.env.META_APP_SECRET;
  if (!secret) return res.status(500).json({ error: 'META_APP_SECRET não configurado no servidor.' });

  try {
    const raw = await rawBody(req);
    if (!validSignature(raw, header(req, 'x-hub-signature-256'), secret)) {
      return res.status(401).json({ error: 'Assinatura inválida.' });
    }
    const body = JSON.parse(raw);
    const sb = adminClient();
    const statuses: any[] = (body?.entry ?? []).flatMap((e: any) => (e?.changes ?? []).flatMap((c: any) => c?.value?.statuses ?? []));

    for (const s of statuses) {
      const msgId = String(s?.id ?? '');
      if (!msgId) continue;
      const when = s?.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : new Date().toISOString();

      if (s.status === 'delivered') {
        await sb.from('notifications_log').update({ status: 'DELIVERED', delivered_at: when }).eq('provider_message_id', msgId).eq('status', 'SENT');
      } else if (s.status === 'read') {
        await sb
          .from('notifications_log')
          .update({ status: 'READ', read_at: when, delivered_at: when })
          .eq('provider_message_id', msgId)
          .in('status', ['SENT', 'DELIVERED']);
      } else if (s.status === 'failed') {
        const err = s?.errors?.[0];
        const reason = `WhatsApp: ${err?.message || err?.title || 'entrega falhou'}${err?.code ? ` (código ${err.code})` : ''}`;
        const { data: row } = await sb
          .from('notifications_log')
          .select('id, status, appointment_id, recipient_id')
          .eq('provider_message_id', msgId)
          .in('status', ['SENT', 'DELIVERED'])
          .maybeSingle();
        if (!row) continue;

        // Fallback: ainda dá tempo, o agendamento está ativo e o cliente aceita e-mail?
        const [{ data: profile }, { data: apt }] = await Promise.all([
          sb.from('profiles').select('email, opt_in_email, is_active').eq('id', row.recipient_id).maybeSingle(),
          row.appointment_id
            ? sb.from('appointments').select('status, start_time').eq('id', row.appointment_id).maybeSingle()
            : Promise.resolve({ data: null as any })
        ]);
        const canMail =
          !!profile?.is_active && !!profile.opt_in_email && !!profile.email &&
          !!apt && ['PENDING', 'CONFIRMED'].includes(apt.status) && new Date(apt.start_time).getTime() > Date.now();

        await sb
          .from('notifications_log')
          .update(
            canMail
              ? {
                  status: 'QUEUED', channel: 'EMAIL', recipient_address: profile!.email, fallback_from: 'WHATSAPP',
                  retry_count: 0, scheduled_for: new Date().toISOString(), locked_at: null, sent_at: null,
                  provider_message_id: null, error_message: `${reason}. Reenviando por e-mail.`
                }
              : { status: 'FAILED', error_message: reason }
          )
          .eq('id', row.id)
          .in('status', ['SENT', 'DELIVERED']);
      }
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[whatsapp-webhook]', e);
    // 500 faz a Meta tentar de novo mais tarde.
    return res.status(500).json({ error: 'Erro ao processar o webhook.' });
  }
}
