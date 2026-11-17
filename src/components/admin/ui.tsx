import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, Trash2, X } from 'lucide-react';
import { uploadClinicImage } from '../../services/api';

export const inputClass =
  'w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-rose-500 disabled:opacity-50';

export const primaryBtn =
  'px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white shadow-md shadow-rose-600/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2';

export const ghostBtn =
  'px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition-colors disabled:opacity-50 flex items-center justify-center gap-2';

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado. Tente novamente.');

export function Field({
  label,
  hint,
  children,
  className = ''
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block text-xs ${className}`}>
      <span className="text-slate-300 font-semibold block mb-1">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-slate-500 block mt-1 leading-snug">{hint}</span>}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 w-9 h-5 rounded-full transition-colors shrink-0 relative ${checked ? 'bg-rose-600' : 'bg-slate-700'}`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`}
        />
      </button>
      <span className="text-xs leading-snug">
        <span className="text-slate-200 font-semibold block">{label}</span>
        {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  size = 'md'
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'md' | 'lg';
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`bg-slate-900 border border-slate-800 rounded-2xl w-full ${size === 'lg' ? 'max-w-2xl' : 'max-w-lg'} max-h-[92vh] flex flex-col shadow-2xl`}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-slate-800">
          <div>
            <h3 className="text-base font-bold text-white">{title}</h3>
            {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Fechar" className="text-slate-400 hover:text-white p-1 -m-1">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto space-y-4">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-slate-800 flex flex-wrap items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

/** Envio de imagem (logo, foto) para o Storage da clínica, com pré-visualização. */
export function ImageField({
  clinicId,
  value,
  onChange,
  label,
  hint,
  rounded = 'rounded-xl',
  fallback
}: {
  clinicId: string;
  value: string;
  onChange: (url: string) => void;
  label: string;
  hint?: string;
  rounded?: string;
  fallback?: React.ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await uploadClinicImage(clinicId, file));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="text-xs">
      <span className="text-slate-300 font-semibold block mb-1">{label}</span>
      <div className="flex items-center gap-3">
        <div
          className={`w-16 h-16 ${rounded} bg-slate-950 border border-slate-800 overflow-hidden flex items-center justify-center shrink-0 text-slate-600`}
        >
          {value ? <img src={value} alt="" className="w-full h-full object-cover" /> : fallback ?? <ImagePlus className="w-5 h-5" />}
        </div>
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className={ghostBtn + ' !py-1.5 !px-3'}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
              {value ? 'Trocar imagem' : 'Enviar imagem'}
            </button>
            {value && (
              <button type="button" onClick={() => onChange('')} className="px-3 py-1.5 rounded-xl text-xs text-slate-400 hover:text-rose-300 flex items-center gap-1.5">
                <Trash2 className="w-3.5 h-3.5" /> Remover
              </button>
            )}
          </div>
          <p className="text-[11px] text-slate-500">{hint ?? 'PNG, JPG ou WebP, até 2 MB.'}</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>
      {error && <p className="text-[11px] text-rose-300 mt-1.5">{error}</p>}
    </div>
  );
}

/** Avatar: foto ou iniciais com a cor da profissional. */
export function Avatar({ name, url, color, size = 'w-12 h-12' }: { name: string; url?: string; color: string; size?: string }) {
  const ini =
    name
      .replace(/^(dra?\.?)\s+/i, '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('') || '?';
  return url ? (
    <img src={url} alt={name} className={`${size} rounded-xl object-cover border border-slate-700 shrink-0`} />
  ) : (
    <div
      style={{ backgroundColor: color }}
      className={`${size} rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0`}
    >
      {ini}
    </div>
  );
}
