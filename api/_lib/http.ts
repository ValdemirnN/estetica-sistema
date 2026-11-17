/// <reference types="node" />
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/** Pedaço mínimo dos objetos que a Vercel entrega às funções (evita depender de @vercel/node). */
export interface Req {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: any;
}
export interface Res {
  status(code: number): Res;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
}

export const header = (req: Req, name: string): string => {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] ?? '' : v ?? '';
};

/** Cliente com a chave service_role. SÓ existe no servidor (variáveis da Vercel, sem prefixo VITE_). */
export function adminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Servidor sem SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY configurados.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const escapeHtml = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
