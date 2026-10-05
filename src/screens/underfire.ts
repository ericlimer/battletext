// The attack view: while a 'Mech is being shot, the right-hand panel becomes its armour record sheet.
// An outlined front + rear doll of armour pips; each weapon's hit knocks pips out and the struck parts blink.

import { UI } from '../engine/ui';
import { C, healthColor } from '../engine/color';
import { Unit, BEvent, SIDE, attackArc } from '../combat/battle';
import { item, LOC_NAMES } from '../data/items';
import { frameTitle } from './widgets';
import { TUNE } from '../game/tuning';

type Fire = Extract<BEvent, { k: 'fire' }>;
type Melee = Extract<BEvent, { k: 'melee' }>;
/** One attack landing on the sheet: a weapon's shots, or a melee blow. */
type Blow = { name: string; hits: number; shots: number; total: number; arm0: Record<string, number>; str0: Record<string, number>; arm: Record<string, number>; str: Record<string, number>; crits: string[] };
type Snap = { arm: Record<string, number>; str: Record<string, number> };
type Row = { w: string; hits: number; shots: number; locs: string; crits: string[] };

export interface UnderFire {
  a: Unit; t: Unit; title: string; arc: string;
  start: Snap; prev: Snap; cur: Snap;
  blinkAt: number; struck: Map<string, number>; // part key (rear as CTR…) → damage from the latest weapon
  rows: Row[]; pend: { at: number; e: Blow }[];
  dmg: number; hits: number; shots: number; hidden: boolean;
  until: number; // when the sheet gives the panel back (Infinity while the attack is still playing)
}


// Viewer's left is the 'Mech's right. Codes: h HD, c CT, r RT, l LT, a RA, b LA, x RL, y LL.
type Span = [string, number, number];
const FRONT: Span[][] = [
  [['h', 12, 17]],
  [['h', 12, 17]],
  [],
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
// Rear torsos, mirrored: from behind, the 'Mech's left is on the viewer's left
const REAR: Span[][] = [
  [['l', 0, 3], ['c', 5, 10], ['r', 12, 15]],
  [['l', 0, 3], ['c', 5, 10], ['r', 12, 15]],
  [['l', 0, 3], ['c', 5, 10], ['r', 12, 15]],
  [['l', 1, 3], ['c', 5, 10], ['r', 12, 14]],
  [['c', 6, 9]],
];
// Vehicles, seen from above with the front at the top: tracks down the sides, turret amidships
const VEHICLE: Span[][] = [
  [['L', 1, 4], ['F', 8, 21], ['R', 25, 28]],
  [['L', 0, 4], ['F', 7, 22], ['R', 25, 29]],
  [['L', 0, 4], ['F', 6, 23], ['R', 25, 29]],
  [['L', 0, 4], ['F', 6, 23], ['R', 25, 29]],
  [['L', 0, 4], ['R', 25, 29]],
  [['L', 0, 4], ['R', 25, 29]],
  [['L', 0, 4], ['T', 10, 19], ['R', 25, 29]],
  [['L', 0, 4], ['T', 9, 20], ['R', 25, 29]],
  [['L', 0, 4], ['T', 9, 20], ['R', 25, 29]],
  [['L', 0, 4], ['T', 9, 20], ['R', 25, 29]],
  [['L', 0, 4], ['T', 10, 19], ['R', 25, 29]],
  [['L', 0, 4], ['R', 25, 29]],
  [['L', 0, 4], ['R', 25, 29]],
  [['L', 0, 4], ['B', 6, 23], ['R', 25, 29]],
  [['L', 0, 4], ['B', 6, 23], ['R', 25, 29]],
  [['L', 0, 4], ['B', 7, 22], ['R', 25, 29]],
  [['L', 1, 4], ['R', 25, 28]],
];
// A fixed gun emplacement: one armoured block
const EMPLACEMENT: Span[][] = [
  [['T', 9, 20]], [['T', 7, 22]], [['T', 6, 23]], [['T', 6, 23]], [['T', 6, 23]],
  [['T', 6, 23]], [['T', 6, 23]], [['T', 6, 23]], [['T', 7, 22]], [['T', 9, 20]],
];
const CODE: Record<string, string> = { h: 'HD', c: 'CT', r: 'RT', l: 'LT', a: 'RA', b: 'LA', x: 'RL', y: 'LL' };
const BOX = ['·', '│', '─', '└', '│', '│', '┌', '├', '─', '┘', '─', '┴', '┐', '┤', '┬', '┼'];

/** Part cells (row-major) and the outline cells around them, offset by one so the outline fits. */
function grid(spans: Span[][], has: (l: string) => boolean = () => true) {
  const parts = new Map<string, string>();
  spans.forEach((row, y) => row.forEach(([k, a, b]) => { const l = CODE[k] ?? k; if (has(l)) for (let x = a; x <= b; x++) parts.set(`${x + 1},${y + 1}`, l); }));
  const border = new Map<string, Set<string>>();
  const byPart: Record<string, [number, number][]> = {};
  for (const [key, l] of parts) {
    const [x, y] = key.split(',').map(Number);
    (byPart[l] ??= []).push([x, y]);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const k = `${x + dx},${y + dy}`;
      if (!parts.has(k)) { if (!border.has(k)) border.set(k, new Set()); border.get(k)!.add(l); }
    }
  }
  for (const cs of Object.values(byPart)) cs.sort((p, q) => p[1] - q[1] || p[0] - q[0]);
  // Join outline cells only along a part's edge, so narrow gaps get two lines and no ladder rungs
  const glyph = new Map<string, string>();
  const P = (x: number, y: number) => parts.has(`${x},${y}`), B = (x: number, y: number) => border.has(`${x},${y}`);
  for (const k of border.keys()) {
    const [x, y] = k.split(',').map(Number);
    const h = (ax: number) => B(ax, y) && (P(x, y - 1) || P(x, y + 1) || P(ax, y - 1) || P(ax, y + 1));
    const v = (ay: number) => B(x, ay) && (P(x - 1, y) || P(x + 1, y) || P(x - 1, ay) || P(x + 1, ay));
    glyph.set(k, BOX[(v(y - 1) ? 1 : 0) | (h(x + 1) ? 2 : 0) | (v(y + 1) ? 4 : 0) | (h(x - 1) ? 8 : 0)]);
  }
  return { border, byPart, glyph };
}
const FRONT_G = grid(FRONT), REAR_G = grid(REAR), EMPLACEMENT_G = grid(EMPLACEMENT);
const vehicleGrids = new Map<string, ReturnType<typeof grid>>();
/** A vehicle's outline, leaving out locations it doesn't have (no turret, say). */
function vehicleGrid(f: Unit['frame']) {
  const key = ['F', 'L', 'R', 'B', 'T'].filter((l) => (f.maxStruct[l] ?? 0) > 0).join('');
  if (!vehicleGrids.has(key)) vehicleGrids.set(key, grid(VEHICLE, (l) => key.includes(l)));
  return vehicleGrids.get(key)!;
}


/** `before` is the target's armour and structure as the volley began (the battle has already resolved it). */
export function startUnderFire(a: Unit, t: Unit, aName: string, tName: string, before?: Snap): UnderFire {
  const s = before ?? { arm: { ...t.frame.armor }, str: { ...t.frame.struct } };
  return {
    a, t, title: `${aName} ▸ ${tName}`, arc: attackArc(t, a.x, a.y),
    start: s, prev: s, cur: s, blinkAt: -9, struck: new Map(), rows: [], pend: [], dmg: 0, hits: 0, shots: 0, hidden: false, until: Infinity,
  };
}

/** Queue a weapon's result; it lands on the doll at the moment its shots hit on the map. */
export function underFireShot(uf: UnderFire, e: Fire, at: number): void {
  if (e.t !== uf.t.id || !e.arm || !e.arm0 || !e.str || !e.str0) return;
  const hits = e.shots.filter((s) => s.hit).length;
  uf.pend.push({ at, e: { name: item(e.w).name, hits, shots: e.shots.length, total: e.total, arm0: e.arm0, str0: e.str0, arm: e.arm, str: e.str, crits: e.crits ?? [] } });
}

/** Queue a melee or death-from-above blow. */
export function underFireMelee(uf: UnderFire, e: Melee, at: number): void {
  if (e.t !== uf.t.id || !e.arm || !e.arm0 || !e.str || !e.str0) return;
  uf.pend.push({ at, e: { name: e.dfa ? 'Death From Above' : 'Melee', hits: e.hit ? 1 : 0, shots: 1, total: e.dmg, arm0: e.arm0, str0: e.str0, arm: e.arm, str: e.str, crits: e.crits ?? [] } });
}

const locLabel = (k: string) => (/^[CLR]TR$/.test(k) ? `${k.slice(0, 2)}(R)` : k);

function land(uf: UnderFire, e: Blow, now: number): void {
  const prev: Snap = { arm: e.arm0, str: e.str0 }, cur: Snap = { arm: e.arm, str: e.str };
  uf.prev = prev; uf.cur = cur;
  const struck = new Map<string, number>();
  for (const k of new Set([...Object.keys(prev.arm), ...Object.keys(cur.arm), ...Object.keys(prev.str), ...Object.keys(cur.str)])) {
    const lostA = Math.max(0, (prev.arm[k] ?? 0) - (cur.arm[k] ?? 0));
    const lostS = k in cur.str ? Math.max(0, Math.max(0, prev.str[k] ?? 0) - Math.max(0, cur.str[k] ?? 0)) : 0;
    if (lostA + lostS > 0) struck.set(k, lostA + lostS);
  }
  uf.struck = struck;
  if (struck.size) uf.blinkAt = now;
  // Where the damage actually went, transfers included
  uf.rows.push({ w: e.name, hits: e.hits, shots: e.shots, locs: [...struck].map(([l, d]) => `${locLabel(l)} -${d}`).join(' '), crits: e.crits });
  uf.dmg += e.total; uf.hits += e.hits; uf.shots += e.shots;
}

/** Draws the sheet over the panel (x, y, w × h). */
export function drawUnderFire(ui: UI, uf: UnderFire, now: number, x0: number, y0: number, w: number, h: number): void {
  const finished = uf.until !== Infinity && !uf.pend.length;
  for (const p of uf.pend) if (now >= p.at) { land(uf, p.e, now); p.at = Infinity; }
  uf.pend = uf.pend.filter((p) => p.at !== Infinity);
  const d = ui.d, t = uf.t, f = t.frame;
  const since = now - uf.blinkAt, lit = since < TUNE.blink && Math.floor(since / TUNE.blinkRate) % 2 === 0;
  const tagOn = since < TUNE.blink + 0.9;
  d.fill(x0, y0, w, h, ' ', C.text, C.panel);
  const mine = SIDE(t.team) === 0;
  ui.header(x0, y0, w, mine ? `◆ UNDER FIRE · ${frameTitle(f)}` : `◆ ON TARGET · ${frameTitle(f)}`, C.bg, mine ? '#b03a2a' : '#2a6a8a');
  d.text(x0 + 1, y0 + 1, uf.title, C.bright, C.panel, w - 2, true);
  d.text(x0 + 1, y0 + 2, `${uf.arc} arc · ${uf.shots ? `${uf.hits}/${uf.shots} hits` : 'incoming'}`, C.dim, C.panel, w - 2);
  const y = y0 + 4;

  const draw = (g: ReturnType<typeof grid>, ox: number, oy: number, rear: boolean) => {
    const keyOf = (l: string) => (rear ? l + 'R' : l);
    const blinking = (l: string) => lit && uf.struck.has(keyOf(l));
    for (const [k, touch] of g.border) {
      const [cx, cy] = k.split(',').map(Number);
      const hot = [...touch].some(blinking), hit = tagOn && [...touch].some((l) => uf.struck.has(keyOf(l)));
      d.set(ox + cx, oy + cy, g.glyph.get(k)!, hot ? '#ffd27a' : hit ? '#c8742e' : '#5a6c78', C.panel);
    }
    for (const [l, cs] of Object.entries(g.byPart)) {
      const key = keyOf(l);
      const maxA = f.maxArmor[key] ?? 0, maxS = rear ? 0 : f.maxStruct[l] ?? 0;
      const arm = Math.max(0, uf.cur.arm[key] ?? 0), armP = Math.max(0, uf.prev.arm[key] ?? 0);
      const str = rear ? 0 : Math.max(0, uf.cur.str[l] ?? 0), strP = rear ? 0 : Math.max(0, uf.prev.str[l] ?? 0);
      const gone = !rear && str <= 0 && maxS > 0;
      // Armour pips while it lasts; then the same cells count internal structure in red
      const onStruct = !rear && arm <= 0 && maxS > 0;
      const frac = onStruct ? str / maxS : arm / Math.max(1, maxA);
      const fracP = onStruct ? (armP > 0 ? 1 : strP / maxS) : armP / Math.max(1, maxA);
      const keep = Math.round(frac * cs.length), keepP = Math.round(fracP * cs.length);
      const on = blinking(l);
      const bg = on ? '#e8782a' : gone ? '#1a0c0a' : '#0e161c';
      cs.forEach(([cx, cy], i) => {
        if (gone) { d.set(ox + cx, oy + cy, on ? '✕' : '╳', on ? '#2a0e02' : '#5a2418', bg); return; }
        const isLost = i < cs.length - keep, newly = isLost && i >= cs.length - keepP && tagOn;
        const ch = newly ? '✕' : isLost ? '·' : onStruct ? '○' : '●';
        const fg = on ? (isLost ? '#7a2c08' : '#2a0e02') : newly ? '#ff9a40' : isLost ? '#33414b' : onStruct ? '#e0603a' : healthColor(frac);
        d.set(ox + cx, oy + cy, ch, fg, bg);
      });
      const dmg = uf.struck.get(key);
      if (dmg && tagOn) {
        const xs = cs.map((c) => c[0]), top = Math.min(...cs.map((c) => c[1]));
        const txt = ` -${dmg} `, mx = Math.round((Math.min(...xs) + Math.max(...xs)) / 2);
        d.text(ox + mx - (txt.length >> 1), oy + top - 1, txt, on ? '#2a0e02' : '#ffffff', on ? '#ffd27a' : '#c04010', 99, true);
      }
    }
  };
  const fx = x0 + 1, mech = f.kind === 'mech';
  let rx = x0 + 33, ly = y + 10, list = ['HD', 'CT', 'RT', 'LT', 'RA', 'LA', 'RL', 'LL'];
  if (mech) {
    draw(FRONT_G, fx, y, false);
    d.text(fx, y, 'R', C.dim); d.text(fx + 29, y, 'L', C.dim);
    d.text(fx + 9, y + 22, '── FRONT ──', C.faint);
    draw(REAR_G, rx - 1, y + 1, true);
    d.text(rx + 4, y + 8, '─ REAR ─', C.faint);
  } else if (f.kind === 'turret') {
    draw(EMPLACEMENT_G, fx, y + 5, false);
    d.text(fx + 7, y + 18, '── EMPLACEMENT ──', C.faint);
    list = ['T']; ly = y + 2;
  } else {
    // Seen from above, so its left is on your left
    draw(vehicleGrid(f), fx, y + 1, false);
    d.text(fx + 12, y, '▲ FRONT', C.dim);
    d.text(fx + 2, y, 'L', C.dim); d.text(fx + 28, y, 'R', C.dim);
    d.text(fx + 8, y + 21, '── TOP VIEW ──', C.faint);
    list = ['F', 'L', 'R', 'B', 'T'].filter((l) => (f.maxStruct[l] ?? 0) > 0); ly = y + 2;
  }
  // Exact values: armour now / max, or internal structure once the armour is gone
  const name = (l: string) => (mech ? l : (LOC_NAMES[l] ?? l).replace(' Side', '').padEnd(6).slice(0, 6));
  const vx = mech ? 3 : 7;
  if (!mech) rx = x0 + 33;
  for (const l of list) {
    const maxA = f.maxArmor[l] ?? 0, arm = Math.max(0, uf.cur.arm[l] ?? 0), str = Math.max(0, uf.cur.str[l] ?? 0);
    const lost = (Math.max(0, uf.start.arm[l] ?? 0) - arm) + (Math.max(0, uf.start.str[l] ?? 0) - str) + (l.endsWith('T') ? Math.max(0, uf.start.arm[l + 'R'] ?? 0) - Math.max(0, uf.cur.arm[l + 'R'] ?? 0) : 0);
    const fl = tagOn && (uf.struck.has(l) || uf.struck.has(l + 'R'));
    d.text(rx, ly, name(l), fl ? C.bright : C.dim);
    if (str <= 0) d.text(rx + vx, ly, ' GONE', '#c04a3a');
    else if (arm > 0) d.text(rx + vx, ly, `${String(arm).padStart(3)}/${maxA}`, fl ? '#ffd080' : healthColor(arm / Math.max(1, maxA)));
    else d.text(rx + vx, ly, ` IS ${str}`, '#e0603a');
    if (lost > 0) d.text(rx + vx + (mech ? 8 : 0), ly + (mech ? 0 : 1), mech ? `-${lost}` : `       -${lost}`, '#ff7a3a');
    if (!mech) ly++;
    ly++;
  }
  // Shot ledger: one line per weapon, newest at the bottom
  let yy = y + 24;
  d.text(x0 + 1, yy++, 'SHOT LEDGER', C.faint);
  const lines: { text: string; color: string; marks?: string; locs?: string; fresh: boolean }[] = [];
  uf.rows.forEach((r, i) => {
    const fresh = i === uf.rows.length - 1 && tagOn && !finished;
    const marks = '■'.repeat(Math.min(6, r.hits)) + '·'.repeat(Math.max(0, Math.min(6 - r.hits, r.shots - r.hits)));
    lines.push({ text: r.w.padEnd(16).slice(0, 16), color: r.hits ? C.text : C.dim, marks, locs: r.hits ? r.locs : 'miss', fresh });
    for (const c of r.crits) lines.push({ text: `  ✶ CRIT ${c}`, color: '#f0d050', fresh: false });
  });
  const room = y0 + h - 3 - yy;
  for (const ln of lines.slice(-Math.max(1, room))) {
    const bg = ln.fresh ? '#2a1a10' : C.panel;
    d.fill(x0 + 1, yy, w - 2, 1, ' ', C.text, bg);
    d.text(x0 + 1, yy, ln.text, ln.fresh ? C.bright : ln.color, bg, w - 2);
    if (ln.marks !== undefined) {
      d.text(x0 + 18, yy, ln.marks.padEnd(7), ln.locs === 'miss' ? C.faint : '#f0a830', bg);
      d.text(x0 + 25, yy, ln.locs!, ln.locs === 'miss' ? C.faint : '#f2c060', bg, w - 26);
    }
    yy++;
  }
  // Footer: running damage, and the outcome once the volley is over
  const fy = y0 + h - 2;
  d.text(x0 + 1, fy, 'DAMAGE', C.faint);
  d.text(x0 + 8, fy, String(uf.dmg), finished ? '#ff7a4a' : C.bright, C.panel, 99, true);
  if (finished && !t.alive) d.text(x0 + 14, fy, 'DESTROYED', '#ff5a3a', C.panel, 99, true);
  d.text(x0 + w - 14, fy, 'click to hide', C.faint);
}
