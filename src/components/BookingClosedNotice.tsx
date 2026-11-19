import React from 'react';
import { Clock } from 'lucide-react';
import type { ClinicBranding } from '../types/clinic';

/**
 * Mostrada ao cliente enquanto o dono ainda não publicou o link de agendamento
 * (a clínica está sendo configurada). A equipe não vê esta tela.
 */
export function BookingClosedNotice({ clinic, onSignOut }: { clinic: Pick<ClinicBranding, 'name' | 'phone' | 'whatsapp'>; onSignOut?: () => void }) {
  const contact = clinic.whatsapp || clinic.phone;
  return (
    <div className="max-w-md mx-auto bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-2 text-center">
      <Clock className="w-8 h-8 text-amber-400 mx-auto" />
      <h2 className="text-base font-bold text-white">{clinic.name}</h2>
      <p className="text-xs text-slate-300 leading-relaxed">
        O agendamento online estará disponível em breve. Enquanto isso, fale diretamente com a clínica.
      </p>
      {contact && <p className="text-xs text-slate-400">{contact}</p>}
      {onSignOut && (
        <button onClick={onSignOut} className="mt-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white">
          Sair
        </button>
      )}
    </div>
  );
}
