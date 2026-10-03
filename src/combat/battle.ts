// Tactical combat rules and state. Headless: the combat screen consumes `events` for animation.

import { RNG } from '../engine/rng';
import { item, ItemDef, LOC_NAMES } from '../data/items';
import { chassis, classOf } from '../data/mechs';
import { vehicle } from '../data/vehicles';
import { Frame, frameStats, FrameStats, frameShort, frameName, frameTons, Component } from '../game/frame';
import { Pilot, has, health, hasQuirk } from '../game/pilot';
import { BattleMap, TERRAIN, los, dist, dirTo, DIRS, inb, Structure, destroyStructure, BIOME_INFO } from './terrain';

export type MoveMode = 'walk' | 'sprint' | 'jump';

export interface Unit {
  id: number;
  team: number; // 0 player, 1 enemy, 2 allied to player (AI-controlled), 3 allied to enemy
  frame: Frame;
  pilot: Pilot | null;
  name: string;
  /** Map tag shown on the battlefield (HB, sc, τ1, ■2); set by the combat screen. */
  mapTag?: string;
  x: number;
  y: number;
  facing: number;
  heat: number;
  stab: number;
  pips: number;
  guarded: boolean;
  entrenched: boolean;
  prone: boolean;
  shutdown: boolean;
  unsteady: boolean;
  accDebuff: number;
  sensorLocked: number;
  phase: number;
  acted: boolean;
  reserved: boolean;
  moved: MoveMode | null;
  movedSteps: number;
  attacked: boolean;
  cannotMove: boolean;
  alive: boolean;
  ejected: boolean;
  destroyHow: '' | 'ct' | 'head' | 'legs' | 'pilot' | 'eject' | 'vehicle' | 'ammo';
  cageUsed: boolean;
  kills: number;
  dmgDealt: number;
  dmgTaken: number;
  injuriesTaken: number;
  tag: '' | 'convoy' | 'target' | 'escort' | 'guard' | 'raider' | 'capper';
  deployRound: number;
  deployed: boolean;
  fled: boolean;
  stats: FrameStats;
  ai: { lastKnown: Map<number, [number, number, number]>; goal?: [number, number]; aggression: number; lance: number };
  startX: number;
  startY: number;
}

export interface Shot { hit: boolean; loc: string; dmg: number; }
export type BEvent =
  | { k: 'round'; round: number }
  | { k: 'phase'; phase: number }
  | { k: 'activate'; u: number }
  | { k: 'move'; u: number; path: [number, number][]; mode: MoveMode; facing: number }
  | { k: 'face'; u: number; dir: number }
  | { k: 'fire'; u: number; t: number; tx: number; ty: number; w: string; shots: Shot[]; indirect: boolean; total: number; struct?: boolean }
  | { k: 'melee'; u: number; t: number; hit: boolean; dmg: number; dfa: boolean; loc: string }
  | { k: 'float'; x: number; y: number; text: string; color: string; big?: boolean }
  | { k: 'log'; text: string; color?: string }
  | { k: 'boom'; x: number; y: number; size: number }
  | { k: 'destroyed'; u: number; how: string }
  | { k: 'structure'; s: number; x: number; y: number }
  | { k: 'status'; u: number; text: string; color: string }
  | { k: 'volley'; u: number; t: number; tx: number; ty: number; n: number }
  | { k: 'volleyEnd'; u: number }
  | { k: 'end'; result: string };

export const SIDE = (team: number) => (team === 0 || team === 2 ? 0 : 1);

// ---- Hit tables ---------------------------------------------------------------------------
type Table = Record<string, number>;
const HIT_FRONT: Table = { HD: 0.6, CT: 16, LT: 14, RT: 14, LA: 10, RA: 10, LL: 8, RL: 8 };
const HIT_LEFT: Table = { HD: 0.6, CT: 8, LT: 18, RT: 4, LA: 18, RA: 3, LL: 14, RL: 4 };
const HIT_RIGHT: Table = { HD: 0.6, CT: 8, RT: 18, LT: 4, RA: 18, LA: 3, RL: 14, LL: 4 };
const HIT_REAR: Table = { HD: 0.6, CTR: 16, LTR: 14, RTR: 14, LA: 10, RA: 10, LL: 8, RL: 8 };
const HIT_PRONE: Table = { HD: 4, CT: 14, LT: 12, RT: 12, LA: 10, RA: 10, LL: 5, RL: 5, CTR: 4, LTR: 3, RTR: 3 };
const HIT_DFA: Table = { HD: 4, CT: 14, LT: 12, RT: 12, LA: 12, RA: 12 };
const HIT_KICK: Table = { LL: 1, RL: 1 };
const V_FRONT: Table = { F: 6, L: 2, R: 2, T: 3 };
const V_LEFT: Table = { L: 6, F: 2, B: 1, T: 3 };
const V_RIGHT: Table = { R: 6, F: 2, B: 1, T: 3 };
const V_REAR: Table = { B: 6, L: 2, R: 2, T: 3 };
const TRANSFER: Record<string, string | null> = { LA: 'LT', RA: 'RT', LL: 'LT', RL: 'RT', LT: 'CT', RT: 'CT', HD: null, CT: null, F: null, L: null, R: null, B: null, T: null };
export const REAR_OF: Record<string, string> = { CTR: 'CT', LTR: 'LT', RTR: 'RT' };
export const structLoc = (k: string) => REAR_OF[k] ?? k;

export type Arc = 'front' | 'left' | 'right' | 'rear';
export function attackArc(t: { x: number; y: number; facing: number }, ax: number, ay: number): Arc {
  if (ax === t.x && ay === t.y) return 'front';
  const toA = Math.atan2(ay - t.y, ax - t.x);
  const f = DIRS[t.facing];
  const fa = Math.atan2(f[1], f[0]);
  let d = ((toA - fa) * 180) / Math.PI;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  if (Math.abs(d) <= 67.5) return 'front';
  if (Math.abs(d) >= 135) return 'rear';
  return d > 0 ? 'right' : 'left';
}

export interface HitCalc {
  chance: number;
  mods: [string, number][];
  range: number;
  indirect: boolean;
  ok: boolean;
  reason: string;
  band: 'short' | 'medium' | 'long' | 'min' | 'out';
}

export interface Assignment { target: Unit | null; struct?: Structure | null; weapons: Component[]; }

export class Battle {
  units: Unit[] = [];
  round = 0;
  phase = 5;
  events: BEvent[] = [];
  resolve = [0, 0];
  resolveMax = [100, 100];
  morale = 25;
  result: '' | 'win' | 'loss' | 'withdraw' = '';
  withdrawIn = -1;
  explored: Uint8Array;
  visibleTiles: Uint8Array;
  seen: [Set<number>, Set<number>] = [new Set(), new Set()];
  detected: [Set<number>, Set<number>] = [new Set(), new Set()];
  lastAttackRound = 0;
  lastDamageRound = 0;
  active: Unit | null = null;
  heatMult: number;
  hooks: { roundStart?: (b: Battle) => void; check?: (b: Battle) => '' | 'win' | 'loss'; destroyed?: (b: Battle, u: Unit) => void; structDestroyed?: (b: Battle, s: Structure) => void } = {};
  log: { text: string; color?: string; round: number }[] = [];
  nextId = 1;
  visualRange: number;
  sensorRange = 26;
  structDmg = new Map<number, number>();

  constructor(public map: BattleMap, public rng: RNG) {
    this.explored = new Uint8Array(map.w * map.h);
    this.visibleTiles = new Uint8Array(map.w * map.h);
    this.heatMult = BIOME_INFO[map.biome].heatMult;
    this.visualRange = map.night ? 10 : 16;
  }

  // ---- Units -----------------------------------------------------------------------------
  addUnit(frame: Frame, pilot: Pilot | null, team: number, x: number, y: number, facing: number, opts: Partial<Unit> = {}): Unit {
    const stats = frameStats(frame);
    const u: Unit = {
      id: this.nextId++, team, frame, pilot, name: pilot ? pilot.callsign : frameShort(frame),
      x, y, facing, heat: 0, stab: 0, pips: 0, guarded: false, entrenched: false, prone: false, shutdown: false, unsteady: false,
      accDebuff: 0, sensorLocked: 0, phase: 0, acted: false, reserved: false, moved: null, movedSteps: 0, attacked: false, cannotMove: false,
      alive: true, ejected: false, destroyHow: '', cageUsed: false, kills: 0, dmgDealt: 0, dmgTaken: 0, injuriesTaken: 0, tag: '',
      deployRound: 0, deployed: true, fled: false, stats, ai: { lastKnown: new Map(), aggression: 0.5, lance: 0 }, startX: x, startY: y,
      ...opts,
    };
    u.phase = this.basePhase(u);
    this.units.push(u);
    return u;
  }

  basePhase(u: Unit): number {
    if (u.frame.kind === 'turret') return 2;
    const cls = classOf(frameTons(u.frame));
    let p = { L: 4, M: 3, H: 2, A: 1 }[cls];
    if (has(u.pilot ?? undefined, 'mastertactician')) p++;
    p += u.stats.initBonus;
    return Math.max(1, Math.min(5, p));
  }

  unit(id: number): Unit { return this.units.find((u) => u.id === id)!; }
  unitAt(x: number, y: number): Unit | undefined {
    return this.units.find((u) => u.alive && u.deployed && !u.fled && u.x === x && u.y === y);
  }
  live(): Unit[] { return this.units.filter((u) => u.alive && u.deployed && !u.fled); }
  enemiesOf(u: Unit): Unit[] { return this.live().filter((o) => SIDE(o.team) !== SIDE(u.team)); }
  alliesOf(u: Unit): Unit[] { return this.live().filter((o) => SIDE(o.team) === SIDE(u.team) && o !== u); }
  isMech(u: Unit): boolean { return u.frame.kind === 'mech'; }
  displayName(u: Unit): string { if (SIDE(u.team) === 1 && u.alive && u.deployed && !this.seen[0].has(u.id)) return 'Unknown contact'; return u.pilot && u.team === 0 ? `${u.pilot.callsign}` : u.mapTag ? `${u.mapTag} ${frameShort(u.frame)}` : frameShort(u.frame); }
  fullName(u: Unit): string { return frameName(u.frame); }

  emit(e: BEvent): void { this.events.push(e); }
  /** While an attack resolves, per-weapon results collect here and print as one summary line. */
  private volley: { name: string; color: string; hits: number; shots: number; dmg: number; locs: Map<string, number>; weapons: Map<string, number> }[] | null = null;
  private sayBuf: { text: string; color?: string }[] | null = null;
  private pendingKnock: Set<Unit> | null = null;
  private record(a: Unit, tname: string, w: ItemDef, hits: number, shots: number, locs: [string, number][]): boolean {
    if (!this.volley) return false;
    let v = this.volley.find((x) => x.name === tname);
    if (!v) { v = { name: tname, color: SIDE(a.team) === 0 ? '#9fd8ef' : '#f0a898', hits: 0, shots: 0, dmg: 0, locs: new Map(), weapons: new Map() }; this.volley.push(v); }
    v.hits += hits; v.shots += shots;
    for (const [l, d] of locs) { v.dmg += d; v.locs.set(l, (v.locs.get(l) ?? 0) + d); }
    v.weapons.set(w.short ?? w.name, (v.weapons.get(w.short ?? w.name) ?? 0) + 1);
    return true;
  }
  say(text: string, color?: string): void {
    if (this.sayBuf) { this.sayBuf.push({ text, color }); return; }
    this.log.push({ text, color, round: this.round });
    this.emit({ k: 'log', text, color });
  }
  float(x: number, y: number, text: string, color: string, big = false): void { this.emit({ k: 'float', x, y, text, color, big }); }

  // ---- Turn structure --------------------------------------------------------------------
  start(): void {
    this.updateVisibility();
    this.startRound();
  }

  startRound(): void {
    this.round++;
    this.phase = 5;
    if (this.round > 1) this.say(`── Round ${this.round} ──`, '#4a5a66');
    for (const u of this.units) {
      if (!u.deployed && u.deployRound <= this.round && u.alive) {
        u.deployed = true;
        this.say(`Contact: ${u.mapTag ? u.mapTag + ' ' : ''}${frameName(u.frame)} entering the area of operations.`, '#f0a830');
      }
      u.acted = false;
      u.reserved = false;
      // Per-activation flags start clean every round (evasion pips persist until the unit acts again)
      u.moved = null;
      u.movedSteps = 0;
      u.attacked = false;
      u.cannotMove = false;
      u.phase = this.basePhase(u) - (u.ai && (u as any)._knockedBack ? 1 : 0);
      (u as any)._knockedBack = false;
      u.phase = Math.max(1, u.phase);
    }
    // Resolve trickles in each round based on morale
    this.resolve[0] = Math.min(this.resolveMax[0], this.resolve[0] + 5 + Math.floor(this.morale / 5));
    this.resolve[1] = Math.min(this.resolveMax[1], this.resolve[1] + 8);
    this.emit({ k: 'round', round: this.round });
    this.hooks.roundStart?.(this);
    if (this.withdrawIn > 0) {
      this.withdrawIn--;
      if (this.withdrawIn === 0) { this.finish('withdraw'); return; }
      this.say(`Dropship inbound. Extraction in ${this.withdrawIn} round${this.withdrawIn > 1 ? 's' : ''}.`, '#5fd0e8');
    }
    this.updateVisibility();
  }

  /** Units that may act right now for a side, in the current phase. */
  pending(side: number | null = null, phase = this.phase): Unit[] {
    return this.live().filter((u) => !u.acted && u.phase === phase && (side === null || SIDE(u.team) === side));
  }

  /** Move the phase/round clock forward until someone can act. Returns who acts next. */
  advance(): { who: 'player' | 'ai' | 'none'; unit?: Unit } {
    for (let guard = 0; guard < 50; guard++) {
      if (this.result) return { who: 'none' };
      const player = this.live().filter((u) => u.team === 0 && !u.acted && u.phase === this.phase);
      if (player.length) return { who: 'player' };
      const ai = this.live().filter((u) => u.team !== 0 && !u.acted && u.phase === this.phase);
      if (ai.length) {
        // Allies before enemies within a phase
        ai.sort((a, b) => SIDE(a.team) - SIDE(b.team) || frameTons(a.frame) - frameTons(b.frame));
        return { who: 'ai', unit: ai[0] };
      }
      this.phase--;
      if (this.phase < 1) {
        this.endRound();
        if (this.result) return { who: 'none' };
        this.startRound();
      } else this.emit({ k: 'phase', phase: this.phase });
    }
    return { who: 'none' };
  }

  endRound(): void {
    for (const u of this.live()) if (u.sensorLocked > 0) u.sensorLocked--;
    this.check();
    // Stalemate guard: if nobody has damaged anything for a long time, both sides disengage
    if (!this.result && this.round - this.lastDamageRound >= 12) {
      this.say('Neither side can make progress. Both forces disengage.', '#f0a830');
      this.finish('withdraw');
    }
  }

  beginActivation(u: Unit): boolean {
    this.active = u;
    u.moved = null;
    u.movedSteps = 0;
    u.attacked = false;
    u.cannotMove = false;
    u.pips = 0;
    u.guarded = false;
    u.entrenched = false;
    this.emit({ k: 'activate', u: u.id });
    if (this.isMech(u)) {
      u.stab = Math.max(0, u.stab - u.stats.stabMax * 0.15 - (u.pilot?.pil ?? 3) * 1.5);
      if (u.stab < u.stats.stabMax * 0.5) u.unsteady = false;
    }
    if (u.shutdown) {
      u.shutdown = false;
      u.heat = Math.max(0, u.heat - this.dissipation(u));
      this.say(`${this.displayName(u)} restarts their reactor.`, '#f0c040');
      this.float(u.x, u.y, 'RESTART', '#f0c040');
      this.finishActivation(u, true);
      return false;
    }
    if (u.prone) {
      u.prone = false;
      u.cannotMove = true;
      this.say(`${this.displayName(u)} stands up.`, '#9ab');
      this.float(u.x, u.y, 'STAND UP', '#9ab');
    }
    return true;
  }

  dissipation(u: Unit): number {
    const t = TERRAIN[this.map.terr[u.y * this.map.w + u.x]];
    return Math.round(u.stats.dissip * this.heatMult) + t.cool;
  }

  /** End of a unit's activation: heat, bulwark, clock. */
  finishActivation(u: Unit, skipHeat = false): void {
    if (!skipHeat && this.isMech(u) && u.alive) {
      const cap = u.stats.heatCap;
      if (u.heat >= cap) {
        u.shutdown = true;
        u.prone = false;
        u.pips = 0;
        u.guarded = false;
        this.say(`${this.displayName(u)} has SHUT DOWN from heat!`, '#ff6a2a');
        this.float(u.x, u.y, 'SHUTDOWN', '#ff6a2a', true);
        this.overheatDamage(u, u.heat - cap * 0.75);
      } else if (u.heat > cap * 0.75) {
        this.float(u.x, u.y, 'OVERHEATING', '#ff6a2a');
        this.overheatDamage(u, u.heat - cap * 0.75);
      }
      u.heat = Math.max(0, u.heat - this.dissipation(u));
    }
    if (u.alive && !u.moved && !u.shutdown && has(u.pilot ?? undefined, 'bulwark') && this.isMech(u)) {
      u.guarded = true;
    }
    u.acted = true;
    if (this.active === u) this.active = null;
    this.updateVisibility();
    this.check();
  }

  private overheatDamage(u: Unit, over: number): void {
    const dmg = Math.max(5, Math.round(over / 2 / 5) * 5);
    // Overheating cooks internal structure in the torso
    const loc = this.rng.pick(['CT', 'LT', 'RT'].filter((l) => u.frame.struct[l] > 0));
    if (!loc) return;
    this.say(`${this.displayName(u)} takes ${dmg} internal heat damage (${loc}).`, '#ff6a2a');
    this.damageStructure(u, loc, dmg, null, 1);
  }

  // ---- Visibility ------------------------------------------------------------------------
  updateVisibility(): void {
    const m = this.map;
    this.visibleTiles.fill(0);
    for (const side of [0, 1]) { this.seen[side].clear(); this.detected[side].clear(); }
    const live = this.live();
    for (const s of live) {
      const side = SIDE(s.team);
      const vr = this.visualRange + (s.frame.kind === 'turret' ? -4 : 0);
      const sr = this.sensorRange + s.stats.sensor;
      for (const o of live) {
        if (SIDE(o.team) === side) continue;
        const d = dist(s.x, s.y, o.x, o.y);
        if (d <= sr) this.detected[side].add(o.id);
        if (d <= vr && los(m, s.x, s.y, o.x, o.y).clear) this.seen[side].add(o.id);
      }
      if (side === 0) {
        const r = Math.ceil(vr);
        for (let y = Math.max(0, s.y - r); y <= Math.min(m.h - 1, s.y + r); y++)
          for (let x = Math.max(0, s.x - r); x <= Math.min(m.w - 1, s.x + r); x++) {
            const i = y * m.w + x;
            if (this.visibleTiles[i]) continue;
            if (dist(s.x, s.y, x, y) > vr) continue;
            if (los(m, s.x, s.y, x, y).clear) { this.visibleTiles[i] = 1; this.explored[i] = 1; }
          }
      }
    }
    for (const o of live) if (o.sensorLocked > 0) this.seen[1 - SIDE(o.team)].add(o.id);
    // AI memory
    for (const s of live) for (const id of this.seen[SIDE(s.team)]) {
      const o = this.unit(id);
      s.ai.lastKnown.set(id, [o.x, o.y, this.round]);
    }
  }

  isVisibleTo(side: number, u: Unit): boolean {
    return SIDE(u.team) === side || this.seen[side].has(u.id);
  }

  // ---- Movement --------------------------------------------------------------------------
  maxPips(u: Unit): number {
    if (u.frame.kind === 'turret') return 0;
    if (u.frame.kind === 'vehicle') return 4;
    const base = { L: 5, M: 4, H: 4, A: 3 }[classOf(frameTons(u.frame))];
    return base + (has(u.pilot ?? undefined, 'evasive') ? 1 : 0) + (hasQuirk(u.pilot, 'jumpy') ? 1 : 0);
  }

  moveCost(u: Unit, fx: number, fy: number, tx: number, ty: number): number {
    const m = this.map;
    const i = ty * m.w + tx;
    const t = TERRAIN[m.terr[i]];
    if (!isFinite(t.cost)) return Infinity;
    const dh = m.elev[i] - m.elev[fy * m.w + fx];
    if (Math.abs(dh) > 1) return Infinity;
    let c = t.cost;
    if (u.frame.kind === 'vehicle') {
      if (m.terr[i] === 'deep' || m.terr[i] === 'hforest') return Infinity;
      if (m.terr[i] === 'lforest' || m.terr[i] === 'rough') c *= 1.5;
    }
    if (dh > 0) c += 0.5;
    if (fx !== tx && fy !== ty) c *= 1.414;
    return c;
  }

  /** Dijkstra over walk/sprint budget. Returns map tile→[cost, prev]. */
  reachable(u: Unit, mode: MoveMode): Map<number, [number, number]> {
    const m = this.map;
    const out = new Map<number, [number, number]>();
    if (u.cannotMove || u.frame.kind === 'turret') return out;
    const start = u.y * m.w + u.x;
    if (mode === 'jump') {
      const R = u.stats.jump;
      if (R <= 0) return out;
      for (let y = u.y - R; y <= u.y + R; y++) for (let x = u.x - R; x <= u.x + R; x++) {
        if (!inb(m, x, y) || (x === u.x && y === u.y)) continue;
        const d = dist(u.x, u.y, x, y);
        if (d > R + 0.01) continue;
        const i = y * m.w + x;
        if (!isFinite(TERRAIN[m.terr[i]].cost) || m.terr[i] === 'deep') continue;
        if (m.elev[i] - m.elev[start] > 3) continue;
        if (this.unitAt(x, y)) continue;
        out.set(i, [d, start]);
      }
      return out;
    }
    const budget = mode === 'walk' ? u.stats.walk : u.stats.sprint;
    const dist2 = new Map<number, number>([[start, 0]]);
    const prev = new Map<number, number>();
    const open: [number, number][] = [[0, start]];
    while (open.length) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (open[k][0] < open[bi][0]) bi = k;
      const [c, i] = open.splice(bi, 1)[0];
      if (c > (dist2.get(i) ?? Infinity)) continue;
      const x = i % m.w, y = (i / m.w) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!inb(m, nx, ny)) continue;
        const ni = ny * m.w + nx;
        const occ = this.unitAt(nx, ny);
        if (occ && SIDE(occ.team) !== SIDE(u.team)) continue;
        // no corner cutting through blockers
        if (dx && dy && (!isFinite(TERRAIN[m.terr[y * m.w + nx]].cost) && !isFinite(TERRAIN[m.terr[ny * m.w + x]].cost))) continue;
        const mc = this.moveCost(u, x, y, nx, ny);
        const nc = c + mc;
        if (nc > budget + 1e-6) continue;
        if (nc < (dist2.get(ni) ?? Infinity)) {
          dist2.set(ni, nc);
          prev.set(ni, i);
          open.push([nc, ni]);
        }
      }
    }
    for (const [i, c] of dist2) {
      if (i === start) continue;
      const x = i % m.w, y = (i / m.w) | 0;
      if (this.unitAt(x, y)) continue; // can pass through allies, not stop on them
      out.set(i, [c, prev.get(i)!]);
    }
    // keep predecessor chain for pass-through tiles
    (out as any)._prev = prev;
    return out;
  }

  pathTo(u: Unit, reach: Map<number, [number, number]>, ti: number, mode: MoveMode): [number, number][] {
    const m = this.map;
    const start = u.y * m.w + u.x;
    if (mode === 'jump') return [[u.x, u.y], [ti % m.w, (ti / m.w) | 0]];
    const prev: Map<number, number> = (reach as any)._prev;
    const path: [number, number][] = [];
    let i: number | undefined = ti;
    let guard = 0;
    while (i !== undefined && i !== start && guard++ < 500) {
      path.push([i % m.w, (i / m.w) | 0]);
      i = prev.get(i);
    }
    path.push([u.x, u.y]);
    return path.reverse();
  }

  pipsFor(u: Unit, mode: MoveMode, steps: number): number {
    const ev = has(u.pilot ?? undefined, 'evasive');
    let p = Math.floor(steps / (ev ? 1.6 : 2));
    if (mode === 'sprint') p += 1;
    if (mode === 'jump') p = Math.floor(steps / 2) + 1;
    return Math.min(this.maxPips(u), p);
  }

  move(u: Unit, path: [number, number][], mode: MoveMode, facing?: number): void {
    if (path.length < 2) return;
    const [ex, ey] = path[path.length - 1];
    const [px, py] = path[path.length - 2];
    const steps = mode === 'jump' ? Math.round(dist(path[0][0], path[0][1], ex, ey)) : path.length - 1;
    u.x = ex; u.y = ey;
    u.facing = facing ?? dirTo(px, py, ex, ey);
    u.moved = mode;
    u.movedSteps = steps;
    u.pips = this.pipsFor(u, mode, steps);
    if (mode === 'jump') {
      u.heat += steps * 3;
      if (u.stab > 0) u.stab = Math.max(0, u.stab - 10);
    }
    if (mode === 'sprint') u.guarded = false;
    this.emit({ k: 'move', u: u.id, path, mode, facing: u.facing });
    if (u.pips > 0 && u.frame.kind !== 'turret') this.float(ex, ey, `EVASION ${'◆'.repeat(u.pips)}`, '#8ab4ff');
    this.updateVisibility();
  }

  setFacing(u: Unit, dir: number): void {
    if (u.facing === dir) return;
    u.facing = dir;
    this.emit({ k: 'face', u: u.id, dir });
  }

  // ---- To-hit ----------------------------------------------------------------------------
  hitChance(a: Unit, t: Unit | null, w: ItemDef, from: { x: number; y: number; moved: MoveMode | null } = a, tpos?: { x: number; y: number }, called = false, struct?: Structure): HitCalc {
    const m = this.map;
    const tx = tpos ? tpos.x : t ? t.x : struct ? struct.tiles[0] % m.w : 0;
    const ty = tpos ? tpos.y : t ? t.y : struct ? (struct.tiles[0] / m.w) | 0 : 0;
    const mods: [string, number][] = [];
    const res: HitCalc = { chance: 0, mods, range: 0, indirect: false, ok: false, reason: '', band: 'out' };
    let d = dist(from.x, from.y, tx, ty);
    if (struct) {
      // nearest tile of the structure
      for (const i of struct.tiles) d = Math.min(d, dist(from.x, from.y, i % m.w, (i / m.w) | 0));
    }
    res.range = d;
    if (from.moved === 'sprint') { res.reason = 'Sprinted this turn'; return res; }
    if (d > (w.lr ?? 0) + 0.01) { res.reason = 'Out of range'; return res; }
    let L = los(m, from.x, from.y, tx, ty, (i) => (t && m.struct[i] >= 0 ? 0 : 0));
    if (struct && !L.clear) {
      // any tile of the structure visible counts
      for (const i of struct.tiles) {
        const r2 = los(m, from.x, from.y, i % m.w, (i / m.w) | 0, (j) => (struct.tiles.includes(j) ? -99 : 0));
        if (r2.clear) { L = r2; break; }
      }
      if (!L.clear) {
        const r3 = los(m, from.x, from.y, tx, ty, (j) => (struct.tiles.includes(j) ? -99 : 0));
        if (r3.clear) L = r3;
      }
    }
    const pil = a.pilot;
    const gun = pil?.gun ?? 3;
    const base = 55 + gun * 3;
    mods.push([`Gunnery ${gun}`, base]);
    if (!L.clear || (d > this.visualRange + 0.01 && !(t && t.sensorLocked > 0))) {
      if (w.indirect && t && this.seen[SIDE(a.team)].has(t.id) && d >= (w.min ?? 0)) {
        res.indirect = true;
        mods.push(['Indirect fire', -20 + (pil?.tac ?? 3)]);
      } else { res.reason = L.clear ? 'Beyond visual range' : 'No line of sight'; return res; }
    } else if (L.obstruct > 0) mods.push(['Obstructed', -L.obstruct]);
    if (t && !this.seen[SIDE(a.team)].has(t.id)) { res.reason = 'Target not visible'; return res; }
    // Range bands
    const minR = w.min ?? 0;
    if (d < minR) { mods.push(['Minimum range', -Math.round((minR - d + 1) * 8)]); res.band = 'min'; }
    else if (d <= (w.sr ?? 0) + 0.01) res.band = 'short';
    else if (d <= (w.mr ?? 0) + 0.01) { mods.push(['Medium range', -5]); res.band = 'medium'; }
    else { mods.push(['Long range', -15]); res.band = 'long'; if (hasQuirk(pil, 'sharpshooter')) mods.push(['Sharpshooter', 5]); }
    if (from.moved === 'jump') mods.push(['Jumped', -10]);
    if (w.acc) mods.push(['Weapon accuracy', w.acc]);
    if (a.stats.accBonus) mods.push(['Targeting system', a.stats.accBonus]);
    if (a.accDebuff) mods.push(['Sensors scrambled', -a.accDebuff]);
    if (this.isMech(a) && a.heat > a.stats.heatCap * 0.75 && !hasQuirk(pil, 'coolhead')) mods.push(['Overheated', -10]);
    if (hasQuirk(pil, 'reckless') && from.moved) mods.push(['Reckless', -5]);
    const eh = m.elev[from.y * m.w + from.x], th = m.elev[ty * m.w + tx];
    if (eh > th) mods.push(['Height advantage', 10]);
    else if (eh < th) mods.push(['Target elevated', -5]);
    if (t) {
      // Sensor lock strips its pips once, when applied
      const pips = t.pips;
      if (pips > 0) mods.push([`Evasion ${'◆'.repeat(pips)}`, -8 * pips]);
      if (t.shutdown) mods.push(['Target shut down', 40]);
      else if (t.prone) mods.push(['Target prone', 20]);
      if (t.frame.kind === 'turret') mods.push(['Stationary target', 10]);
    } else if (struct) mods.push(['Structure', 30]);
    if (m.night && !hasQuirk(pil, 'nightowl')) mods.push(['Night', -5]);
    let c = 0;
    for (const [, v] of mods) c += v;
    res.chance = Math.max(5, Math.min(95, c));
    res.ok = true;
    return res;
  }

  meleeChance(a: Unit, t: Unit, dfa: boolean): HitCalc {
    const mods: [string, number][] = [];
    const pil = a.pilot?.pil ?? 3;
    mods.push([`Piloting ${pil}`, 60 + pil * 3]);
    if (dfa) mods.push(['Death From Above', -10]);
    if (hasQuirk(a.pilot, 'brawler') || hasQuirk(a.pilot, 'reckless')) mods.push([hasQuirk(a.pilot, 'brawler') ? 'Brawler' : 'Reckless', 5]);
    const pips = t.pips;
    if (pips > 0) mods.push([`Evasion ${'◆'.repeat(pips)} (-5 each in melee)`, -5 * pips]);
    if (t.shutdown) mods.push(['Target shut down', 40]);
    else if (t.prone) mods.push(['Target prone', 20]);
    if (t.frame.kind !== 'mech') mods.push(['Vehicle target', 15]);
    const tt = frameTons(t.frame), at = frameTons(a.frame);
    if (at >= tt + 30) mods.push(['Size advantage', 5]);
    let c = 0;
    for (const [, v] of mods) c += v;
    return { chance: Math.max(5, Math.min(95, c)), mods, range: 1, indirect: false, ok: true, reason: '', band: 'short' };
  }

  hitTable(t: Unit, arc: Arc): Table {
    if (t.frame.kind === 'turret') return { T: 1 };
    if (t.frame.kind === 'vehicle') {
      const tb = arc === 'front' ? V_FRONT : arc === 'left' ? V_LEFT : arc === 'right' ? V_RIGHT : V_REAR;
      const o: Table = {};
      for (const k in tb) if (t.frame.maxStruct[k] !== undefined) o[k] = tb[k];
      return o;
    }
    if (t.prone || t.shutdown) return HIT_PRONE;
    return arc === 'front' ? HIT_FRONT : arc === 'left' ? HIT_LEFT : arc === 'right' ? HIT_RIGHT : HIT_REAR;
  }

  rollLocation(t: Unit, arc: Arc, called?: string, calledStrength = 5): string {
    const tb = { ...this.hitTable(t, arc) };
    if (called) {
      const key = arc === 'rear' && (called === 'CT' || called === 'LT' || called === 'RT') ? called + 'R' : called;
      let total = 0;
      for (const k in tb) total += tb[k];
      tb[key] = (tb[key] ?? 0) + total * (0.35 + calledStrength * 0.06);
    }
    const keys = Object.keys(tb);
    return this.rng.weighted(keys, (k) => tb[k]);
  }

  // ---- Attacks ---------------------------------------------------------------------------
  canAttack(u: Unit): boolean {
    return u.alive && !u.attacked && u.moved !== 'sprint' && !u.shutdown;
  }

  /** Projected heat after firing these weapons (before dissipation). */
  projectedHeat(u: Unit, weapons: Component[]): number {
    return u.heat + weapons.reduce((a, c) => a + (item(c.id).heat ?? 0), 0);
  }

  hasAmmo(u: Unit, w: Component): boolean {
    const d = item(w.id);
    if (!d.ammo) return true;
    return u.frame.items.some((c) => !c.dead && c.id === d.ammo && (c.ammo ?? 0) >= 1);
  }

  private useAmmo(u: Unit, w: ItemDef): number {
    // returns number of shots available (missiles consume per missile)
    if (!w.ammo) return w.shots ?? 1;
    const need = w.shots ?? 1;
    let got = 0;
    for (const c of u.frame.items) {
      if (c.dead || c.id !== w.ammo || !c.ammo) continue;
      const take = Math.min(c.ammo, need - got);
      c.ammo -= take;
      got += take;
      if (got >= need) break;
    }
    return got;
  }

  attack(a: Unit, plan: Assignment[], called?: string): void {
    if (!this.canAttack(a)) return;
    this.volley = []; this.sayBuf = []; this.pendingKnock = new Set();
    // Bracket the volley so the screen can build up to it and dwell on the result
    const p0 = plan[0];
    if (p0) {
      const tx = p0.target ? p0.target.x : p0.struct ? p0.struct.tiles[0] % this.map.w : a.x;
      const ty = p0.target ? p0.target.y : p0.struct ? (p0.struct.tiles[0] / this.map.w) | 0 : a.y;
      this.emit({ k: 'volley', u: a.id, t: p0.target ? p0.target.id : -1, tx, ty, n: plan.reduce((x, p) => x + p.weapons.length, 0) });
    }
    try { this.attackInner(a, plan, called); } finally {
      const buf = this.sayBuf ?? [], vol = this.volley ?? [], knock = this.pendingKnock ?? new Set<Unit>();
      this.sayBuf = null; this.volley = null; this.pendingKnock = null;
      for (const v of vol) {
        const locs = [...v.locs.entries()].map(([l, d]) => (l ? `${l} ${d}` : `${d}`)).join(', ');
        const ws = [...v.weapons.entries()].map(([n, k]) => (k > 1 ? `${k}×${n}` : n)).join(' ');
        this.say(`${this.displayName(a)} → ${v.name}: ${v.hits}/${v.shots} hit, ${v.dmg} dmg${locs && v.locs.size > 0 && locs !== String(v.dmg) ? ` (${locs})` : ''} · ${ws}`, v.color);
      }
      for (const m of buf) this.say(m.text, m.color);
      // As in HBS BattleTech, a knockdown lands once the whole volley has resolved
      for (const t of knock) if (t.alive && !t.prone && !t.shutdown) this.knockdown(t);
      this.emit({ k: 'volleyEnd', u: a.id });
    }
  }

  private attackInner(a: Unit, plan: Assignment[], called?: string): void {
    a.attacked = true;
    this.lastAttackRound = this.round;
    const allWeapons = plan.flatMap((p) => p.weapons);
    const breaching = has(a.pilot ?? undefined, 'breaching') && allWeapons.length === 1;
    // face the (first) target
    const first = plan[0];
    if (first) {
      const tx = first.target ? first.target.x : first.struct ? first.struct.tiles[0] % this.map.w : a.x;
      const ty = first.target ? first.target.y : first.struct ? (first.struct.tiles[0] / this.map.w) | 0 : a.y;
      if (a.frame.kind === 'mech') this.setFacing(a, dirTo(a.x, a.y, tx, ty));
    }
    for (const [pi, p] of plan.entries()) {
      const pc = pi === 0 ? called : undefined;
      const t = p.target;
      if (t && !t.alive) continue;
      // Weapon groups fire together: energy, then ballistics, missiles last
      const order = (id: string) => { const w = item(id); return (w.ammo ? (w.shots ?? 1) > 1 ? 2 : 1 : 0) * 1000 - (w.dmg ?? 0) + (w.base ?? id).charCodeAt(0) * 0.001; };
      for (const wc of [...p.weapons].sort((x, y) => order(x.id) - order(y.id) || x.id.localeCompare(y.id))) {
        if (wc.dead) continue;
        const w = item(wc.id);
        const hc = this.hitChance(a, t, w, a, undefined, !!pc, p.struct ?? undefined);
        if (!hc.ok) continue;
        if (!this.hasAmmo(a, wc)) continue;
        const shots = this.useAmmo(a, w);
        if (this.isMech(a)) a.heat += w.heat ?? 0;
        if (t) this.fireAtUnit(a, t, w, shots, hc, pc, breaching);
        else if (p.struct) this.fireAtStructure(a, p.struct, w, shots, hc);
        if (t && !t.alive) break;
      }
      if (t && t.alive) {
        // Each attack sequence strips one evasion pip
        if (t.pips > 0) t.pips--;
        if (t.unsteady && t.pips > 0) t.pips = 0;
      }
    }
    this.updateVisibility();
    this.check();
  }

  private fireAtUnit(a: Unit, t: Unit, w: ItemDef, shots: number, hc: HitCalc, called: string | undefined, breaching: boolean): void {
    const arc = attackArc(t, a.x, a.y);
    const res: Shot[] = [];
    let total = 0;
    const tac = a.pilot?.tac ?? 3;
    for (let s = 0; s < shots; s++) {
      const hit = this.rng.next() * 100 < hc.chance;
      if (!hit) { res.push({ hit: false, loc: '', dmg: 0 }); continue; }
      let dmg = w.dmg ?? 0;
      const tile = TERRAIN[this.map.terr[t.y * this.map.w + t.x]];
      if (!breaching) {
        if (t.guarded && arc !== 'rear') dmg *= 0.6;
        if (tile.cover > 0) dmg *= 1 - tile.cover;
      }
      dmg = Math.max(1, Math.round(dmg));
      const loc = this.rollLocation(t, arc, called, tac);
      if (loc === 'HD' && t.frame.kind === 'mech' && !t.prone && !t.shutdown) dmg = Math.min(dmg, 45);
      res.push({ hit: true, loc, dmg });
      total += dmg;
    }
    this.emit({ k: 'fire', u: a.id, t: t.id, tx: t.x, ty: t.y, w: w.id, shots: res, indirect: hc.indirect, total });
    (t as any)._hitRound = this.round;
    const hits = res.filter((r) => r.hit);
    const locs = new Map<string, number>();
    for (const h of hits) locs.set(h.loc, (locs.get(h.loc) ?? 0) + h.dmg);
    const locStr = [...locs.entries()].map(([l, d]) => `${l} ${d}`).join(', ');
    if (!this.record(a, this.displayName(t), w, hits.length, res.length, [...locs.entries()])) this.say(`${this.displayName(a)}: ${w.name} → ${this.displayName(t)} ${hits.length}/${res.length} hit${hits.length ? ` (${locStr})` : ''}`,
      SIDE(a.team) === 0 ? '#9fd8ef' : '#f0a898');
    if (!hits.length) return;
    for (const h of hits) {
      if (!t.alive) break;
      this.damage(t, h.loc, h.dmg, a, w.crit ?? 1);
    }
    if (t.alive) {
      const stab = (w.stab ?? 0) * hits.length;
      if (stab > 0) this.applyStability(t, stab);
      if (w.targetHeat && this.isMech(t)) { t.heat += w.targetHeat * hits.length; this.float(t.x, t.y, `+${w.targetHeat * hits.length} HEAT`, '#ff6a2a'); }
      if (w.debuffAcc) { t.accDebuff = w.debuffAcc; }
    }
    a.dmgDealt += total;
    this.resolve[SIDE(a.team)] = Math.min(this.resolveMax[SIDE(a.team)], this.resolve[SIDE(a.team)] + Math.floor(total / 25));
  }

  private fireAtStructure(a: Unit, s: Structure, w: ItemDef, shots: number, hc: HitCalc): void {
    const m = this.map;
    const tile = s.tiles[Math.floor(s.tiles.length / 2)];
    const res: Shot[] = [];
    let total = 0;
    for (let k = 0; k < shots; k++) {
      const hit = this.rng.next() * 100 < hc.chance;
      const dmg = hit ? w.dmg ?? 0 : 0;
      res.push({ hit, loc: 'S', dmg });
      total += dmg;
    }
    this.emit({ k: 'fire', u: a.id, t: -1 - s.id, tx: tile % m.w, ty: (tile / m.w) | 0, w: w.id, shots: res, indirect: hc.indirect, total, struct: true });
    const hits = res.filter((r) => r.hit).length;
    if (!this.record(a, s.name, w, hits, res.length, total ? [['', total]] : [])) this.say(`${this.displayName(a)}: ${w.name} → ${s.name} ${hits}/${res.length} hit${total ? ` (${total})` : ''}`, SIDE(a.team) === 0 ? '#9fd8ef' : '#f0a898');
    if (total > 0) this.damageStructureObj(s, total, a);
  }

  damageStructureObj(s: Structure, dmg: number, by: Unit | null): void {
    if (s.destroyed) return;
    if (dmg > 0) this.lastDamageRound = this.round;
    s.hp -= dmg;
    const m = this.map;
    const tile = s.tiles[0];
    if (s.hp <= 0) {
      destroyStructure(m, s);
      this.emit({ k: 'structure', s: s.id, x: tile % m.w, y: (tile / m.w) | 0 });
      for (const i of s.tiles) this.emit({ k: 'boom', x: i % m.w, y: (i / m.w) | 0, size: s.objective ? 2 : 1 });
      this.say(`${s.name} destroyed${by ? ` by ${this.displayName(by)}` : ''}.`, s.objective ? '#f0a830' : '#9ab');
      this.hooks.structDestroyed?.(this, s);
      this.updateVisibility();
      this.check();
    }
  }

  // ---- Damage ----------------------------------------------------------------------------
  damage(t: Unit, loc: string, dmg: number, by: Unit | null, critMult = 1): void {
    if (dmg > 0) this.lastDamageRound = this.round;
    if (!t.alive || dmg <= 0) return;
    const f = t.frame;
    t.dmgTaken += dmg;
    let sl = structLoc(loc);
    // Redirect hits on destroyed locations
    let guard = 0;
    while (f.struct[sl] !== undefined && f.struct[sl] <= 0 && guard++ < 4) {
      const nx = TRANSFER[sl];
      if (!nx) return;
      sl = nx;
      loc = loc in REAR_OF ? sl + 'R' : sl;
      if (f.armor[loc] === undefined) loc = sl;
    }
    if (f.struct[sl] === undefined) return;
    if (f.kind === 'mech' && sl === 'HD') {
      if (!t.prone && !t.shutdown) dmg = Math.min(dmg, 45);
      if (dmg >= 10) this.injure(t, 'Head hit');
      if (!t.alive) return;
    }
    const a = f.armor[loc] ?? 0;
    const absorbed = Math.min(a, dmg);
    if (f.armor[loc] !== undefined) f.armor[loc] = a - absorbed;
    dmg -= absorbed;
    if (dmg > 0) this.damageStructure(t, sl, dmg, by, critMult);
  }

  damageStructure(t: Unit, sl: string, dmg: number, by: Unit | null, critMult = 1): void {
    const f = t.frame;
    if (!t.alive) return;
    const s = f.struct[sl];
    if (s === undefined) return;
    const sd = Math.min(s, dmg);
    if (s === f.maxStruct[sl] && sd > 0 && s - sd > 0 && f.kind === 'mech') this.float(t.x, t.y, `${sl} BREACHED`, '#f08a30');
    f.struct[sl] = s - sd;
    const over = dmg - sd;
    if (f.struct[sl] > 0) {
      const gun = by?.pilot?.gun ?? 3;
      const p = Math.min(0.75, (0.1 + (0.6 * sd) / f.maxStruct[sl]) * critMult * (1 + gun * 0.03));
      if (this.rng.next() < p) this.critical(t, sl, by);
    } else {
      this.destroyLocation(t, sl, by);
      if (over > 0 && t.alive) {
        const nx = TRANSFER[sl];
        if (nx) this.damage(t, nx, over, by, critMult);
      }
    }
  }

  critical(t: Unit, sl: string, by: Unit | null): void {
    const f = t.frame;
    const live = f.items.filter((c) => c.loc === sl && !c.dead);
    if (!live.length) return;
    const c = this.rng.weighted(live, (x) => item(x.id).slots);
    c.dead = true;
    const d = item(c.id);
    this.say(`CRIT! ${this.displayName(t)}'s ${d.name} (${sl}) destroyed.`, '#f0d050');
    this.float(t.x, t.y, `CRIT: ${d.short}`, '#f0d050');
    t.stats = frameStats(f);
    if (d.kind === 'ammo' && (c.ammo ?? 0) > 0 && (d.explode ?? 0) > 0) {
      const boom = Math.min(180, Math.round((c.ammo ?? 0) * (d.explode ?? 0) * 0.35));
      c.ammo = 0;
      this.say(`AMMO EXPLOSION in ${this.displayName(t)}'s ${LOC_NAMES[sl]}! ${boom} damage.`, '#ff6a2a');
      this.float(t.x, t.y, 'AMMO EXPLOSION', '#ff6a2a', true);
      this.emit({ k: 'boom', x: t.x, y: t.y, size: 2 });
      this.injure(t, 'Ammo explosion');
      if (t.alive) this.damageStructure(t, sl, boom, by, 0);
      if (!t.alive && t.destroyHow === 'ct') t.destroyHow = 'ammo';
    } else if (d.id === 'GAUSS' || d.base === 'GAUSS') {
      this.say(`Gauss capacitor discharge!`, '#ff6a2a');
      this.emit({ k: 'boom', x: t.x, y: t.y, size: 1 });
      this.damageStructure(t, sl, 40, by, 0);
    }
  }

  destroyLocation(t: Unit, sl: string, by: Unit | null): void {
    const f = t.frame;
    f.struct[sl] = 0;
    if (f.armor[sl] !== undefined) f.armor[sl] = 0;
    if (f.armor[sl + 'R'] !== undefined) f.armor[sl + 'R'] = 0;
    for (const c of f.items) if (c.loc === sl) c.dead = true;
    t.stats = frameStats(f);
    if (f.kind !== 'mech') {
      this.kill(t, 'vehicle', by);
      return;
    }
    this.float(t.x, t.y, `${LOC_NAMES[sl].toUpperCase()} DESTROYED`, '#e8503a');
    this.say(`${this.displayName(t)}'s ${LOC_NAMES[sl]} is destroyed!`, '#e8503a');
    this.resolve[1 - SIDE(t.team)] = Math.min(this.resolveMax[1 - SIDE(t.team)], this.resolve[1 - SIDE(t.team)] + 10);
    if (sl === 'HD') { this.kill(t, 'head', by); return; }
    if (sl === 'CT') { this.kill(t, 'ct', by); return; }
    if (sl === 'LT' || sl === 'RT') {
      const arm = sl === 'LT' ? 'LA' : 'RA';
      if (f.struct[arm] > 0) {
        f.struct[arm] = 0; f.armor[arm] = 0;
        for (const c of f.items) if (c.loc === arm) c.dead = true;
        this.say(`${this.displayName(t)}'s ${LOC_NAMES[arm]} is torn away.`, '#e8503a');
      }
      this.injure(t, 'Side torso destroyed');
      t.stats = frameStats(f);
    }
    if (sl === 'LL' || sl === 'RL') {
      if (f.struct.LL <= 0 && f.struct.RL <= 0) { this.kill(t, 'legs', by); return; }
      this.knockdown(t);
    }
    if (t.alive && t.team === 1 && this.shouldEject(t)) this.eject(t);
  }

  injure(t: Unit, why: string): void {
    if (!t.pilot || !t.alive || t.frame.kind !== 'mech') return;
    if (t.stats.injuryResist > 0 && !t.cageUsed) {
      t.cageUsed = true;
      this.float(t.x, t.y, 'SAFETY CAGE', '#8ab4ff');
      return;
    }
    t.pilot.injuries++;
    t.injuriesTaken++;
    this.float(t.x, t.y, 'PILOT INJURED', '#f08a30');
    this.say(`${this.displayName(t)}'s pilot injured (${why}). Health ${Math.max(0, health(t.pilot) - t.pilot.injuries)}/${health(t.pilot)}.`, '#f08a30');
    if (t.pilot.injuries >= health(t.pilot)) {
      this.say(`${t.team === 0 ? t.pilot.callsign : `${this.displayName(t)}'s pilot`} is incapacitated!`, '#e8503a');
      this.kill(t, 'pilot', null);
    }
  }

  knockdown(t: Unit): void {
    if (!this.isMech(t) || t.prone || !t.alive) return;
    t.prone = true;
    t.stab = 0;
    t.pips = 0;
    t.unsteady = false;
    t.guarded = false;
    this.float(t.x, t.y, 'KNOCKDOWN', '#f0d050', true);
    this.say(`${this.displayName(t)} is knocked down!`, '#f0d050');
    this.injure(t, 'Knockdown');
  }

  applyStability(t: Unit, amt: number): void {
    if (!this.isMech(t) || !t.alive || t.prone || t.shutdown) return;
    const pil = t.pilot?.pil ?? 3;
    amt *= Math.max(0.2, 1 - pil * 0.025 - t.stats.stabReduce / 100) * (t.entrenched ? 0.5 : 1);
    t.stab += amt;
    const mx = t.stats.stabMax;
    if (t.stab >= mx) { if (this.pendingKnock) this.pendingKnock.add(t); else this.knockdown(t); }
    else if (t.stab >= mx * 0.5 && !t.unsteady) {
      t.unsteady = true;
      t.pips = 0;
      this.float(t.x, t.y, 'UNSTEADY', '#f0d050');
    }
  }

  shouldEject(t: Unit): boolean {
    if (!t.pilot || !this.isMech(t)) return false;
    const f = t.frame;
    let destroyed = 0;
    for (const k in f.maxStruct) if (f.struct[k] <= 0) destroyed++;
    const ctF = f.struct.CT / f.maxStruct.CT;
    const risk = destroyed * 0.12 + (ctF < 0.35 ? 0.25 : 0) + t.pilot.injuries * 0.12 - t.pilot.gut * 0.03;
    return this.rng.next() < risk;
  }

  eject(t: Unit): void {
    if (!t.alive) return;
    this.say(`${this.displayName(t)}'s pilot ejects!`, '#f0a830');
    t.ejected = true;
    this.float(t.x, t.y, 'EJECTED', '#f0a830', true);
    this.kill(t, 'eject', null);
  }

  kill(t: Unit, how: Unit['destroyHow'], by: Unit | null): void {
    if (!t.alive) return;
    t.alive = false;
    t.destroyHow = how;
    if (by) { by.kills++; this.resolve[SIDE(by.team)] = Math.min(this.resolveMax[SIDE(by.team)], this.resolve[SIDE(by.team)] + 20); }
    this.emit({ k: 'boom', x: t.x, y: t.y, size: how === 'eject' || how === 'pilot' ? 1 : 3 });
    this.emit({ k: 'destroyed', u: t.id, how });
    this.map.wrecks.set(t.y * this.map.w + t.x, t.frame.kind === 'mech' ? '¤' : '&');
    this.map.scorch[t.y * this.map.w + t.x] = 1;
    const what = how === 'eject' ? 'abandoned' : how === 'pilot' ? 'disabled' : 'destroyed';
    this.say(`${t.team === 0 ? `${this.fullName(t)} (${this.displayName(t)})` : `${t.mapTag ? t.mapTag + ' ' : ''}${this.fullName(t)}`} ${what}${by ? ` by ${this.displayName(by)}` : ''}.`, SIDE(t.team) === 0 ? '#e8503a' : '#6ad46a');
    this.hooks.destroyed?.(this, t);
  }

  // ---- Melee -----------------------------------------------------------------------------
  meleeSpots(u: Unit, t: Unit, dfa: boolean): Map<number, [number, number]> {
    const m = this.map;
    const reach = dfa ? this.reachable(u, 'jump') : this.reachable(u, 'walk');
    const out = new Map<number, [number, number]>();
    const addIf = (x: number, y: number, v: [number, number]) => {
      if (Math.max(Math.abs(x - t.x), Math.abs(y - t.y)) !== 1) return;
      if (Math.abs(m.elev[y * m.w + x] - m.elev[t.y * m.w + t.x]) > 1 && !dfa) return;
      out.set(y * m.w + x, v);
    };
    if (!u.moved && Math.max(Math.abs(u.x - t.x), Math.abs(u.y - t.y)) === 1 && !dfa) addIf(u.x, u.y, [0, -1]);
    for (const [i, v] of reach) addIf(i % m.w, (i / m.w) | 0, v);
    (out as any)._prev = (reach as any)._prev;
    return out;
  }

  melee(a: Unit, t: Unit, path: [number, number][], dfa: boolean): void {
    if (!this.isMech(a) || a.attacked || !t.alive) return;
    if (path.length >= 2) this.move(a, path, dfa ? 'jump' : 'walk');
    a.moved = dfa ? 'jump' : 'walk';
    a.attacked = true;
    this.setFacing(a, dirTo(a.x, a.y, t.x, t.y));
    const hc = this.meleeChance(a, t, dfa);
    const hit = this.rng.next() * 100 < hc.chance;
    const tons = frameTons(a.frame);
    let dmg = Math.round((dfa ? a.stats.dfaDmg : a.stats.meleeDmg) * (hasQuirk(a.pilot, 'brawler') ? 1.15 : 1));
    const arc = attackArc(t, a.x, a.y);
    let loc = '';
    if (hit) {
      const smaller = frameTons(t.frame) <= tons - 20;
      if (t.frame.kind !== 'mech') loc = this.rollLocation(t, arc);
      else if (dfa) loc = this.rng.weighted(Object.keys(HIT_DFA), (k) => HIT_DFA[k]);
      else if (smaller && this.rng.chance(0.5)) loc = this.rng.pick(Object.keys(HIT_KICK));
      else loc = this.rollLocation(t, arc);
      if (t.guarded && arc !== 'rear') dmg = Math.round(dmg * 0.6);
    }
    this.emit({ k: 'melee', u: a.id, t: t.id, hit, dmg: hit ? dmg : 0, dfa, loc });
    if (hit) {
      // Split into two blows for the damage model
      const half = Math.ceil(dmg / 2);
      const loc2 = dfa ? this.rng.weighted(Object.keys(HIT_DFA), (k) => HIT_DFA[k]) : loc;
      this.say(`${this.displayName(a)} ${dfa ? 'DEATH FROM ABOVE' : 'melee'} → ${this.displayName(t)}: ${dmg} (${loc2 === loc ? `${loc} ${dmg}` : `${loc} ${half}, ${loc2} ${dmg - half}`})`, '#f0a830');
      this.damage(t, loc, half, a, 1);
      if (t.alive) this.damage(t, loc2, dmg - half, a, 1);
      a.dmgDealt += dmg;
      const jug = has(a.pilot ?? undefined, 'juggernaut');
      if (t.alive) {
        this.applyStability(t, tons * (dfa ? 1.0 : 0.8) * (jug ? 1.5 : 1));
        if (jug && !t.acted && t.phase > 1) { t.phase--; this.float(t.x, t.y, 'INITIATIVE -1', '#f0d050'); }
        else if (jug) (t as any)._knockedBack = true;
        t.pips = 0;
      }
    } else {
      this.say(`${this.displayName(a)} ${dfa ? 'DFA' : 'melee'} misses ${this.displayName(t)}.`, '#889');
    }
    // Support weapons fire alongside a melee attack, as in BATTLETECH
    if (t.alive && a.alive) {
      const sup = this.weaponsOf(a).filter((w) => item(w.id).hard === 'S' && this.hasAmmo(a, w));
      for (const wc of sup) {
        const w = item(wc.id);
        const shc = this.hitChance(a, t, w);
        if (!shc.ok || !t.alive) continue;
        const shots = this.useAmmo(a, w);
        if (this.isMech(a)) a.heat += w.heat ?? 0;
        this.fireAtUnit(a, t, w, shots, shc, undefined, false);
      }
    }
    if (dfa) {
      // The attacker's legs take a beating either way
      const legDmg = Math.round(tons * (hit ? 0.25 : 0.4));
      this.say(`${this.displayName(a)}'s legs take ${legDmg} damage from the landing.`, '#9ab');
      for (const l of ['LL', 'RL']) if (a.frame.struct[l] > 0) this.damage(a, l, Math.round(legDmg / 2), null, 0.5);
      if (a.alive) this.applyStability(a, hit ? 20 : 60);
    }
    this.updateVisibility();
    this.check();
  }

  // ---- Other actions ---------------------------------------------------------------------
  brace(u: Unit): void {
    u.guarded = true;
    u.stab = 0;
    u.unsteady = false;
    this.float(u.x, u.y, 'BRACED', '#8ab4ff');
    this.say(`${this.displayName(u)} braces.`, '#8ab4ff');
  }

  vigilance(u: Unit): boolean {
    const side = SIDE(u.team);
    if (this.resolve[side] < this.resolveCost()) return false;
    this.resolve[side] -= this.resolveCost();
    u.guarded = true;
    u.entrenched = true;
    u.stab = 0;
    u.unsteady = false;
    u.accDebuff = 0;
    if (u.pilot && u.pilot.injuries > 0 && u.team !== 0) void 0;
    this.float(u.x, u.y, 'VIGILANCE', '#5fd0e8', true);
    this.say(`${this.displayName(u)} uses VIGILANCE: Guarded, Entrenched, stability restored.`, '#5fd0e8');
    return true;
  }

  resolveCost(): number { return 40; }

  sensorLock(u: Unit, t: Unit): void {
    u.attacked = true;
    t.sensorLocked = 2;
    t.pips = Math.max(0, t.pips - 2);
    this.float(t.x, t.y, 'SENSOR LOCK', '#5fd0e8', true);
    this.say(`${this.displayName(u)} sensor-locks ${this.displayName(t)}.`, '#5fd0e8');
    this.updateVisibility();
  }

  reserve(u: Unit): boolean {
    if (u.phase <= 1 || u.moved || u.attacked) return false;
    u.phase--;
    u.reserved = true;
    if (this.active === u) this.active = null;
    this.say(`${this.displayName(u)} reserves to phase ${u.phase}.`, '#9ab');
    return true;
  }

  withdraw(): void {
    if (this.withdrawIn > 0) return;
    this.withdrawIn = 2;
    this.say('Withdrawal ordered. Dropship inbound: extraction in 2 rounds.', '#5fd0e8');
  }

  check(): void {
    if (this.result) return;
    const r = this.hooks.check?.(this) ?? '';
    if (r) { this.finish(r); return; }
    const playerMechs = this.units.filter((u) => u.team === 0 && u.alive && !u.fled);
    if (!playerMechs.length) this.finish('loss');
  }

  finish(r: 'win' | 'loss' | 'withdraw'): void {
    if (this.result) return;
    this.result = r;
    this.emit({ k: 'end', result: r });
  }

  // ---- Helpers for UI/AI -----------------------------------------------------------------
  weaponsOf(u: Unit): Component[] {
    return u.frame.items.filter((c) => !c.dead && item(c.id).kind === 'weapon');
  }

  expectedDamage(a: Unit, t: Unit, from: { x: number; y: number; moved: MoveMode | null }, weapons = this.weaponsOf(a)): number {
    let e = 0;
    for (const wc of weapons) {
      const w = item(wc.id);
      if (!this.hasAmmo(a, wc)) continue;
      const hc = this.hitChance(a, t, w, from);
      if (!hc.ok) continue;
      e += ((hc.chance / 100) * (w.dmg ?? 0) * (w.shots ?? 1));
    }
    return e;
  }

  structAt(x: number, y: number): Structure | null {
    const m = this.map;
    if (!inb(m, x, y)) return null;
    const s = m.struct[y * m.w + x];
    return s >= 0 ? m.structures[s] : null;
  }

  describeArmor(u: Unit): string {
    const f = u.frame;
    return Object.keys(f.armor).map((k) => `${k}:${f.armor[k]}/${f.struct[structLoc(k)] ?? '-'}`).join(' ');
  }

  chassisName(u: Unit): string {
    return u.frame.kind === 'mech' ? chassis(u.frame.defId).name : vehicle(u.frame.defId).name;
  }
}
