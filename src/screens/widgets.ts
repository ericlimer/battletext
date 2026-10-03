// Reusable drawing widgets: paper doll, bars, pips, weapon rows.

import { Display } from '../engine/display';
import { C, healthColor, scale, lerp } from '../engine/color';
import { Frame, frameStats, frameName } from '../game/frame';
import { item, HARD_COLORS, LOC_NAMES } from '../data/items';
import { chassis, CLASS_NAMES, classOf } from '../data/mechs';
import { Pilot, health, SKILLS, SKILL_NAMES } from '../game/pilot';
import { UI } from '../engine/ui';

export const DOLL_W = 29;
export const DOLL_H = 10;
const COLX: Record<string, number> = { LA: 0, LT: 6, CT: 12, RT: 18, RA: 24 };

export interface DollOpts {
  highlight?: string | null;
  pct?: Record<string, number>; // called-shot percentages
  onHover?: (loc: string) => void;
  maxArmor?: boolean; // show configured maxima instead of damage (mechlab)
  label?: boolean;
}

function box(d: Display, x: number, y: number, val: number, max: number, dead: boolean, struct: boolean, hl: boolean): void {
  const f = max > 0 ? val / max : 0;
  let bg = dead ? '#1a1a1a' : scale(healthColor(f), struct ? 0.28 : 0.42);
  let fg = dead ? '#555555' : struct ? lerp(healthColor(f), '#ffffff', 0.35) : '#f4f6f8';
  if (max === 0 && !dead) { bg = '#161b20'; fg = '#4a5560'; }
  if (hl) { bg = lerp(bg, '#f0a830', 0.55); fg = '#ffffff'; }
  const s = dead ? '  ✕  ' : String(Math.round(val)).padStart(4, ' ') + ' ';
  d.text(x, y, s, fg, bg);
}

/** Draw a mech paper doll. Returns rect of each location for hit-testing. */
export function drawDoll(ui: UI, x: number, y: number, f: Frame, o: DollOpts = {}): Record<string, [number, number, number, number]> {
  const d = ui.d;
  const rects: Record<string, [number, number, number, number]> = {};
  const lab = (lx: number, ly: number, t: string, loc: string) => {
    const hl = o.highlight === loc;
    const p = o.pct?.[loc];
    const txt = p !== undefined ? `${t}${Math.round(p)}%` : t;
    d.text(lx, ly, txt.slice(0, 6), hl ? C.accent : C.dim);
  };
  const loc = (l: string, bx: number, by: number, withRear: boolean) => {
    const dead = (f.struct[l] ?? 0) <= 0;
    const hl = o.highlight === l;
    const am = o.maxArmor ? f.maxArmor[l] : f.armor[l] ?? 0;
    const amMax = o.maxArmor ? Math.max(1, f.maxArmor[l]) : f.maxArmor[l] ?? 0;
    box(d, bx, by, am, amMax, dead, false, hl);
    box(d, bx, by + 1, f.struct[l] ?? 0, f.maxStruct[l] ?? 0, dead, true, hl);
    let h = 2;
    if (withRear) {
      const r = l + 'R';
      const ra = o.maxArmor ? f.maxArmor[r] : f.armor[r] ?? 0;
      const rm = o.maxArmor ? Math.max(1, f.maxArmor[r]) : f.maxArmor[r] ?? 0;
      box(d, bx, by + 2, ra, rm, dead, false, o.highlight === r);
      d.set(bx, by + 2, 'r', dead ? '#555' : '#c8d2d8');
      h = 3;
    }
    rects[l] = [bx, by - 1, 5, h + 1];
    if (ui.hover(bx, by - 1, 5, h + 1) && o.onHover) o.onHover(l);
  };
  if (f.kind === 'mech') {
    lab(x + COLX.CT, y, 'HD', 'HD');
    loc('HD', x + COLX.CT, y + 1, false);
    for (const l of ['LA', 'LT', 'CT', 'RT', 'RA']) lab(x + COLX[l], y + 3, l, l);
    loc('LA', x + COLX.LA, y + 4, false);
    loc('LT', x + COLX.LT, y + 4, true);
    loc('CT', x + COLX.CT, y + 4, true);
    loc('RT', x + COLX.RT, y + 4, true);
    loc('RA', x + COLX.RA, y + 4, false);
    lab(x + COLX.LT, y + 7, 'LL', 'LL');
    lab(x + COLX.RT, y + 7, 'RL', 'RL');
    loc('LL', x + COLX.LT, y + 8, false);
    loc('RL', x + COLX.RT, y + 8, false);
  } else {
    // Vehicle / turret: F on top, L T R middle, B bottom
    const place: Record<string, [number, number]> = { F: [COLX.CT, 0], L: [COLX.LT, 3], T: [COLX.CT, 3], R: [COLX.RT, 3], B: [COLX.CT, 7] };
    for (const [l, [dx, dy]] of Object.entries(place)) {
      if (f.maxStruct[l] === undefined) continue;
      lab(x + dx, y + dy, l === 'T' && f.kind === 'turret' ? 'BODY' : l === 'F' ? 'FRONT' : l === 'B' ? 'REAR' : l === 'T' ? 'TURR' : l === 'L' ? 'LEFT' : 'RIGHT', l);
      loc(l, x + dx, y + dy + 1, false);
    }
  }
  return rects;
}

export function heatBar(d: Display, x: number, y: number, w: number, heat: number, projected: number, cap: number, dissip: number): void {
  const cells = w;
  const f = (v: number) => Math.max(0, Math.min(1, v / cap));
  const cur = f(heat), proj = f(projected), after = f(Math.max(0, projected - dissip));
  for (let i = 0; i < cells; i++) {
    const a = (i + 0.5) / cells;
    let bg = '#1a1210';
    let ch = ' ';
    let fg = '#ff6a2a';
    if (a <= cur) bg = lerp('#a03010', '#ff6a2a', a);
    else if (a <= proj) bg = '#5a2410';
    if (a > after - 1 / cells / 2 && a <= after + 1 / cells / 2 && proj > 0) { ch = '▏'; fg = '#ffe0a0'; }
    if (Math.abs(a - 0.75) < 0.5 / cells) { ch = '│'; fg = '#ff3a1a'; }
    d.set(x + i, y, ch, fg, bg);
  }
}

export function simpleBar(d: Display, x: number, y: number, w: number, frac: number, color: string, back = '#161c22', mark = -1): void {
  for (let i = 0; i < w; i++) {
    const a = (i + 0.5) / w;
    d.set(x + i, y, Math.abs(a - mark) < 0.5 / w ? '│' : ' ', '#ffffff', a <= frac ? color : back);
  }
}

export function pipStr(n: number, max: number): string {
  return '◆'.repeat(n) + '◇'.repeat(Math.max(0, max - n));
}

export function skillLine(p: Pilot): string {
  return `{#6d7f8a}G{/}${p.gun} {#6d7f8a}P{/}${p.pil} {#6d7f8a}U{/}${p.gut} {#6d7f8a}T{/}${p.tac}`;
}

export function healthPips(p: Pilot, injuriesOverride?: number): string {
  const h = health(p);
  const inj = injuriesOverride ?? p.injuries;
  return `{#6ad46a}${'♥'.repeat(Math.max(0, h - inj))}{/}{#5a2020}${'♥'.repeat(Math.min(h, inj))}{/}`;
}

export function frameTitle(f: Frame): string {
  if (f.kind !== 'mech') return frameName(f);
  const c = chassis(f.defId);
  return `${c.name.toUpperCase()} ${c.id}`;
}

export function classTag(f: Frame): string {
  if (f.kind !== 'mech') return f.kind === 'turret' ? 'EMPLACEMENT' : 'VEHICLE';
  const c = chassis(f.defId);
  return `${CLASS_NAMES[classOf(c.tons)].toUpperCase()} ${c.tons}t`;
}

export function hardpointStr(f: Frame): string {
  if (f.kind !== 'mech') return '';
  const c = chassis(f.defId);
  const cnt: Record<string, number> = { B: 0, E: 0, M: 0, S: 0 };
  for (const l in c.hardpoints) for (const h of c.hardpoints[l as keyof typeof c.hardpoints]!) cnt[h]++;
  return (['B', 'E', 'M', 'S'] as const).filter((h) => cnt[h]).map((h) => `{${HARD_COLORS[h]}}${cnt[h]}${h}{/}`).join(' ');
}

export function weaponTip(id: string): string[] {
  const w = item(id);
  const out = [`{#f2f6f8}${w.name}{/}  {#6d7f8a}${w.tons}t · ${w.slots} slot${w.slots > 1 ? 's' : ''}{/}`];
  if (w.kind === 'weapon') {
    out.push(`Damage {#f2f6f8}${w.dmg}${(w.shots ?? 1) > 1 ? ` x${w.shots}` : ''}{/}  Heat {#ff6a2a}${w.heat}{/}  Stability {#8ab4ff}${w.stab}{/}`);
    out.push(`Range ${w.min ? `{#e8503a}min ${w.min}{/} · ` : ''}short ${w.sr} · med ${w.mr} · long ${w.lr} tiles`);
    if (w.acc) out.push(`Accuracy ${w.acc > 0 ? `{#6ad46a}+${w.acc}%{/}` : `{#e8803a}${w.acc}%{/}`}`);
    if (w.bonusText) out.push(`{#f0a830}${w.bonusText}{/}`);
  }
  if (w.kind === 'ammo') out.push(w.explode ? `${w.ammoShots} shots · explodes if critted (up to ${Math.min(180, Math.round((w.ammoShots ?? 0) * w.explode * 0.35))} damage when full)` : `${w.ammoShots} shots`);
  out.push(`{#6d7f8a}${w.desc}{/}`);
  return out;
}

export function skillBars(d: Display, x: number, y: number, p: Pilot, w = 10): void {
  SKILLS.forEach((s, i) => {
    d.text(x, y + i, SKILL_NAMES[s].padEnd(9), C.dim);
    for (let k = 0; k < w; k++) d.set(x + 9 + k, y + i, k < p[s] ? '■' : '·', k < p[s] ? (k >= 7 ? C.accent : k >= 4 ? C.cyan : C.text) : C.faint);
    d.text(x + 10 + w, y + i, String(p[s]).padStart(2), C.bright);
  });
}

export function statsSummary(f: Frame): { label: string; val: string; frac: number; tip: string }[] {
  const s = frameStats(f, false);
  const fp = s.alphaDmg;
  return [
    { label: 'Firepower', val: String(fp), frac: Math.min(1, fp / 400), tip: 'Total damage if every weapon hits.' },
    { label: 'Heat Eff.', val: `${s.alphaHeat}/${s.dissip}`, frac: Math.min(1, s.dissip / Math.max(1, s.alphaHeat)), tip: 'Alpha strike heat vs. heat dissipated per turn.' },
    { label: 'Durability', val: String(s.armorMax + Object.values(f.maxStruct).reduce((a, b) => a + b, 0)), frac: Math.min(1, (s.armorMax + 400) / 2400), tip: 'Total armor plus internal structure.' },
    { label: 'Mobility', val: `${s.walk}/${s.sprint}${s.jump ? `/${s.jump}J` : ''}`, frac: Math.min(1, (s.walk + s.jump * 0.5) / 12), tip: 'Walk / sprint / jump distance in tiles.' },
    { label: 'Melee', val: String(s.meleeDmg), frac: Math.min(1, s.meleeDmg / 110), tip: 'Melee attack damage. Death From Above deals more.' },
  ];
}

export function locName(l: string): string { return LOC_NAMES[l] ?? l; }
