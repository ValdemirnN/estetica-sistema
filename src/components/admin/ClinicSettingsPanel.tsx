import React, { useEffect, useState } from 'react';
import { Check, Copy, Loader2, Mail, Palette, Settings, Sparkles, Trash2, UserPlus } from 'lucide-react';
import { ClinicSettings, TeamInvite, TeamMember, UserRole } from '../../types/clinic';
import { fetchTeam, inviteMember, revokeInvite, setMemberAccess, updateClinic } from '../../services/api';
import { COLOR_PRESETS, applyTheme, isValidHex } from '../../lib/theme';
import { buildClinicUrl } from '../../lib/tenant';
import { Field, ImageField, errMsg, ghostBtn, inputClass, primaryBtn } from './ui';
import { ErrorBox } from './ServicesManager';

interface Props {
  clinicId: string;
  settings: ClinicSettings;
  currentUserId: string;
  onChanged: () => Promise<void>;
  notify: (msg: string) => void;
}

const Card = ({ title, subtitle, icon, children }: { title: string; subtitle?: string; icon: React.ReactNode; children: React.ReactNode }) => (
  <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
    <div>
      <h4 className="text-sm font-bold text-white flex items-center gap-2">
        {icon} {title}
      </h4>
      {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
    </div>
    {children}
  </section>
);

export function ClinicSettingsPanel({ clinicId, settings, currentUserId, onChanged, notify }: Props) {
  const [form, setForm] = useState<ClinicSettings>(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Prévia ao vivo da cor: o app inteiro muda enquanto você escolhe; ao sair sem salvar, volta ao salvo.
  useEffect(() => {
    if (isValidHex(form.primaryColor)) applyTheme(form.primaryColor);
  }, [form.primaryColor]);
  useEffect(() => () => applyTheme(settings.primaryColor), [settings.primaryColor]);

  const dirty = JSON.stringify(form) !== JSON.stringify(settings);
  const url = buildClinicUrl(settings.slug);

  const save = async () => {
    setError(null);
    if (!form.name.trim()) return setError('Informe o nome da clínica.');
    if (!isValidHex(form.primaryColor)) return setError('Cor inválida. Use o formato #RRGGBB.');
    setBusy(true);
    try {
      await updateClinic(clinicId, form);
      await onChanged();
      notify('Personalização salva! Seus clientes já veem as mudanças.');
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = () => {
    navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <Settings className="w-4 h-4 text-rose-400" /> Minha Clínica
        </h3>
        <p className="text-xs text-slate-400 mt-1">Deixe o sistema com a cara da sua clínica: nome, logo, cores, textos e regras de agendamento.</p>
      </div>

      <Card title="Link para seus clientes" icon={<Copy className="w-4 h-4 text-rose-400" />} subtitle="Divulgue este endereço no Instagram, WhatsApp e Google.">
        <div className="flex items-center gap-2">
          <input readOnly value={url} className={inputClass + ' font-mono'} onFocus={(e) => e.currentTarget.select()} />
          <button onClick={copy} className={ghostBtn + ' shrink-0'}>
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copiado' : 'Copiar'}
          </button>
        </div>
      </Card>

      <Card title="Identidade visual" icon={<Palette className="w-4 h-4 text-rose-400" />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Nome da clínica *">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={150} className={inputClass} />
          </Field>
          <Field label="Slogan (abaixo do nome)">
            <input value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} maxLength={200} className={inputClass} />
          </Field>
        </div>
        <ImageField
          clinicId={clinicId}
          label="Logo"
          hint="Quadrada funciona melhor. PNG, JPG ou WebP, até 2 MB."
          value={form.logoUrl ?? ''}
          onChange={(u) => setForm({ ...form, logoUrl: u || undefined })}
          fallback={<Sparkles className="w-6 h-6 text-rose-400" />}
        />
        <div>
          <span className="text-xs text-slate-300 font-semibold block mb-1.5">Cor principal</span>
          <div className="flex flex-wrap items-center gap-2">
            {COLOR_PRESETS.map((c) => (
              <button
                key={c.hex}
                type="button"
                title={c.name}
                aria-label={c.name}
                onClick={() => setForm({ ...form, primaryColor: c.hex })}
                style={{ backgroundColor: c.hex }}
                className={`w-8 h-8 rounded-full border-2 transition-transform ${
                  form.primaryColor.toLowerCase() === c.hex ? 'border-white scale-110' : 'border-transparent'
                }`}
              />
            ))}
            <input
              type="color"
              aria-label="Escolher outra cor"
              value={isValidHex(form.primaryColor) ? form.primaryColor : '#e11d48'}
              onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
              className="w-8 h-8 rounded-full bg-transparent border-0 p-0 cursor-pointer"
            />
            <input
              value={form.primaryColor}
              onChange={(e) => setForm({ ...form, primaryColor: e.target.value.trim() })}
              maxLength={7}
              className={inputClass + ' !w-24 font-mono'}
            />
          </div>
          <p className="text-[11px] text-slate-500 mt-1.5">A prévia é aplicada na hora em toda a tela. Botões, destaques e bordas usam esta cor.</p>
        </div>
      </Card>

      <Card title="Página inicial do cliente" icon={<Sparkles className="w-4 h-4 text-rose-400" />} subtitle="O texto de boas-vindas que aparece acima dos procedimentos.">
        <div className="grid grid-cols-1 gap-3">
          <Field label="Selo">
            <input value={form.heroBadge} onChange={(e) => setForm({ ...form, heroBadge: e.target.value })} maxLength={80} className={inputClass} />
          </Field>
          <Field label="Título">
            <input value={form.heroTitle} onChange={(e) => setForm({ ...form, heroTitle: e.target.value })} maxLength={200} className={inputClass} />
          </Field>
          <Field label="Texto de apoio">
            <textarea rows={2} value={form.heroSubtitle} onChange={(e) => setForm({ ...form, heroSubtitle: e.target.value })} className={inputClass + ' resize-y'} />
          </Field>
        </div>
        <div className="rounded-xl bg-gradient-to-r from-rose-950/40 via-slate-900 to-indigo-950/40 border border-rose-500/20 p-4">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Prévia</p>
          {form.heroBadge && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/10 text-rose-300 border border-rose-500/30 mb-2">
              <Sparkles className="w-3 h-3 text-rose-400" /> {form.heroBadge}
            </span>
          )}
          <h5 className="text-lg font-bold text-white leading-snug">{form.heroTitle || 'Título da página'}</h5>
          <p className="text-xs text-slate-300 mt-1">{form.heroSubtitle}</p>
        </div>
      </Card>

      <Card title="Contato" icon={<Mail className="w-4 h-4 text-rose-400" />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Telefone">
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} maxLength={30} className={inputClass} />
          </Field>
          <Field label="WhatsApp">
            <input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} maxLength={30} className={inputClass} />
          </Field>
          <Field label="Endereço" className="sm:col-span-2">
            <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={inputClass} />
          </Field>
        </div>
      </Card>

      <Card title="Regras de agendamento" icon={<Settings className="w-4 h-4 text-rose-400" />}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Grade de horários" hint="De quanto em quanto tempo os horários são oferecidos.">
            <select value={form.slotStepMinutes} onChange={(e) => setForm({ ...form, slotStepMinutes: Number(e.target.value) })} className={inputClass}>
              {[10, 15, 20, 30, 45, 60].map((m) => (
                <option key={m} value={m}>
                  a cada {m} min
                </option>
              ))}
            </select>
          </Field>
          <Field label="Intervalo entre atendimentos" hint="Tempo de higienização/preparo da cabine.">
            <select value={form.defaultBufferMinutes} onChange={(e) => setForm({ ...form, defaultBufferMinutes: Number(e.target.value) })} className={inputClass}>
              {[0, 5, 10, 15, 20, 30, 45].map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </Field>
          <Field label="Cancelamento online até (horas antes)" hint="Abaixo disso, o cliente precisa ligar.">
            <input
              type="number"
              min={0}
              max={168}
              value={form.minCancelNoticeHours}
              onChange={(e) => setForm({ ...form, minCancelNoticeHours: Number(e.target.value) })}
              className={inputClass}
            />
          </Field>
        </div>
      </Card>

      {error && <ErrorBox text={error} />}
      <div className="sticky bottom-3 flex items-center justify-end gap-3 bg-slate-950/90 backdrop-blur border border-slate-800 rounded-2xl px-4 py-3">
        <span className="text-xs text-slate-400 mr-auto">{dirty ? 'Você tem alterações não salvas.' : 'Tudo salvo.'}</span>
        <button onClick={() => setForm(settings)} disabled={!dirty || busy} className={ghostBtn}>
          Descartar
        </button>
        <button onClick={save} disabled={!dirty || busy} className={primaryBtn}>
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Salvar alterações
        </button>
      </div>

      <TeamPanel clinicId={clinicId} currentUserId={currentUserId} notify={notify} />
    </div>
  );
}

const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: 'Administrador(a)',
  RECEPTIONIST: 'Recepção',
  PROFESSIONAL: 'Profissional (agenda e fichas)',
  CLIENT: 'Cliente'
};

function TeamPanel({ clinicId, currentUserId, notify }: { clinicId: string; currentUserId: string; notify: (m: string) => void }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('RECEPTIONIST');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const t = await fetchTeam(clinicId);
      setMembers(t.members);
      setInvites(t.invites);
    } catch (e) {
      setError(errMsg(e));
    }
  };
  useEffect(() => {
    load();
  }, [clinicId]);

  const act = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      if (ok) notify(ok);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const invite = () =>
    act(async () => {
      if (!email.trim()) throw new Error('Informe o e-mail da pessoa.');
      const r = await inviteMember(clinicId, email, role);
      setEmail('');
      notify(r === 'MEMBER' ? 'Acesso liberado agora.' : 'Convite criado: o acesso vale quando a pessoa criar a conta com este e-mail e entrar no link da clínica.');
    }, '');

  return (
    <Card
      title="Equipe e acessos"
      icon={<UserPlus className="w-4 h-4 text-rose-400" />}
      subtitle="Quem pode ver a agenda e as fichas. A pessoa precisa ter conta no sistema (ou criar uma com o e-mail convidado)."
    >
      {error && <ErrorBox text={error} />}
      <div className="space-y-1.5">
        {members.map((m) => (
          <div key={m.userId} className="flex flex-wrap items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs">
            <div className="min-w-0 mr-auto">
              <p className="text-white font-semibold truncate">
                {m.fullName} {m.userId === currentUserId && <span className="text-slate-500 font-normal">(você)</span>}
                {!m.isActive && <span className="ml-2 text-[10px] text-slate-500">bloqueado</span>}
              </p>
              <p className="text-slate-500 truncate">{m.email}</p>
            </div>
            <select
              value={m.role}
              disabled={busy}
              onChange={(e) => act(() => setMemberAccess(clinicId, m.userId, e.target.value as UserRole, m.isActive), 'Papel atualizado.')}
              className={inputClass + ' !w-auto'}
            >
              {(['ADMIN', 'RECEPTIONIST', 'PROFESSIONAL'] as UserRole[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
            <button
              disabled={busy}
              onClick={() => window.confirm(`Remover o acesso de equipe de ${m.fullName}? Ela continua como cliente.`) && act(() => setMemberAccess(clinicId, m.userId, 'CLIENT', true), 'Acesso removido.')}
              className="text-slate-400 hover:text-rose-300"
              aria-label="Remover acesso"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {invites.map((i) => (
          <div key={i.id} className="flex items-center gap-2 bg-slate-950/50 border border-dashed border-slate-700 rounded-xl px-3 py-2 text-xs">
            <div className="mr-auto min-w-0">
              <p className="text-slate-200 truncate">{i.email}</p>
              <p className="text-slate-500">Convite pendente · {ROLE_LABEL[i.role]}</p>
            </div>
            <button onClick={() => act(() => revokeInvite(i.id), 'Convite cancelado.')} disabled={busy} className="text-slate-400 hover:text-rose-300" aria-label="Cancelar convite">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Convidar pessoa" className="flex-1 min-w-[200px]">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@exemplo.com" className={inputClass} />
        </Field>
        <Field label="Papel">
          <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} className={inputClass}>
            {(['RECEPTIONIST', 'PROFESSIONAL', 'ADMIN'] as UserRole[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </Field>
        <button onClick={invite} disabled={busy} className={primaryBtn}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />} Convidar
        </button>
      </div>
    </Card>
  );
}
