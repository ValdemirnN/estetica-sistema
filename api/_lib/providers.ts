/// <reference types="node" />
/** Envio por WhatsApp Cloud API (Meta) e por e-mail (Resend). Cada função devolve sucesso ou erro classificado. */

export interface SendOk {
  ok: true;
  id?: string;
}
export interface SendFail {
  ok: false;
  error: string;
  /** true = vale tentar de novo mais tarde (rede, 5xx, limite de taxa). */
  retryable: boolean;
}
export type SendResult = SendOk | SendFail;

const TIMEOUT_MS = 8000;

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export const whatsappConfigured = () => !!process.env.WHATSAPP_TOKEN && !!process.env.WHATSAPP_PHONE_NUMBER_ID;
export const emailConfigured = () => !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;

/** "(11) 98765-4321" -> "5511987654321" (assume Brasil quando não há DDI). */
export function normalizePhone(phone: string): string | null {
  const d = phone.replace(/\D/g, '');
  if (d.length < 10) return null;
  if (d.length <= 11) return `55${d}`;
  return d;
}

// Códigos da Meta que indicam problema passageiro (limite de taxa / indisponibilidade).
const WA_RETRYABLE_CODES = new Set([4, 80007, 130429, 131016, 133016]);

export async function sendWhatsappTemplate(params: {
  to: string;
  template: string;
  variables: string[];
}): Promise<SendResult> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) return { ok: false, error: 'WhatsApp não configurado.', retryable: false };
  const version = process.env.WHATSAPP_API_VERSION || 'v21.0';
  const lang = process.env.WHATSAPP_TEMPLATE_LANG || 'pt_BR';
  try {
    const r = await timedFetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: params.to,
        type: 'template',
        template: {
          name: params.template,
          language: { code: lang },
          components: [{ type: 'body', parameters: params.variables.map((text) => ({ type: 'text', text })) }]
        }
      })
    });
    const body: any = await r.json().catch(() => ({}));
    if (r.ok) return { ok: true, id: body?.messages?.[0]?.id };
    const code = Number(body?.error?.code);
    const msg = body?.error?.error_data?.details || body?.error?.message || `Meta respondeu ${r.status}`;
    return {
      ok: false,
      error: `${msg}${Number.isFinite(code) ? ` (código ${code})` : ''}`,
      retryable: r.status >= 500 || r.status === 429 || WA_RETRYABLE_CODES.has(code)
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.name === 'AbortError' ? 'Tempo esgotado ao falar com a Meta.' : 'Falha de rede ao falar com a Meta.', retryable: true };
  }
}

export async function sendEmailMessage(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Resend ignora reenvios com a mesma chave por 24h: protege contra envio duplicado. */
  idempotencyKey: string;
}): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return { ok: false, error: 'RESEND_API_KEY / EMAIL_FROM não configurados.', retryable: false };
  try {
    const r = await timedFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': params.idempotencyKey },
      body: JSON.stringify({ from, to: [params.to], subject: params.subject, html: params.html, text: params.text })
    });
    const body: any = await r.json().catch(() => ({}));
    if (r.ok) return { ok: true, id: body?.id };
    return { ok: false, error: body?.message || `Resend respondeu ${r.status}`, retryable: r.status >= 500 || r.status === 429 };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.name === 'AbortError' ? 'Tempo esgotado ao falar com o Resend.' : 'Falha de rede ao falar com o Resend.', retryable: true };
  }
}
