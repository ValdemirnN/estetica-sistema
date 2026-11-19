/** Geração de arquivo de calendário (.ics, RFC 5545) para um agendamento. Tudo no navegador. */

export interface IcsEvent {
  /** Identificador estável: adicionar de novo o mesmo agendamento atualiza o evento em vez de duplicar. */
  uid: string;
  title: string;
  startIso: string;
  endIso: string;
  location?: string;
  description?: string;
  /** Aviso antes do evento, em minutos (0/undefined = sem alarme). */
  reminderMinutes?: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO -> 20261125T130000Z */
function toIcsUtc(iso: string): string {
  const d = new Date(iso);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** Escapa texto conforme a RFC 5545 (barra, ponto e vírgula, vírgula e quebras de linha). */
export function escapeIcsText(t: string): string {
  return t.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Linhas com mais de 75 bytes são quebradas (continuação começa com um espaço). */
export function foldIcsLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = '';
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (curBytes + b > limit) {
      parts.push(cur);
      cur = ch;
      curBytes = b;
      limit = 74; // o espaço inicial da continuação conta 1 byte
    } else {
      cur += ch;
      curBytes += b;
    }
  }
  if (cur) parts.push(cur);
  return parts.join('\r\n ');
}

export function buildIcs(ev: IcsEvent): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Estetica Sistema//Agendamento//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${ev.uid}`,
    `DTSTAMP:${toIcsUtc(new Date().toISOString())}`,
    `DTSTART:${toIcsUtc(ev.startIso)}`,
    `DTEND:${toIcsUtc(ev.endIso)}`,
    `SUMMARY:${escapeIcsText(ev.title)}`
  ];
  if (ev.location) lines.push(`LOCATION:${escapeIcsText(ev.location)}`);
  if (ev.description) lines.push(`DESCRIPTION:${escapeIcsText(ev.description)}`);
  lines.push('STATUS:CONFIRMED', 'TRANSP:OPAQUE');
  if (ev.reminderMinutes && ev.reminderMinutes > 0) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeIcsText(ev.title)}`,
      `TRIGGER:-PT${Math.round(ev.reminderMinutes)}M`,
      'END:VALARM'
    );
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

/** Baixa o .ics no navegador. */
export function downloadIcs(ev: IcsEvent, fileName: string): void {
  const blob = new Blob([buildIcs(ev)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.ics') ? fileName : `${fileName}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
