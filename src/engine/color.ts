// Color helpers. Colors are "#rrggbb" strings throughout the codebase; parsing is cached.

export type RGB = [number, number, number];

const parseCache = new Map<string, RGB>();

export function rgb(c: string): RGB {
  let v = parseCache.get(c);
  if (v) return v;
  let h = c.startsWith('#') ? c.slice(1) : c;
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  parseCache.set(c, v);
  return v;
}

function clamp255(n: number): number {
  return n < 0 ? 0 : n > 255 ? 255 : Math.round(n);
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

export function hex(r: number, g: number, b: number): string {
  return '#' + HEX[clamp255(r)] + HEX[clamp255(g)] + HEX[clamp255(b)];
}

export function lerp(a: string, b: string, t: number): string {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const x = rgb(a), y = rgb(b);
  return hex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
}

export function scale(c: string, f: number): string {
  const x = rgb(c);
  return hex(x[0] * f, x[1] * f, x[2] * f);
}

export function add(c: string, d: string, f = 1): string {
  const x = rgb(c), y = rgb(d);
  return hex(x[0] + y[0] * f, x[1] + y[1] * f, x[2] + y[2] * f);
}

/** Multiply color by a light color (normalized 0..255 → 0..1, can exceed). */
export function light(c: string, lr: number, lg: number, lb: number): string {
  const x = rgb(c);
  return hex(x[0] * lr, x[1] * lg, x[2] * lb);
}

export function desaturate(c: string, t: number): string {
  const x = rgb(c);
  const g = x[0] * 0.3 + x[1] * 0.59 + x[2] * 0.11;
  return hex(x[0] + (g - x[0]) * t, x[1] + (g - x[1]) * t, x[2] + (g - x[2]) * t);
}

/** Map 0..1 health to a green→yellow→red ramp. */
export function healthColor(f: number): string {
  if (f <= 0) return '#3a3a3a';
  if (f > 0.75) return lerp('#b8d86a', '#52d273', (f - 0.75) / 0.25);
  if (f > 0.4) return lerp('#e8c24a', '#b8d86a', (f - 0.4) / 0.35);
  return lerp('#d8402a', '#e8c24a', f / 0.4);
}

// ---- Palette -------------------------------------------------------------
export const C = {
  bg: '#05070a',
  panel: '#0a0e13',
  panel2: '#0f151c',
  panelHi: '#16202a',
  border: '#2a3a46',
  borderHi: '#4d6a7c',
  text: '#c8d2d8',
  dim: '#6d7f8a',
  faint: '#3b4a54',
  bright: '#f2f6f8',
  accent: '#f0a830', // HBS-ish amber
  accentDim: '#8a5f1c',
  cyan: '#5fd0e8',
  blue: '#4a8ee8',
  green: '#6ad46a',
  red: '#e8503a',
  orange: '#f08a30',
  yellow: '#f0d050',
  purple: '#b27ae8',
  pink: '#e878b0',
  player: '#5fc8f0',
  enemy: '#f0503a',
  ally: '#8ae878',
  neutral: '#d8c878',
  cbill: '#f0c850',
  heat: '#ff6a2a',
  stab: '#8ab4ff',
  good: '#6ad46a',
  bad: '#e8503a',
  warn: '#f0c040',
};
