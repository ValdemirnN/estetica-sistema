import React, { useMemo, useState } from 'react';
import {
  Appointment,
  ClinicSettings,
  NotificationLog,
  NotificationStatus,
  Professional,
  Service
} from '../types/clinic';
import {
  TEMPLATE_KEYS,
  TEMPLATE_LABEL,
  TemplateKey,
  WHATSAPP_BODIES,
  isTemplateKey,
  renderEmail,
  renderWhatsapp,
  whatsappParams
} from '../lib/notificationTemplates';
import { Field, inputClass } from './admin/ui';
import { AlertTriangle, CheckCheck, Eye, Loader2, Mail, MessageSquare, RefreshCw, RotateCcw } from 'lucide-react';

interface Props {
  notifications: NotificationLog[];
  appointments: Appointment[];
  services: Service[];
  professionals: Professional[];
  settings: ClinicSettings;
  onRefresh: () => void;
  isRefreshing: boolean;
  /** Recoloca na fila um aviso FAILED/SKIPPED. */
  onRequeue: (id: string) => Promise<void>;
}

type Filter = 'ALL' | 'QUEUED' | 'SENT' | 'FAILED' | 'SKIPPED';

const STATUS_LABEL: Record<NotificationStatus, string> = {
  QUEUED: 'Na fila',
  SENT: 'Enviado',
  DELIVERED: 'Entregue',
  READ: 'Lido',
  FAILED: 'Falhou',
  SKIPPED: 'Descartado'
};

const STATUS_STYLE: Record<NotificationStatus, string> = {
  QUEUED: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  SENT: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  DELIVERED: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  READ: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
  FAILED: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  SKIPPED: 'bg-slate-500/10 text-slate-300 border-slate-500/30'
};

const when = (iso?: string) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

export function NotificationsView({ notifications, appointments, services, professionals, settings, onRefresh, isRefreshing, onRequeue }: Props) {
  const [filter, setFilter] = useState<Filter>('ALL');
  const [busyId, setBusyId] = useState<string | null>(null);

  // ---- Números e alerta de fila parada ----
  const count = (f: (n: NotificationLog) => boolean) => notifications.filter(f).length;
  const queued = count((n) => n.status === 'QUEUED');
  const sent = count((n) => n.status === 'SENT');
  const delivered = count((n) => n.status === 'DELIVERED' || n.status === 'READ');
  const failed = count((n) => n.status === 'FAILED');
  const stale = notifications.filter((n) => n.status === 'QUEUED' && Date.now() - new Date(n.scheduledFor).getTime() > 30 * 60000).length;

  const shown = notifications.filter((n) => {
    if (filter === 'ALL') return true;
    if (filter === 'SENT') return n.status === 'SENT' || n.status === 'DELIVERED' || n.status === 'READ';
    return n.status === filter;
  });

  // ---- Prévia com um agendamento verdadeiro ----
  const candidates = useMemo(() => {
    const now = Date.now();
    const upcoming = appointments
      .filter((a) => (a.status === 'CONFIRMED' || a.status === 'PENDING') && new Date(a.startTime).getTime() > now)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    const recent = appointments
      .filter((a) => !upcoming.includes(a))
      .sort((a, b) => b.startTime.localeCompare(a.startTime))
      .slice(0, 20);
    return [...upcoming.slice(0, 30), ...recent];
  }, [appointments]);

  const [aptId, setAptId] = useState('');
  const [template, setTemplate] = useState<TemplateKey>('appointment_reminder_24h');
  const apt = candidates.find((a) => a.id === aptId) ?? candidates[0];

  const preview = useMemo(() => {
    if (!apt) return null;
    const data = {
      clientName: apt.clientName,
      clinica: settings.name,
      procedimento: services.find((s) => s.id === apt.serviceId)?.name ?? 'Procedimento',
      horario: apt.startTime,
      profissional: professionals.find((p) => p.id === apt.professionalId)?.name ?? ''
    };
    return { whatsapp: renderWhatsapp(template, data), params: whatsappParams(data), email: renderEmail(template, data) };
  }, [apt, template, settings.name, services, professionals]);

  const requeue = async (id: string) => {
    setBusyId(id);
    try {
      await onRequeue(id);
    } finally {
      setBusyId(null);
    }
  };

  const filters: { key: Filter; label: string }[] = [
    { key: 'ALL', label: `Todos (${notifications.length})` },
    { key: 'QUEUED', label: `Na fila (${queued})` },
    { key: 'SENT', label: `Enviados (${sent + delivered})` },
    { key: 'FAILED', label: `Falhas (${failed})` },
    { key: 'SKIPPED', label: `Descartados (${count((n) => n.status === 'SKIPPED')})` }
  ];

  return (
    <div className="space-y-6">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <MessageSquare className="w-4 h-4" />
            </span>
            <h2 className="text-base font-bold text-white">Central de Comunicação</h2>
          </div>
          <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
            Confirmação, remarcação e lembretes de 24h e 2h saem por <strong>WhatsApp</strong> (modelos aprovados na Meta) e, se o
            WhatsApp falhar ou o cliente preferir, por <strong>e-mail</strong>. Falhas temporárias são tentadas de novo; quem desligou
            os avisos em “Meus Dados & Privacidade” não recebe nada.
          </p>
        </div>
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 shrink-0 bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-60"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? 'Atualizando...' : 'Atualizar'}
        </button>
      </div>

      {stale > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-xs text-amber-200 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            {stale} aviso(s) estão na fila há mais de 30 minutos. O envio automático pode estar parado: confira o agendador
            (workflow “notify-worker” no GitHub Actions ou o cron da Vercel) e as variáveis de WhatsApp/e-mail.
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Na fila', value: queued, color: 'text-amber-400' },
          { label: 'Enviados', value: sent, color: 'text-emerald-400' },
          { label: 'Entregues / lidos', value: delivered, color: 'text-sky-300' },
          { label: 'Falhas', value: failed, color: 'text-rose-400' }
        ].map((k) => (
          <div key={k.label} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <span className="text-xs text-slate-400 block mb-1">{k.label}</span>
            <span className={`text-2xl font-bold font-mono ${k.color}`}>{k.value}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Prévia com dados reais */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
            <Eye className="w-4 h-4 text-emerald-400" /> Prévia com um agendamento real
          </h3>
          {candidates.length === 0 ? (
            <p className="text-[11px] text-slate-400">A prévia aparece aqui assim que houver um agendamento.</p>
          ) : (
            <>
              <Field label="Modelo">
                <select className={inputClass} value={template} onChange={(e) => setTemplate(e.target.value as TemplateKey)}>
                  {TEMPLATE_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {TEMPLATE_LABEL[k]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Agendamento">
                <select className={inputClass} value={apt?.id ?? ''} onChange={(e) => setAptId(e.target.value)}>
                  {candidates.map((a) => (
                    <option key={a.id} value={a.id}>
                      {when(a.startTime)} — {a.clientName} ({a.status})
                    </option>
                  ))}
                </select>
              </Field>

              {preview && (
                <>
                  <div className="bg-emerald-950/30 border border-emerald-500/30 rounded-xl p-4 text-xs text-slate-200 space-y-2">
                    <div className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                      <MessageSquare className="w-3 h-3" /> WhatsApp · {template}
                    </div>
                    <p className="leading-relaxed">{preview.whatsapp}</p>
                  </div>
                  <details className="text-[11px] text-slate-400">
                    <summary className="cursor-pointer text-slate-300">Variáveis enviadas à Meta</summary>
                    <ol className="mt-2 space-y-1 font-mono">
                      {preview.params.map((p, i) => (
                        <li key={i}>
                          <span className="text-emerald-400">{`{{${i + 1}}}`}</span> {p}
                        </li>
                      ))}
                    </ol>
                    <p className="mt-2 text-slate-500">Texto do modelo a cadastrar na Meta:</p>
                    <p className="font-mono text-slate-300 mt-1">{WHATSAPP_BODIES[template]}</p>
                  </details>
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs text-slate-200 space-y-2">
                    <div className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                      <Mail className="w-3 h-3" /> E-mail (fallback)
                    </div>
                    <p className="font-semibold text-white">{preview.email.subject}</p>
                    <p className="whitespace-pre-line text-slate-300 leading-relaxed">{preview.email.text}</p>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Log real */}
        <div className="lg:col-span-3 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-800 bg-slate-950 space-y-2">
            <span className="text-xs font-bold text-white uppercase tracking-wider">Log de envios</span>
            <div className="flex flex-wrap gap-1.5">
              {filters.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                    filter === f.key ? 'bg-rose-600 text-white border-rose-500' : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-slate-800/80 max-h-[32rem] overflow-y-auto">
            {shown.length === 0 && <p className="p-6 text-xs text-slate-500 text-center">Nenhum aviso neste filtro.</p>}
            {shown.map((n) => (
              <div key={n.id} className="p-4 flex items-start justify-between gap-3 text-xs">
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${STATUS_STYLE[n.status]}`}>{STATUS_LABEL[n.status]}</span>
                    <span className="text-slate-400 text-[11px] flex items-center gap-1">
                      {n.channel === 'WHATSAPP' ? <MessageSquare className="w-3 h-3" /> : <Mail className="w-3 h-3" />}
                      {n.channel === 'WHATSAPP' ? 'WhatsApp' : 'E-mail'}
                    </span>
                    {n.fallbackFrom && <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/30">WhatsApp → e-mail</span>}
                    {n.readAt && <CheckCheck className="w-3.5 h-3.5 text-sky-400" aria-label="Lido" />}
                  </div>
                  <div className="text-white font-medium truncate">
                    {n.recipientName} · {isTemplateKey(n.templateName) ? TEMPLATE_LABEL[n.templateName] : n.templateName}
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono truncate">{n.recipientAddress}</div>
                  {n.errorMessage && (
                    <div className={`text-[11px] ${n.status === 'FAILED' ? 'text-rose-300' : 'text-slate-400'}`}>{n.errorMessage}</div>
                  )}
                </div>

                <div className="text-right text-[11px] text-slate-400 shrink-0 space-y-1">
                  <div>
                    {n.status === 'QUEUED' ? 'Agendado: ' : n.sentAt ? 'Enviado: ' : 'Previsto: '}
                    {when(n.status === 'QUEUED' ? n.scheduledFor : n.sentAt ?? n.scheduledFor)}
                  </div>
                  {n.retryCount > 0 && <div>Tentativas: {n.retryCount}</div>}
                  {n.deliveredAt && <div>Entregue: {when(n.deliveredAt)}</div>}
                  {n.readAt && <div>Lido: {when(n.readAt)}</div>}
                  {(n.status === 'FAILED' || n.status === 'SKIPPED') && (
                    <button
                      onClick={() => requeue(n.id)}
                      disabled={busyId === n.id}
                      className="mt-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold flex items-center gap-1.5 disabled:opacity-50 ml-auto"
                    >
                      {busyId === n.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                      Reenviar
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
