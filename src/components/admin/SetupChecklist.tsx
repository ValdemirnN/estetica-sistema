import React, { useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, Copy, Globe, Loader2, Lock, PauseCircle, Wand2 } from 'lucide-react';
import { ClinicSettings, Professional, Service } from '../../types/clinic';
import { loadClinicTemplate, setBookingPublished } from '../../services/api';
import { buildClinicUrl } from '../../lib/tenant';
import { errMsg, ghostBtn, primaryBtn } from './ui';
import { ErrorBox } from './ServicesManager';

export type SetupTarget = 'professionals' | 'services' | 'settings';

interface Props {
  clinicId: string;
  settings: ClinicSettings;
  professionals: Professional[];
  services: Service[];
  goTo: (tab: SetupTarget) => void;
  /** Recarrega catálogo e marca depois de uma mudança. */
  onChanged: () => Promise<void>;
  notify: (msg: string) => void;
}

interface Step {
  done: boolean;
  label: string;
  hint?: string;
  tab: SetupTarget;
}

/**
 * "Primeiros passos": o link de agendamento só pode ser publicado com ao menos
 * 1 profissional, 1 horário e 1 procedimento ativos. O banco confere de novo ao publicar.
 */
export function SetupChecklist({ clinicId, settings, professionals, services, goTo, onChanged, notify }: Props) {
  const [busy, setBusy] = useState<null | 'publish' | 'pause' | 'template'>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const activePros = professionals.filter((p) => p.isActive);
  const inactiveServices = services.filter((s) => !s.isActive).length;

  // Obrigatórios (mesmas regras do banco)
  const required: Step[] = [
    { done: activePros.length > 0, label: 'Cadastre ao menos 1 profissional ativo', tab: 'professionals' },
    {
      done: activePros.some((p) => p.workingHours.some((w) => w.isActive)),
      label: 'Defina ao menos 1 horário de atendimento',
      tab: 'professionals'
    },
    {
      done: services.some((s) => s.isActive),
      label: 'Tenha ao menos 1 procedimento ativo',
      hint: inactiveServices > 0 ? `Você tem ${inactiveServices} procedimento(s) inativo(s): revise preço e duração e ative.` : undefined,
      tab: 'services'
    }
  ];
  // Recomendados (não travam a publicação)
  const recommended: Step[] = [
    {
      done: services.some((s) => s.isActive && activePros.some((p) => p.specialtyServiceIds.includes(s.id))),
      label: 'Vincule os procedimentos a quem realiza',
      hint: 'Sem vínculo, o procedimento não mostra horários para o cliente.',
      tab: 'services'
    },
    {
      done: !!settings.logoUrl || settings.primaryColor.toLowerCase() !== '#e11d48',
      label: 'Personalize logo, cores e textos',
      tab: 'settings'
    }
  ];

  const ready = required.every((s) => s.done);
  const missing = required.filter((s) => !s.done);
  const published = settings.bookingPublished;
  const url = buildClinicUrl(settings.slug);
  const doneCount = required.filter((s) => s.done).length;
  const showTemplate = services.length === 0;

  const run = async (kind: 'publish' | 'pause' | 'template', fn: () => Promise<void>) => {
    setError(null);
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const publish = () =>
    run('publish', async () => {
      await setBookingPublished(clinicId, true);
      await onChanged();
      notify('Link de agendamento publicado!');
    });

  const pause = () => {
    if (!window.confirm('Pausar o agendamento online? Os clientes não conseguirão agendar até você publicar de novo. Agendamentos existentes continuam valendo.')) return;
    return run('pause', async () => {
      await setBookingPublished(clinicId, false);
      await onChanged();
      notify('Agendamento online pausado.');
    });
  };

  const loadTemplate = () =>
    run('template', async () => {
      const r = await loadClinicTemplate(clinicId);
      await onChanged();
      notify(
        r.servicesAdded > 0
          ? `Modelo carregado: ${r.servicesAdded} procedimentos de exemplo (inativos) e horários padrão.`
          : 'Nada novo para carregar: seu catálogo já tem os procedimentos do modelo.'
      );
    });

  const copy = () => {
    navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const StepButton = ({ st, soft }: { st: Step; soft?: boolean }) => (
    <button
      onClick={() => goTo(st.tab)}
      className={`flex items-start gap-2 text-left text-xs px-3 py-2 rounded-xl border transition-colors ${
        st.done
          ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300'
          : soft
            ? 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-600'
            : 'border-slate-700 bg-slate-950 text-slate-200 hover:border-rose-500/50'
      }`}
    >
      {st.done ? (
        <CheckCircle2 className="w-4 h-4 shrink-0 mt-px" />
      ) : (
        <span className="w-4 h-4 rounded-full border border-slate-600 shrink-0 mt-px" />
      )}
      <span>
        {st.label}
        {!st.done && st.hint && <span className="block text-[11px] text-slate-500 mt-0.5">{st.hint}</span>}
      </span>
    </button>
  );

  // Tudo certo e publicado: barra compacta com o link
  if (published && ready) {
    return (
      <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl p-3 flex flex-wrap items-center gap-3">
        <Globe className="w-4 h-4 text-emerald-400 shrink-0" />
        <div className="min-w-0 mr-auto">
          <p className="text-xs font-bold text-white">Agendamento online aberto</p>
          <p className="text-[11px] text-slate-400 font-mono truncate">{url}</p>
        </div>
        <button onClick={copy} className={ghostBtn}>
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copiado' : 'Copiar link'}
        </button>
        <button onClick={pause} disabled={busy !== null} className={ghostBtn}>
          {busy === 'pause' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PauseCircle className="w-3.5 h-3.5" />} Pausar
        </button>
        {error && (
          <div className="w-full">
            <ErrorBox text={error} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border border-rose-500/30 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-white">Primeiros passos para receber agendamentos</h3>
        <span className="text-[11px] text-slate-400">
          {doneCount}/{required.length} obrigatórios
        </span>
      </div>

      {published && !ready && (
        <div className="flex items-start gap-2.5 text-xs bg-amber-500/10 border border-amber-500/30 text-amber-200 rounded-xl p-3">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Seu link está publicado, mas <strong>faltam itens</strong> e os clientes não conseguem agendar: {missing.map((m) => m.label.toLowerCase()).join('; ')}.
          </span>
        </div>
      )}

      {showTemplate && (
        <div className="flex flex-wrap items-center gap-3 text-xs bg-slate-950 border border-dashed border-slate-700 rounded-xl p-3">
          <Wand2 className="w-4 h-4 text-rose-300 shrink-0" />
          <p className="text-slate-300 mr-auto min-w-[14rem]">
            Catálogo vazio? <strong>Carregue o modelo</strong>: procedimentos de exemplo (inativos, você edita preço e duração) e horários padrão de
            segunda a sexta.
          </p>
          <button onClick={loadTemplate} disabled={busy !== null} className={ghostBtn}>
            {busy === 'template' && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Carregar modelo
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {required.map((st) => (
          <StepButton key={st.label} st={st} />
        ))}
      </div>

      <div>
        <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-1.5">Recomendado</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {recommended.map((st) => (
            <StepButton key={st.label} st={st} soft />
          ))}
        </div>
      </div>

      {error && <ErrorBox text={error} />}

      {!published && (
        <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-slate-800">
          <Lock className="w-4 h-4 text-slate-500 shrink-0 mt-3" />
          <p className="text-xs text-slate-400 mr-auto min-w-[14rem] mt-3">
            {ready
              ? 'Tudo pronto. Ao publicar, seus clientes já podem entrar pelo link e agendar.'
              : `O link de agendamento fica bloqueado até você concluir os itens obrigatórios (faltam ${missing.length}).`}
          </p>
          <button onClick={publish} disabled={!ready || busy !== null} className={primaryBtn + ' mt-3'}>
            {busy === 'publish' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />} Publicar link de agendamento
          </button>
        </div>
      )}
    </div>
  );
}
