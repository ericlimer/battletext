// Mission setup: force generation, map layout, spawns and objectives for each contract type.

import { RNG } from '../engine/rng';
import { CHASSIS, ChassisDef } from '../data/mechs';
import { VEHICLES, VehicleDef } from '../data/vehicles';
import { bonusesFor, item } from '../data/items';
import { faction } from '../data/factions';
import { Frame, newMechFrame, newVehicleFrame } from '../game/frame';
import { Pilot, makePilot, uniqueCallsign } from '../game/pilot';
import { Battle, Unit, SIDE } from './battle';
import { Biome, generateMap, MapGenOpts, TERRAIN, BattleMap, dist } from './terrain';

export type MissionType = 'battle' | 'assassinate' | 'destroybase' | 'defendbase' | 'ambush' | 'escort' | 'capture';

export const MISSION_INFO: Record<MissionType, { name: string; desc: string; glyph: string }> = {
  battle: { name: 'Battle', glyph: '⚔', desc: 'Engage and destroy all hostile forces in the area.' },
  assassinate: { name: 'Assassinate', glyph: '◎', desc: 'Locate and destroy a high-value target before it escapes.' },
  destroybase: { name: 'Destroy Base', glyph: '■', desc: 'Raze the enemy installation. Expect turrets and a defending lance.' },
  defendbase: { name: 'Defend Base', glyph: '⌂', desc: 'Protect the employer\'s facility from waves of attackers.' },
  ambush: { name: 'Ambush Convoy', glyph: '»', desc: 'Intercept and destroy a supply convoy before it leaves the map.' },
  escort: { name: 'Escort Convoy', glyph: '«', desc: 'Protect a friendly convoy until it reaches the extraction point.' },
  capture: { name: 'Target Acquisition', glyph: '¤', desc: 'Seize three data beacons held by a defending lance.' },
};

export interface Objective {
  id: string;
  text: string;
  primary: boolean;
  status: 'active' | 'done' | 'failed';
  bonus: number; // C-Bills for optional objectives
  progress?: string;
}

export interface Combatant { frame: Frame; pilot: Pilot | null; }

export interface MissionSpec {
  type: MissionType;
  difficulty: number; // 1..10 (half-skulls)
  biome: Biome;
  seed: number;
  night: boolean;
  employer: string;
  target: string;
  player: Combatant[];
  enemies?: Combatant[]; // explicit (skirmish)
  targetName?: string;
  basePay?: number;
  morale?: number;
  startResolve?: number; // bonus Resolve at deployment (Argo upgrades)
}

export interface MissionRuntime {
  spec: MissionSpec;
  battle: Battle;
  objectives: Objective[];
  enemyUnits: Unit[];
  playerUnits: Unit[];
  briefing: string[];
}

// ---- Force generation --------------------------------------------------------------------
export function pilotTier(d: number): number {
  return d <= 2 ? 0 : d <= 4 ? 1 : d <= 6 ? 2 : d <= 8 ? 3 : 4;
}

function upgradeWeapons(r: RNG, f: Frame, chance: number): void {
  for (const c of f.items) {
    const d = item(c.id);
    if (d.kind !== 'weapon' || !r.chance(chance)) continue;
    const bs = bonusesFor(d.base);
    const tier = r.chance(0.2 + chance) ? (r.chance(chance) ? 3 : 2) : 1;
    c.id = `${d.base}+${tier}${r.pick(bs)}`;
  }
}

export function pickChassis(r: RNG, targetTons: number, maxRarity: number, prefs: string[]): ChassisDef {
  const pool = CHASSIS.filter((c) => c.rarity <= maxRarity && Math.abs(c.tons - targetTons) <= 10);
  const src = pool.length ? pool : CHASSIS.filter((c) => c.rarity <= maxRarity);
  return r.weighted(src, (c) => (1 / (1 + Math.abs(c.tons - targetTons) / 6)) * (prefs.includes(c.name) ? 2.2 : 1) * (1 / (1 + c.rarity * 0.4)));
}

function pickVehicle(r: RNG, targetTons: number): VehicleDef {
  const pool = VEHICLES.filter((v) => v.kind === 'vehicle' && v.role !== 'convoy' && Math.abs(v.tons - targetTons) <= 15);
  const src = pool.length ? pool : VEHICLES.filter((v) => v.kind === 'vehicle' && v.role !== 'convoy');
  return r.weighted(src, (v) => 1 / (1 + Math.abs(v.tons - targetTons) / 10));
}

export function generateForce(r: RNG, d: number, factionId: string, count: number, opts: { noVehicles?: boolean; heavier?: number } = {}): Combatant[] {
  const f = faction(factionId);
  const out: Combatant[] = [];
  const avg = (d <= 2 ? 23 + d * 4 : 20 + d * 7.5) + (opts.heavier ?? 0);
  const maxRarity = Math.floor(d / 3) + 1;
  const tier = pilotTier(d);
  for (let i = 0; i < count; i++) {
    const tons = Math.max(20, Math.min(100, avg + r.gauss(0, d <= 3 ? 7 : 11)));
    const veh = !opts.noVehicles && r.chance(f.vehicleRatio * (d > 7 ? 0.6 : 1));
    let frame: Frame;
    if (veh) frame = newVehicleFrame(pickVehicle(r, tons + 5).id);
    else {
      frame = newMechFrame(pickChassis(r, tons, maxRarity, f.prefers).id);
      upgradeWeapons(r, frame, Math.min(0.5, 0.02 + d * 0.035 * (0.6 + f.techBias)));
    }
    const pilot = makePilot(r, d <= 2 ? 0 : Math.max(0, Math.min(4, tier + (r.chance(0.2) ? 1 : 0) - (r.chance(0.2) ? 1 : 0))));
    out.push({ frame, pilot });
  }
  return out;
}

// ---- Map + spawn helpers ------------------------------------------------------------------
export function findSpot(b: Battle, x: number, y: number, maxR = 8): [number, number] | null {
  const m = b.map;
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const xx = x + dx, yy = y + dy;
      if (xx < 1 || yy < 1 || xx >= m.w - 1 || yy >= m.h - 1) continue;
      const i = yy * m.w + xx;
      if (!isFinite(TERRAIN[m.terr[i]].cost) || m.terr[i] === 'deep') continue;
      if (b.units.some((u) => (u.alive || !u.deployed) && u.x === xx && u.y === yy)) continue;
      return [xx, yy];
    }
  }
  return null;
}

function place(b: Battle, list: Combatant[], team: number, cx: number, cy: number, facing: number, opts: Partial<Unit> = {}, spread = 2): Unit[] {
  const out: Unit[] = [];
  list.forEach((c, k) => {
    const ox = (k % 2) * spread * 2 - spread, oy = Math.floor(k / 2) * spread * 2 - spread;
    const spot = findSpot(b, cx + ox, cy + oy, 10) ?? findSpot(b, cx, cy, 20);
    if (!spot) return;
    out.push(b.addUnit(c.frame, c.pilot, team, spot[0], spot[1], facing, opts));
  });
  return out;
}

/** 'A' or 'An' for a faction name. */
const art = (w: string) => (/^[AEIOU]/i.test(w) ? 'An' : 'A');

// ---- Setup --------------------------------------------------------------------------------
export function setupMission(spec: MissionSpec): MissionRuntime {
  const r = new RNG(spec.seed);
  const d = spec.difficulty;
  const W = 64, H = 44;
  const t = spec.type;
  const mo: MapGenOpts = { w: W, h: H, biome: spec.biome, night: spec.night, road: null, base: null, clear: [] };
  // Player deploys on the west; enemies east (layout varies by type)
  const pStart: [number, number] = [5, Math.floor(H / 2) + r.int(-8, 8)];
  let eStart: [number, number] = [W - 7, Math.floor(H / 2) + r.int(-10, 10)];
  if (t === 'destroybase') mo.base = { x: W - 20, y: Math.floor(H / 2) - 7, w: 15, h: 14, buildings: 5, walls: true, team: 1, objectiveCount: 3 };
  if (t === 'defendbase') mo.base = { x: 6, y: Math.floor(H / 2) - 7, w: 14, h: 14, buildings: 5, walls: r.chance(0.6), team: 0, objectiveCount: 3 };
  if (t === 'ambush' || t === 'escort') mo.road = 'h';
  // Target Acquisition: three beacons across the middle and far side of the map
  const beacons: { x: number; y: number; owner: number }[] = [];
  if (t === 'capture') {
    for (const [fx, fy] of [[0.48, 0.22], [0.66, 0.5], [0.48, 0.78]]) beacons.push({ x: Math.round(W * fx) + r.int(-3, 3), y: Math.round(H * fy) + r.int(-3, 3), owner: 1 });
    for (const bc of beacons) mo.clear!.push({ x: bc.x, y: bc.y, r: 2 });
  }
  mo.clear!.push({ x: pStart[0], y: pStart[1], r: 4 }, { x: eStart[0], y: eStart[1], r: 4 });
  const map: BattleMap = generateMap(r, mo);
  if (beacons.length) map.beacons = beacons;
  const b = new Battle(map, r);
  if (spec.morale !== undefined) { b.morale = spec.morale; b.resolveMax[0] = 60 + spec.morale * 2; b.resolve[0] = Math.round(spec.morale / 2); }
  if (spec.startResolve) b.resolve[0] = Math.min(b.resolveMax[0], b.resolve[0] + spec.startResolve);
  const objectives: Objective[] = [];
  const briefing: string[] = [];
  const emp = faction(spec.employer), tgt = faction(spec.target);
  let enemyUnits: Unit[] = [];
  let playerUnits: Unit[] = [];

  const bonus = (spec.basePay ?? 100000) * 0.25;

  const enemyLance = (count = 4, extra: Parameters<typeof generateForce>[4] = {}) => spec.enemies ?? generateForce(r, d, spec.target, d <= 2 ? Math.min(count, 3) : count, extra);

  const road = () => {
    // find the road rows at west/east edges
    let wy = -1, ey = -1;
    for (let y = 0; y < H; y++) { if (map.terr[y * W] === 'road' && wy < 0) wy = y; if (map.terr[y * W + W - 1] === 'road' && ey < 0) ey = y; }
    return { wy: wy < 0 ? H / 2 : wy, ey: ey < 0 ? H / 2 : ey };
  };

  switch (t) {
    case 'battle': {
      playerUnits = place(b, spec.player, 0, pStart[0], pStart[1], 2);
      // Meeting engagement: the lances start close enough to make contact by round 2
      enemyUnits = place(b, enemyLance(4), 1, W - 20, eStart[1], 6);
      if (d >= 6 && !spec.enemies) {
        const reinf = generateForce(r, d - 1, spec.target, 2);
        const ru = place(b, reinf, 1, W - 4, r.chance(0.5) ? 5 : H - 6, 6, { deployRound: 3, deployed: false });
        enemyUnits.push(...ru);
      }
      objectives.push({ id: 'kill', text: 'Destroy all hostile forces', primary: true, status: 'active', bonus: 0 });
      objectives.push({ id: 'nolosses', text: 'Lose no \'Mechs', primary: false, status: 'active', bonus });
      briefing.push(`${tgt.name} forces have been sighted in the area. ${emp.short} command wants them eliminated.`);
      break;
    }
    case 'assassinate': {
      playerUnits = place(b, spec.player, 0, pStart[0], pStart[1], 2);
      const force = enemyLance(4, { noVehicles: true });
      // The target: best pilot, heavier machine
      const tgtC = spec.enemies ? force[0] : generateForce(r, Math.min(10, d + 2), spec.target, 1, { noVehicles: true })[0];
      if (!spec.enemies) force[0] = tgtC;
      if (tgtC.pilot) { tgtC.pilot.callsign = spec.targetName ?? tgtC.pilot.callsign; tgtC.pilot.gun = Math.min(10, tgtC.pilot.gun + 2); }
      enemyUnits = place(b, force, 1, eStart[0], eStart[1], 6);
      if (enemyUnits[0]) { enemyUnits[0].tag = 'target'; enemyUnits[0].ai.goal = [Math.floor(W * 0.3), eStart[1] > H / 2 ? H - 1 : 0]; }
      objectives.push({ id: 'target', text: `Destroy ${enemyUnits[0]?.pilot?.callsign ?? 'the target'} (${enemyUnits[0] ? b.fullName(enemyUnits[0]) : ''})`, primary: true, status: 'active', bonus: 0 });
      objectives.push({ id: 'escorts', text: 'Destroy all escorts', primary: false, status: 'active', bonus });
      briefing.push(`${tgt.short} commander "${enemyUnits[0]?.pilot?.callsign}" is overseeing operations here. ${emp.short} wants them dead. If the target escapes, the contract is void.`);
      break;
    }
    case 'destroybase': {
      playerUnits = place(b, spec.player, 0, pStart[0], pStart[1], 2);
      const base = mo.base!;
      const cx = base.x + base.w / 2, cy = base.y + base.h / 2;
      const guards = place(b, enemyLance(d <= 4 ? 3 : 4), 1, Math.floor(cx - 4), Math.floor(cy), 6, { tag: 'guard' }, 3);
      for (const g of guards) g.ai.goal = [Math.floor(cx), Math.floor(cy)];
      const turrets: Combatant[] = [];
      const nT = 1 + Math.floor(d / 4);
      for (let i = 0; i < nT; i++) turrets.push({ frame: newVehicleFrame(d >= 8 ? 'TUR-H' : d >= 5 ? 'TUR-M' : 'TUR-L'), pilot: makePilot(r, Math.max(0, pilotTier(d) - 1)) });
      const tu: Unit[] = [];
      turrets.forEach((tc, k) => {
        const ang = (k / turrets.length) * Math.PI * 2;
        const spot = findSpot(b, Math.round(cx + Math.cos(ang) * 5), Math.round(cy + Math.sin(ang) * 5), 4);
        if (spot) tu.push(b.addUnit(tc.frame, tc.pilot, 1, spot[0], spot[1], 6));
      });
      enemyUnits = [...guards, ...tu];
      for (const pu of playerUnits) pu.ai.goal = [Math.floor(cx), Math.floor(cy)];
      objectives.push({ id: 'buildings', text: 'Destroy the base\'s primary structures', primary: true, status: 'active', bonus: 0 });
      objectives.push({ id: 'turrets', text: 'Destroy all defensive turrets', primary: false, status: 'active', bonus });
      briefing.push(`${art(tgt.short)} ${tgt.short} installation is operating in the region. Level its primary structures (marked ■). Turrets and a garrison lance defend it.`);
      break;
    }
    case 'defendbase': {
      const base = mo.base!;
      const cx = Math.floor(base.x + base.w / 2), cy = Math.floor(base.y + base.h / 2);
      playerUnits = place(b, spec.player, 0, cx + 10, cy, 2);
      // Hardened employer facilities
      for (const st of map.structures) if (st.objective) { st.maxHp *= 2; st.hp = st.maxHp; }
      const w1 = place(b, enemyLance(d <= 4 ? 3 : 4), 1, W - 5, cy + r.int(-10, 10), 6);
      const w2 = spec.enemies ? [] : place(b, generateForce(r, d, spec.target, d >= 5 ? 3 : 2), 1, W - 4, r.chance(0.5) ? 4 : H - 5, 6, { deployRound: 4, deployed: false });
      // The employer's base has its own light defenses
      for (const off of [-5, 5]) {
        const spot = findSpot(b, base.x + base.w + 1, cy + off, 3);
        if (spot) { const tu = b.addUnit(newVehicleFrame(d >= 6 ? 'TUR-M' : 'TUR-L'), makePilot(r, 1), 2, spot[0], spot[1], 2); tu.name = 'Turret'; }
      }
      const w3 = spec.enemies || d < 5 ? [] : place(b, generateForce(r, d, spec.target, 3), 1, W - 4, cy, 6, { deployRound: 7, deployed: false });
      enemyUnits = [...w1, ...w2, ...w3];
      // Half of every wave are raiders who go straight for the facility
      enemyUnits.forEach((e, k) => { e.ai.goal = [cx, cy]; if (k % 2 === 0) e.tag = 'raider'; });
      objectives.push({ id: 'defend', text: 'Destroy all attacking forces', primary: true, status: 'active', bonus: 0 });
      objectives.push({ id: 'base', text: 'Keep at least one primary structure standing', primary: true, status: 'active', bonus: 0 });
      objectives.push({ id: 'intact', text: 'Keep all primary structures intact', primary: false, status: 'active', bonus });
      briefing.push(`${tgt.short} raiders are moving on a ${emp.short} facility. Hold them off. Multiple attack waves are expected.`);
      break;
    }
    case 'ambush': {
      const rd = road();
      playerUnits = place(b, spec.player, 0, Math.floor(W / 2) - 4, rd.wy + (r.chance(0.5) ? -9 : 9), 4);
      const convoy: Combatant[] = [];
      const n = 4;
      for (let i = 0; i < n; i++) convoy.push({ frame: newVehicleFrame('HAULER'), pilot: makePilot(r, 0) });
      const cu = place(b, convoy, 1, 2, rd.wy, 2, { tag: 'convoy' }, 1);
      for (const c of cu) c.ai.goal = [W - 1, rd.ey];
      const esc = spec.enemies ?? generateForce(r, d, spec.target, d >= 5 ? 4 : 3);
      // The escort screens ahead of the haulers
      const eu = place(b, esc, 1, 12, rd.wy, 2, { tag: 'escort' });
      for (const e of eu) e.ai.goal = [W - 4, rd.ey];
      enemyUnits = [...cu, ...eu];
      // Small raids only need to break the convoy; bigger contracts want it gutted
      const need = d <= 3 ? 2 : 3;
      (b as any).convoyNeed = need;
      objectives.push({ id: 'convoy', text: `Destroy the convoy (at least ${need} of ${n} haulers)`, primary: true, status: 'active', bonus: 0 });
      objectives.push({ id: 'escorts', text: 'Destroy the convoy escort', primary: false, status: 'active', bonus });
      briefing.push(`${art(tgt.short)} ${tgt.short} supply convoy is moving along the highway. Intercept it before it leaves the area.`);
      break;
    }
    case 'escort': {
      const rd = road();
      playerUnits = place(b, spec.player, 0, 6, rd.wy + 4, 2);
      const convoy: Combatant[] = [];
      for (let i = 0; i < 3; i++) convoy.push({ frame: newVehicleFrame('HAULER'), pilot: makePilot(r, 0) });
      const cu = place(b, convoy, 2, 3, rd.wy, 2, { tag: 'convoy' }, 1);
      for (const c of cu) {
        c.ai.goal = [W - 1, rd.ey]; c.name = 'Convoy';
        // Escorted convoys use up-armored haulers
        for (const k in c.frame.armor) { c.frame.armor[k] = Math.round(c.frame.armor[k] * 2); c.frame.maxArmor[k] = c.frame.armor[k]; }
      }
      const a1 = place(b, enemyLance(3), 1, Math.floor(W * 0.6), r.chance(0.5) ? 5 : H - 6, 4);
      const a2 = spec.enemies ? [] : place(b, generateForce(r, d, spec.target, 2), 1, W - 5, rd.ey + (r.chance(0.5) ? -12 : 12), 6, { deployRound: 4, deployed: false });
      enemyUnits = [...a1, ...a2];
      for (const e of enemyUnits) e.ai.goal = [Math.floor(W * 0.4), rd.ey];
      for (const pu of playerUnits) { pu.tag = 'guard'; pu.ai.goal = [cu[0]?.x ?? 6, cu[0]?.y ?? rd.wy]; }
      objectives.push({ id: 'escort', text: 'At least 2 convoy vehicles reach the east edge', primary: true, status: 'active', bonus: 0 });
      objectives.push({ id: 'allsafe', text: 'All convoy vehicles survive', primary: false, status: 'active', bonus });
      briefing.push(`${art(emp.short)} ${emp.short} convoy must cross ${tgt.short}-held territory. Keep it alive until it exits east. The haulers only roll while one of your 'Mechs is within 10 tiles, and halt when hostiles close in.`);
      break;
    }
    case 'capture': {
      playerUnits = place(b, spec.player, 0, pStart[0], pStart[1], 2);
      const mid = beacons[1];
      const guards = place(b, enemyLance(d <= 4 ? 3 : 4), 1, mid.x + 3, mid.y, 6, { tag: 'guard' }, 3);
      guards.forEach((g, k) => { const bc = beacons[k % beacons.length]; g.ai.goal = [bc.x, bc.y]; });
      const re = spec.enemies || d < 5 ? [] : place(b, generateForce(r, d, spec.target, 2), 1, W - 4, r.chance(0.5) ? 5 : H - 6, 6, { deployRound: 4, deployed: false });
      for (const e of re) e.ai.goal = [mid.x, mid.y];
      enemyUnits = [...guards, ...re];
      for (const pu of playerUnits) { pu.tag = 'capper'; pu.ai.goal = [beacons[0].x, beacons[0].y]; }
      objectives.push({ id: 'beacons', text: 'Secure all three data beacons ◎', primary: true, status: 'active', bonus: 0 });
      objectives.push({ id: 'kill', text: 'Destroy all hostile forces', primary: false, status: 'active', bonus });
      briefing.push(`${tgt.short} has seeded the area with data beacons. Move a unit onto each ◎ with no enemy adjacent to secure it.`);
      break;
    }
  }
  if (spec.night) briefing.push('Night operation: visual range reduced to 360m. Sensors unaffected.');

  // Unique callsigns within each side keep the combat log readable
  const taken = new Set<string>();
  for (const u of b.units) if (u.team === 0 && u.pilot) { taken.add(u.pilot.callsign); u.name = u.pilot.callsign; }
  for (const u of b.units) {
    if (u.team === 0 || !u.pilot) continue;
    if (taken.has(u.pilot.callsign)) u.pilot.callsign = uniqueCallsign(r, taken);
    taken.add(u.pilot.callsign);
    u.name = u.pilot.callsign;
  }
  // Text that names enemy pilots is written once callsigns are final
  if (t === 'assassinate') {
    const tg = enemyUnits.find((u) => u.tag === 'target');
    const o = objectives.find((x) => x.id === 'target');
    if (tg && o) {
      o.text = `Destroy ${tg.pilot?.callsign ?? 'the target'} (${b.fullName(tg)})`;
      briefing[0] = `${tgt.short} commander "${tg.pilot?.callsign}" is overseeing operations here. ${emp.short} wants them dead. If the target escapes, the contract is void.`;
    }
  }
  const rt: MissionRuntime = { spec, battle: b, objectives, enemyUnits, playerUnits, briefing };
  installHooks(rt);
  return rt;
}

function obj(rt: MissionRuntime, id: string): Objective | undefined {
  return rt.objectives.find((o) => o.id === id);
}

function installHooks(rt: MissionRuntime): void {
  const b = rt.battle;
  const t = rt.spec.type;
  const alive = (us: Unit[]) => us.filter((u) => u.alive && !u.fled);
  const combatEnemies = () => rt.enemyUnits.filter((u) => u.tag !== 'convoy');
  const baseStructs = () => b.map.structures.filter((s) => s.objective);

  const update = (): '' | 'win' | 'loss' => {
    const lostMechs = rt.playerUnits.some((u) => !u.alive && u.frame.kind === 'mech' && u.destroyHow !== 'pilot' && u.destroyHow !== 'eject');
    const o = rt.objectives;
    for (const x of o) if (x.id === 'nolosses') x.status = lostMechs ? 'failed' : 'active';
    switch (t) {
      case 'battle': {
        const left = alive(rt.enemyUnits).length + rt.enemyUnits.filter((u) => !u.deployed).length;
        obj(rt, 'kill')!.progress = `${rt.enemyUnits.filter((u) => !u.alive).length}/${rt.enemyUnits.length}`;
        if (left === 0) { obj(rt, 'kill')!.status = 'done'; const n = obj(rt, 'nolosses'); if (n && n.status === 'active') n.status = 'done'; return 'win'; }
        break;
      }
      case 'assassinate': {
        const tg = rt.enemyUnits.find((u) => u.tag === 'target');
        const esc = rt.enemyUnits.filter((u) => u.tag !== 'target');
        const eo = obj(rt, 'escorts')!;
        if (eo.status === 'active' && esc.every((u) => !u.alive)) eo.status = 'done';
        if (tg && !tg.alive) { obj(rt, 'target')!.status = 'done'; return 'win'; }
        if (tg && tg.alive) obj(rt, 'target')!.progress = (tg as any)._fleeing ? `ESCAPING — ${Math.max(0, Math.round(dist(tg.x, tg.y, tg.ai.goal![0], tg.ai.goal![1])))} tiles from the ×` : `round ${b.round} of 9 — bolts then, or sooner if badly hurt`;
        if (tg && tg.fled) { obj(rt, 'target')!.status = 'failed'; return 'loss'; }
        break;
      }
      case 'destroybase': {
        const bs = baseStructs();
        const done = bs.filter((s) => s.destroyed).length;
        obj(rt, 'buildings')!.progress = `${done}/${bs.length}`;
        const tu = rt.enemyUnits.filter((u) => u.frame.kind === 'turret');
        const to = obj(rt, 'turrets')!;
        if (to.status === 'active' && tu.every((u) => !u.alive)) to.status = 'done';
        if (done === bs.length) { obj(rt, 'buildings')!.status = 'done'; return 'win'; }
        break;
      }
      case 'defendbase': {
        const bs = baseStructs();
        const standing = bs.filter((s) => !s.destroyed).length;
        obj(rt, 'base')!.progress = `${standing}/${bs.length} standing`;
        if (standing < bs.length) obj(rt, 'intact')!.status = 'failed';
        if (standing === 0) { obj(rt, 'base')!.status = 'failed'; return 'loss'; }
        const left = alive(rt.enemyUnits).length + rt.enemyUnits.filter((u) => !u.deployed).length;
        obj(rt, 'defend')!.progress = `${rt.enemyUnits.filter((u) => !u.alive).length}/${rt.enemyUnits.length}`;
        if (left === 0) {
          obj(rt, 'defend')!.status = 'done'; obj(rt, 'base')!.status = 'done';
          const it = obj(rt, 'intact')!; if (it.status === 'active') it.status = 'done';
          return 'win';
        }
        break;
      }
      case 'ambush': {
        const cv = rt.enemyUnits.filter((u) => u.tag === 'convoy');
        const dead = cv.filter((u) => !u.alive).length, fled = cv.filter((u) => u.fled).length;
        obj(rt, 'convoy')!.progress = `${dead}/${cv.length} destroyed, ${fled} escaped`;
        const eo = obj(rt, 'escorts')!;
        if (eo.status === 'active' && combatEnemies().every((u) => !u.alive)) eo.status = 'done';
        const need: number = (b as any).convoyNeed ?? cv.length - 1;
        if (fled > cv.length - need) { obj(rt, 'convoy')!.status = 'failed'; return 'loss'; }
        if (dead >= need && (dead + fled === cv.length)) { obj(rt, 'convoy')!.status = 'done'; return 'win'; }
        if (dead >= need && combatEnemies().every((u) => !u.alive)) { obj(rt, 'convoy')!.status = 'done'; return 'win'; }
        break;
      }
      case 'capture': {
        const bcs = b.map.beacons ?? [];
        const foes = alive(rt.enemyUnits);
        for (const bc of bcs) {
          if (bc.owner === 0) continue;
          const holder = b.units.find((u) => u.alive && SIDE(u.team) === 0 && dist(u.x, u.y, bc.x, bc.y) <= 1.5);
          if (holder && !foes.some((e) => dist(e.x, e.y, bc.x, bc.y) <= 2.5)) {
            bc.owner = 0;
            b.say(`${b.displayName(holder)} secured a data beacon.`, '#4ad4e8');
            b.float(bc.x, bc.y, 'BEACON SECURED', '#4ad4e8', true);
          }
        }
        const got = bcs.filter((bc) => bc.owner === 0).length;
        obj(rt, 'beacons')!.progress = `${got}/${bcs.length}`;
        const ko = obj(rt, 'kill')!;
        if (ko.status === 'active' && rt.enemyUnits.every((u) => !u.alive || u.fled) && rt.enemyUnits.every((u) => u.deployed)) ko.status = 'done';
        if (got === bcs.length) { obj(rt, 'beacons')!.status = 'done'; return 'win'; }
        if (alive(rt.enemyUnits).length === 0 && rt.enemyUnits.every((u) => u.deployed)) { /* keep moving to the beacons */ }
        break;
      }
      case 'escort': {
        const cv = b.units.filter((u) => u.team === 2 && u.tag === 'convoy');
        const dead = cv.filter((u) => !u.alive).length, safe = cv.filter((u) => u.fled).length;
        obj(rt, 'escort')!.progress = `${safe} safe, ${dead} lost`;
        if (dead > 0) obj(rt, 'allsafe')!.status = 'failed';
        if (dead >= 2) { obj(rt, 'escort')!.status = 'failed'; return 'loss'; }
        // Done once every hauler is out or lost — or the road is clear, so the rest are sure to make it
        const clear = rt.enemyUnits.every((u) => u.deployed && (!u.alive || u.fled)) && !b.units.some((u) => u.alive && u.deployed && !u.fled && SIDE(u.team) === 1);
        if (safe >= 2 && (safe + dead === cv.length || clear)) {
          obj(rt, 'escort')!.status = 'done';
          const a = obj(rt, 'allsafe')!; if (a.status === 'active') a.status = dead === 0 ? 'done' : 'failed';
          return 'win';
        }
        break;
      }
    }
    return '';
  };
  b.hooks.check = () => update();
  b.hooks.roundStart = () => {
    // Escorts shadow the lead vehicle of the convoy
    if (t === 'escort') {
      const lead = b.units.filter((v) => v.team === 2 && v.tag === 'convoy' && v.alive && !v.fled).sort((p, q) => q.x - p.x)[0];
      if (lead) for (const u of rt.playerUnits) if (u.alive && u.tag === 'guard') u.ai.goal = [Math.min(b.map.w - 2, lead.x + 3), lead.y];
    }
    // Beacon runners head for the nearest unsecured beacon
    const open = (b.map.beacons ?? []).filter((bc) => bc.owner !== 0);
    for (const u of rt.playerUnits) {
      if (u.tag !== 'capper' || !u.alive || !open.length) continue;
      const bc = open.reduce((a, q) => (dist(u.x, u.y, q.x, q.y) < dist(u.x, u.y, a.x, a.y) ? q : a));
      u.ai.goal = [bc.x, bc.y];
    }
    // Assassination targets bolt once hurt or after round 6
    const tg = rt.enemyUnits.find((u) => u.tag === 'target');
    if (tg && tg.alive && !(tg as any)._fleeing && (b.round >= 9 || tg.dmgTaken > 300)) {
      (tg as any)._fleeing = true;
      b.say(`${tg.pilot?.callsign ?? 'The target'} (${b.displayName(tg)}) is attempting to escape!`, '#f0a830');
    }
  };
  void SIDE; void dist;
}

export function objectivesSummary(rt: MissionRuntime): { primaryOk: boolean; bonus: number } {
  const primaryOk = rt.objectives.filter((o) => o.primary).every((o) => o.status === 'done');
  const bonus = rt.objectives.filter((o) => !o.primary && o.status === 'done').reduce((a, o) => a + o.bonus, 0);
  return { primaryOk, bonus };
}
