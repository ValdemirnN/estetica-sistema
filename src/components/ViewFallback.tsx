import { Loader2 } from 'lucide-react';

/** Mostrado enquanto uma tela carrega sob demanda (code-splitting). */
export function ViewFallback() {
  return (
    <div className="flex items-center justify-center gap-2 py-20 text-sm text-slate-400" role="status" aria-live="polite">
      <Loader2 className="w-4 h-4 animate-spin" />
      Carregando…
    </div>
  );
}
