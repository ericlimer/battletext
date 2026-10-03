// Battlefield survey: a half-block minimap of a contract's battlefield, generated from its seed,
// with the drop zone, objectives and an intel estimate of the opposition.

import { Display } from '../engine/display';
import { C, lerp, scale } from '../engine/color';
import { Contract, Company, mechReady, workQueueDays, travelMult } from '../game/company';
import { route } from '../game/world';
import { setupMission, MissionRuntime } from '../combat/missions';
import { BIOME_INFO } from '../combat/terrain';
import { SIDE } from '../combat/battle';
import { isAvailable, skillTotal } from '../game/pilot';
import { Frame, cloneFrame, frameTons, frameStats, newMechFrame } from '../game/frame';

const cache = new Map<string, MissionRuntime>();

export type DropSlot = { mech: string | null; pilot: string | null };

/** The lance the drop screen starts with: the heaviest ready 'Mechs, each paired with the best available MechWarrior.
 *  readyIn counts 'Mechs and pilots that will be ready within that many days (for contracts reached by travel).
 *  Contract odds use the same lance, so the estimate matches the drop. */
export function defaultSlots(c: Company, readyIn = 0): DropSlot[] {
  const readyM = c.mechs.filter((m) => mechReady(c, m) || (readyIn > 0 && m.struct.CT > 0 && m.struct.HD > 0 && workQueueDays(c, m.uid) <= readyIn));
  const readyP = c.pilots.filter((p) => isAvailable(p) || (readyIn > 0 && !p.dead && p.healDays <= readyIn));
  const slots: DropSlot[] = [0, 1, 2, 3].map(() => ({ mech: null, pilot: null }));
  // Strongest 'Mechs (firepower × armor, so a stripped hulk doesn't outrank an armed light) get the best gunners
  const power = (m: Frame) => { const u = unitPower(m, 5); return Math.sqrt(u.fp * u.dur); };
  const byTons = [...readyM].sort((a, b) => power(b) - power(a) || frameTons(b) - frameTons(a));
  const bySkill = [...readyP].sort((a, b) => b.gun * 2 + b.pil + b.tac * 0.5 - (a.gun * 2 + a.pil + a.tac * 0.5) || skillTotal(b) - skillTotal(a));
  slots.forEach((s, i) => { if (byTons[i] && bySkill[i]) { s.mech = byTons[i].uid; s.pilot = bySkill[i].id; } });
  return slots;
}

/** The 'Mechs that would actually drop (those with a pilot). */
export function likelyLance(c: Company, readyIn = 0): Frame[] {
  return defaultSlots(c, readyIn).filter((s) => s.mech && s.pilot).map((s) => c.mechs.find((m) => m.uid === s.mech)!).filter(Boolean);
}

/** Days until a contract's battle: the trip there for travel contracts. */
export function daysToContract(c: Company, k: Contract): number {
  if (!k.sysId || k.sysId === c.location) return 0;
  return route(c.systems, c.location, k.sysId, travelMult(c))?.days ?? 0;
}

/** Builds (once) the mission a contract would launch, using placeholder 'Mechs for the player. */
export function surveyOf(c: Company, k: Contract): MissionRuntime {
  const lance = likelyLance(c, daysToContract(c, k));
  const key = `${k.id}:${k.seed}:${lance.map((m) => m.uid).join(',')}`;
  let rt = cache.get(key);
  if (!rt) {
    const frames = (lance.length ? lance : c.mechs.slice(0, 4)).map(cloneFrame);
    if (!frames.length) frames.push(newMechFrame('LCT-1V'));
    rt = setupMission({
      type: k.type, difficulty: k.diff, biome: k.biome, seed: k.seed, night: k.night,
      employer: k.employer, target: k.target, targetName: k.targetName, basePay: k.pay,
      player: frames.map((f) => ({ frame: f, pilot: null })),
    });
    if (cache.size > 40) cache.clear();
    cache.set(key, rt);
  }
  return rt;
}

function tileColor(rt: MissionRuntime, i: number): string {
  const m = rt.battle.map;
  const B = BIOME_INFO[m.biome];
  const e = m.elev[i];
  const base = scale(B.ground[e], 1.25 + e * 0.22 + m.hill[i] * 0.25);
  switch (m.terr[i]) {
    case 'lforest': return lerp(base, B.forest[0], 0.45);
    case 'hforest': return lerp(base, B.forest[1], 0.55);
    case 'water': return scale(B.water[1], 1.6);
    case 'deep': return scale(B.water[1], 1.1);
    case 'rock': return scale(B.rock, 0.9);
    case 'road': return lerp(base, '#d8d0b8', 0.35);
    case 'building': case 'wall': {
      const st = m.structures[m.struct[i]];
      if (st?.objective) return SIDE(st.team) === 0 ? '#3aa8d8' : '#e8603a';
      return '#8a8a84';
    }
    case 'rubble': return '#5a5048';
    default: return base;
  }
}

/** Draws the survey at (x, y): w = map width columns, map height / 2 rows. */
const colorCache = new WeakMap<MissionRuntime, string[]>();
export function drawSurvey(d: Display, rt: MissionRuntime, x: number, y: number): void {
  const m = rt.battle.map;
  let cols = colorCache.get(rt);
  if (!cols) { cols = []; for (let i = 0; i < m.w * m.h; i++) cols.push(tileColor(rt, i)); colorCache.set(rt, cols); }
  const tileColorC = (_rt: MissionRuntime, i: number) => cols![i];
  for (let row = 0; row < m.h / 2; row++) {
    for (let col = 0; col < m.w; col++) {
      const top = tileColorC(rt, row * 2 * m.w + col);
      const bot = row * 2 + 1 < m.h ? tileColorC(rt, (row * 2 + 1) * m.w + col) : top;
      d.set(x + col, y + row, '▀', m.night ? scale(top, 0.6) : top, m.night ? scale(bot, 0.6) : bot);
    }
  }
  const mark = (tx: number, ty: number, ch: string, fg: string) => {
    const cx = x + Math.max(0, Math.min(m.w - 1, tx)), cy = y + Math.max(0, Math.min(m.h / 2 - 1, ty >> 1));
    d.set(cx, cy, ch, fg, '#05070a');
  };
  // Drop zone
  for (const u of rt.playerUnits) mark(u.x, u.y, '▲', C.cyan);
  // Escort/assassination exits and objective focal points
  for (const u of [...rt.enemyUnits, ...rt.battle.units.filter((v) => v.team === 2)]) {
    if ((u.tag === 'convoy' || u.tag === 'target') && u.ai.goal) mark(u.ai.goal[0], u.ai.goal[1], '×', '#f0c040');
  }
  for (const bc of rt.battle.map.beacons ?? []) mark(bc.x, bc.y, '◎', '#f0c040');
  if (rt.spec.type === 'escort') for (const u of rt.battle.units.filter((v) => v.tag === 'convoy')) mark(u.x, u.y, '■', '#6ad46a');
}

/** Fighting power of one unit: expected damage per volley (scaled by gunnery) and how much it can soak. */
export function unitPower(f: Frame, gun: number): { fp: number; dur: number } {
  const st = frameStats(f);
  const acc = Math.max(0.25, Math.min(0.95, (45 + gun * 3) / 100));
  return { fp: st.alphaDmg * acc, dur: st.armorTotal + st.structTotal };
}

/** Lanchester-style odds: (firepower × durability) of each side, square-rooted so 1.0 is an even fight. */
export function fightOdds(c: Company, k: Contract, lance?: DropSlot[]): { ratio: number; you: number; them: number } {
  const slots = (lance ?? defaultSlots(c, daysToContract(c, k))).filter((x) => x.mech && x.pilot);
  let pf = 0, pd = 0;
  for (const sl of slots) { const m = c.mechs.find((q) => q.uid === sl.mech)!; const p = c.pilots.find((q) => q.id === sl.pilot)!; const u = unitPower(m, p.gun); pf += u.fp; pd += u.dur; }
  const rt = surveyOf(c, k);
  let ef = 0, ed = 0;
  for (const u of rt.battle.units) {
    if (SIDE(u.team) !== 1 || u.tag === 'convoy') continue;
    const w = unitPower(u.frame, u.pilot?.gun ?? 3); ef += w.fp; ed += w.dur;
  }
  const you = pf * pd, them = Math.max(1, ef * ed);
  return { ratio: Math.sqrt(you / them), you, them };
}

/** Intel estimate of the opposition: unit count and tonnage, rounded so it stays an estimate. */
export function oppositionEstimate(rt: MissionRuntime): { units: number; tons: number; mechs: number } {
  const foes = rt.battle.units.filter((u) => SIDE(u.team) === 1 && u.frame.kind !== 'turret' && u.tag !== 'convoy');
  const tons = foes.reduce((a, u) => a + frameTons(u.frame), 0);
  return { units: foes.length, tons: Math.round(tons / 25) * 25, mechs: foes.filter((u) => u.frame.kind === 'mech').length };
}

export function oddsText(ratio: number): [string, string] {
  return ratio >= 1.35 ? ['strongly favoured', '#6ad46a'] : ratio >= 1.1 ? ['favourable odds', '#6ad46a'] : ratio >= 0.85 ? ['an even fight', '#f0c040'] : ratio >= 0.65 ? ['outgunned', '#e8803a'] : ['badly outgunned', '#e8503a'];
}

/** What makes each mission type dangerous beyond raw strength. */
export const MISSION_RISK: Record<string, string> = {
  battle: '', assassinate: 'The target bolts for the map edge if hurt or after round 9 — bring speed.',
  destroybase: 'Defensive turrets add firepower the estimate counts; buildings soak shots.',
  defendbase: 'Attackers arrive in waves; the base must survive.',
  ambush: 'Haulers flee for the edge — fast \'Mechs and long range matter more than armor.',
  escort: 'Haulers only move with your \'Mechs close; losing two fails the contract.',
  capture: 'You must hold each beacon with nobody hostile nearby.',
};
