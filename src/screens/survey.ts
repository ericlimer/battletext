// Battlefield survey: a half-block minimap of a contract's battlefield, generated from its seed,
// with the drop zone, objectives and an intel estimate of the opposition.

import { Display } from '../engine/display';
import { C, lerp, scale } from '../engine/color';
import { Contract, Company, mechReady } from '../game/company';
import { setupMission, MissionRuntime } from '../combat/missions';
import { BIOME_INFO } from '../combat/terrain';
import { SIDE } from '../combat/battle';
import { Frame, cloneFrame, frameTons, newMechFrame } from '../game/frame';

const cache = new Map<string, MissionRuntime>();

/** The lance the drop screen would field: heaviest ready 'Mechs first. */
export function likelyLance(c: Company): Frame[] {
  return c.mechs.filter((m) => mechReady(c, m)).sort((a, b) => frameTons(b) - frameTons(a)).slice(0, 4);
}

/** Builds (once) the mission a contract would launch, using placeholder 'Mechs for the player. */
export function surveyOf(c: Company, k: Contract): MissionRuntime {
  const lance = likelyLance(c);
  const key = `${k.id}:${k.seed}:${lance.length}`;
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

/** Intel estimate of the opposition: unit count and tonnage, rounded so it stays an estimate. */
export function oppositionEstimate(rt: MissionRuntime): { units: number; tons: number; mechs: number } {
  const foes = rt.battle.units.filter((u) => SIDE(u.team) === 1 && u.frame.kind !== 'turret' && u.tag !== 'convoy');
  const tons = foes.reduce((a, u) => a + frameTons(u.frame), 0);
  return { units: foes.length, tons: Math.round(tons / 25) * 25, mechs: foes.filter((u) => u.frame.kind === 'mech').length };
}
