import React, { useState } from 'react';
import { Check, Copy, Loader2 } from 'lucide-react';
import type { NewClientInput } from '../../services/api';
import { isValidCpf, maskCpf, maskPhone, onlyDigits } from '../../lib/format';
import { Field, Modal, errMsg, ghostBtn, inputClass, primaryBtn, Toggle } from '../admin/ui';

interface Props {
  onClose: () => void;
  /** Cria o cliente e devolve o id e a senha provisória. */
  onCreate: (input: NewClientInput) => Promise<{ clientId: string; temporaryPassword: string }>;
  /** Chamado depois do cadastro (ex.: já selecionar o cliente no agendamento). */
  onCreated?: (clientId: string) => void;
}

/** Cadastro do cliente pela equipe: só dados básicos, sem nada de saúde. */
export function NewClientModal({ onClose, onCreate, onCreated }: Props) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [cpf, setCpf] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [notes, setNotes] = useState('');
  const [optInWhatsapp, setOptInWhatsapp] = useState(true);
  const [optInEmail, setOptInEmail] = useState(true);
  const [lgpd, setLgpd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ clientId: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async () => {
    setError(null);
    if (fullName.trim().length < 3) return setError('Informe o nome completo.');
    if (onlyDigits(phone).length < 10) return setError('Informe um telefone/WhatsApp com DDD.');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Informe um e-mail válido: é com ele que o cliente entra no sistema.');
    if (cpf && !isValidCpf(cpf)) return setError('CPF inválido. Deixe em branco se não quiser informar.');
    if (!lgpd) return setError('Confirme que o cliente autorizou o uso dos dados (LGPD).');

    setSaving(true);
    try {
      const r = await onCreate({
        fullName: fullName.trim(),
        phone: phone.trim(),
        email: email.trim().toLowerCase(),
        cpf: cpf ? maskCpf(cpf) : undefined,
        birthDate: birthDate || undefined,
        notes: notes.trim() || undefined,
        optInWhatsapp,
        optInEmail
      });
      setCreated({ clientId: r.clientId, password: r.temporaryPassword });
      onCreated?.(r.clientId);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  if (created) {
    return (
      <Modal title="Cliente cadastrado" onClose={onClose} footer={<button className={primaryBtn} onClick={onClose}>Concluir</button>}>
        <div className="space-y-3 text-xs text-slate-300">
          <p>
            <strong className="text-white">{fullName}</strong> já pode ser agendado(a). Para o cliente entrar no sistema, passe a
            senha provisória abaixo (ele troca no primeiro acesso). Ela <strong>não será exibida de novo</strong>.
          </p>
          <div className="flex items-center justify-between gap-3 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5">
            <div>
              <div className="text-[11px] text-slate-500">Login: {email}</div>
              <div className="font-mono text-sm text-white tracking-wide">{created.password}</div>
            </div>
            <button
              className={ghostBtn}
              onClick={() => {
                navigator.clipboard?.writeText(created.password);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copiado' : 'Copiar'}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Novo cliente"
      subtitle="Cadastro básico — nenhum dado de saúde é coletado."
      onClose={onClose}
      footer={
        <>
          <button className={ghostBtn} onClick={onClose} disabled={saving}>Cancelar</button>
          <button className={primaryBtn} onClick={submit} disabled={saving}>
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Cadastrar cliente
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <div className="text-xs text-rose-300 bg-rose-950/40 border border-rose-500/30 rounded-lg px-3 py-2">{error}</div>}
        <Field label="Nome completo *">
          <input className={inputClass} value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Telefone / WhatsApp *">
            <input className={inputClass} inputMode="tel" value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} placeholder="(11) 98765-4321" />
          </Field>
          <Field label="E-mail *" hint="Usado no login do cliente.">
            <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="CPF (opcional)">
            <input className={inputClass} inputMode="numeric" value={cpf} onChange={(e) => setCpf(maskCpf(e.target.value))} placeholder="000.000.000-00" />
          </Field>
          <Field label="Nascimento (opcional)">
            <input className={inputClass} type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Observação interna (opcional)" hint="Só a equipe vê. Não registre informações de saúde aqui.">
          <textarea className={inputClass} rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="space-y-2.5 border-t border-slate-800 pt-3">
          <Toggle checked={optInWhatsapp} onChange={setOptInWhatsapp} label="Receber avisos por WhatsApp" />
          <Toggle checked={optInEmail} onChange={setOptInEmail} label="Receber avisos por e-mail" />
          <label className="flex items-start gap-2 text-[11px] text-slate-400 cursor-pointer pt-1">
            <input type="checkbox" className="mt-0.5 accent-rose-500" checked={lgpd} onChange={(e) => setLgpd(e.target.checked)} />
            O cliente autorizou o tratamento destes dados para agendamentos e avisos (LGPD, Lei 13.709/2018).
          </label>
        </div>
      </div>
    </Modal>
  );
}
