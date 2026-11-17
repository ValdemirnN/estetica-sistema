import React, { useCallback, useEffect, useState } from 'react';
import { Building2, Check, Copy, ExternalLink, Loader2, LogOut, Plus, Power, ShieldAlert } from 'lucide-react';
import { PlatformClinic } from '../types/clinic';
import { platformCreateClinic, platformListClinics, platformSetClinicActive, signOut } from '../services/api';
import { buildClinicUrl } from '../lib/tenant';
import { COLOR_PRESETS } from '../lib/theme';
import { Field, Modal, errMsg, ghostBtn, inputClass, primaryBtn } from './admin/ui';
import { ErrorBox } from './admin/ServicesManager';

const slugFrom = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

/** Painel de quem aluga o sistema: cria, acompanha e suspende clínicas. */
export function PlatformAdmin({ allowed, onBack }: { allowed: boolean; onBack?: () => void }) {
  const [clinics, setClinics] = useState<PlatformClinic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '', ownerEmail: '', phone: '', primaryColor: COLOR_PRESETS[0].hex });
  const [slugTouched, setSlugTouched] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setClinics(await platformListClinics());
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  if (!allowed) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-3 text-center">
          <ShieldAlert className="w-8 h-8 text-amber-400 mx-auto" />
          <h1 className="text-base font-bold text-white">Clínica não informada</h1>
          <p className="text-xs text-slate-300 leading-relaxed">
            Acesse o sistema pelo endereço da sua clínica (por exemplo, <code className="text-rose-300">?clinica=nome-da-clinica</code> ou o subdomínio
            que você recebeu). Se você administra a plataforma, entre com a conta de administrador.
          </p>
          <button onClick={() => signOut()} className={ghostBtn + ' mx-auto'}>
            <LogOut className="w-3.5 h-3.5" /> Sair
          </button>
        </div>
      </div>
    );
  }

  const create = async () => {
    setError(null);
    if (!form.name.trim() || !form.slug || !form.ownerEmail.trim()) return setError('Preencha nome, endereço e e-mail do dono.');
    setBusy(true);
    try {
      await platformCreateClinic({ ...form, slug: form.slug.trim() });
      setCreating(false);
      setForm({ name: '', slug: '', ownerEmail: '', phone: '', primaryColor: COLOR_PRESETS[0].hex });
      setSlugTouched(false);
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (c: PlatformClinic) => {
    const verb = c.isActive ? 'SUSPENDER' : 'reativar';
    if (!window.confirm(`Deseja ${verb} a clínica "${c.name}"? ${c.isActive ? 'Ninguém conseguirá entrar nem agendar até você reativar.' : ''}`)) return;
    try {
      await platformSetClinicActive(c.id, !c.isActive);
      await load();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const copy = (slug: string) => {
    navigator.clipboard?.writeText(buildClinicUrl(slug));
    setCopied(slug);
    setTimeout(() => setCopied(null), 1800);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      <header className="border-b border-slate-800 bg-slate-900/90">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-rose-400" />
            <span className="font-bold text-white">Plataforma · Clínicas</span>
          </div>
          <div className="flex gap-2">
            {onBack && (
              <button onClick={onBack} className={ghostBtn}>
                Voltar
              </button>
            )}
            <button onClick={() => signOut()} className={ghostBtn}>
              <LogOut className="w-3.5 h-3.5" /> Sair
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-white">Clínicas clientes</h1>
            <p className="text-xs text-slate-400 mt-1 max-w-xl">
              Cada clínica tem seu endereço, sua marca e seus dados totalmente separados. O dono recebe o acesso de administrador ao criar a conta com o e-mail informado.
            </p>
          </div>
          <button onClick={() => { setCreating(true); setError(null); }} className={primaryBtn}>
            <Plus className="w-3.5 h-3.5" /> Nova clínica
          </button>
        </div>

        {error && !creating && <ErrorBox text={error} />}

        {clinics === null ? (
          <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
        ) : (
          <div className="grid gap-3">
            {clinics.map((c) => (
              <div key={c.id} className={`bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center gap-4 ${c.isActive ? '' : 'opacity-60'}`}>
                <span className="w-3 h-10 rounded-full shrink-0" style={{ backgroundColor: c.primaryColor }} />
                <div className="min-w-0 mr-auto">
                  <p className="font-bold text-white text-sm flex items-center gap-2">
                    {c.name}
                    {!c.isActive && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">Suspensa</span>}
                  </p>
                  <p className="text-[11px] text-slate-400 font-mono">{buildClinicUrl(c.slug)}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Dono: {[...c.owners, ...c.pendingOwnerInvites.map((e) => `${e} (aguardando cadastro)`)].join(', ') || '—'}
                  </p>
                </div>
                <div className="text-[11px] text-slate-400 text-right">
                  <p>{c.members} pessoas</p>
                  <p>{c.appointments30d} agendamentos em 30 dias</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => copy(c.slug)} className={ghostBtn + ' !px-3'} aria-label="Copiar link">
                    {copied === c.slug ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <a href={buildClinicUrl(c.slug)} target="_blank" rel="noreferrer" className={ghostBtn + ' !px-3'} aria-label="Abrir clínica">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <button onClick={() => toggle(c)} className={ghostBtn + ' !px-3'} title={c.isActive ? 'Suspender' : 'Reativar'}>
                    <Power className={`w-3.5 h-3.5 ${c.isActive ? 'text-amber-300' : 'text-emerald-400'}`} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {creating && (
        <Modal
          title="Nova clínica"
          subtitle="Cria o espaço da clínica com categorias iniciais. O dono personaliza o resto."
          onClose={() => !busy && setCreating(false)}
          footer={
            <>
              <button onClick={() => setCreating(false)} disabled={busy} className={ghostBtn}>Cancelar</button>
              <button onClick={create} disabled={busy} className={primaryBtn}>
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Criar clínica
              </button>
            </>
          }
        >
          {error && <ErrorBox text={error} />}
          <Field label="Nome da clínica *">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value, slug: slugTouched ? form.slug : slugFrom(e.target.value) })}
              className={inputClass}
            />
          </Field>
          <Field label="Endereço (slug) *" hint={`Link da clínica: ${form.slug ? buildClinicUrl(form.slug) : '…'}`}>
            <input
              value={form.slug}
              onChange={(e) => {
                setSlugTouched(true);
                setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') });
              }}
              maxLength={63}
              className={inputClass + ' font-mono'}
            />
          </Field>
          <Field label="E-mail do dono(a) *" hint="Quando essa pessoa criar a conta com este e-mail (confirmado) e entrar no link da clínica, vira administradora.">
            <input type="email" value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} className={inputClass} />
          </Field>
          <Field label="Telefone / WhatsApp (opcional)">
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputClass} />
          </Field>
          <div>
            <span className="text-xs text-slate-300 font-semibold block mb-1.5">Cor inicial</span>
            <div className="flex flex-wrap gap-2">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  aria-label={c.name}
                  onClick={() => setForm({ ...form, primaryColor: c.hex })}
                  style={{ backgroundColor: c.hex }}
                  className={`w-7 h-7 rounded-full border-2 ${form.primaryColor === c.hex ? 'border-white' : 'border-transparent'}`}
                />
              ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
