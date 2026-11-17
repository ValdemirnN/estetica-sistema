import React, { useState } from 'react';
import { Loader2, Lock } from 'lucide-react';
import { completeFirstAccess } from '../../services/api';
import { Field, errMsg, inputClass, primaryBtn } from '../admin/ui';

/** Cliente cadastrado pela equipe: precisa trocar a senha provisória antes de usar o sistema. */
export function FirstAccessPasswordModal({ onDone, onSignOut }: { onDone: () => void; onSignOut: () => void }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (pw.length < 8) return setError('A senha precisa ter pelo menos 8 caracteres.');
    if (pw !== pw2) return setError('As senhas não conferem.');
    setSaving(true);
    try {
      await completeFirstAccess(pw);
      onDone();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-2xl">
        <div className="flex items-center gap-2 text-white font-bold">
          <Lock className="w-4 h-4 text-rose-400" /> Crie sua senha
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
          Você entrou com uma senha provisória. Defina agora uma senha só sua para continuar.
        </p>
        {error && <div className="text-xs text-rose-300 bg-rose-950/40 border border-rose-500/30 rounded-lg px-3 py-2">{error}</div>}
        <Field label="Nova senha">
          <input type="password" className={inputClass} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" autoFocus />
        </Field>
        <Field label="Repita a nova senha">
          <input type="password" className={inputClass} value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
        </Field>
        <div className="flex items-center justify-between gap-2 pt-1">
          <button type="button" onClick={onSignOut} className="text-xs text-slate-400 hover:text-white">Sair</button>
          <button type="submit" className={primaryBtn} disabled={saving}>
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Salvar senha
          </button>
        </div>
      </form>
    </div>
  );
}
