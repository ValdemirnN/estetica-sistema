import React, { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid
} from 'recharts';
import { AlertCircle, ArrowDown, ArrowUp, Download, Loader2, Minus, Percent, Save } from 'lucide-react';
import { Appointment, Professional, Service } from '../../types/clinic';
import { formatBRL } from '../../lib/format';
import { localDateKey, todayKey } from '../../lib/dates';
import { fetchCommissions, saveCommission } from '../../services/api';
import {
  PERIOD_LABELS,
  PeriodPreset,
  brDate,
  buildCommissions,
  buildReport,
  centsToDecimal,
  downloadCsv,
  isValidRange,
  pctChange,
  presetRange,
  previousRange,
  rangeDays,
  toCsv
} from '../../services/reports';
import { errMsg, ghostBtn, inputClass } from './ui';

interface Props {
  clinicId: string;
  appointments: Appointment[];
  professionals: Professional[];
  services: Service[];
  notify: (msg: string) => void;
}

const STATUS_PT: Record<string, string> = {
  PENDING: 'Pendente',
  CONFIRMED: 'Confirmado',
  COMPLETED: 'Concluído',
  CANCELLED: 'Cancelado',
  NO_SHOW: 'Faltou'
};

const PIE_COLORS = ['#f43f5e', '#38bdf8'];

const fileDate = (r: { from: string; to: string }) => `${r.from}_a_${r.to}`;

function Delta({ value, suffix = '%', invert = false }: { value: number | null; suffix?: string; invert?: boolean }) {
  if (value === null) return <span className="text-[11px] text-slate-500">sem base de comparação</span>;
  if (value === 0) {
    return (
      <span className="text-[11px] text-slate-400 flex items-center gap-1">
        <Minus className="w-3 h-3" /> igual ao período anterior
      </span>
    );
  }
  const good = invert ? value < 0 : value > 0;
  return (
    <span className={`text-[11px] flex items-center gap-1 ${good ? 'text-emerald-400' : 'text-rose-400'}`}>
      {value > 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
      {Math.abs(value).toLocaleString('pt-BR')}
      {suffix} vs. período anterior
    </span>
  );
}

function Kpi({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-1">
      <p className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">{label}</p>
      <p className="text-xl font-bold text-white">{value}</p>
      {children}
    </div>
  );
}

export function ReportsPanel({ clinicId, appointments, professionals, services, notify }: Props) {
  const today = todayKey();
  const [preset, setPreset] = useState<PeriodPreset>('thisMonth');
  const [custom, setCustom] = useState({ from: `${today.slice(0, 7)}-01`, to: today });

  const range = preset === 'custom' ? custom : presetRange(preset, today);
  const valid = isValidRange(range);
  // Período muito longo deixaria a tela lenta e o gráfico ilegível.
  const tooLong = valid && rangeDays(range) > 1830;
  const usable = valid && !tooLong;

  const report = useMemo(
    () => (usable ? buildReport(appointments, services, professionals, range, today) : null),
    [appointments, services, professionals, usable, range.from, range.to, today]
  );
  const previous = useMemo(
    () => (usable ? buildReport(appointments, services, professionals, previousRange(range), today) : null),
    [appointments, services, professionals, usable, range.from, range.to, today]
  );

  // --- Comissão (somente o dono; falha aqui não derruba os relatórios) ---
  const [pcts, setPcts] = useState<Map<string, number>>(new Map());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [commissionError, setCommissionError] = useState<string | null>(null);
  const [loadingCommissions, setLoadingCommissions] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoadingCommissions(true);
    fetchCommissions(clinicId)
      .then((m) => {
        if (!alive) return;
        setPcts(m);
        setCommissionError(null);
      })
      .catch((e) => alive && setCommissionError(errMsg(e)))
      .finally(() => alive && setLoadingCommissions(false));
    return () => {
      alive = false;
    };
  }, [clinicId]);

  const commissions = useMemo(() => (report ? buildCommissions(report, pcts) : []), [report, pcts]);
  const commissionTotal = commissions.reduce((s, c) => s + c.commissionCents, 0);

  const parsePct = (raw: string): number | null => {
    const n = Number(raw.replace(',', '.'));
    return raw.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) / 100 : null;
  };

  const onSavePct = async (professionalId: string) => {
    const draft = drafts[professionalId];
    const pct = parsePct(draft ?? '');
    if (pct === null) {
      notify('Informe uma comissão entre 0 e 100.');
      return;
    }
    setSavingId(professionalId);
    try {
      await saveCommission(clinicId, professionalId, pct);
      setPcts((prev) => new Map(prev).set(professionalId, pct));
      setDrafts((d) => {
        const { [professionalId]: _removed, ...rest } = d;
        return rest;
      });
      notify('Comissão salva.');
    } catch (e) {
      notify(errMsg(e));
    } finally {
      setSavingId(null);
    }
  };

  // --- Exportações ---
  const serviceName = useMemo(() => new Map(services.map((s) => [s.id, s.name])), [services]);
  const proName = useMemo(() => new Map(professionals.map((p) => [p.id, p.name])), [professionals]);

  const exportSummary = () => {
    if (!report) return;
    const k = report.kpis;
    downloadCsv(
      `resumo_${fileDate(range)}`,
      toCsv(
        ['Período', 'Faturamento (R$)', 'Previsto (R$)', 'Atendimentos', 'Faltas', 'Cancelados', 'Ticket médio (R$)', 'No-show (%)', 'Clientes atendidos', 'Clientes novos', 'Clientes recorrentes'],
        [[
          `${brDate(range.from)} a ${brDate(range.to)}`,
          centsToDecimal(k.revenueCents),
          centsToDecimal(k.forecastCents),
          k.completed,
          k.noShows,
          k.cancelled,
          centsToDecimal(k.avgTicketCents),
          String(k.noShowRate).replace('.', ','),
          k.uniqueClients,
          k.newClients,
          k.returningClients
        ]]
      )
    );
  };

  const exportAppointments = () => {
    if (!report) return;
    const rows = appointments
      .filter((a) => {
        const d = localDateKey(a.startTime);
        return d >= range.from && d <= range.to;
      })
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .map((a) => [
        brDate(localDateKey(a.startTime)),
        new Date(a.startTime).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }),
        a.clientName,
        serviceName.get(a.serviceId) ?? 'Procedimento removido',
        proName.get(a.professionalId) ?? 'Profissional removido',
        STATUS_PT[a.status] ?? a.status,
        centsToDecimal(a.totalPriceCents)
      ]);
    downloadCsv(`atendimentos_${fileDate(range)}`, toCsv(['Data', 'Hora', 'Cliente', 'Procedimento', 'Profissional', 'Situação', 'Valor (R$)'], rows));
  };

  const exportProcedures = () => {
    if (!report) return;
    downloadCsv(
      `procedimentos_${fileDate(range)}`,
      toCsv(
        ['Procedimento', 'Atendimentos', 'Faturamento (R$)', 'Participação (%)'],
        report.procedures.map((p) => [p.name, p.count, centsToDecimal(p.revenueCents), String(p.share).replace('.', ',')])
      )
    );
  };

  const exportProfessionals = () => {
    if (!report) return;
    downloadCsv(
      `profissionais_${fileDate(range)}`,
      toCsv(
        ['Profissional', 'Atendimentos', 'Faltas', 'Faturamento (R$)', 'Ticket médio (R$)', 'Ocupação (%)'],
        report.professionals.map((p) => [
          p.name,
          p.completed,
          p.noShows,
          centsToDecimal(p.revenueCents),
          centsToDecimal(p.avgTicketCents),
          p.occupancy === null ? '' : String(p.occupancy).replace('.', ',')
        ])
      )
    );
  };

  const exportCommissions = () => {
    if (!report) return;
    downloadCsv(
      `comissoes_${fileDate(range)}`,
      toCsv(
        ['Profissional', 'Atendimentos', 'Faturamento (R$)', 'Comissão (%)', 'Comissão a pagar (R$)'],
        commissions.map((c) => [
          c.name,
          c.completed,
          centsToDecimal(c.revenueCents),
          String(c.pct).replace('.', ','),
          centsToDecimal(c.commissionCents)
        ])
      )
    );
  };

  const k = report?.kpis;
  const pk = previous?.kpis;
  const topProcedures = report?.procedures.slice(0, 8) ?? [];
  const maxProcedure = topProcedures[0]?.revenueCents || 1;
  const chartData = (report?.series ?? []).map((p) => ({ label: p.label, faturamento: p.revenueCents / 100, atendimentos: p.completed }));
  const mixData = k
    ? [
        { name: 'Novos', value: k.newClients },
        { name: 'Recorrentes', value: k.returningClients }
      ]
    : [];

  const sectionTitle = 'text-sm font-bold text-white';
  const card = 'bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3';
  const th = 'text-left text-[11px] uppercase tracking-wide text-slate-400 font-semibold py-2 pr-3';
  const td = 'py-2 pr-3 text-xs text-slate-200 align-middle';
  const tooltipStyle = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, fontSize: 12 };

  return (
    <div className="space-y-5">
      {/* Período */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-end gap-3">
        <label className="text-xs">
          <span className="text-slate-300 font-semibold block mb-1">Período</span>
          <select className={inputClass} value={preset} onChange={(e) => setPreset(e.target.value as PeriodPreset)}>
            {(Object.keys(PERIOD_LABELS) as PeriodPreset[]).map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        {preset === 'custom' && (
          <>
            <label className="text-xs">
              <span className="text-slate-300 font-semibold block mb-1">De</span>
              <input type="date" className={inputClass} value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            </label>
            <label className="text-xs">
              <span className="text-slate-300 font-semibold block mb-1">Até</span>
              <input type="date" className={inputClass} value={custom.to} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
            </label>
          </>
        )}
        <p className="text-xs text-slate-400 pb-2">
          {valid ? `${brDate(range.from)} a ${brDate(range.to)} (${rangeDays(range)} dia${rangeDays(range) > 1 ? 's' : ''})` : 'Informe um período válido.'}
        </p>
        <div className="ml-auto flex flex-wrap gap-2">
          <button className={ghostBtn} onClick={exportSummary} disabled={!report}>
            <Download className="w-3.5 h-3.5" /> Resumo (CSV)
          </button>
          <button className={ghostBtn} onClick={exportAppointments} disabled={!report}>
            <Download className="w-3.5 h-3.5" /> Atendimentos (CSV)
          </button>
        </div>
      </div>

      {tooLong && (
        <div className="bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs rounded-xl p-3 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> Escolha um período de até 5 anos.
        </div>
      )}

      {report && k && pk && (
        <>
          {/* Indicadores */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Faturamento" value={formatBRL(k.revenueCents)}>
              <Delta value={pctChange(k.revenueCents, pk.revenueCents)} />
              {k.forecastCents > 0 && <p className="text-[11px] text-slate-500">+ {formatBRL(k.forecastCents)} previsto</p>}
            </Kpi>
            <Kpi label="Atendimentos" value={String(k.completed)}>
              <Delta value={pctChange(k.completed, pk.completed)} />
            </Kpi>
            <Kpi label="Ticket médio" value={formatBRL(k.avgTicketCents)}>
              <Delta value={pctChange(k.avgTicketCents, pk.avgTicketCents)} />
            </Kpi>
            <Kpi label="No-show" value={`${k.noShowRate.toLocaleString('pt-BR')}%`}>
              <p className="text-[11px] text-slate-500">
                {k.noShows} falta{k.noShows === 1 ? '' : 's'} • {k.cancelled} cancelado{k.cancelled === 1 ? '' : 's'}
              </p>
              <Delta value={pctChange(k.noShowRate, pk.noShowRate)} invert />
            </Kpi>
          </div>

          {/* Faturamento no tempo + novos x recorrentes */}
          <div className="grid lg:grid-cols-3 gap-4">
            <div className={`${card} lg:col-span-2`}>
              <h3 className={sectionTitle}>
                Faturamento {report.granularity === 'day' ? 'por dia' : report.granularity === 'week' ? 'por semana' : 'por mês'}
              </h3>
              {report.series.length > 0 && k.completed > 0 ? (
                <div className="h-60">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} interval="preserveStartEnd" />
                      <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} width={56} tickFormatter={(v) => `R$ ${v}`} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        cursor={{ fill: 'rgba(148,163,184,0.08)' }}
                        formatter={((value: number, name: string) =>
                          name === 'faturamento' ? [formatBRL(Math.round(value * 100)), 'Faturamento'] : [value, 'Atendimentos']) as any}
                      />
                      <Bar dataKey="faturamento" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-xs text-slate-500 py-10 text-center">Nenhum atendimento concluído neste período.</p>
              )}
            </div>

            <div className={card}>
              <h3 className={sectionTitle}>Clientes novos x recorrentes</h3>
              {k.uniqueClients > 0 ? (
                <>
                  <div className="h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={mixData} dataKey="value" nameKey="name" innerRadius={38} outerRadius={64} paddingAngle={2} stroke="none">
                          {mixData.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="text-xs space-y-1.5">
                    <li className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-slate-300">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: PIE_COLORS[0] }} /> Novos (1º atendimento)
                      </span>
                      <b className="text-white">{k.newClients}</b>
                    </li>
                    <li className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-slate-300">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: PIE_COLORS[1] }} /> Recorrentes
                      </span>
                      <b className="text-white">{k.returningClients}</b>
                    </li>
                    <li className="flex items-center justify-between border-t border-slate-800 pt-1.5">
                      <span className="text-slate-400">Taxa de retorno</span>
                      <b className="text-white">{Math.round((k.returningClients / k.uniqueClients) * 100)}%</b>
                    </li>
                  </ul>
                </>
              ) : (
                <p className="text-xs text-slate-500 py-10 text-center">Sem clientes atendidos no período.</p>
              )}
            </div>
          </div>

          {/* Top procedimentos */}
          <div className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className={sectionTitle}>Top procedimentos</h3>
              <button className={ghostBtn + ' !py-1.5 !px-3'} onClick={exportProcedures} disabled={report.procedures.length === 0}>
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
            </div>
            {topProcedures.length === 0 ? (
              <p className="text-xs text-slate-500">Nenhum procedimento concluído neste período.</p>
            ) : (
              <ul className="space-y-2.5">
                {topProcedures.map((p, i) => (
                  <li key={p.serviceId} className="text-xs">
                    <div className="flex items-center justify-between gap-3 mb-1">
                      <span className="text-slate-200 font-semibold truncate">
                        {i + 1}. {p.name}
                      </span>
                      <span className="text-slate-400 shrink-0">
                        {p.count} atend. • <b className="text-white">{formatBRL(p.revenueCents)}</b> • {p.share.toLocaleString('pt-BR')}%
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                      <div className="h-full bg-rose-500 rounded-full" style={{ width: `${Math.max(2, (p.revenueCents / maxProcedure) * 100)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Por profissional */}
          <div className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className={sectionTitle}>Por profissional</h3>
              <button className={ghostBtn + ' !py-1.5 !px-3'} onClick={exportProfessionals} disabled={report.professionals.length === 0}>
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px]">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className={th}>Profissional</th>
                    <th className={th}>Atend.</th>
                    <th className={th}>Faltas</th>
                    <th className={th}>Faturamento</th>
                    <th className={th}>Ticket médio</th>
                    <th className={th}>Ocupação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {report.professionals.map((p) => (
                    <tr key={p.professionalId}>
                      <td className={`${td} font-semibold`}>{p.name}</td>
                      <td className={td}>{p.completed}</td>
                      <td className={td}>{p.noShows}</td>
                      <td className={td}>{formatBRL(p.revenueCents)}</td>
                      <td className={td}>{formatBRL(p.avgTicketCents)}</td>
                      <td className={td}>
                        {p.occupancy === null ? (
                          <span className="text-slate-500">sem jornada</span>
                        ) : (
                          <div className="flex items-center gap-2 min-w-[120px]">
                            <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                              <div className="h-full bg-sky-400 rounded-full" style={{ width: `${p.occupancy}%` }} />
                            </div>
                            <span className="w-12 text-right">{p.occupancy.toLocaleString('pt-BR')}%</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {report.professionals.length === 0 && (
                    <tr>
                      <td className={td} colSpan={6}>
                        Nenhuma profissional cadastrada.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Comissão */}
          <div className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className={sectionTitle}>Comissão por profissional</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Calculada sobre o faturamento dos atendimentos concluídos no período. Só você (administrador) vê estes percentuais.
                </p>
              </div>
              <button className={ghostBtn + ' !py-1.5 !px-3'} onClick={exportCommissions} disabled={commissions.length === 0}>
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
            </div>

            {commissionError && (
              <div className="bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs rounded-xl p-3 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {commissionError}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px]">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className={th}>Profissional</th>
                    <th className={th}>Faturamento</th>
                    <th className={th}>Comissão (%)</th>
                    <th className={th}>A pagar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {commissions.map((c) => {
                    const draft = drafts[c.professionalId];
                    const dirty = draft !== undefined && draft !== String(c.pct).replace('.', ',');
                    return (
                      <tr key={c.professionalId}>
                        <td className={`${td} font-semibold`}>{c.name}</td>
                        <td className={td}>{formatBRL(c.revenueCents)}</td>
                        <td className={td}>
                          <div className="flex items-center gap-1.5">
                            <div className="relative w-24">
                              <input
                                className={`${inputClass} pr-7`}
                                inputMode="decimal"
                                aria-label={`Comissão de ${c.name}`}
                                disabled={loadingCommissions || !!commissionError}
                                value={draft ?? String(c.pct).replace('.', ',')}
                                onChange={(e) => setDrafts((d) => ({ ...d, [c.professionalId]: e.target.value }))}
                                onKeyDown={(e) => e.key === 'Enter' && dirty && onSavePct(c.professionalId)}
                              />
                              <Percent className="w-3 h-3 text-slate-500 absolute right-2.5 top-1/2 -translate-y-1/2" />
                            </div>
                            {dirty && (
                              <button
                                className={ghostBtn + ' !py-1.5 !px-2.5'}
                                onClick={() => onSavePct(c.professionalId)}
                                disabled={savingId === c.professionalId}
                              >
                                {savingId === c.professionalId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                Salvar
                              </button>
                            )}
                          </div>
                        </td>
                        <td className={`${td} font-bold text-white`}>{formatBRL(c.commissionCents)}</td>
                      </tr>
                    );
                  })}
                  {commissions.length > 0 && (
                    <tr className="border-t border-slate-700">
                      <td className={`${td} font-bold`} colSpan={3}>
                        Total a pagar em comissões
                      </td>
                      <td className={`${td} font-bold text-rose-300`}>{formatBRL(commissionTotal)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {commissions.every((c) => (pcts.get(c.professionalId) ?? 0) === 0) && !commissionError && !loadingCommissions && (
              <p className="text-[11px] text-slate-500">Defina o percentual de cada profissional para calcular o valor a pagar.</p>
            )}
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed">
            Como os números são calculados: faturamento = atendimentos <b>concluídos</b>; “previsto” = pendentes e confirmados de hoje em diante;
            no-show = faltas ÷ (concluídos + faltas), cancelamentos não entram; ocupação = minutos reservados (sem os cancelados) ÷ minutos de
            jornada, sem o almoço (folgas e bloqueios cadastrados não são descontados); cliente novo = primeiro atendimento concluído dele caiu
            no período. Datas no horário de Brasília.
          </p>
        </>
      )}
    </div>
  );
}
