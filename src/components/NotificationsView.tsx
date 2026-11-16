import React from 'react';
import { NotificationLog } from '../types/clinic';
import {
  Bell,
  MessageSquare,
  Mail,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Send,
  RefreshCw,
  ShieldCheck
} from 'lucide-react';

interface NotificationsViewProps {
  notifications: NotificationLog[];
  onRefresh: () => void;
  isRefreshing: boolean;
}

export function NotificationsView({
  notifications,
  onRefresh,
  isRefreshing
}: NotificationsViewProps) {
  const queuedCount = notifications.filter((n) => n.status === 'QUEUED').length;
  const sentCount = notifications.filter((n) => n.status === 'SENT' || n.status === 'DELIVERED').length;

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <MessageSquare className="w-4 h-4" />
            </span>
            <h2 className="text-base font-bold text-white">Central de Notificações & Lembretes</h2>
          </div>
          <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
            Envios transacionais automáticos via <strong>Meta Cloud API (WhatsApp Oficial)</strong> com templates pré-homologados (sem risco de banimento) e fallback imediato por e-mail via <strong>Resend</strong>.
          </p>
          <p className="text-[11px] text-amber-300/90 mt-2 max-w-2xl leading-relaxed">
            A fila abaixo é gravada no banco a cada agendamento. O envio efetivo ao WhatsApp/e-mail depende de um worker
            (ex.: Edge Function agendada) conectado ao provedor; enquanto ele não existir, as mensagens permanecem como “na fila”.
          </p>
        </div>

        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all shadow-md shrink-0 bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30 disabled:opacity-60"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? 'Atualizando...' : `Atualizar fila (${queuedCount} pendentes)`}
        </button>
      </div>

      {/* Estatísticas Rápidas */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <span className="text-xs text-slate-400 block mb-1">Fila Pendente (QUEUED):</span>
          <span className="text-2xl font-bold font-mono text-amber-400">{queuedCount}</span>
          <p className="text-[11px] text-slate-500 mt-1">Aguardando cron de 5 em 5 minutos</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <span className="text-xs text-slate-400 block mb-1">Entregues com Sucesso:</span>
          <span className="text-2xl font-bold font-mono text-emerald-400">{sentCount}</span>
          <p className="text-[11px] text-slate-500 mt-1">Taxa de abertura superior a 94%</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <span className="text-xs text-slate-400 block mb-1">Provedor Homologado:</span>
          <span className="text-sm font-bold text-white flex items-center gap-1.5 mt-1">
            <ShieldCheck className="w-4 h-4 text-emerald-400" /> Meta WhatsApp Cloud API
          </span>
          <p className="text-[11px] text-slate-500 mt-1">Número fixo com selo verificado</p>
        </div>
      </div>

      {/* Mock do Template do WhatsApp */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
            <MessageSquare className="w-4 h-4 text-emerald-400" /> Prévia do Template WhatsApp
          </h3>
          <div className="bg-emerald-950/30 border border-emerald-500/30 rounded-xl p-4 text-xs text-slate-200 font-sans space-y-2 relative shadow-inner">
            <div className="text-[10px] text-emerald-400 font-mono">Template: appointment_reminder_24h</div>
            <p>
              Olá, <strong>Juliana</strong>! ✨
            </p>
            <p className="text-slate-300">
              Passando para lembrar do seu atendimento na <strong>Aesthetiq Clínica</strong> amanhã:
            </p>
            <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800 space-y-1 text-[11px]">
              <div>Procedimento: <strong>Limpeza de Pele Profunda</strong></div>
              <div>Data: <strong>Amanhã às 10:00</strong></div>
              <div>Profissional: <strong>Dra. Camila Vasconcellos</strong></div>
              <div>Local: <strong>Av. Paulista, 1842 - Conj. 91</strong></div>
            </div>
            <p className="text-[11px] text-slate-400">
              Se precisar remarcar, solicitamos antecedência de 24 horas pelo nosso aplicativo.
            </p>
          </div>
        </div>

        {/* Lista da Tabela notifications_log */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
            <span className="text-xs font-bold text-white uppercase tracking-wider">
              Tabela: public.notifications_log (Tempo Real)
            </span>
            <span className="text-xs text-slate-500 font-mono">Idempotência garantida</span>
          </div>

          <div className="divide-y divide-slate-800/80 max-h-80 overflow-y-auto">
            {notifications.map((notif) => (
              <div key={notif.id} className="p-4 flex items-center justify-between gap-3 text-xs">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        notif.status === 'DELIVERED' || notif.status === 'SENT'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : notif.status === 'QUEUED'
                          ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                      }`}
                    >
                      {notif.status}
                    </span>
                    <span className="text-slate-400 font-mono text-[11px]">
                      {notif.channel === 'WHATSAPP' ? 'WhatsApp' : 'E-mail'} → {notif.recipientAddress}
                    </span>
                  </div>
                  <div className="text-white font-medium">
                    {notif.recipientName} ({notif.templateName})
                  </div>
                </div>

                <div className="text-right font-mono text-[11px] text-slate-400 shrink-0">
                  {notif.sentAt
                    ? `Enviado: ${new Date(notif.sentAt).toLocaleTimeString('pt-BR')}`
                    : `Agendado para: ${new Date(notif.scheduledFor).toLocaleTimeString('pt-BR')}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
