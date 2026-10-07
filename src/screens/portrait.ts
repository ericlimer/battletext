// 'Mech portraits: hand-drawn ASCII art, shaded by part and tinted by each location's damage.

import { Display, COLS, ROWS } from '../engine/display';
import { C, lerp, scale } from '../engine/color';
import { UI } from '../engine/ui';
import { Screen, app } from './app';
import { MechArt, artFor, ART_NAMES } from '../data/mechart';
import { PixArt, pixFor, pixZone, pixWidth, pixColor } from '../data/pixart';
import { VehArt, VPIX } from '../data/pixart/vehicles';
import { chassis, CHASSIS } from '../data/mechs';
import { Frame } from '../game/frame';
import { LOC_NAMES } from '../data/items';

export type Portrait = MechArt | PixArt | VehArt;
const isPix = (a: Portrait): a is PixArt | VehArt => 'px' in a;
/** Location a pixel shows: 'Mechs use the zone spec, vehicles a per-pixel mask. */
const zoneOf = (a: PixArt | VehArt, x: number, y: number): string => ('zones' in a ? a.zones[y]?.[x] ?? '.' : pixZone(a, x, y));

/** A chassis's portrait: pixel art where drawn, else the older ASCII line art. */
export function portraitOf(f: Frame): Portrait | null {
  if (f.kind !== 'mech') return VPIX[f.defId] ?? null;
  const n = chassis(f.defId).name;
  return pixFor(n) ?? artFor(n);
}

/** Size in cells. */
export function portraitSize(a: Portrait): [number, number] {
  return isPix(a) ? [Math.max(...a.px.map((r) => r.length)), Math.ceil(a.px.length / 2)] : [Math.max(...a.rows.map((r) => r.length)), a.rows.length];
}

/** Which body location a cell of the portrait shows. */
export function zoneAt(a: MechArt, x: number, y: number): string {
  const w = Math.max(...a.rows.map((r) => r.length));
  if (y >= a.legs) return x < w / 2 ? 'RL' : 'LL';
  if (x < a.arms[0]) return 'RA';
  if (x >= a.arms[1]) return 'LA';
  if (y < a.head) return 'HD';
  const t0 = a.arms[0], t1 = Math.min(a.arms[1], w), third = (t1 - t0) / 3;
  return x < t0 + third ? 'RT' : x >= t1 - third ? 'LT' : 'CT';
}

/** Health of a location as 0..1 (armour weighted with structure); -1 when destroyed. */
function locHealth(f: Frame, loc: string): number {
  const s = f.struct[loc] ?? 0, ms = f.maxStruct[loc] ?? 1;
  if (s <= 0) return -1;
  const a = (f.armor[loc] ?? 0) + (f.armor[loc + 'R'] ?? 0);
  const ma = (f.maxArmor[loc] ?? 0) + (f.maxArmor[loc + 'R'] ?? 0);
  return (a + s) / Math.max(1, ma + ms);
}

const OUTLINE = new Set(['/', '\\', '|', '_', '-', '.', "'", '`', ',']);

/** Base shading by glyph role, Cogmind-style: dim outlines, brighter detail, a lit cockpit. */
function baseColor(ch: string, zone: string): string {
  if (OUTLINE.has(ch)) return zone === 'HD' ? '#a8b8c4' : '#7d8a94';
  if ((ch === 'o' || ch === 'O') && zone === 'HD') return '#ff5a3a'; // glowing eyes
  if (ch === 'o' || ch === 'O') return '#d8a848'; // missile tubes
  if (ch === '=' ) return '#b8c4cc';             // barrels and rails
  if (ch === '[' || ch === ']') return zone === 'HD' ? '#5fd8f0' : '#9aa8b2';
  if (ch === '#' || ch === '%' || ch === ':') return '#8a7a6a';
  if (ch === '(' || ch === ')') return '#c0c8ce';
  if (ch === '^') return '#f08a40';
  if (ch === '¤') return '#ff6a5a';              // laser emitters
  if (ch === '●' || ch === '◎') return '#6ab0ff'; // PPC and Gauss coils
  if (/[A-Za-z0-9]/.test(ch)) return '#c8a060';
  return '#9aa6ae';
}

/** Health tint: untouched parts keep their shading; damage pushes them to amber, then red; lost parts go dark. */
function tint(col: string, h: number): string {
  if (h < 0) return '#3a2626';
  if (h >= 0.98) return col;
  if (h > 0.6) return lerp(col, '#e8d070', (1 - h) * 1.2);
  if (h > 0.3) return lerp(col, '#f09040', 0.6);
  return lerp(col, '#ff4a3a', 0.75);
}

export interface PortraitOpts { frame?: Frame; highlight?: string | null; dim?: number; onHover?: (loc: string) => void; ui?: UI }

/** Draws a portrait with its top-left at (x, y). Returns its size. */
export function drawPortrait(d: Display, a: Portrait, x: number, y: number, o: PortraitOpts = {}): [number, number] {
  if (isPix(a)) return drawPix(d, a, x, y, o);
  const w = Math.max(...a.rows.map((r) => r.length));
  a.rows.forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx++) {
      const ch = row[rx];
      if (ch === ' ') continue;
      const z = zoneAt(a, rx, ry);
      let col = baseColor(ch, z);
      if (o.frame) col = tint(col, locHealth(o.frame, z));
      if (o.highlight && o.highlight === z) col = lerp(col, '#ffffff', 0.45);
      if (o.dim) col = scale(col, o.dim);
      d.set(x + rx, y + ry, ch, col);
    }
  });
  if (o.ui && o.onHover) {
    const mx = Math.floor(o.ui.inp.mx) - x, my = Math.floor(o.ui.inp.my) - y;
    if (mx >= 0 && my >= 0 && my < a.rows.length && mx < w && (a.rows[my][mx] ?? ' ') !== ' ') o.onHover(zoneAt(a, mx, my));
  }
  return [w, a.rows.length];
}

/** Pixel portrait: two pixels per cell (▀ over ▄), tinted per location like the ASCII art. */
function drawPix(d: Display, a: PixArt | VehArt, x: number, y: number, o: PortraitOpts): [number, number] {
  const w = Math.max(...a.px.map((r) => r.length)), h = a.px.length, rows = Math.ceil(h / 2);
  let hov: string | null = null;
  if (o.ui && o.onHover) {
    const mx = Math.floor(o.ui.inp.mx) - x, my = Math.floor(o.ui.inp.my) - y;
    if (mx >= 0 && my >= 0 && mx < w && my < rows) {
      const py = [my * 2, my * 2 + 1].find((yy) => pixColor(a.px[yy]?.[mx], yy, h));
      if (py !== undefined) { const z = zoneOf(a, mx, py); if (z !== '.') hov = z; }
    }
  }
  const col = (px: number, py: number): string | null => {
    let c = pixColor(a.px[py]?.[px], py, h);
    if (!c) return null;
    const z = zoneOf(a, px, py);
    if (o.frame && z !== '.') c = tint(c, locHealth(o.frame, z));
    const hl = o.highlight ?? hov;
    if (hl && hl === z) c = lerp(c, '#ffffff', 0.35);
    if (o.dim) c = scale(c, o.dim);
    return c;
  };
  for (let r = 0; r < rows; r++) for (let i = 0; i < w; i++) {
    const top = col(i, r * 2), bot = col(i, r * 2 + 1);
    if (!top && !bot) continue;
    const bg = d.getBg(x + i, y + r);
    if (top && bot && top === bot) d.set(x + i, y + r, '█', top, bg);
    else if (top) d.set(x + i, y + r, '▀', top, bot ?? bg);
    else d.set(x + i, y + r, '▄', bot!, bg);
  }
  if (hov && o.onHover) o.onHover(hov);
  return [w, rows];
}

/** Hover text for a portrait location. */
export function locTip(f: Frame, loc: string): string[] {
  const s = f.struct[loc] ?? 0;
  const a = f.armor[loc] ?? 0, ra = f.armor[loc + 'R'];
  return [`${LOC_NAMES[loc] ?? loc}`, s <= 0 ? 'DESTROYED' : `armour ${a}/${f.maxArmor[loc] ?? 0}${ra !== undefined ? ` · rear ${ra}/${f.maxArmor[loc + 'R']}` : ''} · structure ${s}/${f.maxStruct[loc]}`];
}

/** Debug contact sheet: ?artsheet shows every portrait. */
export class ArtSheetScreen implements Screen {
  page = 0;
  render(ui: UI): void {
    const d = ui.d;
    d.fill(0, 0, COLS, ROWS, ' ', C.text, C.bg);
    const names = [...new Set([...CHASSIS.map((c) => c.name), ...ART_NAMES])].filter((n) => pixFor(n) || artFor(n));
    const per = 8;
    const list = names.slice(this.page * per, this.page * per + per);
    list.forEach((n, i) => {
      const a = (pixFor(n) ?? artFor(n))!;
      const cx = 1 + (i % 4) * 37, cy = 1 + Math.floor(i / 4) * 23;
      d.text(cx, cy, n.toUpperCase(), C.accent);
      const ch = CHASSIS.find((c) => c.name === n);
      if (ch) d.text(cx + 20, cy, `${ch.tons}t`, C.faint);
      drawPortrait(d, a, cx, cy + 2);
    });
    d.text(1, ROWS - 1, `page ${this.page + 1}/${Math.ceil(names.length / per)} · ←/→`, C.faint);
    if (ui.key('ArrowRight')) this.page = Math.min(Math.ceil(names.length / per) - 1, this.page + 1);
    if (ui.key('ArrowLeft')) this.page = Math.max(0, this.page - 1);
    if (ui.key('Escape')) app.pop();
  }
}
