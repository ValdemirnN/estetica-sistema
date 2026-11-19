import React from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';

/** Bloco cinza pulsante usado nos "esqueletos" de carregamento. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-xl bg-slate-800/70 ${className}`} />;
}

/** Estado vazio com mensagem útil e, opcionalmente, um botão de ação. */
export function EmptyState({
  icon,
  title,
  text,
  actionLabel,
  onAction
}: {
  icon?: React.ReactNode;
  title: string;
  text?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-2 py-8 px-4">
      {icon && <div className="p-3 rounded-2xl bg-slate-800/60 text-slate-400">{icon}</div>}
      <p className="text-sm font-semibold text-white">{title}</p>
      {text && <p className="text-xs text-slate-400 max-w-xs leading-relaxed">{text}</p>}
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="mt-2 px-4 py-2 rounded-xl bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 text-white text-xs font-semibold transition-all"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/** Aviso de erro em linha, com botão "Tentar de novo". */
export function InlineError({
  text,
  onRetry,
  retrying = false
}: {
  text: string;
  onRetry: () => void;
  retrying?: boolean;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-rose-950/30 border border-rose-500/30 rounded-2xl p-4"
    >
      <p className="text-xs text-rose-100 flex items-start gap-2 leading-relaxed">
        <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
        {text}
      </p>
      <button
        onClick={onRetry}
        disabled={retrying}
        className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shrink-0"
      >
        {retrying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        Tentar de novo
      </button>
    </div>
  );
}

/**
 * Captura falha ao baixar uma tela sob demanda (ex.: sem internet ou versão nova publicada).
 * "Tentar de novo" recarrega a página, que busca os arquivos atualizados.
 */
export class LoadErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('Falha ao carregar a tela:', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <InlineError
        text="Não foi possível carregar esta tela. Verifique sua conexão e tente de novo."
        onRetry={() => window.location.reload()}
      />
    );
  }
}
