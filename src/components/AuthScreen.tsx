import React, { useState } from 'react';
import { Sparkles, LogIn, UserPlus, Loader2, MailCheck } from 'lucide-react';
import { signIn, signUp } from '../services/api';

interface AuthScreenProps {
  clinicName?: string | null;
}

export function AuthScreen({ clinicName }: AuthScreenProps) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmEmailSent, setConfirmEmailSent] = useState(false);

  const inputClass =
    'w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-rose-500';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'login') {
        await signIn(email.trim(), password);
        // O App percebe a sessão via onAuthStateChange.
      } else {
        if (password.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.');
        const { needsEmailConfirmation } = await signUp({
          email: email.trim(),
          password,
          fullName: fullName.trim(),
          phone: phone.trim()
        });
        if (needsEmailConfirmation) setConfirmEmailSent(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível concluir.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 font-sans">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-pink-500 via-rose-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-pink-500/20">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-lg text-white tracking-tight">{clinicName ?? 'Aesthetiq'}</h1>
            <p className="text-[11px] text-slate-400">Agendamento Biomédico & Gestão de Cabines</p>
          </div>
        </div>

        {confirmEmailSent ? (
          <div className="text-center space-y-3 py-4">
            <MailCheck className="w-10 h-10 text-emerald-400 mx-auto" />
            <h2 className="text-base font-bold text-white">Confirme seu e-mail</h2>
            <p className="text-xs text-slate-300 leading-relaxed">
              Enviamos um link de confirmação para <strong>{email}</strong>. Depois de confirmar, volte aqui e entre.
            </p>
            <button
              onClick={() => {
                setConfirmEmailSent(false);
                setMode('login');
              }}
              className="text-xs text-rose-400 hover:text-rose-300 font-semibold"
            >
              Ir para o login
            </button>
          </div>
        ) : (
          <>
            <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 mb-5 text-xs font-semibold">
              {(['login', 'signup'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m);
                    setError(null);
                  }}
                  className={`flex-1 py-2 rounded-lg transition-all ${
                    mode === m ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {m === 'login' ? 'Entrar' : 'Criar conta'}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              {mode === 'signup' && (
                <>
                  <input
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Nome completo"
                    autoComplete="name"
                    className={inputClass}
                  />
                  <input
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="WhatsApp com DDD (ex: +55 11 98765-4321)"
                    autoComplete="tel"
                    className={inputClass}
                  />
                </>
              )}
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="E-mail"
                autoComplete="email"
                className={inputClass}
              />
              <input
                required
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Senha"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                className={inputClass}
              />

              {mode === 'signup' && (
                <label className="flex items-start gap-2.5 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="mt-0.5 rounded accent-rose-500"
                  />
                  <span className="text-[11px] text-slate-400 leading-relaxed">
                    Concordo com o tratamento dos meus dados pessoais para agendamento e atendimento, conforme a Lei
                    Geral de Proteção de Dados (Lei 13.709/2018).
                  </span>
                </label>
              )}

              {error && (
                <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || (mode === 'signup' && !consent)}
                className={`w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all ${
                  loading || (mode === 'signup' && !consent)
                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    : 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30'
                }`}
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : mode === 'login' ? (
                  <LogIn className="w-4 h-4" />
                ) : (
                  <UserPlus className="w-4 h-4" />
                )}
                {mode === 'login' ? 'Entrar' : 'Criar minha conta'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
