/**
 * Descobre QUAL clínica o visitante está acessando.
 *
 * Ordem de prioridade:
 *   1. ?clinica=<slug>                  (útil em testes e em hospedagem sem subdomínio)
 *   2. /c/<slug>                        (link curto: https://app.com/c/clinica-bella)
 *   3. <slug>.<VITE_BASE_DOMAIN>        (subdomínio: https://bella.seudominio.com.br)
 *   4. VITE_DEFAULT_CLINIC_SLUG         (instalação dedicada a uma única clínica)
 *
 * ?plataforma=1 abre o painel do dono da plataforma (sem clínica).
 */

const RESERVED_SUBDOMAINS = new Set(['www', 'app', 'api', 'admin', 'plataforma', 'painel']);

const clean = (v: string | null | undefined) => (v ?? '').trim().toLowerCase();
const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function isPlatformRoute(): boolean {
  return new URLSearchParams(window.location.search).get('plataforma') === '1';
}

export function resolveClinicSlug(): string | null {
  if (isPlatformRoute()) return null;

  const fromQuery = clean(new URLSearchParams(window.location.search).get('clinica'));
  if (SLUG_RE.test(fromQuery)) return fromQuery;

  const fromPath = window.location.pathname.match(/^\/c\/([a-z0-9-]+)\/?/i);
  if (fromPath && SLUG_RE.test(clean(fromPath[1]))) return clean(fromPath[1]);

  const base = clean(import.meta.env.VITE_BASE_DOMAIN as string | undefined);
  const host = window.location.hostname.toLowerCase();
  if (base && host.endsWith(`.${base}`)) {
    const sub = host.slice(0, -(base.length + 1));
    if (sub && !sub.includes('.') && !RESERVED_SUBDOMAINS.has(sub) && SLUG_RE.test(sub)) return sub;
  }

  const fallback = clean(import.meta.env.VITE_DEFAULT_CLINIC_SLUG as string | undefined);
  return SLUG_RE.test(fallback) ? fallback : null;
}

/** Endereço público de uma clínica (para o dono copiar e divulgar). */
export function buildClinicUrl(slug: string): string {
  const base = clean(import.meta.env.VITE_BASE_DOMAIN as string | undefined);
  if (base) return `${window.location.protocol}//${slug}.${base}`;
  return `${window.location.origin}/?clinica=${slug}`;
}

export function buildPlatformUrl(): string {
  return `${window.location.origin}/?plataforma=1`;
}
