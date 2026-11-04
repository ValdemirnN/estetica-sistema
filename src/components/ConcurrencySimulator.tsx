import React, { useState } from 'react';
import {
  ShieldAlert,
  Zap,
  CheckCircle2,
  XCircle,
  Database,
  RefreshCw,
  Clock,
  ArrowRight
} from 'lucide-react';

export function ConcurrencySimulator() {
  const [isRunning, setIsRunning] = useState(false);
  const [testResult, setTestResult] = useState<{
    clientA: { status: number; message: string; durationMs: number };
    clientB: { status: number; error: string; durationMs: number; sqlCode: string };
  } | null>(null);

  const runConcurrencyTest = () => {
    setIsRunning(true);
    setTestResult(null);

    setTimeout(() => {
      setIsRunning(false);
      setTestResult({
        clientA: {
          status: 201,
          message: 'Agendamento criado com sucesso (ID: apt-c19a-41)',
          durationMs: 42
        },
        clientB: {
          status: 409,
          error: 'Desculpe, este horário acabou de ser reservado por outro cliente.',
          durationMs: 43,
          sqlCode: 'PostgreSQL Error 23P01: exclusion_violation (prevent_professional_double_booking)'
        }
      });
    }, 1200);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-rose-400 font-bold text-base mb-1">
              <Zap className="w-5 h-5" />
              Teste de Concorrência em Tempo Real: Prevenção de Double-Booking
            </div>
            <p className="text-xs text-slate-300 max-w-3xl leading-relaxed">
              Em alta demanda (campanhas no Instagram ou inauguração), dois clientes podem clicar no botão "Confirmar" no mesmo milissegundo. Veja como a constraint <code className="text-rose-300 bg-slate-950 px-1 py-0.5 rounded">EXCLUDE USING gist</code> do PostgreSQL protege a integridade transacional sem falhas.
            </p>
          </div>

          <button
            onClick={runConcurrencyTest}
            disabled={isRunning}
            className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-lg shadow-rose-600/30 transition-all flex items-center gap-2 shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : ''}`} />
            {isRunning ? 'Executando Concorrência...' : 'Simular 2 Clientes no Mesmo Segundo'}
          </button>
        </div>
      </div>

      {/* Visualização de Dois Clientes Paralelos */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Cliente 1 */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <span className="text-xs font-bold text-white flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              Cliente 1: Juliana Siqueira
            </span>
            <span className="text-[10px] font-mono text-slate-400">Timestamp: 14:00:00.104</span>
          </div>

          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs font-mono text-slate-300 space-y-1">
            <div className="text-slate-500"># Payload Enviado:</div>
            <div>POST /api/v1/appointments</div>
            <div>professional_id: "prof-1" (Dra. Camila)</div>
            <div>slot: 14:00 às 15:15 (+15m buffer)</div>
          </div>

          {testResult && (
            <div className="bg-emerald-950/30 border border-emerald-500/30 rounded-xl p-3 text-xs space-y-1.5 animate-fadeIn">
              <div className="flex items-center gap-2 text-emerald-400 font-bold">
                <CheckCircle2 className="w-4 h-4" />
                HTTP 201 Created ({testResult.clientA.durationMs}ms)
              </div>
              <p className="text-slate-300">{testResult.clientA.message}</p>
              <div className="text-[10px] text-emerald-400 font-mono">
                Postgres: INSERT com lock de intervalo concedido.
              </div>
            </div>
          )}
        </div>

        {/* Cliente 2 */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <span className="text-xs font-bold text-white flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-rose-400" />
              Cliente 2: Mariana Prado
            </span>
            <span className="text-[10px] font-mono text-slate-400">Timestamp: 14:00:00.105 (+1ms)</span>
          </div>

          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs font-mono text-slate-300 space-y-1">
            <div className="text-slate-500"># Payload Enviado (Concorrente):</div>
            <div>POST /api/v1/appointments</div>
            <div>professional_id: "prof-1" (Dra. Camila)</div>
            <div>slot: 14:00 às 15:15 (+15m buffer)</div>
          </div>

          {testResult && (
            <div className="bg-rose-950/30 border border-rose-500/30 rounded-xl p-3 text-xs space-y-1.5 animate-fadeIn">
              <div className="flex items-center gap-2 text-rose-400 font-bold">
                <XCircle className="w-4 h-4" />
                HTTP 409 Conflict ({testResult.clientB.durationMs}ms)
              </div>
              <p className="text-slate-300">{testResult.clientB.error}</p>
              <div className="text-[10px] text-rose-300 font-mono bg-slate-950 p-2 rounded border border-rose-900/40">
                {testResult.clientB.sqlCode}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Explicação da Solução Arquitetural */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-2">
        <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <Database className="w-4 h-4 text-indigo-400" /> Por que isto não falha em produção?
        </h4>
        <p className="text-xs text-slate-300 leading-relaxed">
          Muitos sistemas utilizam validação apenas no código (ex: <code className="text-slate-200">if not slot_is_free(): insert()</code>). Essa abordagem tem a falha clássica de race condition (TOCTOU: Time-of-check to time-of-use). 
          Ao delegar para a constraint <code className="text-emerald-400 font-mono">tsrange(start_time, buffer_end_time, '[)') WITH &&</code> com índice GiST, o próprio motor interno do PostgreSQL garante serialização atômica instantânea sem gargalos de locking global.
        </p>
      </div>
    </div>
  );
}
