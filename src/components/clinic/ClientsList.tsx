import React, { useMemo, useState } from 'react';
import { MessageCircle, Pencil, Plus, Search, Users } from 'lucide-react';
import { Appointment, ClientRecord } from '../../types/clinic';
import { whatsappLink } from '../../lib/format';
import { Field, Modal, errMsg, ghostBtn, inputClass, primaryBtn } from '../admin/ui';

interface Props {
  clients: ClientRecord[];
  appointments: Appointment[];
  onNewClient: () => void;
  onBook: (clientId: string) => void;
  onSaveNotes: (clientId: string, notes: string) => Promise<void>;
  notify: (msg: string) => void;
}

const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Lista de clientes da clínica (cadastro básico) com atalho para agendar. */
export function ClientsList({ clients, appointments, onNewClient, onBook, onSaveNotes, notify }: Props) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<ClientRecord | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const stats = useMemo(() => {
    const m = new Map<string, { total: number; last?: string }>();
    for (const a of appointments) {
      if (a.status === 'CANCELLED') continue;
      const cur = m.get(a.clientId) ?? { total: 0 };
      cur.total += 1;
      if (!cur.last || a.startTime > cur.last) cur.last = a.startTime;
      m.set(a.clientId, cur);
    }
    return m;
  }, [appointments]);

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    const digits = q.replace(/\D/g, '');
    return clients.filter(
      (c) =>
        !q ||
        norm(c.fullName).includes(q) ||
        norm(c.email).includes(q) ||
        (digits.length >= 3 && (c.phone.replace(/\D/g, '').includes(digits) || (c.cpf ?? '').replace(/\D/g, '').includes(digits)))
    );
  }, [clients, query]);

  const saveNotes = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await onSaveNotes(editing.id, notes);
      notify('Observação salva.');
      setEditing(null);
    } catch (e) {
      notify(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Users className="w-4 h-4 text-rose-400" /> Clientes ({clients.length})
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">Cadastro básico para agendamento. Não há prontuário neste sistema.</p>
        </div>
        <button className={primaryBtn} onClick={onNewClient}>
          <Plus className="w-3.5 h-3.5" /> Novo cliente
        </button>
      </div>

      <div className="relative">
        <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <input className={`${inputClass} pl-8`} placeholder="Buscar por nome, telefone, e-mail ou CPF..." value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl divide-y divide-slate-800/80 overflow-hidden">
        {filtered.length === 0 && <p className="p-5 text-xs text-slate-500">Nenhum cliente encontrado.</p>}
        {filtered.map((c) => {
          const st = stats.get(c.id);
          const wa = whatsappLink(c.phone, `Olá, ${c.fullName.split(' ')[0]}! `);
          return (
            <div key={c.id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="space-y-0.5 min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-white truncate">{c.fullName}</h4>
                  {!c.isActive && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">Desativado</span>}
                </div>
                <p className="text-xs text-slate-400">{[c.phone, c.email].filter(Boolean).join(' • ')}</p>
                <p className="text-[11px] text-slate-500">
                  {st ? `${st.total} agendamento(s)` : 'Sem agendamentos'}
                  {st?.last && <> • último em {new Date(st.last).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</>}
                </p>
                {c.staffNotes && <p className="text-[11px] text-amber-300/80">Obs.: {c.staffNotes}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {wa && (
                  <a href={wa} target="_blank" rel="noopener noreferrer" className={ghostBtn} title="Abrir conversa no WhatsApp">
                    <MessageCircle className="w-3.5 h-3.5 text-emerald-400" /> WhatsApp
                  </a>
                )}
                <button
                  className={ghostBtn}
                  onClick={() => {
                    setEditing(c);
                    setNotes(c.staffNotes);
                  }}
                >
                  <Pencil className="w-3.5 h-3.5" /> Observação
                </button>
                <button className={primaryBtn} disabled={!c.isActive} onClick={() => onBook(c.id)}>
                  Agendar
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {editing && (
        <Modal
          title="Observação interna"
          subtitle={editing.fullName}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className={ghostBtn} onClick={() => setEditing(null)} disabled={saving}>Cancelar</button>
              <button className={primaryBtn} onClick={saveNotes} disabled={saving}>Salvar</button>
            </>
          }
        >
          <Field label="Observação (só a equipe vê)" hint="Não registre informações de saúde.">
            <textarea className={inputClass} rows={4} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  );
}
