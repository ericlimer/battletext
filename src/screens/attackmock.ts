// Design mockups for an "under fire" attack view in the right-hand panel (debug only: ?mock=A|B|C&mf=1..3).
// Each variant renders a fixed, scripted volley against a real unit so the layouts can be compared.

import { UI } from '../engine/ui';
import { C, lerp, healthColor } from '../engine/color';
import { Unit } from '../combat/battle';
import { frameTitle } from './widgets';
import { portraitOf, drawPortrait } from './portrait';
import { LOC_NAMES } from '../data/items';

const PX = 100, PW = 50, MY = 1;

type Shot = { w: string; hits: [string, number][]; misses: number; crit?: string };
// The scripted volley: 4 weapon groups, the third a missile salvo
const VOLLEY: Shot[] = [
  { w: 'Medium Laser', hits: [['CT', 25]], misses: 0 },
  { w: 'Medium Laser', hits: [], misses: 1 },
  { w: 'Medium Laser', hits: [['LA', 25]], misses: 0 },
  { w: 'SRM4', hits: [['LT', 8], ['CT', 8], ['RL', 8]], misses: 1, crit: 'Heat Sink (LT)' },
];
const shown = (frame: number) => (frame <= 1 ? 1 : frame === 2 ? 3 : 4);

/** Armour lost per location after the first n weapon groups. */
function lost(n: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of VOLLEY.slice(0, n)) for (const [l, d] of s.hits) out[l] = (out[l] ?? 0) + d;
  return out;
}

function header(ui: UI, a: Unit, t: Unit, title: string): number {
  const d = ui.d;
  d.fill(PX, MY, PW, 47, ' ', C.text, C.panel);
  ui.header(PX, MY, PW, `◆ UNDER FIRE · ${title}`, C.bg, '#b03a2a');
  d.text(PX + 1, MY + 1, `${a.name} ▸ ${frameTitle(t.frame)}`, C.bright, C.panel, PW - 2, true);
  d.text(PX + 1, MY + 2, '4 weapon groups · rear arc · 62% avg to hit', C.dim, C.panel);
  return MY + 4;
}

function ledger(ui: UI, x: number, y: number, frame: number, w = PW - 2): number {
  const d = ui.d;
  const n = shown(frame);
  d.text(x, y++, 'SHOT LEDGER', C.faint);
  VOLLEY.slice(0, n).forEach((s, i) => {
    const fresh = i === n - 1 && frame < 3;
    const bg = fresh ? '#2a1a10' : C.panel;
    d.fill(x, y, w, 1, ' ', C.text, bg);
    d.text(x, y, s.w.padEnd(13).slice(0, 13), fresh ? C.bright : C.text, bg);
    const marks = [...s.hits.map(() => '■'), ...Array(s.misses).fill('·')].join('');
    d.text(x + 14, y, marks.padEnd(5), s.hits.length ? '#f0a830' : C.faint, bg);
    const txt = s.hits.length ? s.hits.map(([l, dmg]) => `${l} -${dmg}`).join(' ') : 'miss';
    d.text(x + 20, y, txt, s.hits.length ? '#f2c060' : C.faint, bg, w - 20);
    y++;
    if (s.crit && frame >= 3) { d.text(x + 2, y++, `✶ CRIT  ${s.crit} destroyed`, '#f0d050', C.panel); }
  });
  if (frame < 3) d.text(x, y++, `${'·'.repeat(4 - n)} ${4 - n} group${4 - n === 1 ? '' : 's'} to fire`, C.faint);
  return y;
}

function total(ui: UI, x: number, y: number, frame: number): void {
  const d = ui.d;
  const sum = Object.values(lost(shown(frame))).reduce((a, b) => a + b, 0);
  d.text(x, y, 'DAMAGE', C.faint);
  d.text(x + 8, y, String(sum), frame >= 3 ? '#ff7a4a' : C.bright, C.panel, 99, true);
  d.text(x + 14, y, `${VOLLEY.slice(0, shown(frame)).reduce((a, s) => a + s.hits.length, 0)}/${VOLLEY.slice(0, shown(frame)).reduce((a, s) => a + s.hits.length + s.misses, 0)} hits`, C.dim);
}

// ---- A: large paper doll ------------------------------------------------------------------------
function variantA(ui: UI, a: Unit, t: Unit, frame: number): void {
  const d = ui.d;
  let y = header(ui, a, t, 'DAMAGE DOLL');
  const n = shown(frame), gone = lost(n), last = frame < 3 ? VOLLEY[n - 1] : null;
  const f = t.frame;
  // Body-shaped grid of location boxes, 9 wide × 4 tall
  const box = (l: string, bx: number, by: number) => {
    const maxA = (f.maxArmor[l] ?? 0) + (f.maxArmor[l + 'R'] ?? 0), arm = Math.max(0, maxA - (gone[l] ?? 0));
    const flash = !!last && last.hits.some(([hl]) => hl === l);
    const bg = flash ? '#5a2a14' : '#10161c';
    d.box(bx, by, 9, 4, flash ? '#ff9a40' : '#2a3a46', bg);
    d.text(bx + 1, by + 1, l, flash ? C.bright : C.dim, bg);
    d.text(bx + 4, by + 1, String(arm).padStart(4), flash ? '#ffd080' : healthColor(arm / Math.max(1, maxA)), bg);
    const fill = Math.round((arm / Math.max(1, maxA)) * 7);
    for (let i = 0; i < 7; i++) d.set(bx + 1 + i, by + 2, i < fill ? '▀' : '▔', i < fill ? healthColor(arm / Math.max(1, maxA)) : '#2a3238', bg);
    if (flash) { const dmg = last!.hits.filter(([hl]) => hl === l).reduce((s, [, v]) => s + v, 0); d.text(bx + 2, by + 3, ` -${dmg} `, '#ffffff', '#c04010', 99, true); }
  };
  const cx = PX + 6;
  box('HD', cx + 16, y);
  box('RA', cx - 2, y + 4); box('RT', cx + 7, y + 4); box('CT', cx + 16, y + 4); box('LT', cx + 25, y + 4); box('LA', cx + 34, y + 4);
  box('RL', cx + 11, y + 8); box('LL', cx + 21, y + 8);
  y += 13;
  if (frame === 1) d.text(PX + 2, y - 1, '   ═══►  incoming: Medium Laser', '#ff6a4a');
  y = ledger(ui, PX + 1, y + 1, frame);
  total(ui, PX + 1, y + 1, frame);
  d.text(PX + 1, 46, 'A · Boxes flash and drop as each group lands.', C.faint);
}

// ---- B: portrait with hit flashes ---------------------------------------------------------------
function variantB(ui: UI, a: Unit, t: Unit, frame: number): void {
  const d = ui.d;
  let y = header(ui, a, t, 'PORTRAIT CAM');
  const art = portraitOf(t.frame);
  const n = shown(frame), last = frame < 3 ? VOLLEY[n - 1] : null;
  if (art) {
    const aw = Math.max(...art.rows.map((r) => r.length));
    const ax = PX + Math.max(1, (PW - aw) >> 1);
    const flashLoc = last?.hits[0]?.[0] ?? null;
    drawPortrait(d, art, ax, y, { frame: t.frame, highlight: flashLoc });
    // Impact sparks over the struck part, a miss streaking past
    if (last && last.hits.length) {
      const [l, dmg] = last.hits[0];
      const spot = { HD: [0.5, 0.1], CT: [0.5, 0.35], LT: [0.65, 0.3], RT: [0.35, 0.3], LA: [0.85, 0.35], RA: [0.15, 0.35], LL: [0.6, 0.8], RL: [0.4, 0.8] }[l] ?? [0.5, 0.4];
      const sx = ax + Math.round(spot[0] * aw), sy = y + Math.round(spot[1] * art.rows.length);
      d.text(sx - 1, sy, '✶', '#ffe0a0'); d.text(sx + 1, sy - 1, '*', '#ff9a40'); d.text(sx - 2, sy + 1, '·', '#ff9a40');
      const right = sx + 8 < PX + PW; d.text(right ? sx + 3 : sx - 7, sy + (right ? 0 : 1), `-${dmg}`, '#ff7a3a', undefined, 99, true);
    }
    if (frame === 2) { d.text(ax - 9, y + 2, '─·  ·  ·', '#7a8a96'); d.text(ax - 9, y + 3, 'miss', C.faint); }
    if (frame === 1) d.text(ax - 6, y + 5, '══►', '#ff6a4a');
    y += art.rows.length + 1;
  }
  // Compact location bars, two columns
  const gone = lost(n);
  ['HD', 'CT', 'LT', 'RT', 'LA', 'RA', 'LL', 'RL'].forEach((l, i) => {
    const f = t.frame, maxA = (f.maxArmor[l] ?? 0) + (f.maxArmor[l + 'R'] ?? 0), arm = Math.max(0, maxA - (gone[l] ?? 0));
    const bx = PX + 1 + (i % 2) * 24, by = y + (i >> 1);
    const hit = !!gone[l];
    d.text(bx, by, l, hit ? C.bright : C.dim);
    for (let k = 0; k < 12; k++) d.set(bx + 3 + k, by, k < Math.round((arm / Math.max(1, maxA)) * 12) ? '■' : '·', k < Math.round((arm / Math.max(1, maxA)) * 12) ? healthColor(arm / Math.max(1, maxA)) : '#2a3238');
    if (hit) d.text(bx + 16, by, `-${gone[l]}`, '#ff7a3a');
  });
  y += 5;
  y = ledger(ui, PX + 1, y, frame);
  total(ui, PX + 1, y + 1, frame);
  d.text(PX + 1, 46, 'B · The struck part lights up on the portrait.', C.faint);
}

// ---- C: gun camera -------------------------------------------------------------------------------
function variantC(ui: UI, a: Unit, t: Unit, frame: number): void {
  const d = ui.d;
  let y = header(ui, a, t, 'GUN CAMERA');
  // A 3× close-up of the ground around the target: each tile becomes a 6×3 block
  const m = (a as any).__map ?? null; void m;
  const vx = PX + 1, vw = PW - 2, vh = 15;
  d.fill(vx, y, vw, vh, ' ', C.text, '#0a0e0a');
  for (let ty = 0; ty < 5; ty++) for (let tx = 0; tx < 8; tx++) {
    const shadeV = ((tx * 7 + ty * 13) % 5) / 40;
    const bg = lerp('#16201a', '#26301e', shadeV * 4);
    d.fill(vx + tx * 6, y + ty * 3, 6, 3, ' ', C.text, bg);
    if ((tx + ty * 3) % 7 === 2) d.text(vx + tx * 6 + 2, y + ty * 3 + 1, '♣', '#4a8a4a', bg);
  }
  // The target, large, at the centre
  const tcx = vx + 24, tcy = y + 6;
  d.fill(tcx - 3, tcy - 1, 8, 3, ' ', C.text, frame === 2 ? '#7a2a14' : '#5a1409');
  d.text(tcx - 1, tcy, (t.mapTag ?? 'XX').padEnd(2), '#ffffff', frame === 2 ? '#7a2a14' : '#5a1409', 99, true);
  d.text(tcx - 3, tcy + 2, frameTitle(t.frame).slice(0, 12), '#f0a898');
  // Projectiles arriving from the left, impact burst
  if (frame === 1) { d.text(vx + 1, tcy, '═══════════►', '#ff6a4a'); d.text(vx + 1, tcy - 1, 'Kestrel ▸', C.cyan); }
  if (frame === 2) { d.text(tcx - 6, tcy - 2, '✶  *', '#ffe0a0'); d.text(tcx + 6, tcy + 1, '-25', '#ff7a3a', undefined, 99, true); d.text(tcx + 4, tcy - 3, '·  ·  miss', '#7a8a96'); }
  if (frame === 3) { d.text(tcx + 6, tcy - 1, '-74', '#ff7a3a', undefined, 99, true); d.text(tcx - 5, tcy + 1, '░▒░', '#5a5048'); }
  y += vh + 1;
  // Hit-location strip: one column per location, bars shrink and flash
  const gone = lost(shown(frame)), last = frame < 3 ? VOLLEY[shown(frame) - 1] : null;
  ['HD', 'RA', 'RT', 'CT', 'LT', 'LA', 'RL', 'LL'].forEach((l, i) => {
    const f = t.frame, maxA = (f.maxArmor[l] ?? 0) + (f.maxArmor[l + 'R'] ?? 0), arm = Math.max(0, maxA - (gone[l] ?? 0));
    const cx = PX + 2 + i * 6, frac = arm / Math.max(1, maxA), flash = !!last && last.hits.some(([hl]) => hl === l);
    for (let k = 0; k < 4; k++) d.set(cx + 1, y + 3 - k, k < Math.round(frac * 4) ? '█' : '▁', flash ? '#ffb060' : k < Math.round(frac * 4) ? healthColor(frac) : '#2a3238');
    d.text(cx, y + 4, l, flash ? C.bright : C.dim);
    if (gone[l]) d.text(cx, y + 5, `-${gone[l]}`, '#ff7a3a');
  });
  y += 7;
  y = ledger(ui, PX + 1, y, frame);
  total(ui, PX + 1, y + 1, frame);
  d.text(PX + 1, 46, 'C · A close-up of the target as shots arrive.', C.faint);
  void LOC_NAMES;
}

// ---- A2/A3: proportional silhouette doll (front + rear), solid (HBS) or pips (record sheet) -------
// Viewer's left is the 'Mech's right. Codes: h HD, c CT, r RT, l LT, a RA, b LA, x RL, y LL.
type Span = [string, number, number];
const FRONT_SPANS: Span[][] = [
  [['h', 12, 17]],
  [['h', 12, 17]],
  [['c', 14, 15]],
  [['a', 2, 5], ['r', 7, 10], ['c', 12, 17], ['l', 19, 22], ['b', 24, 27]],
  [['a', 1, 5], ['r', 7, 10], ['c', 12, 17], ['l', 19, 22], ['b', 24, 28]],
  [['a', 1, 5], ['r', 7, 10], ['c', 12, 17], ['l', 19, 22], ['b', 24, 28]],
  [['a', 1, 5], ['r', 7, 10], ['c', 12, 17], ['l', 19, 22], ['b', 24, 28]],
  [['a', 1, 5], ['r', 7, 10], ['c', 12, 17], ['l', 19, 22], ['b', 24, 28]],
  [['a', 1, 5], ['r', 8, 10], ['c', 12, 17], ['l', 19, 21], ['b', 24, 28]],
  [['a', 2, 4], ['r', 9, 10], ['c', 12, 17], ['l', 19, 20], ['b', 25, 27]],
  [['a', 2, 4], ['c', 11, 18], ['b', 25, 27]],
  [['a', 2, 4], ['b', 25, 27]],
  [['a', 2, 4], ['x', 9, 13], ['y', 16, 20], ['b', 25, 27]],
  [['a', 2, 4], ['x', 9, 13], ['y', 16, 20], ['b', 25, 27]],
  [['a', 1, 5], ['x', 9, 13], ['y', 16, 20], ['b', 24, 28]],
  [['x', 9, 13], ['y', 16, 20]],
  [['x', 10, 13], ['y', 16, 19]],
  [['x', 10, 13], ['y', 16, 19]],
  [['x', 9, 13], ['y', 16, 20]],
  [['x', 8, 13], ['y', 16, 21]],
];
// Rear: torsos only, mirrored (the 'Mech's left is now on the viewer's left)
const REAR_SPANS: Span[][] = [
  [['l', 0, 3], ['c', 5, 10], ['r', 12, 15]],
  [['l', 0, 3], ['c', 5, 10], ['r', 12, 15]],
  [['l', 0, 3], ['c', 5, 10], ['r', 12, 15]],
  [['l', 1, 3], ['c', 5, 10], ['r', 12, 14]],
  [['c', 6, 9]],
];
const CODE: Record<string, string> = { h: 'HD', c: 'CT', r: 'RT', l: 'LT', a: 'RA', b: 'LA', x: 'RL', y: 'LL' };

/** Cells of each location in a span mask, row-major. */
function cellsOf(spans: Span[][]): Record<string, [number, number][]> {
  const out: Record<string, [number, number][]> = {};
  spans.forEach((row, y) => row.forEach(([k, a, b]) => { for (let x = a; x <= b; x++) (out[CODE[k]] ??= []).push([x, y]); }));
  return out;
}

/** Scripted rear damage so the rear view has something to show: one SRM to CT(R) in the last group. */
function silhouette(ui: UI, a: Unit, t: Unit, frame: number, pips: boolean): void {
  const d = ui.d;
  let y = header(ui, a, t, pips ? 'RECORD SHEET' : 'SILHOUETTE');
  const n = shown(frame), gone = lost(n), last = frame < 3 ? VOLLEY[n - 1] : null;
  const prevGone = lost(frame < 3 ? n - 1 : n);
  const f = t.frame;
  const flashOf = (l: string) => (last ? last.hits.filter(([hl]) => hl === l).reduce((s, [, v]) => s + v, 0) : 0);
  const draw = (spans: Span[][], ox: number, oy: number, rear: boolean) => {
    const cells = cellsOf(spans);
    for (const [l, cs] of Object.entries(cells)) {
      const key = rear ? l + 'R' : l;
      const maxA = f.maxArmor[key] ?? 0;
      const hitNow = rear ? 0 : flashOf(l), hitAll = rear ? 0 : gone[l] ?? 0, hitBefore = rear ? 0 : prevGone[l] ?? 0;
      const arm = Math.max(0, maxA - hitAll), frac = arm / Math.max(1, maxA);
      const flash = hitNow > 0;
      if (pips) {
        // One pip per cell; lost armour knocks out pips from the top, the newest ones marked ✕
        const keep = Math.round(frac * cs.length), keepBefore = Math.round((Math.max(0, maxA - hitBefore) / Math.max(1, maxA)) * cs.length);
        cs.forEach(([cx, cy], i) => {
          const lostIdx = cs.length - 1 - i; // count lost from the top
          void lostIdx;
          const isLost = i < cs.length - keep, newly = isLost && i >= cs.length - keepBefore;
          const ch = newly ? '✕' : isLost ? '·' : '●';
          const fg = newly ? '#ff9a40' : isLost ? '#3a4650' : flash ? '#ffd080' : healthColor(frac);
          d.set(ox + cx, oy + cy, ch, fg, flash ? '#4a200c' : '#18222a');
        });
      } else {
        const bg = flash ? '#e07020' : lerp('#0c1216', healthColor(frac), 0.55);
        cs.forEach(([cx, cy]) => d.set(ox + cx, oy + cy, ' ', C.text, bg));
        // Label and armour value centred in the part (front only for big parts)
        const xs = cs.map((c) => c[0]), ys = cs.map((c) => c[1]);
        const mx = Math.round((Math.min(...xs) + Math.max(...xs)) / 2), my = Math.round((Math.min(...ys) + Math.max(...ys)) / 2);
        const fg = flash ? '#ffffff' : '#0a0e10';
        if (rear || l === 'HD') d.text(ox + mx - (String(arm).length >> 1), oy + my, String(arm), fg, bg, 99, true);
        else {
          d.text(ox + mx - 1 + (l === 'RT' || l === 'LT' ? 0 : 0), oy + my - 1, l, fg, bg);
          d.text(ox + mx - (String(arm).length >> 1), oy + my, String(arm), fg, bg, 99, true);
        }
      }
      // Damage callout
      if (flash) {
        const xs = cs.map((c) => c[0]), ys = cs.map((c) => c[1]);
        const mx = Math.round((Math.min(...xs) + Math.max(...xs)) / 2), my = Math.max(...ys);
        const txt = ` -${hitNow} `;
        const cy = pips || l === 'HD' ? Math.min(...ys) - 1 : my + (l === 'CT' ? 0 : 1);
        d.text(ox + mx - (txt.length >> 1), oy + Math.max(0, cy), txt, '#ffffff', '#c04010', 99, true);
      }
    }
  };
  const fx = PX + 1, rx = PX + 33;
  d.text(fx + 1, y, 'R', C.dim); d.text(fx + 27, y, 'L', C.dim);
  draw(FRONT_SPANS, fx, y, false);
  d.text(fx + 9, y + 21, '── FRONT ──', C.faint);
  d.text(rx + 3, y, 'REAR', C.faint);
  draw(REAR_SPANS, rx, y + 1, true);
  if (pips) {
    // Location readout beside the doll (armour now / max)
    let ly = y + 8;
    for (const l of ['HD', 'CT', 'RT', 'LT', 'RA', 'LA', 'RL', 'LL']) {
      const maxA = f.maxArmor[l] ?? 0, arm = Math.max(0, maxA - (gone[l] ?? 0)), fl = flashOf(l) > 0;
      d.text(rx, ly, l, fl ? C.bright : C.dim);
      d.text(rx + 3, ly, `${String(arm).padStart(3)}/${maxA}`, fl ? '#ffd080' : healthColor(arm / Math.max(1, maxA)));
      if (gone[l]) d.text(rx + 11, ly, `-${gone[l]}`, '#ff7a3a');
      ly++;
    }
  } else {
    d.text(rx, y + 8, 'Colour = armour', C.faint);
    d.text(rx, y + 9, 'left. Struck', C.faint);
    d.text(rx, y + 10, 'parts flash.', C.faint);
  }
  if (frame === 1) d.text(PX + 2, y + 22, '═══►  incoming: Medium Laser', '#ff6a4a');
  y += 23;
  y = ledger(ui, PX + 1, y + 1, frame);
  total(ui, PX + 1, y + 1, frame);
  d.text(PX + 1, 46, pips ? 'A3 · Pips knock out like a tabletop record sheet.' : 'A2 · Solid parts, HBS style; colour shows armour.', C.faint);
}

export function drawAttackMock(ui: UI, variant: string, frame: number, a: Unit, t: Unit): void {
  if (variant === 'A2' || variant === 'A3') silhouette(ui, a, t, frame, variant === 'A3');
  else if (variant === 'A') variantA(ui, a, t, frame);
  else if (variant === 'B') variantB(ui, a, t, frame);
  else variantC(ui, a, t, frame);
}
