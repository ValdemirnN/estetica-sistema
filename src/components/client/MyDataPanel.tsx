import React, { useEffect, useState } from 'react';
import { Download, Loader2, ShieldCheck, Trash2 } from 'lucide-react';
import { UserProfile } from '../../types/clinic';
import {
  DeletionRequest,
  MyProfileInput,
  cancelAccountDeletionRequest,
  fetchMyDeletionRequest,
  requestAccountDeletion
} from '../../services/api';
import { Field, Toggle, errMsg, ghostBtn, inputClass, primaryBtn } from '../admin/ui';
import { maskPhone, onlyDigits } from '../../lib/format';

interface Props {
  currentUser: UserProfile;
  clinicId: string;
  onExportData: () => void;
  /** Salva no banco e recarrega o perfil; lança erro com mensagem legível se falhar. */
  onSaveProfile: (input: MyProfileInput) => Promise<void>;
  notify: (msg: string) => void;
}

export function MyDataPanel({ currentUser, clinicId, onExportData, onSaveProfile, notify }: Props) {
  const [fullName, setFullName] = useState(currentUser.fullName);
  const [phone, setPhone] = useState(currentUser.phone ? maskPhone(currentUser.phone) : '');
  const [optWa, setOptWa] = useState(currentUser.optInWhatsapp);
  const [optMail, setOptMail] = useState(currentUser.optInEmail);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [request, setRequest] = useState<DeletionRequest | null>(null);
  const [loadingReq, setLoadingReq] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [reason, setReason] = useState('');
  const [busyDelete, setBusyDelete] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchMyDeletionRequest(clinicId)
      .then((r) => alive && setRequest(r))
      .catch(() => {})
      .finally(() => alive && setLoadingReq(false));
    return () => {
      alive = false;
    };
  }, [clinicId]);

  const dirty =
    fullName.trim() !== currentUser.fullName ||
    onlyDigits(phone) !== onlyDigits(currentUser.phone) ||
    optWa !== currentUser.optInWhatsapp ||
    optMail !== currentUser.optInEmail;

  const save = async () => {
    setFormError(null);
    if (fullName.trim().length < 3) return setFormError('Informe seu nome completo.');
    const d = onlyDigits(phone);
    if (d.length < 10 || d.length > 13) return setFormError('Informe um telefone válido com DDD.');
    setSaving(true);
    try {
      await onSaveProfile({ fullName: fullName.trim(), phone: phone.trim(), optInWhatsapp: optWa, optInEmail: optMail });
      notify('Cadastro atualizado.');
    } catch (e) {
      setFormError(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const askDeletion = async () => {
    setBusyDelete(true);
    try {
      await requestAccountDeletion(clinicId, reason);
      setRequest(await fetchMyDeletionRequest(clinicId));
      setConfirmingDelete(false);
      setReason('');
      notify('Pedido de exclusão registrado. A clínica vai analisá-lo.');
    } catch (e) {
      notify(errMsg(e));
    } finally {
      setBusyDelete(false);
    }
  };

  const withdrawDeletion = async () => {
    setBusyDelete(true);
    try {
      await cancelAccountDeletionRequest(clinicId);
      setRequest(null);
      notify('Pedido de exclusão cancelado.');
    } catch (e) {
      notify(errMsg(e));
    } finally {
      setBusyDelete(false);
    }
  };

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-rose-400" /> Meus Dados & Privacidade
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Seus dados cadastrais são usados apenas para agendamentos e avisos, conforme a LGPD.
            </p>
          </div>
          <button onClick={onExportData} className={`${ghostBtn} shrink-0`}>
            <Download className="w-3.5 h-3.5" />
            Exportar Dados (JSON)
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Nome completo">
            <input className={inputClass} value={fullName} maxLength={150} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <Field label="Telefone / WhatsApp">
            <input className={inputClass} value={phone} inputMode="tel" onChange={(e) => setPhone(maskPhone(e.target.value))} />
          </Field>
          <Field label="E-mail" hint="O e-mail é o seu login e não pode ser alterado aqui.">
            <input className={inputClass} value={currentUser.email} disabled />
          </Field>
        </div>

        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
          <h4 className="text-xs font-bold text-white">Como quero receber avisos</h4>
          <Toggle checked={optWa} onChange={setOptWa} label="WhatsApp" hint="Confirmações, lembretes e remarcações." />
          <Toggle checked={optMail} onChange={setOptMail} label="E-mail" hint="Usado quando o WhatsApp está desligado ou indisponível." />
          {!optWa && !optMail && (
            <p className="text-[11px] text-amber-300">
              Com os dois desligados você não receberá lembretes dos seus agendamentos. Os avisos já na fila serão cancelados.
            </p>
          )}
        </div>

        {formError && <p className="text-xs text-rose-300">{formError}</p>}
        <div className="flex justify-end">
          <button className={primaryBtn} disabled={!dirty || saving} onClick={save}>
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Salvar alterações
          </button>
        </div>
      </div>

      <div className="bg-slate-900 border border-rose-500/20 rounded-2xl p-6 space-y-3">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Trash2 className="w-4 h-4 text-rose-400" /> Excluir minha conta
        </h3>
        {loadingReq ? (
          <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
        ) : request ? (
          <>
            <p className="text-xs text-slate-300 leading-relaxed">
              Seu pedido de exclusão foi registrado em{' '}
              <strong className="text-white">{new Date(request.requestedAt).toLocaleDateString('pt-BR')}</strong> e está em análise
              pela clínica. Você pode desistir enquanto ele estiver pendente.
            </p>
            <button className={ghostBtn} disabled={busyDelete} onClick={withdrawDeletion}>
              {busyDelete && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Cancelar pedido de exclusão
            </button>
          </>
        ) : confirmingDelete ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-300 leading-relaxed">
              A clínica receberá o seu pedido e apagará ou anonimizará seus dados pessoais. Informações que a lei exige guardar
              (como o registro de atendimentos realizados) podem ser mantidas pelo prazo legal. Agendamentos futuros{' '}
              <strong className="text-white">não são cancelados automaticamente</strong>: cancele-os antes, se for o caso.
            </p>
            <Field label="Motivo (opcional)">
              <textarea className={inputClass} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <div className="flex gap-2 justify-end">
              <button className={ghostBtn} disabled={busyDelete} onClick={() => setConfirmingDelete(false)}>
                Voltar
              </button>
              <button
                disabled={busyDelete}
                onClick={askDeletion}
                className="px-4 py-2 rounded-xl bg-rose-700 hover:bg-rose-600 text-xs font-semibold text-white disabled:opacity-50 flex items-center gap-2"
              >
                {busyDelete && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Solicitar exclusão
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-xs text-slate-400 leading-relaxed">
              Você pode pedir a exclusão dos seus dados a qualquer momento (LGPD, art. 18).
            </p>
            <button className={ghostBtn} onClick={() => setConfirmingDelete(true)}>
              Solicitar exclusão da conta
            </button>
          </>
        )}
      </div>
    </div>
  );
}
