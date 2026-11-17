/**
 * Tema por clínica.
 *
 * Todo o app usa as cores "rose" do Tailwind (botões, destaques, bordas). Em vez de reescrever
 * centenas de classes, sobrescrevemos as variáveis CSS --color-rose-* em tempo de execução com
 * uma paleta gerada a partir da cor escolhida pela clínica. O Tailwind v4 lê essas variáveis,
 * então tudo (inclusive variações com opacidade e gradientes) muda junto.
 */

const DEFAULT_COLOR = '#e11d48';
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

export const COLOR_PRESETS: { name: string; hex: string }[] = [
  { name: 'Rosé', hex: '#e11d48' },
  { name: 'Pink', hex: '#db2777' },
  { name: 'Lavanda', hex: '#7c3aed' },
  { name: 'Índigo', hex: '#4f46e5' },
  { name: 'Azul', hex: '#0284c7' },
  { name: 'Turquesa', hex: '#0d9488' },
  { name: 'Esmeralda', hex: '#059669' },
  { name: 'Dourado', hex: '#b45309' },
  { name: 'Coral', hex: '#ea580c' }
];

export function isValidHex(v: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(v);
}

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l * 100];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const ss = Math.max(0, Math.min(100, s)) / 100;
  const ll = Math.max(0, Math.min(100, l)) / 100;
  const k = (n: number) => (n + hh / 30) % 12;
  const a = ss * Math.min(ll, 1 - ll);
  const f = (n: number) => ll - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

/** Gera a escala 50…950 mantendo o matiz da cor escolhida (que vira o tom 600 dos botões). */
export function buildPalette(hex: string, hueShift = 0): Record<number, string> {
  const [h, s, l] = hexToHsl(isValidHex(hex) ? hex : DEFAULT_COLOR);
  const base = Math.max(40, Math.min(52, l)); // evita botões claros ou escuros demais
  const sat = Math.max(35, s);
  const lightness: Record<number, number> = {
    50: 97, 100: 94, 200: 88, 300: 80, 400: 70, 500: Math.min(62, base + 9), 600: base,
    700: base - 8, 800: base - 16, 900: base - 24, 950: Math.max(7, base - 34)
  };
  const out: Record<number, string> = {};
  for (const shade of SHADES) {
    // tons muito claros/escuros perdem saturação para não "gritar"
    const satAdj = shade <= 100 ? sat * 0.9 : shade >= 900 ? sat * 0.7 : sat;
    out[shade] = hslToHex(h + hueShift, satAdj, lightness[shade]);
  }
  return out;
}

export function applyTheme(primaryHex: string | undefined | null) {
  const root = document.documentElement;
  const hex = primaryHex && isValidHex(primaryHex) ? primaryHex : DEFAULT_COLOR;
  const rose = buildPalette(hex);
  const pink = buildPalette(hex, 18); // vizinho no círculo cromático, usado nos gradientes dos botões
  for (const shade of SHADES) root.style.setProperty(`--color-rose-${shade}`, rose[shade]);
  for (const shade of [400, 500, 600] as const) root.style.setProperty(`--color-pink-${shade}`, pink[shade]);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', rose[600]);
}

export function resetTheme() {
  const root = document.documentElement;
  for (const shade of SHADES) root.style.removeProperty(`--color-rose-${shade}`);
  for (const shade of [400, 500, 600]) root.style.removeProperty(`--color-pink-${shade}`);
}
