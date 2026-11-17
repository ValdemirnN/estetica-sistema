import React, { useMemo, useState } from 'react';
import { Search, UserPlus, X } from 'lucide-react';
import { ClientRecord } from '../../types/clinic';
import { inputClass } from '../admin/ui';

interface Props {
  clients: ClientRecord[];
  value: string;
  onChange: (clientId: string) => void;
  /** Mostra o atalho "cadastrar novo cliente" (abre o modal de cadastro). */
  onCreateNew?: () => void;
}

const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Busca cliente por nome, telefone, e-mail ou CPF. */
export function ClientSearchSelector({ clients, value, onChange, onCreateNew }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selected = clients.find((c) => c.id === value);

  const results = useMemo(() => {
    const q = norm(query.trim());
    const digits = q.replace(/\D/g, '');
    return clients
      .filter((c) => c.isActive)
      .filter(
        (c) =>
          !q ||
          norm(c.fullName).includes(q) ||
          norm(c.email).includes(q) ||
          (digits.length >= 3 && (c.phone.replace(/\D/g, '').includes(digits) || (c.cpf ?? '').replace(/\D/g, '').includes(digits)))
      )
      .slice(0, 8);
  }, [clients, query]);

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-2 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2">
        <div className="text-xs">
          <div className="text-white font-semibold">{selected.fullName}</div>
          <div className="text-slate-400">{selected.phone || selected.email}</div>
        </div>
        <button type="button" onClick={() => onChange('')} className="text-slate-400 hover:text-white" title="Trocar cliente">
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Buscar por nome, telefone, e-mail ou CPF..."
          className={`${inputClass} pl-8`}
        />
      </div>
      {open && (
        <div className="absolute z-20 mt-1 w-full bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
          {results.length === 0 && <p className="px-3 py-2.5 text-xs text-slate-500">Nenhum cliente encontrado.</p>}
          {results.map((c) => (
            <button
              type="button"
              key={c.id}
              onClick={() => {
                onChange(c.id);
                setOpen(false);
                setQuery('');
              }}
              className="w-full text-left px-3 py-2 hover:bg-slate-800 border-b border-slate-800 last:border-0"
            >
              <div className="text-xs text-white font-semibold">{c.fullName}</div>
              <div className="text-[11px] text-slate-400">{[c.phone, c.email].filter(Boolean).join(' • ')}</div>
            </button>
          ))}
          {onCreateNew && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onCreateNew();
              }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-semibold text-rose-300 hover:bg-slate-800 border-t border-slate-700"
            >
              <UserPlus className="w-3.5 h-3.5" /> Cadastrar novo cliente
            </button>
          )}
        </div>
      )}
    </div>
  );
}
