/// <reference types="node" />
import { randomInt } from 'node:crypto';
import { Req, Res, adminClient, header } from '../_lib/http';

/**
 * POST /api/admin/create-client
 * Equipe (ADMIN ou RECEPTIONIST) cadastra um cliente: cria a conta de login com senha provisória
 * (o cliente troca no primeiro acesso), vincula à clínica como CLIENT e grava os dados básicos.
 * Autorização: o token (JWT) do usuário logado vai no cabeçalho Authorization; o papel é conferido no banco.
 */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const tempPassword = () => Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');

function validCpf(v: string): boolean {
  const d = digits(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  try {
    const sb = adminClient();

    // 1) Quem está chamando?
    const token = header(req, 'authorization').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Faça login para continuar.' });
    const { data: u, error: uErr } = await sb.auth.getUser(token);
    if (uErr || !u.user) return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });

    // 2) Entrada
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
    const clinicId = String(b.clinicId ?? '');
    const fullName = String(b.fullName ?? '').trim();
    const phone = String(b.phone ?? '').trim();
    const email = String(b.email ?? '').trim().toLowerCase();
    const cpf = b.cpf ? String(b.cpf).trim() : '';
    const birthDate = b.birthDate ? String(b.birthDate) : '';
    const notes = b.notes ? String(b.notes).trim().slice(0, 1000) : '';

    if (!/^[0-9a-f-]{36}$/i.test(clinicId)) return res.status(400).json({ error: 'Clínica inválida.' });
    if (fullName.length < 3 || fullName.length > 150) return res.status(400).json({ error: 'Informe o nome completo.' });
    if (digits(phone).length < 10 || digits(phone).length > 13) return res.status(400).json({ error: 'Telefone inválido.' });
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 255) return res.status(400).json({ error: 'E-mail inválido.' });
    if (cpf && !validCpf(cpf)) return res.status(400).json({ error: 'CPF inválido.' });
    if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return res.status(400).json({ error: 'Data de nascimento inválida.' });

    // 3) Quem chama é equipe desta clínica (e a clínica está ativa)?
    const { data: me } = await sb
      .from('clinic_members')
      .select('role, is_active, clinics!inner(is_active)')
      .eq('clinic_id', clinicId)
      .eq('user_id', u.user.id)
      .maybeSingle();
    const clinicActive = (me as any)?.clinics?.is_active === true;
    if (!me || !me.is_active || !clinicActive || !['ADMIN', 'RECEPTIONIST'].includes(me.role as string)) {
      return res.status(403).json({ error: 'Apenas administrador ou recepção da clínica pode cadastrar clientes.' });
    }

    // 4) Duplicidades
    const { data: byEmail } = await sb.from('profiles').select('id').eq('email', email).maybeSingle();
    if (byEmail) {
      return res.status(409).json({
        error: 'Já existe uma conta com este e-mail. Peça para a pessoa entrar pelo link da clínica; o vínculo é criado no primeiro acesso.'
      });
    }
    if (cpf) {
      const { data: byCpf } = await sb.from('profiles').select('id').eq('cpf', cpf).maybeSingle();
      if (byCpf) return res.status(409).json({ error: 'Já existe um cadastro com este CPF.' });
    }

    // 5) Cria a conta (o gatilho do banco cria o perfil) e completa os dados
    const password = tempPassword();
    const { data: created, error: cErr } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, phone, must_change_password: true }
    });
    if (cErr || !created.user) {
      return res.status(400).json({ error: cErr?.message || 'Não foi possível criar a conta.' });
    }
    const clientId = created.user.id;

    const rollback = async (msg: string) => {
      await sb.auth.admin.deleteUser(clientId).catch(() => {});
      return res.status(500).json({ error: msg });
    };

    const { error: pErr } = await sb
      .from('profiles')
      .update({
        full_name: fullName,
        phone,
        cpf: cpf || null,
        birth_date: birthDate || null,
        opt_in_whatsapp: b.optInWhatsapp !== false,
        opt_in_email: b.optInEmail !== false,
        lgpd_consent_at: new Date().toISOString()
      })
      .eq('id', clientId);
    if (pErr) return rollback(`Não foi possível salvar os dados do cliente: ${pErr.message}`);

    const { error: mErr } = await sb
      .from('clinic_members')
      .insert({ clinic_id: clinicId, user_id: clientId, role: 'CLIENT' });
    if (mErr) return rollback(`Não foi possível vincular o cliente à clínica: ${mErr.message}`);

    if (notes) {
      await sb
        .from('clinic_client_notes')
        .upsert({ clinic_id: clinicId, client_id: clientId, notes, updated_by: u.user.id });
    }

    return res.status(200).json({ clientId, temporaryPassword: password });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Erro inesperado.' });
  }
}
