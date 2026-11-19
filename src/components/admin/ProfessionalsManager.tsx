import React, { useState } from 'react';
import { CalendarOff, Loader2, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { DayOfWeek, Leave, Professional, Service, WorkingHours } from '../../types/clinic';
import {
  ProfessionalInput,
  addLeave,
  defaultWorkingHours,
  deleteLeave,
  deleteProfessional,
  saveProfessional
} from '../../services/api';
import { formatLocalDate, formatLocalTime } from '../../services/slotCalculator';
import { Avatar, Field, ImageField, Modal, Toggle, errMsg, ghostBtn, inputClass, primaryBtn } from './ui';
import { ErrorBox } from './ServicesManager';

interface Props {
  clinicId: string;
  /** Jornada padrão da clínica (modelo). Sem valor, usa seg–sex 09–18 com almoço. */
  defaultHours?: WorkingHours[];
  professionals: Professional[];
  services: Service[];
  leaves: Leave[];
  onChanged: () => Promise<void>;
  notify: (msg: string) => void;
}

const DAYS: { d: DayOfWeek; label: string; short: string }[] = [
  { d: 1, label: 'Segunda-feira', short: 'Seg' },
  { d: 2, label: 'Terça-feira', short: 'Ter' },
  { d: 3, label: 'Quarta-feira', short: 'Qua' },
  { d: 4, label: 'Quinta-feira', short: 'Qui' },
  { d: 5, label: 'Sexta-feira', short: 'Sex' },
  { d: 6, label: 'Sábado', short: 'Sáb' },
  { d: 0, label: 'Domingo', short: 'Dom' }
];

const COLORS = ['#ec4899', '#8b5cf6', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#14b8a6', '#6366f1'];

type Tab = 'dados' | 'procedimentos' | 'jornada' | 'bloqueios';

const summarize = (hours: WorkingHours[]) => {
  const active = DAYS.filter(({ d }) => hours.find((h) => h.dayOfWeek === d && h.isActive));
  if (!active.length) return 'Sem jornada cadastrada';
  return active.map(({ d, short }) => {
    const h = hours.find((x) => x.dayOfWeek === d)!;
    return `${short} ${h.startTime}–${h.endTime}`;
  }).join(' · ');
};

const emptyPro = (colorIdx: number, defaultHours?: WorkingHours[]): ProfessionalInput => ({
  name: '',
  title: '',
  registryNumber: '',
  bio: '',
  colorHex: COLORS[colorIdx % COLORS.length],
  avatarUrl: '',
  intervalBufferMinutes: 15,
  isAvailableForAutoAssign: true,
  isActive: true,
  serviceIds: [],
  workingHours: defaultWorkingHours(defaultHours)
});

/** datetime-local (horário de Brasília) -> ISO UTC */
const localToIso = (v: string) => new Date(`${v}:00-03:00`).toISOString();

export function ProfessionalsManager({ clinicId, defaultHours, professionals, services, leaves, onChanged, notify }: Props) {
  const [form, setForm] = useState<ProfessionalInput | null>(null);
  const [tab, setTab] = useState<Tab>('dados');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leaveStart, setLeaveStart] = useState('');
  const [leaveEnd, setLeaveEnd] = useState('');
  const [leaveReason, setLeaveReason] = useState('');

  const activeServices = services.filter((s) => s.isActive);

  const openNew = () => {
    const f = emptyPro(professionals.length, defaultHours);
    f.serviceIds = activeServices.map((s) => s.id);
    setForm(f);
    setTab('dados');
    setError(null);
  };

  const openEdit = (p: Professional) => {
    const hours = defaultWorkingHours().map(
      (d) => p.workingHours.find((w) => w.dayOfWeek === d.dayOfWeek) ?? { ...d, isActive: false }
    );
    setForm({
      id: p.id,
      name: p.name,
      title: p.title,
      registryNumber: p.registryNumber,
      bio: p.bio,
      colorHex: p.colorHex,
      avatarUrl: p.avatarUrl,
      intervalBufferMinutes: p.intervalBufferMinutes,
      isAvailableForAutoAssign: p.isAvailableForAutoAssign,
      isActive: p.isActive,
      serviceIds: p.specialtyServiceIds,
      workingHours: hours
    });
    setTab('dados');
    setError(null);
  };

  const setHour = (d: DayOfWeek, patch: Partial<WorkingHours>) =>
    setForm((f) => f && { ...f, workingHours: f.workingHours.map((w) => (w.dayOfWeek === d ? { ...w, ...patch } : w)) });

  const submit = async () => {
    if (!form) return;
    if (!form.name.trim()) {
      setTab('dados');
      return setError('Informe o nome da profissional.');
    }
    setBusy(true);
    setError(null);
    try {
      await saveProfessional(clinicId, form);
      await onChanged();
      notify(form.id ? 'Profissional atualizada!' : 'Profissional cadastrada!');
      setForm(null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: Professional) => {
    if (!window.confirm(`Excluir ${p.name}? Se ela já tem atendimentos, use "Inativa" em vez de excluir.`)) return;
    setBusy(true);
    try {
      await deleteProfessional(p.id);
      await onChanged();
      notify('Profissional excluída.');
      setForm(null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const copyMonday = () => {
    setForm((f) => {
      if (!f) return f;
      const mon = f.workingHours.find((w) => w.dayOfWeek === 1)!;
      return {
        ...f,
        workingHours: f.workingHours.map((w) =>
          w.dayOfWeek >= 2 && w.dayOfWeek <= 5
            ? { ...w, startTime: mon.startTime, endTime: mon.endTime, breakStartTime: mon.breakStartTime, breakEndTime: mon.breakEndTime }
            : w
        )
      };
    });
  };

  const proLeaves = form?.id ? leaves.filter((l) => l.professionalId === form.id) : [];

  const submitLeave = async () => {
    if (!form?.id) return;
    if (!leaveStart || !leaveEnd) return setError('Informe o início e o fim do bloqueio.');
    setBusy(true);
    setError(null);
    try {
      await addLeave(clinicId, form.id, localToIso(leaveStart), localToIso(leaveEnd), leaveReason);
      await onChanged();
      setLeaveStart('');
      setLeaveEnd('');
      setLeaveReason('');
      notify('Bloqueio cadastrado: esses horários não aparecem mais para os clientes.');
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const removeLeave = async (id: string) => {
    try {
      await deleteLeave(id);
      await onChanged();
      notify('Bloqueio removido.');
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'dados', label: 'Dados' },
    { id: 'procedimentos', label: 'Procedimentos' },
    { id: 'jornada', label: 'Horários de atendimento' },
    { id: 'bloqueios', label: 'Folgas e bloqueios' }
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Users className="w-4 h-4 text-rose-400" /> Profissionais & Horários
          </h3>
          <p className="text-xs text-slate-400 mt-1 max-w-xl">
            Cadastre quem atende, em quais dias e horários, e o que cada uma realiza. Os clientes só enxergam horários livres dentro da jornada que você definir aqui.
          </p>
        </div>
        <button onClick={openNew} className={primaryBtn}>
          <Plus className="w-3.5 h-3.5" /> Nova profissional
        </button>
      </div>

      {professionals.length === 0 ? (
        <div className="bg-slate-900 border border-dashed border-slate-700 rounded-2xl p-8 text-center text-xs text-slate-400 space-y-3">
          <p>Nenhuma profissional cadastrada. Se você mesma atende, cadastre-se aqui também.</p>
          <button onClick={openNew} className={primaryBtn + ' mx-auto'}>
            <Plus className="w-3.5 h-3.5" /> Cadastrar a primeira profissional
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {professionals.map((p) => {
            const noHours = !p.workingHours.some((w) => w.isActive);
            return (
              <div
                key={p.id}
                className={`bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col gap-4 ${p.isActive ? '' : 'opacity-70'}`}
              >
                <div className="flex items-center gap-3">
                  <Avatar name={p.name} url={p.avatarUrl} color={p.colorHex} />
                  <div className="min-w-0">
                    <h4 className="font-bold text-white text-sm truncate">{p.name}</h4>
                    <p className="text-xs text-slate-400 truncate">{p.title || 'Sem especialidade informada'}</p>
                    {p.registryNumber && <span className="text-[10px] text-rose-400 font-mono">{p.registryNumber}</span>}
                  </div>
                  {!p.isActive && (
                    <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">Inativa</span>
                  )}
                </div>
                <div className="text-[11px] bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1.5">
                  <p className={noHours ? 'text-amber-300' : 'text-slate-300'}>{summarize(p.workingHours)}</p>
                  <p className="text-slate-400">
                    {p.specialtyServiceIds.length} procedimento(s) · intervalo de {p.intervalBufferMinutes} min
                  </p>
                </div>
                {noHours && p.isActive && (
                  <p className="text-[11px] text-amber-300/90">Sem dias de atendimento: nenhum horário é oferecido aos clientes.</p>
                )}
                <button onClick={() => openEdit(p)} className={primaryBtn + ' !py-1.5'}>
                  <Pencil className="w-3 h-3" /> Editar dados e horários
                </button>
              </div>
            );
          })}
        </div>
      )}

      {form && (
        <Modal
          size="lg"
          title={form.id ? `Editar ${form.name || 'profissional'}` : 'Nova profissional'}
          onClose={() => !busy && setForm(null)}
          footer={
            <>
              {form.id && (
                <button
                  onClick={() => remove(professionals.find((x) => x.id === form.id)!)}
                  disabled={busy}
                  className="mr-auto px-3 py-2 rounded-xl text-xs font-semibold text-rose-300 hover:bg-rose-500/10 flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Excluir
                </button>
              )}
              <button onClick={() => setForm(null)} disabled={busy} className={ghostBtn}>
                Fechar
              </button>
              <button onClick={submit} disabled={busy} className={primaryBtn}>
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Salvar alterações
              </button>
            </>
          }
        >
          <div className="flex gap-1 overflow-x-auto -mt-1 pb-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap ${
                  tab === t.id ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {error && <ErrorBox text={error} />}

          {tab === 'dados' && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Nome *" className="sm:col-span-2">
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Ex.: Dra. Camila Vasconcellos"
                    maxLength={150}
                    className={inputClass}
                  />
                </Field>
                <Field label="Especialidade / cargo">
                  <input
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="Ex.: Biomédica Esteta"
                    className={inputClass}
                  />
                </Field>
                <Field label="Registro profissional (opcional)">
                  <input
                    value={form.registryNumber}
                    onChange={(e) => setForm({ ...form, registryNumber: e.target.value })}
                    placeholder="Ex.: CRBM-SP 34.892"
                    className={inputClass}
                  />
                </Field>
                <Field label="Apresentação (opcional)" className="sm:col-span-2">
                  <textarea
                    rows={2}
                    value={form.bio}
                    onChange={(e) => setForm({ ...form, bio: e.target.value })}
                    className={inputClass + ' resize-y'}
                  />
                </Field>
              </div>
              <ImageField
                clinicId={clinicId}
                label="Foto (opcional)"
                value={form.avatarUrl}
                onChange={(url) => setForm({ ...form, avatarUrl: url })}
                fallback={<Avatar name={form.name || '?'} color={form.colorHex} size="w-full h-full" />}
              />
              <div>
                <span className="text-xs text-slate-300 font-semibold block mb-1.5">Cor na agenda</span>
                <div className="flex flex-wrap gap-2">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Cor ${c}`}
                      onClick={() => setForm({ ...form, colorHex: c })}
                      style={{ backgroundColor: c }}
                      className={`w-7 h-7 rounded-full border-2 ${form.colorHex === c ? 'border-white' : 'border-transparent'}`}
                    />
                  ))}
                </div>
              </div>
              <Field label="Intervalo de higienização após cada atendimento (min)">
                <input
                  type="number"
                  min={0}
                  max={120}
                  value={form.intervalBufferMinutes}
                  onChange={(e) => setForm({ ...form, intervalBufferMinutes: Number(e.target.value) })}
                  className={inputClass + ' !w-28'}
                />
              </Field>
              <Toggle
                checked={form.isAvailableForAutoAssign}
                onChange={(v) => setForm({ ...form, isAvailableForAutoAssign: v })}
                label='Participa do "Primeiro disponível"'
                hint="Quando o cliente não escolhe profissional, o sistema distribui entre quem tem essa opção."
              />
              <Toggle
                checked={form.isActive}
                onChange={(v) => setForm({ ...form, isActive: v })}
                label="Ativa na agenda"
                hint="Desative em vez de excluir para manter o histórico de atendimentos."
              />
            </div>
          )}

          {tab === 'procedimentos' && (
            <div className="space-y-2">
              <p className="text-xs text-slate-400">Marque os procedimentos que {form.name || 'esta profissional'} realiza.</p>
              {activeServices.length === 0 ? (
                <p className="text-xs text-amber-300">Cadastre procedimentos na aba "Procedimentos & Preços" primeiro.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {activeServices.map((s) => {
                    const checked = form.serviceIds.includes(s.id);
                    return (
                      <label
                        key={s.id}
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer text-xs ${
                          checked ? 'border-rose-500/50 bg-rose-500/10 text-white' : 'border-slate-800 bg-slate-950 text-slate-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          className="accent-rose-500"
                          onChange={() =>
                            setForm({
                              ...form,
                              serviceIds: checked ? form.serviceIds.filter((i) => i !== s.id) : [...form.serviceIds, s.id]
                            })
                          }
                        />
                        <span className="truncate">{s.name}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === 'jornada' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-400">Marque os dias de atendimento e defina início, fim e o intervalo de almoço.</p>
                <button type="button" onClick={copyMonday} className="text-[11px] text-rose-300 hover:text-rose-200 font-semibold">
                  Copiar segunda para ter–sex
                </button>
              </div>
              <div className="space-y-2">
                {DAYS.map(({ d, label }) => {
                  const w = form.workingHours.find((x) => x.dayOfWeek === d)!;
                  return (
                    <div
                      key={d}
                      className={`rounded-xl border p-3 ${w.isActive ? 'border-slate-700 bg-slate-950' : 'border-slate-800/60 bg-slate-950/40'}`}
                    >
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        <label className="flex items-center gap-2 w-36 text-xs font-semibold text-slate-200 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={w.isActive}
                            className="accent-rose-500"
                            onChange={(e) => setHour(d, { isActive: e.target.checked })}
                          />
                          {label}
                        </label>
                        {w.isActive ? (
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-slate-400">
                            <span className="flex items-center gap-1.5">
                              Das
                              <input
                                type="time"
                                value={w.startTime}
                                onChange={(e) => setHour(d, { startTime: e.target.value })}
                                className={inputClass + ' !w-32'}
                              />
                              às
                              <input
                                type="time"
                                value={w.endTime}
                                onChange={(e) => setHour(d, { endTime: e.target.value })}
                                className={inputClass + ' !w-32'}
                              />
                            </span>
                            <span className="flex items-center gap-1.5">
                              Intervalo
                              <input
                                type="time"
                                value={w.breakStartTime ?? ''}
                                onChange={(e) => setHour(d, { breakStartTime: e.target.value || undefined })}
                                className={inputClass + ' !w-32'}
                              />
                              às
                              <input
                                type="time"
                                value={w.breakEndTime ?? ''}
                                onChange={(e) => setHour(d, { breakEndTime: e.target.value || undefined })}
                                className={inputClass + ' !w-32'}
                              />
                            </span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-500">Não atende</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-slate-500">Deixe o intervalo em branco se não houver pausa. Horários em Brasília.</p>
            </div>
          )}

          {tab === 'bloqueios' && (
            <div className="space-y-3">
              {!form.id ? (
                <p className="text-xs text-slate-400">Salve a profissional primeiro para cadastrar folgas, férias ou bloqueios pontuais.</p>
              ) : (
                <>
                  <p className="text-xs text-slate-400">
                    Férias, atestado, curso ou qualquer horário em que ela não atende. Esses períodos somem da grade de horários dos clientes. Salvos na hora.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-slate-950 border border-slate-800 rounded-xl p-3">
                    <Field label="Início">
                      <input type="datetime-local" value={leaveStart} onChange={(e) => setLeaveStart(e.target.value)} className={inputClass} />
                    </Field>
                    <Field label="Fim">
                      <input type="datetime-local" value={leaveEnd} onChange={(e) => setLeaveEnd(e.target.value)} className={inputClass} />
                    </Field>
                    <Field label="Motivo (opcional)" className="sm:col-span-2">
                      <input value={leaveReason} onChange={(e) => setLeaveReason(e.target.value)} placeholder="Ex.: Férias" className={inputClass} />
                    </Field>
                    <button onClick={submitLeave} disabled={busy} className={primaryBtn + ' sm:col-span-2'}>
                      <CalendarOff className="w-3.5 h-3.5" /> Bloquear período
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {proLeaves.length === 0 && <p className="text-xs text-slate-500">Nenhum bloqueio futuro.</p>}
                    {proLeaves.map((l) => (
                      <div key={l.id} className="flex items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs">
                        <span className="text-slate-200">
                          {formatLocalDate(l.startDatetime)} {formatLocalTime(l.startDatetime)} → {formatLocalDate(l.endDatetime)} {formatLocalTime(l.endDatetime)}
                          {l.reason && <span className="text-slate-500"> · {l.reason}</span>}
                        </span>
                        <button onClick={() => removeLeave(l.id)} className="text-slate-400 hover:text-rose-300" aria-label="Remover bloqueio">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
