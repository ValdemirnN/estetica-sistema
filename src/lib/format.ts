/** Centavos -> "R$ 2.400,00" */
export const formatBRL = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** "Dra. Camila Vasconcellos" -> "CV" */
export const initials = (name: string) =>
  name
    .replace(/^(dra?\.?)\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('') || '?';
