// Tactical combat screen.

import { Screen, app } from './app';
import { UI } from '../engine/ui';
import { Display, COLS, ROWS } from '../engine/display';
import { C, lerp, scale, light, desaturate, healthColor, rgb, hex } from '../engine/color';
import { Battle, Unit, BEvent, SIDE, MoveMode, attackArc, HitCalc, Assignment, structLoc } from '../combat/battle';
import { aiTakeTurn } from '../combat/ai';
import { MissionRuntime, MISSION_INFO } from '../combat/missions';
import { FX, lightAt } from '../combat/fx';
import { BIOME_INFO, TERRAIN, dist, dirTo, DIRS, Structure } from '../combat/terrain';
import { item, ItemDef } from '../data/items';
import { Component, frameGlyph } from '../game/frame';
import { has, health, ability } from '../game/pilot';
import { drawDoll, heatBar, simpleBar, pipStr, frameTitle, classTag, skillLine, healthPips, weaponTip, locName } from './widgets';
import { wrap, vlen, pad } from '../engine/util';
import { sfx, weaponSfx, isMuted, setMuted } from '../engine/sound';

const MX = 0, MY = 1, VW = 50, VH = 36;
const PX = 100, PW = 50;

type Mode = 'move' | 'jump' | 'melee' | 'dfa' | 'facing' | 'called' | 'lock';

interface Reach { walk: Map<number, [number, number]>; sprint: Map<number, [number, number]>; jump: Map<number, [number, number]>; }

export class CombatScreen implements Screen {
  b: Battle;
  fx = new FX();
  camX = 0;
  camY = 0;
  sel: Unit | null = null;
  mode: Mode = 'move';
  reach: Reach | null = null;
  reachKey = '';
  pending: { tile: number; mode: MoveMode } | null = null;
  target: Unit | null = null;
  /** The target was chosen automatically after a move; the first click on it only confirms it. */
  autoPicked = false;
  tStruct: Structure | null = null;
  weaponsOff = new Set<Component>();
  multi = new Map<Component, Unit>();
  calledLoc: string | null = null;
  meleeTarget: Unit | null = null;
  queue: BEvent[] = [];
  wait = 0;
  shownPos = new Map<number, [number, number]>();
  animPos = new Map<number, [number, number]>();
  ghosts = new Set<number>();
  logLines: { text: string; color?: string }[] = [];
  flashMsg: { text: string; until: number } | null = null;
  logScroll = { scroll: 0 };
  banner: { text: string; sub: string; t: number; color: string } | null = null;
  aiTimer = 0;
  speed = 1;
  showHeights = false;
  showHelp = false;
  confirmWithdraw = false;
  time = 0;
  facingDir = 0;
  hoverTile = -1;
  resultShown = false;
  lastActor: 'player' | 'ai' | 'none' = 'none';
  briefingOpen = true;
  deadFx = new Map<number, number>();
  autoplay = false;
  plan: { x: number; y: number; moved: MoveMode | null } | null = null;
  heatConfirm = false;
  hitFlash = new Map<number, number>();
  glyphs = new Map<number, string>();
  playingTeam = 0;

  constructor(public rt: MissionRuntime, public onDone: (rt: MissionRuntime) => void, public title = '') {
    this.b = rt.battle;
    this.b.start();
    this.pull();
    const p = rt.playerUnits[0];
    if (p) this.centerOn(p.x, p.y);
    this.assignGlyphs();
    const q = new URLSearchParams(location.search);
    if (q.has('auto')) { this.autoplay = true; this.briefingOpen = false; this.speed = +(q.get('speed') ?? 1); }
  }

  /** Unique glyph per unit within a side: first unused letter of the chassis name. */
  assignGlyphs(): void {
    const used = new Set<string>(); // shared, so a tag never means two different units
    for (const side of [0, 1]) {
      for (const u of this.b.units.filter((x) => SIDE(x.team) === side)) {
        // Turrets and haulers are numbered; other vehicles get lower-case codes so they never read as 'Mechs
        if (u.frame.kind === 'turret' || u.tag === 'convoy') {
          const base = u.frame.kind === 'turret' ? 'τ' : '■';
          let n = 1; while (used.has(base + n)) n++;
          const g = n < 10 ? base + n : base; used.add(g); this.glyphs.set(u.id, g); u.mapTag = g; continue;
        }
        if (u.frame.kind === 'vehicle') {
          const code = u.frame.defId.toLowerCase().replace(/[^a-z]/g, '');
          let g = code.slice(0, 2);
          for (let k = 2; used.has(g) && k < code.length; k++) g = code[0] + code[k];
          for (let n = 2; used.has(g) && n < 10; n++) g = code[0] + String(n);
          used.add(g); this.glyphs.set(u.id, g); u.mapTag = g; continue;
        }
        // Two-letter designation from the BattleTech variant code (HBK-4G → HB, AS7-D → AS)
        const code = u.frame.defId.toUpperCase().replace(/[^A-Z]/g, '');
        let g = code.slice(0, 2);
        for (let k = 2; used.has(g) && k < code.length; k++) g = code[0] + code[k];
        for (let n = 2; used.has(g) && n < 10; n++) g = code[0] + String(n);
        used.add(g);
        this.glyphs.set(u.id, g);
        u.mapTag = g;
      }
    }
  }
  /** Exit zones and escape points implied by mission AI goals. */
  goalMarkers(): Map<number, { color: string; glyph: string; force?: boolean }> {
    const out = new Map<number, { color: string; glyph: string; force?: boolean }>();
    const m = this.b.map;
    for (const bc of m.beacons ?? []) {
      const col = bc.owner === 0 ? '#4ad4e8' : '#f0c040';
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = bc.x + dx, y = bc.y + dy;
        if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
        out.set(y * m.w + x, dx || dy ? { color: col, glyph: '·' } : { color: col, glyph: '◎', force: true });
      }
    }
    for (const u of this.b.units) {
      if (!u.alive || u.fled || !u.ai.goal) continue;
      const fleeing = u.tag === 'convoy' || (u as any)._fleeing || (u.tag === 'target' && this.b.seen[0].has(u.id));
      if (!fleeing) continue;
      const [gx, gy] = u.ai.goal;
      const col = SIDE(u.team) === 0 ? '#4ad48a' : '#e8503a';
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = Math.max(0, Math.min(m.w - 1, gx + dx)), y = Math.max(0, Math.min(m.h - 1, gy + dy));
        out.set(y * m.w + x, { color: col, glyph: SIDE(u.team) === 0 ? '»' : '×' });
      }
    }
    return out;
  }

  wasSeen = new Set<number>();
  ghostAt(i: number): boolean {
    const m = this.b.map;
    for (const id of this.ghosts) { const u = this.b.unit(id); if (u.y * m.w + u.x === i) return true; }
    return false;
  }

  glyphOf(u: Unit): string { return this.glyphs.get(u.id) ?? frameGlyph(u.frame); }

  // ---- Event plumbing --------------------------------------------------------------------
  pull(): void {
    for (const id of this.b.seen[0]) this.wasSeen.add(id);
    const evs = this.b.events.splice(0);
    for (const e of evs) {
      if (e.k === 'move' && !this.shownPos.has(e.u)) this.shownPos.set(e.u, e.path[0]);
      if (e.k === 'destroyed') this.ghosts.add(e.u);
    }
    this.queue.push(...evs);
  }

  visibleUnit(u: Unit): boolean {
    return SIDE(u.team) === 0 || this.b.seen[0].has(u.id);
  }

  private playNext(): void {
    const e = this.queue.shift()!;
    const b = this.b;
    if ('u' in e && typeof (e as any).u === 'number' && e.k !== 'destroyed') { const pu = b.units.find((q) => q.id === (e as any).u); if (pu) this.playingTeam = SIDE(pu.team); }
    const sp = this.speed;
    switch (e.k) {
      case 'round':
        this.banner = { text: `ROUND ${e.round}`, sub: '', t: 1.4, color: C.accent };
        sfx('alert');
        this.wait = 0.35 / sp;
        break;
      case 'phase':
        this.wait = 0.05;
        break;
      case 'activate': {
        const u = b.unit(e.u);
        if (u.team === 0 || this.visibleUnit(u)) this.ensureVisible(u.x, u.y);
        this.wait = u.team === 0 ? 0 : 0.12 / sp;
        break;
      }
      case 'move': {
        const u = b.unit(e.u);
        const vis = u.team === 0 || SIDE(u.team) === 0 || this.b.seen[0].has(u.id) || this.tileSeenNow(e.path[0]);
        if (!vis) { this.shownPos.delete(e.u); this.wait = 0; break; }
        const path = e.path;
        const stepT = (e.mode === 'jump' ? 0.5 : 0.075 * path.length) / sp;
        let t = 0;
        const total = stepT;
        let lastStep = -1;
        if (e.mode === 'jump') sfx('jump');
        const tick = () => {
          const f = Math.min(1, t / total);
          if (e.mode === 'jump') {
            const [x0, y0] = path[0], [x1, y1] = path[path.length - 1];
            this.animPos.set(e.u, [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f - Math.sin(f * Math.PI) * 1.5]);
            if (Math.random() < 0.5) this.fx.parts.push({ x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f - Math.sin(f * Math.PI) * 1.5 + 0.6, vx: 0, vy: 1, life: 0, max: 0.3, glyph: ['*', '·'], c0: '#ffd060', c1: '#a03010', light: 1.5 });
          } else {
            const k = f * (path.length - 1);
            const i = Math.min(path.length - 2, Math.floor(k));
            const fr = k - i;
            const [ax, ay] = path[i], [bx, by] = path[i + 1];
            this.animPos.set(e.u, [ax + (bx - ax) * fr, ay + (by - ay) * fr]);
            if (i !== lastStep && u.frame.kind === 'mech') { lastStep = i; sfx('step', 0, 0.4 + frameTonsOf(u) / 150); }
          }
          const [px, py] = this.animPos.get(e.u)!;
          if (u.team === 0 || this.visibleUnit(u)) this.ensureVisible(Math.round(px), Math.round(py), 4);
        };
        this.anims.push({ dur: total, step: (dt) => { t += dt; tick(); }, done: () => { this.animPos.delete(e.u); this.shownPos.delete(e.u); } });
        this.wait = total;
        break;
      }
      case 'face':
        this.wait = 0;
        break;
      case 'fire':
        this.wait = this.animateFire(e) / sp;
        break;
      case 'melee': {
        const a = b.unit(e.u), t = b.unit(e.t);
        const [ax, ay] = this.posOf(a), [tx, ty] = this.posOf(t);
        this.fx.parts.push({ x: tx, y: ty, vx: 0, vy: 0, life: 0, max: 0.3, glyph: e.hit ? '✶' : '·', c0: '#ffffff', c1: '#f0a830', light: e.hit ? 3 : 0 });
        sfx('melee', 0, e.hit ? 1 : 0.4);
        if (e.hit) { this.fx.sparks(tx, ty, 10, ['#ffe0a0', '#a04010'], 4); this.fx.shake = 0.4; this.fx.float(tx, ty, `${e.dmg}`, '#f0d050', true); }
        else this.fx.float(tx, ty, 'MISS', '#889');
        void ax; void ay;
        this.wait = 0.45 / sp;
        break;
      }
      case 'float':
        if (this.tileVisibleXY(e.x, e.y) || this.unitVisibleAt(e.x, e.y) || this.ghostAt(e.y * this.b.map.w + e.x)) {
          this.fx.float(e.x, e.y, e.text, e.color, e.big);
          if (e.text.startsWith('CRIT')) sfx('crit');
          if (e.text === 'KNOCKDOWN') { this.fx.sparks(e.x, e.y, 12, ['#c0b090', '#403a30'], 2.2, 0, 0.9); this.fx.shake = Math.max(this.fx.shake, 0.3); sfx('melee', 0, 0.6); }
        }
        this.wait = 0.02;
        break;
      case 'log':
        if (!this.mergeLog(e.text)) this.logLines.push({ text: e.text, color: e.color });
        if (this.logLines.length > 400) this.logLines.splice(0, 100);
        this.logScroll.scroll = 1e9;
        this.wait = 0;
        break;
      case 'boom':
        this.fx.explosion(e.x, e.y, e.size);
        { const m = this.b.map; const rr = e.size >= 3 ? 2 : e.size >= 2 ? 1 : 0;
          for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) { const xx = e.x + dx, yy = e.y + dy; if (xx >= 0 && yy >= 0 && xx < m.w && yy < m.h) m.scorch[yy * m.w + xx] = Math.max(m.scorch[yy * m.w + xx], 1 - Math.hypot(dx, dy) / (rr + 1.5)); } }
        sfx(e.size >= 3 ? 'bigboom' : 'boom', 0, e.size >= 2 ? 1 : 0.6);
        this.wait = (e.size >= 3 ? 0.35 : 0.15) / sp;
        break;
      case 'destroyed': {
        this.ghosts.delete(e.u);
        const u = b.unit(e.u);
        if (e.how !== 'fled') { this.deadFx.set(u.y * b.map.w + u.x, this.time); if (u.frame.kind === 'mech' && e.how !== 'eject' && e.how !== 'pilot') { this.fx.flash = Math.max(this.fx.flash, 0.35); this.fx.shake = Math.max(this.fx.shake, 0.6); } }
        this.wait = 0.2 / sp;
        break;
      }
      case 'structure':
        this.wait = 0.15 / sp;
        break;
      case 'status':
        if (e.text === 'KNOCKDOWN') this.fx.sparks(this.b.unit(e.u).x, this.b.unit(e.u).y, 10, ['#b0a080', '#403a30'], 2, 0, 0.8);
        this.fx.float(b.unit(e.u).x, b.unit(e.u).y, e.text, e.color);
        this.wait = 0.05;
        break;
      case 'end':
        this.wait = 0.8;
        break;
    }
  }

  anims: { dur: number; step: (dt: number) => void; done: () => void; t?: number }[] = [];

  private unitVisibleAt(x: number, y: number): boolean {
    const u = this.b.units.find((q) => q.x === x && q.y === y);
    return !!u && (SIDE(u.team) === 0 || this.b.seen[0].has(u.id));
  }

  private tileSeenNow(p: [number, number]): boolean {
    return !!this.b.visibleTiles[p[1] * this.b.map.w + p[0]];
  }
  private tileVisibleXY(x: number, y: number): boolean {
    return !!this.b.visibleTiles[Math.round(y) * this.b.map.w + Math.round(x)];
  }

  posOf(u: Unit): [number, number] {
    return this.animPos.get(u.id) ?? this.shownPos.get(u.id) ?? [u.x, u.y];
  }

  private animateFire(e: Extract<BEvent, { k: 'fire' }>): number {
    const b = this.b;
    const a = b.unit(e.u);
    const w = item(e.w);
    const base = w.base;
    const tu = e.t >= 0 ? b.unit(e.t) : null;
    const [tx, ty] = tu ? this.posOf(tu) : [e.tx, e.ty];
    let [ax, ay] = this.posOf(a);
    if (SIDE(a.team) === 1 && !b.seen[0].has(a.id)) {
      // Don't reveal a hidden shooter: fire streaks in from its general direction
      const dd = Math.hypot(ax - tx, ay - ty) || 1;
      ax = tx + ((ax - tx) / dd) * 6; ay = ty + ((ay - ty) / dd) * 6;
    }
    const shots = e.shots;
    let dur = 0.3;
    const missPt = () => {
      const ang = Math.random() * Math.PI * 2, r = 0.8 + Math.random() * 1.6;
      return [tx + Math.cos(ang) * r, ty + Math.sin(ang) * r];
    };
    sfx(weaponSfx(base), 0, 0.9);
    const impact = (x: number, y: number, hit: boolean, big: number) => {
      if (hit) { sfx('hit', 0, 0.5 + big * 0.2); if (tu) this.hitFlash.set(tu.id, this.time); }
      if (hit) this.fx.sparks(x, y, 3 + big * 2, ['#ffe8a0', '#c04010'], 2 + big);
      else this.fx.sparks(x, y, 2, ['#8a7a60', '#3a3228'], 1.5);
    };
    if (base === 'ML' || base === 'LL' || base === 'SL') {
      const col = base === 'LL' ? '#ff4040' : base === 'SL' ? '#ff7050' : '#ff2a2a';
      const s = shots[0];
      const [ex, ey] = s.hit ? [tx, ty] : missPt();
      this.fx.beam(ax, ay, ex, ey, col, '#ffd0d0', base === 'LL' ? 0.45 : 0.3, 0);
      impact(ex, ey, s.hit, base === 'LL' ? 2 : 1);
      dur = 0.35;
    } else if (base === 'PPC') {
      const s = shots[0];
      const [ex, ey] = s.hit ? [tx, ty] : missPt();
      this.fx.beam(ax, ay, ex, ey, '#60a8ff', '#ffffff', 0.5, 0, true);
      this.fx.sparks(ex, ey, s.hit ? 10 : 3, ['#e0f0ff', '#2050c0'], 3);
      if (s.hit) this.fx.flash = Math.max(this.fx.flash, 0.12);
      dur = 0.5;
    } else if (base === 'FL') {
      for (let i = 0; i < 14; i++) {
        const f = Math.random();
        this.fx.parts.push({ x: ax, y: ay, vx: (tx - ax) * (1.5 + f) + (Math.random() - 0.5) * 2, vy: (ty - ay) * (1.5 + f) + (Math.random() - 0.5) * 2, life: 0, max: 0.4 + Math.random() * 0.2,
          glyph: ['*', '≈', '~', '^'], c0: '#ffe070', c1: '#c02010', delay: i * 0.02, light: 1.8, lc: '#ff7020' });
      }
      dur = 0.45;
    } else if (base === 'MG') {
      shots.forEach((s, i) => {
        const [ex, ey] = s.hit ? [tx + (Math.random() - 0.5) * 0.4, ty + (Math.random() - 0.5) * 0.4] : missPt();
        this.fx.projectile(ax, ay, ex, ey, '·', '#fff0a0', '#f0a030', 45, i * 0.06, () => impact(ex, ey, s.hit, 0));
        this.fx.projectile(ax, ay, ex, ey, '·', '#fff0a0', '#f0a030', 45, i * 0.06 + 0.03);
      });
      dur = 0.3;
    } else if (base.startsWith('AC') || base === 'GAUSS') {
      const s = shots[0];
      const [ex, ey] = s.hit ? [tx, ty] : missPt();
      const big = base === 'AC20' ? 3 : base === 'AC10' ? 2 : base === 'GAUSS' ? 2 : 1;
      const glyph = base === 'AC20' ? '●' : base === 'GAUSS' ? '◆' : base === 'AC10' ? '•' : '·';
      const color = base === 'GAUSS' ? '#d0e8ff' : '#ffd060';
      // muzzle flash
      this.fx.parts.push({ x: ax, y: ay, vx: 0, vy: 0, life: 0, max: 0.15, glyph: '*', c0: '#ffffff', c1: '#f0a030', light: 2.5 });
      const tt = this.fx.projectile(ax, ay, ex, ey, glyph, color, '#f08030', base === 'GAUSS' ? 70 : 38, 0.02, () => {
        impact(ex, ey, s.hit, big);
        if (s.hit && big >= 3) { this.fx.shake = 0.5; this.fx.parts.push({ x: ex, y: ey, vx: 0, vy: 0, life: 0, max: 0.3, glyph: '✶', c0: '#ffffff', c1: '#f08030', light: 3.5 }); }
      });
      if (base === 'AC2') this.fx.projectile(ax, ay, ex, ey, '·', color, '#f08030', 38, 0.1);
      dur = tt + 0.15;
    } else {
      // Missiles
      const lrm = base.startsWith('LRM');
      for (let k = 0; k < 4; k++) this.fx.parts.push({ x: ax + (Math.random() - 0.5) * 0.6, y: ay + (Math.random() - 0.5) * 0.6, vx: (Math.random() - 0.5) * 0.8, vy: -0.3 - Math.random() * 0.4, life: 0, max: 0.9 + Math.random() * 0.6, glyph: ['░', '░'], c0: '#9a9088', c1: '#2a2826', delay: k * 0.05 });
      let last = 0;
      shots.forEach((s, i) => {
        const [ex, ey] = s.hit ? [tx + (Math.random() - 0.5) * 0.8, ty + (Math.random() - 0.5) * 0.8] : missPt();
        const arc = lrm ? (e.indirect ? 5 : 2.5) * (Math.random() < 0.5 ? 1 : -1) * (0.6 + Math.random() * 0.6) : (Math.random() - 0.5) * 1.2;
        const d = i * (lrm ? 0.035 : 0.05);
        const t = this.fx.projectile(ax, ay, ex, ey, lrm ? '•' : '*', '#ffe0a0', '#f07030', lrm ? 22 : 26, d, () => {
          if (s.hit) { this.fx.parts.push({ x: ex, y: ey, vx: 0, vy: 0, life: 0, max: 0.25, glyph: '*', c0: '#fff0c0', c1: '#c04010', light: 2 }); }
          else impact(ex, ey, false, 0);
        }, arc, '·');
        last = Math.max(last, d + t);
      });
      dur = Math.min(1.2, last + 0.1);
    }
    if (e.total > 0 && tu) this.fx.float(tx, ty, `${e.total}`, e.total >= 60 ? '#ffd050' : '#f2f6f8', e.total >= 60, dur * 0.8);
    else if (tu) this.fx.float(tx, ty, 'MISS', '#6d7f8a', false, dur * 0.8);
    return Math.max(0.2, dur * 0.85);
  }

  // ---- Camera ---------------------------------------------------------------------------
  centerOn(x: number, y: number): void {
    const m = this.b.map;
    this.camX = Math.max(0, Math.min(m.w - VW, Math.round(x - VW / 2)));
    this.camY = Math.max(0, Math.min(m.h - VH, Math.round(y - VH / 2)));
  }
  ensureVisible(x: number, y: number, margin = 6): void {
    if (x < this.camX + margin || x >= this.camX + VW - margin || y < this.camY + margin || y >= this.camY + VH - margin) this.centerOn(x, y);
  }

  // ---- Selection & reach ----------------------------------------------------------------
  playerTurn(): boolean {
    return !this.b.result && this.queue.length === 0 && this.anims.length === 0 && this.lastActor === 'player';
  }

  canAct(u: Unit | null): u is Unit {
    return !!u && u.team === 0 && u.alive && !u.acted && u.phase === this.b.phase;
  }

  select(u: Unit): void {
    if (this.b.active && this.b.active !== u) return; // must finish current activation
    this.sel = u;
    this.clearTargeting();
    this.mode = 'move';
    this.pending = null;
    this.reach = null;
    this.ensureVisible(u.x, u.y);
  }

  clearTargeting(): void {
    this.target = null;
    this.tStruct = null;
    this.weaponsOff.clear();
    this.multi.clear();
    this.calledLoc = null;
    this.meleeTarget = null;
  }

  getReach(u: Unit): Reach {
    const key = `${u.id}:${u.x},${u.y}:${u.moved}:${this.b.round}:${this.b.units.filter((x) => x.alive).map((x) => x.x + ',' + x.y).join(';')}`;
    if (this.reach && this.reachKey === key) return this.reach;
    const moving = !u.moved && !u.cannotMove && !u.prone && !(u.attacked && !has(u.pilot ?? undefined, 'ace'));
    const empty = new Map<number, [number, number]>();
    this.reach = {
      walk: moving ? this.b.reachable(u, 'walk') : empty,
      sprint: moving && !u.attacked ? this.b.reachable(u, 'sprint') : empty,
      jump: moving && u.stats.jump > 0 ? this.b.reachable(u, 'jump') : empty,
    };
    this.reachKey = key;
    return this.reach;
  }

  commit(u: Unit): boolean {
    if (this.b.active === u) return true;
    if (this.b.active) return false;
    const ok = this.b.beginActivation(u);
    this.pull();
    this.reach = null;
    if (!ok) { this.afterActivation(); return false; }
    return true;
  }

  afterActivation(): void {
    this.clearTargeting();
    this.mode = 'move';
    this.pending = null;
    this.reach = null;
    this.heatConfirm = false;
    // Keep showing the unit that just acted; the idle loop selects the next one once
    // its animations have finished playing.
  }

  endActivation(u: Unit): void {
    this.b.finishActivation(u);
    this.pull();
    this.afterActivation();
  }

  doMove(u: Unit, tile: number, mode: MoveMode): void {
    if (!this.commit(u)) return;
    const r = this.getReach(u);
    const map = mode === 'walk' ? r.walk : mode === 'sprint' ? r.sprint : r.jump;
    if (!map.has(tile)) return;
    const path = this.b.pathTo(u, map, tile, mode);
    this.b.move(u, path, mode);
    this.pull();
    this.pending = null;
    this.reach = null;
    if (mode === 'sprint' || (u.attacked && has(u.pilot ?? undefined, 'ace'))) { this.mode = 'facing'; this.facingDir = u.facing; }
    else this.mode = 'move';
    this.autoTarget(u);
  }

  autoTarget(u: Unit): void {
    // Keep current target if still valid; else pick the best visible enemy in range
    const cands = this.b.enemiesOf(u).filter((e) => this.b.seen[0].has(e.id));
    const valid = (t: Unit) => this.b.weaponsOf(u).some((w) => this.b.hitChance(u, t, item(w.id)).ok);
    this.autoPicked = true;
    if (this.target && this.target.alive && valid(this.target)) return;
    this.target = null;
    let best: Unit | null = null, bv = 0;
    for (const t of cands) {
      const ev = this.b.expectedDamage(u, t, u);
      if (ev > bv) { bv = ev; best = t; }
    }
    if (best && u.moved) this.target = best;
  }

  selectedWeapons(u: Unit, t: Unit | null, s: Structure | null = null): Component[] {
    return this.b.weaponsOf(u).filter((w) => {
      if (this.weaponsOff.has(w)) return false;
      if (this.multi.size && this.multi.has(w)) return false;
      if (!this.b.hasAmmo(u, w)) return false;
      const hc = this.b.hitChance(u, t, item(w.id), u, undefined, false, s ?? undefined);
      return hc.ok;
    });
  }

  fire(u: Unit): void {
    if (!this.b.canAttack(u)) return;
    const plan: Assignment[] = [];
    if (this.target || this.tStruct) plan.push({ target: this.target, struct: this.tStruct, weapons: this.selectedWeapons(u, this.target, this.tStruct) });
    // Multi-target extra assignments
    const groups = new Map<Unit, Component[]>();
    for (const [w, t] of this.multi) { if (!groups.has(t)) groups.set(t, []); groups.get(t)!.push(w); }
    for (const [t, ws] of groups) plan.push({ target: t, weapons: ws.filter((w) => this.b.hitChance(u, t, item(w.id)).ok && this.b.hasAmmo(u, w)) });
    const total = plan.reduce((a, p) => a + p.weapons.length, 0);
    if (!total) return;
    if (this.b.isMech(u) && this.b.projectedHeat(u, plan.flatMap((p) => p.weapons)) >= u.stats.heatCap && !this.heatConfirm) {
      this.heatConfirm = true;
      this.b.say('WARNING: this attack will SHUT DOWN your \'Mech. Fire again to confirm.', '#ff6a2a');
      this.pull();
      return;
    }
    if (!this.commit(u)) return;
    let called: string | undefined;
    if (this.calledLoc && this.target) {
      if (this.b.resolve[0] >= this.b.resolveCost()) { this.b.resolve[0] -= this.b.resolveCost(); called = this.calledLoc; this.b.say(`${u.name} uses PRECISION STRIKE on the ${locName(called)}.`, C.accent); }
    }
    this.b.attack(u, plan, called);
    this.pull();
    if (u.alive && has(u.pilot ?? undefined, 'ace') && !u.moved) {
      this.clearTargeting();
      this.mode = 'move';
      this.b.say(`${u.name} (Ace Pilot) may still move.`, C.cyan);
      this.pull();
      return;
    }
    if (u.alive) this.endActivation(u); else this.afterActivation();
  }

  // ---- Main loop ----------------------------------------------------------------------
  render(ui: UI, dt: number): void {
    this.time += dt;
    const sp = this.speed;
    this.fx.update(dt * sp);
    for (const a of this.anims) { a.t = (a.t ?? 0) + dt * sp; a.step(dt * sp); }
    const doneA = this.anims.filter((a) => (a.t ?? 0) >= a.dur);
    for (const a of doneA) a.done();
    this.anims = this.anims.filter((a) => (a.t ?? 0) < a.dur);
    if (this.banner) { this.banner.t -= dt; if (this.banner.t <= 0) this.banner = null; }
    // Heat shimmer on overheating 'Mechs, smoke from shut-down reactors
    for (const u of this.b.live()) {
      if (!this.b.isMech(u) || !(SIDE(u.team) === 0 || this.b.seen[0].has(u.id))) continue;
      const hf = u.heat / u.stats.heatCap;
      if (hf > 0.6 && Math.random() < dt * 6 * hf) this.fx.parts.push({ x: u.x + (Math.random() - 0.5) * 0.8, y: u.y - 0.3, vx: (Math.random() - 0.5) * 0.3, vy: -0.9, life: 0, max: 0.6, glyph: ['~', '≈', '\''], c0: '#ff8a3a', c1: '#401808' });
      if (u.shutdown && Math.random() < dt * 4) this.fx.smoke(u.x, u.y);
    }
    // lingering fires/smoke on wrecks
    if (Math.random() < 0.6 * dt * 10) {
      for (const [i] of this.b.map.wrecks) {
        if (Math.random() < 0.08) {
          const x = i % this.b.map.w, y = (i / this.b.map.w) | 0;
          if (this.b.visibleTiles[i]) { this.fx.smoke(x, y); if (Math.random() < 0.3) this.fx.fire(x, y); }
        }
      }
    }
    // process events
    this.wait -= dt;
    let guard = 0;
    while (this.wait <= 0 && this.queue.length && guard++ < 200) this.playNext();
    const idle = this.queue.length === 0 && this.anims.length === 0 && this.wait <= 0;
    if (idle && !this.b.result && !this.briefingOpen) {
      const n = this.b.advance();
      this.pull();
      this.lastActor = n.who;
      if (n.who === 'ai' && this.queue.length === 0) {
        this.aiTimer += dt * sp;
        if (this.aiTimer > 0.15) {
          this.aiTimer = 0;
          aiTakeTurn(this.b, n.unit!);
          this.pull();
        }
      } else if (n.who === 'player' && this.autoplay) {
        this.aiTimer += dt * sp;
        if (this.aiTimer > 0.15) { this.aiTimer = 0; aiTakeTurn(this.b, this.b.pending(0).find((x) => x.team === 0)!); this.pull(); }
      } else if (n.who === 'player') {
        if (!this.b.active && (!this.sel || !this.canAct(this.sel))) {
          const p = this.b.pending(0).filter((x) => x.team === 0);
          if (p.length) this.select(p[0]);
        } else if (this.b.active && this.sel !== this.b.active) this.sel = this.b.active;
      }
    }
    this.handleInput(ui);
    this.draw(ui);
    if (this.briefingOpen) this.drawBriefing(ui);
    if (this.showHelp) this.drawHelp(ui);
    if (this.confirmWithdraw) this.drawWithdraw(ui);
    if (this.b.result && idle && !this.queue.length) this.drawResult(ui);
  }

  // ---- Input ----------------------------------------------------------------------------
  mouseTile(): number {
    const ui = app.ui;
    const mx = ui.inp.mx, my = ui.inp.my;
    if (mx < MX || mx >= MX + VW * 2 || my < MY || my >= MY + VH) return -1;
    const tx = Math.floor((mx - MX) / 2) + this.camX, ty = Math.floor(my - MY) + this.camY;
    if (tx < 0 || ty < 0 || tx >= this.b.map.w || ty >= this.b.map.h) return -1;
    return ty * this.b.map.w + tx;
  }

  handleInput(ui: UI): void {
    if (this.briefingOpen || this.showHelp || this.confirmWithdraw || (this.b.result && !this.queue.length)) return;
    const b = this.b;
    const m = b.map;
    // Camera
    const panSpeed = 1;
    if (ui.key('ArrowLeft')) this.camX = Math.max(0, this.camX - 3 * panSpeed);
    if (ui.key('ArrowRight')) this.camX = Math.min(m.w - VW, this.camX + 3 * panSpeed);
    if (ui.key('ArrowUp')) this.camY = Math.max(0, this.camY - 3 * panSpeed);
    if (ui.key('ArrowDown')) this.camY = Math.min(m.h - VH, this.camY + 3 * panSpeed);
    const wh = ui.wheel(MX, MY, VW * 2, VH);
    if (wh) { if (ui.inp.held.has('Shift')) this.camX = Math.max(0, Math.min(m.w - VW, this.camX + wh * 2)); else this.camY = Math.max(0, Math.min(m.h - VH, this.camY + wh * 2)); }
    if (ui.key('z')) this.showHeights = !this.showHeights;
    if (ui.key('?') || ui.key('F1') || ui.key('h')) this.showHelp = true;
    if (ui.key('+') || ui.key('=')) this.speed = Math.min(4, this.speed * 2);
    if (ui.key('-')) this.speed = Math.max(0.5, this.speed / 2);
    this.hoverTile = this.mouseTile();
    if (!this.playerTurn()) return;
    const u = this.sel;
    if (ui.key('Tab')) {
      if (!b.active) {
        const p = b.pending(0).filter((x) => x.team === 0);
        if (p.length) { const i = u ? p.indexOf(u) : -1; this.select(p[(i + 1) % p.length]); }
      }
    }
    if (ui.key('c') && u) this.centerOn(u.x, u.y);
    if (!this.canAct(u)) return;
    const canMove = !u.moved && !u.cannotMove && !u.prone && !(u.attacked && !has(u.pilot ?? undefined, 'ace'));
    // Hotkeys
    if (ui.key('Escape') || ui.inp.rclicked) {
      ui.inp.rclicked = false;
      if (this.mode === 'facing' && u.moved === 'sprint') { /* must face */ }
      else if (this.pending) this.pending = null;
      else if (this.mode !== 'move') { this.mode = 'move'; this.meleeTarget = null; }
      else if (this.calledLoc) this.calledLoc = null;
      else this.clearTargeting();
    }
    if (ui.key('j') && canMove && u.stats.jump > 0) { this.mode = this.mode === 'jump' ? 'move' : 'jump'; this.pending = null; }
    if (ui.key('m') && canMove && b.isMech(u)) { this.mode = this.mode === 'melee' ? 'move' : 'melee'; this.pending = null; this.meleeTarget = null; }
    if (ui.key('d') && canMove && b.isMech(u) && u.stats.jump > 0) { this.mode = this.mode === 'dfa' ? 'move' : 'dfa'; this.pending = null; this.meleeTarget = null; }
    for (let k = 1; k <= 9; k++) if (ui.key(String(k))) {
      const w = b.weaponsOf(u)[k - 1];
      if (w) { if (this.weaponsOff.has(w)) this.weaponsOff.delete(w); else this.weaponsOff.add(w); }
    }
    if (ui.key('f') || (ui.key('Enter') && !this.pending && (this.target || this.tStruct))) this.fire(u);
    if (ui.key('b')) this.actBrace(u);
    if (ui.key('v')) this.actVigilance(u);
    if (ui.key('r')) this.actReserve(u);
    if (ui.key('x') && b.isMech(u)) this.actEject(u);
    if (ui.key('p')) this.togglePrecision(u);
    if (ui.key('l') && has(u.pilot ?? undefined, 'sensorlock') && b.canAttack(u)) this.mode = this.mode === 'lock' ? 'move' : 'lock';
    if (ui.key('e') || ui.key(' ')) {
      if (this.mode === 'facing') this.confirmFacing(u);
      else if (this.pending) this.doMove(u, this.pending.tile, this.pending.mode);
      else { this.mode = 'facing'; this.facingDir = u.facing; }
    }
    if (this.pending && ui.key('Enter')) this.doMove(u, this.pending.tile, this.pending.mode);

    // Facing mode: mouse direction
    const ht = this.hoverTile;
    if (this.mode === 'facing') {
      if (ht >= 0) {
        const hx = ht % m.w, hy = (ht / m.w) | 0;
        if (hx !== u.x || hy !== u.y) this.facingDir = dirTo(u.x, u.y, hx, hy);
      }
      if (ht >= 0 && ui.click(MX, MY, VW * 2, VH)) this.confirmFacing(u);
      return;
    }
    if (ht < 0) return;
    const hx = ht % m.w, hy = (ht / m.w) | 0;
    const hu = b.unitAt(hx, hy);
    const hs = b.structAt(hx, hy);
    if (!ui.click(MX, MY, VW * 2, VH)) return;
    // Clicking
    if (hu && hu.team === 0 && hu !== u && !b.active) { this.select(hu); return; }
    if (this.mode === 'lock') {
      if (hu && SIDE(hu.team) === 1 && b.detected[0].has(hu.id)) {
        if (!this.commit(u)) return;
        b.sensorLock(u, hu); this.pull(); this.endActivation(u);
      }
      return;
    }
    if (this.mode === 'melee' || this.mode === 'dfa') {
      const dfa = this.mode === 'dfa';
      if (hu && SIDE(hu.team) === 1 && this.visibleUnit(hu)) {
        const spots = b.meleeSpots(u, hu, dfa);
        if (!spots.size) { this.flashMsg = { text: `Out of reach: ${b.displayName(hu)} is ${dist(u.x, u.y, hu.x, hu.y).toFixed(1)} tiles away, ${dfa ? `jump ${u.stats.jump}` : `walk ${u.stats.walk}`}.`, until: this.time + 3 }; return; }
        if (this.meleeTarget === hu) {
          // default spot: cheapest
          let bi = -1, bc = Infinity;
          for (const [i, [c]] of spots) if (c < bc) { bc = c; bi = i; }
          this.doMelee(u, hu, bi, dfa, spots);
        } else this.meleeTarget = hu;
        return;
      }
      if (this.meleeTarget) {
        const spots = b.meleeSpots(u, this.meleeTarget, dfa);
        if (spots.has(ht)) this.doMelee(u, this.meleeTarget, ht, dfa, spots);
      }
      return;
    }
    // Enemy click: target (multi-target with shift)
    if (hu && SIDE(hu.team) === 1 && this.visibleUnit(hu)) {
      if (!b.canAttack(u)) return;
      if (ui.inp.held.has('Shift') && has(u.pilot ?? undefined, 'multitarget') && this.target && hu !== this.target) {
        // assign currently enabled weapons that can reach this new target
        const ws = this.selectedWeapons(u, this.target).filter((w) => b.hitChance(u, hu, item(w.id)).ok);
        const targets = new Set([...this.multi.values()]);
        if (targets.size >= 2 && !targets.has(hu)) return;
        for (const w of ws.slice(0, Math.max(1, Math.ceil(ws.length / 2)))) this.multi.set(w, hu);
        return;
      }
      if (this.target === hu && !this.pending && !this.autoPicked) { this.fire(u); return; }
      this.autoPicked = false;
      this.target = hu; this.tStruct = null; this.multi.clear(); this.calledLoc = null; this.pending = null;
      return;
    }
    if (hs && !hs.destroyed && b.canAttack(u) && !this.pending && !this.reachHas(u, ht)) {
      if (this.tStruct === hs) { this.fire(u); return; }
      this.tStruct = hs; this.target = null;
      return;
    }
    // Movement
    if (!canMove) return;
    const r = this.getReach(u);
    const mode: MoveMode | null = this.mode === 'jump' ? (r.jump.has(ht) ? 'jump' : null) : r.walk.has(ht) ? 'walk' : r.sprint.has(ht) ? 'sprint' : null;
    if (!mode) return;
    if (this.pending && this.pending.tile === ht) this.doMove(u, ht, mode);
    else this.pending = { tile: ht, mode };
  }

  reachHas(u: Unit, t: number): boolean {
    if (!this.canAct(u)) return false;
    const r = this.getReach(u);
    return r.walk.has(t) || r.sprint.has(t) || (this.mode === 'jump' && r.jump.has(t));
  }

  doMelee(u: Unit, t: Unit, spot: number, dfa: boolean, spots: Map<number, [number, number]>): void {
    if (!this.commit(u)) return;
    const b = this.b;
    const path = spot === u.y * b.map.w + u.x ? [] : b.pathTo(u, spots, spot, dfa ? 'jump' : 'walk');
    b.melee(u, t, path, dfa);
    this.pull();
    if (u.alive) this.endActivation(u); else this.afterActivation();
  }

  confirmFacing(u: Unit): void {
    if (!this.commit(u)) return;
    this.b.setFacing(u, this.facingDir);
    this.endActivation(u);
  }

  ejectArm = false;
  dangerous(u: Unit): boolean {
    const f = u.frame;
    return f.struct.CT < f.maxStruct.CT * 0.5 || (u.pilot ? health(u.pilot) - u.pilot.injuries <= 1 : false);
  }
  actEject(u: Unit): void {
    if (!this.ejectArm) { this.ejectArm = true; return; }
    this.ejectArm = false;
    if (!this.commit(u)) return;
    this.b.eject(u);
    this.pull();
    this.afterActivation();
  }

  actBrace(u: Unit): void {
    if (!this.b.isMech(u)) return;
    if (!this.commit(u)) return;
    this.b.brace(u);
    this.mode = 'facing';
    this.facingDir = u.facing;
    this.pull();
  }
  actVigilance(u: Unit): void {
    if (this.b.resolve[0] < this.b.resolveCost() || u.attacked) return;
    if (!this.commit(u)) return;
    this.b.vigilance(u);
    this.pull();
    this.mode = 'facing';
    this.facingDir = u.facing;
  }
  actReserve(u: Unit): void {
    if (this.b.active === u) return;
    if (this.b.reserve(u)) { this.pull(); this.afterActivation(); }
  }
  togglePrecision(u: Unit): void {
    if (!this.target || this.target.frame.kind !== 'mech') return;
    if (this.b.resolve[0] < this.b.resolveCost() && !this.calledLoc) { this.b.say('Not enough Resolve for a Precision Strike.', C.dim); this.pull(); return; }
    this.mode = this.mode === 'called' ? 'move' : 'called';
    if (this.mode !== 'called') this.calledLoc = null;
    void u;
  }

  // ---- Drawing --------------------------------------------------------------------------
  draw(ui: UI): void {
    const d = ui.d;
    this.drawMap(ui);
    this.drawTopBar(ui);
    this.drawBottom(ui);
    this.drawPanel(ui);
    // Frame lines
    d.vline(PX - 1 + 0, MY, ROWS - MY, C.border);
    void COLS;
  }

  /** Folds repeated volleys of the same weapon at the same target into one log line. */
  mergeLog(text: string): boolean {
    const RE = /^(.+?): (?:(\d+)× )?(.+?) → (.+?) (\d+)\/(\d+) hit(?: \((.*)\))?$/;
    const prev = this.logLines[this.logLines.length - 1];
    const a = prev && RE.exec(prev.text), b = RE.exec(text);
    if (!a || !b || a[1] !== b[1] || a[3] !== b[3] || a[4] !== b[4]) return false;
    const n = (+(a[2] ?? 1)) + 1;
    const hits = +a[5] + +b[5], shots = +a[6] + +b[6];
    const locs = new Map<string, number>();
    for (const part of [a[7], b[7]]) {
      if (!part) continue;
      for (const seg of part.split(', ')) {
        const m = /^(.*?) ?(\d+)$/.exec(seg);
        if (m) locs.set(m[1], (locs.get(m[1]) ?? 0) + +m[2]);
      }
    }
    const ls = [...locs.entries()].map(([l, d]) => (l ? `${l} ${d}` : `${d}`)).join(', ');
    prev.text = `${a[1]}: ${n}× ${a[3]} → ${a[4]} ${hits}/${shots} hit${ls ? ` (${ls})` : ''}`;
    return true;
  }

  tileColors(i: number, x: number, y: number): { ch: string; fg: string; bg: string } {
    const b = this.b, m = b.map;
    const B = BIOME_INFO[m.biome];
    const t = m.terr[i];
    const e = m.elev[i];
    const s = m.shade[i];
    const hs = m.hill[i];
    // Elevation reads as distinct brightness bands, softened by hillshade
    let bg = scale(B.ground[e], (1.05 + e * 0.14 + s * 0.05) * (1 + hs * 0.26));
    let fg = lerp(bg, scale(B.groundFg, 1 + e * 0.1), 0.28);
    let ch = m.glyph[i];
    // Sparse ground texture: a faint grid dot on most tiles, occasional detail
    const calm = m.biome === 'martian' || m.biome === 'badlands' || m.biome === 'lunar' || m.biome === 'desert';
    if (t === 'plain') ch = calm ? (((x * 7 + y * 13) % 3 === 0) ? '·' : ' ') : ((x * 7 + y * 13) % 5 === 0 && ch !== '.') ? ch : '·';
    if (t === 'rough' && calm && ch !== '◦' && (x * 5 + y * 11) % 3 !== 0) ch = ' ';
    // Crater rims read as a raised, sunlit lip rather than a row of glyphs
    if (ch === '◦') { ch = (x + y) % 2 ? '∙' : ' '; bg = scale(bg, 1.38); fg = lerp(bg, '#ffffff', 0.25); }
    if (t === 'plain' && m.biome === 'desert') { const band = Math.sin(x * 0.5 + y * 0.9 + s * 3); if (band > 0.82) { ch = '~'; fg = lerp(bg, '#d8a860', 0.35); } }
    const tt = this.time;
    switch (t) {
      case 'lforest': fg = lerp(B.forest[0], B.forest[1], s * 0.6); bg = lerp(bg, scale(B.forestBg, 1.6), 0.75); break;
      case 'hforest': fg = lerp(B.forest[1], '#c8f0c0', 0.15 + s * 0.15); bg = lerp(scale(B.forestBg, 1.1), '#000', 0.1); break;
      case 'water': case 'deep': {
        const wave = Math.sin(tt * 1.6 + x * 0.7 + y * 0.45) * 0.5 + 0.5;
        bg = scale(B.water[1], t === 'deep' ? 0.85 : 1.35 + wave * 0.1);
        fg = lerp(scale(B.water[0], 0.7), B.water[0], wave);
        ch = wave > 0.75 ? '≈' : t === 'deep' ? '≈' : '~';
        break;
      }
      case 'rock': fg = lerp(scale(B.rock, 1.1), '#ffffff', s * 0.15); bg = scale(B.ground[Math.min(3, e + 1)], 1.05); break;
      case 'road': fg = scale(B.road, 1.15); bg = lerp(bg, scale(B.road, 0.45), 0.75); ch = '·'; break;
      case 'building': case 'wall': {
        const st = m.structures[m.struct[i]];
        const obj = st?.objective;
        // Box-draw the outline by connecting to neighbouring tiles of the same structure
        const same = (dx: number, dy: number) => { const xx = x + dx, yy = y + dy; return xx >= 0 && yy >= 0 && xx < m.w && yy < m.h && m.struct[yy * m.w + xx] === m.struct[i] && m.struct[i] >= 0; };
        const wallN = (dx: number, dy: number) => { const xx = x + dx, yy = y + dy; return xx >= 0 && yy >= 0 && xx < m.w && yy < m.h && m.terr[yy * m.w + xx] === 'wall'; };
        const nb = t === 'wall' ? wallN : same;
        const u2 = nb(0, -1), d2 = nb(0, 1), l2 = nb(-1, 0), r2 = nb(1, 0);
        const dbl = !!obj;
        const key = `${u2 ? 1 : 0}${d2 ? 1 : 0}${l2 ? 1 : 0}${r2 ? 1 : 0}`;
        const S: Record<string, string> = { '0000': '□', '1100': '│', '0011': '─', '0101': '┌', '0110': '┐', '1001': '└', '1010': '┘', '1101': '├', '1110': '┤', '0111': '┬', '1011': '┴', '1111': '┼', '1000': '│', '0100': '│', '0010': '─', '0001': '─' };
        const D: Record<string, string> = { '0000': '■', '1100': '║', '0011': '═', '0101': '╔', '0110': '╗', '1001': '╚', '1010': '╝', '1101': '╠', '1110': '╣', '0111': '╦', '1011': '╩', '1111': '▓', '1000': '║', '0100': '║', '0010': '═', '0001': '═' };
        ch = (dbl ? D : S)[key] ?? '■';
        const frac = st ? Math.max(0, st.hp) / st.maxHp : 1;
        fg = obj ? (SIDE(st.team) === 0 ? '#6fd8ff' : '#ff7a58') : t === 'wall' ? '#c0c0b4' : '#b0b0a8';
        bg = obj ? (SIDE(st.team) === 0 ? '#0e2a3a' : '#3a1610') : t === 'wall' ? '#24262a' : '#2e3034';
        if (frac < 0.66) fg = lerp(fg, '#6a4a3a', 0.35);
        if (frac < 0.33) { fg = lerp(fg, '#ff6a2a', 0.4 + 0.3 * Math.sin(tt * 5 + x)); }
        break;
      }
      case 'rubble': fg = '#7a6e5e'; bg = lerp(bg, '#1a1612', 0.5); break;
      case 'rough': fg = lerp(bg, scale(B.groundFg, 1.35), 0.75); bg = scale(bg, 0.88); break;
    }
    // Contour ledges where the ground drops away to the south or west
    if ((t === 'plain' || t === 'rough' || t === 'road')) {
      const south = y + 1 < m.h ? m.elev[i + m.w] : e;
      const west = x > 0 ? m.elev[i - 1] : e;
      if (south < e) { ch = '▁'; fg = lerp(bg, '#000000', 0.55); }
      else if (west < e) { ch = '▏'; fg = lerp(bg, '#000000', 0.45); }
    }
    if (m.scorch[i] > 0) bg = lerp(bg, '#0a0806', 0.5 * m.scorch[i]);
    const wr = m.wrecks.get(i) && !this.ghostAt(i) ? m.wrecks.get(i) : undefined;
    if (wr) { ch = wr; fg = '#8a7060'; }
    return { ch, fg, bg };
  }

  drawMap(ui: UI): void {
    const d = ui.d, b = this.b, m = b.map;
    const lights = this.fx.lights();
    // At night every friendly 'Mech carries its own floodlights
    if (m.night) for (const pu of b.units) if (pu.alive && pu.deployed && !pu.fled && SIDE(pu.team) === 0) lights.push({ x: pu.x, y: pu.y, r: 4.5, color: '#c8d0d8', intensity: 0.16 });
    const ambient = m.night ? 0.55 : 1;
    const u = this.sel;
    const act = this.playerTurn() && this.canAct(u);
    const reach = act && u ? this.getReach(u) : null;
    const pathTiles = new Set<number>();
    let pendingTile = -1, pendingMode: MoveMode | null = null;
    const ht = this.hoverTile;
    if (act && u && reach) {
      const tile = this.pending?.tile ?? (ht >= 0 && (this.mode === 'move' || this.mode === 'jump') ? ht : -1);
      const mode: MoveMode | null = this.pending?.mode ?? (tile >= 0 ? (this.mode === 'jump' ? (reach.jump.has(tile) ? 'jump' : null) : reach.walk.has(tile) ? 'walk' : reach.sprint.has(tile) ? 'sprint' : null) : null);
      if (tile >= 0 && mode) {
        pendingTile = tile; pendingMode = mode;
        const mp = mode === 'walk' ? reach.walk : mode === 'sprint' ? reach.sprint : reach.jump;
        const path = b.pathTo(u, mp, tile, mode);
        if (mode === 'jump') {
          const [x0, y0] = path[0], [x1, y1] = path[1];
          const n = Math.ceil(dist(x0, y0, x1, y1) * 2);
          for (let k = 1; k < n; k++) pathTiles.add(Math.round(y0 + (y1 - y0) * k / n) * m.w + Math.round(x0 + (x1 - x0) * k / n));
        } else for (const [px, py] of path.slice(1)) pathTiles.add(py * m.w + px);
      }
    }
    // Melee spots
    let meleeSpots: Map<number, [number, number]> | null = null;
    if (act && u && (this.mode === 'melee' || this.mode === 'dfa') && this.meleeTarget) meleeSpots = b.meleeSpots(u, this.meleeTarget, this.mode === 'dfa');
    // Targetability from pending destination
    const destFrom = pendingTile >= 0 && u ? { x: pendingTile % m.w, y: (pendingTile / m.w) | 0, moved: pendingMode } : u ? { x: u.x, y: u.y, moved: u.moved } : null;
    this.plan = pendingTile >= 0 && u && pendingMode !== 'sprint' ? destFrom : null;

    const facingU = act && u && this.mode === 'facing' ? u : null;
    const markers = this.goalMarkers();
    const shakeX = this.fx.shake > 0 ? Math.round((Math.random() - 0.5) * this.fx.shake * 2) : 0;
    for (let vy = 0; vy < VH; vy++) {
      for (let vx = 0; vx < VW; vx++) {
        const x = vx + this.camX + shakeX, y = vy + this.camY;
        const sx = MX + vx * 2, sy = MY + vy;
        if (x < 0 || y < 0 || x >= m.w || y >= m.h) { d.wide(sx, sy, ' ', '#000', '#000'); continue; }
        const i = y * m.w + x;
        let { ch, fg, bg } = this.tileColors(i, x, y);
        // lighting
        const vis = b.visibleTiles[i];
        let lr = ambient, lg = ambient, lb = ambient * (m.night ? 1.15 : 1);
        if (lights.length) { const L = lightAt(lights, x, y); lr += L[0] * 1.3; lg += L[1] * 1.3; lb += L[2] * 1.3; }
        if (!vis) { const k = m.night ? 0.55 : 0.62; lr *= k; lg *= k; lb *= k * (m.night ? 1.22 : 1.1); fg = desaturate(fg, m.night ? 0.6 : 0.35); }
        fg = light(fg, lr, lg, lb);
        bg = light(bg, lr, lg, lb);
        // overlays
        if (reach && act) {
          if (this.mode === 'jump') { if (reach.jump.has(i)) bg = lerp(bg, '#2a8a4a', 0.32); }
          else if (this.mode === 'move') {
            if (reach.walk.has(i)) { bg = lerp(bg, '#3a8ae8', 0.34); fg = lerp(fg, '#b0d8ff', 0.35); }
            else if (reach.sprint.has(i)) { bg = lerp(bg, '#c0a030', 0.24); fg = lerp(fg, '#f0e090', 0.25); }
          }
        }
        if (facingU && Math.max(Math.abs(x - facingU.x), Math.abs(y - facingU.y)) <= 6 && (x !== facingU.x || y !== facingU.y)) {
          const arc = attackArc({ x: facingU.x, y: facingU.y, facing: this.facingDir }, x, y);
          const fade = 1 - dist(x, y, facingU.x, facingU.y) / 8;
          if (arc === 'front') bg = lerp(bg, '#ffb030', 0.45 * fade + 0.1); else if (arc === 'rear') bg = lerp(bg, '#ff3020', 0.5 * fade + 0.1);
        }
        const mk = markers.get(i);
        if (mk) { bg = lerp(bg, mk.color, 0.3 + 0.1 * Math.sin(this.time * 3)); if (mk.force || ch === '·' || ch === '.') { ch = mk.glyph; fg = mk.force ? lerp(mk.color, '#ffffff', 0.3 + 0.3 * Math.sin(this.time * 4)) : mk.color; } }
        if (meleeSpots?.has(i)) bg = lerp(bg, '#c06a2a', 0.45 + 0.1 * Math.sin(this.time * 6));
        if (pathTiles.has(i)) { bg = lerp(bg, pendingMode === 'sprint' ? '#e0c050' : pendingMode === 'jump' ? '#60e090' : '#70b0ff', 0.35); if (!b.unitAt(x, y) && i !== pendingTile) { ch = '•'; fg = '#e8f4ff'; } }
        if (i === ht) bg = lerp(bg, '#ffffff', 0.18);
        if (this.showHeights) bg = lerp(bg, ['#1a3a6a', '#2a7a4a', '#b0a030', '#c0502a'][m.elev[i]], 0.55);
        // particles that tint bg (smoke)
        d.wide(sx, sy, ch, fg, bg);
      }
    }
    // Death marks (scorch flash)
    // Particles
    this.drawParticles(d);
    // Units
    const tgtOk = new Set<number>();
    if (act && u && destFrom && b.canAttack(u) && pendingMode !== 'sprint') {
      for (const e of b.enemiesOf(u)) {
        if (!b.seen[0].has(e.id) && !(destFrom.x !== u.x || destFrom.y !== u.y)) continue;
        if (b.weaponsOf(u).some((w) => b.hitChance(u, e, item(w.id), destFrom, undefined, false).ok)) tgtOk.add(e.id);
      }
    }
    for (const un of b.units) {
      if (!un.deployed) continue;
      if (!un.alive && !this.ghosts.has(un.id)) continue;
      if (un.fled && !this.ghosts.has(un.id)) continue;
      const [fx, fy] = this.posOf(un);
      const x = Math.round(fx), y = Math.round(fy);
      if (x < this.camX || y < this.camY || x >= this.camX + VW || y >= this.camY + VH) continue;
      const sx = MX + (x - this.camX) * 2, sy = MY + (y - this.camY);
      const side = SIDE(un.team);
      const seen = side === 0 || b.seen[0].has(un.id) || this.animPos.has(un.id) || (this.ghosts.has(un.id) && this.wasSeen.has(un.id));
      const blip = !seen && b.detected[0].has(un.id);
      if (!seen && !blip) continue;
      if (blip) {
        const pulse = 0.6 + 0.4 * Math.sin(this.time * 3 + un.id);
        d.wide(sx, sy, '?', lerp('#401010', '#e05030', pulse), '#1a0806');
        continue;
      }
      const col = un.team === 0 ? C.player : un.team === 2 ? C.ally : C.enemy;
      let bg = un.team === 0 ? '#0e3a58' : un.team === 2 ? '#18401a' : '#5a1409';
      let fg = col;
      if (un === this.sel) { bg = lerp(bg, '#3a8ab0', 0.5 + 0.2 * Math.sin(this.time * 5)); fg = '#ffffff'; }
      if (un === this.target || [...this.multi.values()].includes(un)) bg = lerp(bg, '#c04020', 0.55 + 0.25 * Math.sin(this.time * 6));
      else if (tgtOk.has(un.id)) bg = lerp(bg, '#a03020', 0.35);
      if (this.mode === 'facing' && u && side === 1 && dist(u.x, u.y, un.x, un.y) < 16 && attackArc({ x: u.x, y: u.y, facing: this.facingDir }, un.x, un.y) === 'rear') { bg = lerp(bg, '#ff2010', 0.5 + 0.3 * Math.sin(this.time * 8)); }
      if (un === this.meleeTarget) bg = lerp(bg, '#e08030', 0.6);
      if (un.acted && un.alive && side === 0) fg = lerp(fg, '#405060', 0.4);
      if (un.shutdown) fg = lerp(fg, '#303030', 0.5);
      let glyph = this.glyphOf(un);
      if (un.prone) bg = lerp(bg, '#8a7010', 0.5);
      const hf = this.hitFlash.get(un.id);
      if (hf !== undefined && this.time - hf < 0.18) { bg = lerp(bg, '#ffffff', 0.55); fg = '#ffffff'; }
      if (un.tag === 'target') fg = lerp(fg, '#ffd050', 0.5 + 0.5 * Math.sin(this.time * 4));
      const facing = un.frame.kind === 'turret' ? -1 : (un === this.sel && this.mode === 'facing') ? this.facingDir : un.facing;
      d.wide(sx, sy, glyph, fg, bg, facing, un.team === 0 ? '#bfe8ff' : '#ffc0b0');
      // The assassination target wears a gold halo so it can't be lost in a crowd
      if (un.tag === 'target') {
        const a = 0.36 + 0.12 * Math.sin(this.time * 4);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const cx = sx + dx * 2, cy = sy + dy;
          if (cx < MX || cy < MY || cx >= MX + VW * 2 || cy >= MY + VH) continue;
          for (const k of [0, 1]) { const i = cy * COLS + cx + k; d.bg[i] = lerp(d.bg[i], '#ffd050', a); }
        }
      }
    }
    // Line of fire to the hovered enemy
    if (act && u && ht >= 0) {
      const hx = ht % m.w, hy = (ht / m.w) | 0;
      const he = b.unitAt(hx, hy);
      if (he && SIDE(he.team) === 1 && b.seen[0].has(he.id) && destFrom) {
        const ws = b.weaponsOf(u);
        let best = 0, anyOk = false, indirect = false;
        for (const w of ws) { const hc = b.hitChance(u, he, item(w.id), destFrom); if (hc.ok) { anyOk = true; best = Math.max(best, hc.chance); indirect = indirect || hc.indirect; } }
        const col = !anyOk ? '#5a5a5a' : indirect ? '#b27ae8' : healthColor(best / 100);
        const n = Math.ceil(dist(destFrom.x, destFrom.y, hx, hy) * 2);
        for (let k = 2; k < n - 1; k++) {
          const tx = Math.round(destFrom.x + ((hx - destFrom.x) * k) / n), ty = Math.round(destFrom.y + ((hy - destFrom.y) * k) / n);
          if (tx < this.camX || ty < this.camY || tx >= this.camX + VW || ty >= this.camY + VH || b.unitAt(tx, ty)) continue;
          const sx = MX + (tx - this.camX) * 2, sy = MY + (ty - this.camY);
          if (k % 2 === 0) d.wide(sx, sy, '·', col, d.getBg(sx, sy));
        }
      }
    }
    // Pending destination ghost + facing
    if (act && u && pendingTile >= 0) {
      const x = pendingTile % m.w, y = (pendingTile / m.w) | 0;
      if (x >= this.camX && y >= this.camY && x < this.camX + VW && y < this.camY + VH) {
        const sx = MX + (x - this.camX) * 2, sy = MY + (y - this.camY);
        const [px, py] = [...pathTiles].length ? [u.x, u.y] : [u.x, u.y];
        void px; void py;
        d.wide(sx, sy, this.glyphOf(u), lerp(C.player, '#000', 0.25), '#1a4a6a', -1);
      }
    }
    // Floaters
    const occ: [number, number, number][] = [];
    // Floaters never sit on top of a visible unit
    for (const u of b.units) if (u.alive && u.deployed && !u.fled && (SIDE(u.team) === 0 || this.visibleUnit(u))) occ.push([MY + u.y - this.camY, MX + (u.x - this.camX) * 2, MX + (u.x - this.camX) * 2 + 2]);
    for (const f of this.b.result ? [] : this.fx.floats) {
      if (f.delay && f.delay > 0) continue;
      const k = f.life / f.max;
      const x = f.x, y = f.y - k * (f.big ? 2.2 : 1.6) - 0.6;
      let sy = MY + Math.round(y - this.camY);
      const len = [...f.text].length;
      const sx = Math.max(MX, Math.min(MX + VW * 2 - len, MX + Math.round((x - this.camX) * 2 + 1 - len / 2)));
      // Bump up until this label doesn't overlap another on the same row
      for (let tries = 0; tries < 8 && occ.some(([ry, a, bb]) => ry === sy && sx < bb + 1 && sx + len > a - 1); tries++) sy--;
      occ.push([sy, sx, sx + len]);
      if (sy < MY || sy >= MY + VH) continue;
      const col = k > 0.8 ? lerp(f.color, '#303030', (k - 0.8) / 0.2) : f.color;
      for (let c = 0; c < len; c++) {
        const cx = sx + c;
        if (cx < MX || cx >= MX + VW * 2) continue;
        d.set(cx, sy, f.text[c], col, lerp(d.getBg(cx, sy), '#000000', 0.72), f.big);
      }
    }
    // Round banner
    if (this.banner) {
      const t = this.banner;
      const w = t.text.length + 8;
      const x = MX + VW - Math.floor(w / 2), y = MY + 3;
      const a = Math.min(1, t.t * 3);
      d.fill(x, y, w, 3, ' ', C.bright, lerp('#000', '#2a1c08', a));
      d.hline(x, y, w, lerp('#000', C.accent, a), '━');
      d.hline(x, y + 2, w, lerp('#000', C.accent, a), '━');
      d.text(x + 4, y + 1, t.text, lerp('#000', t.color, a), undefined, 99, true);
    }
    // Screen flash
    if (this.fx.flash > 0) {
      for (let vy = 0; vy < VH; vy++) for (let vx = 0; vx < VW * 2; vx++) {
        d.setBg(MX + vx, MY + vy, lerp(d.getBg(MX + vx, MY + vy), '#fff4e0', this.fx.flash * 0.4));
      }
    }
  }

  drawParticles(d: Display): void {
    const toScreen = (x: number, y: number): [number, number] | null => {
      const tx = Math.round(x), ty = Math.round(y);
      if (tx < this.camX || ty < this.camY || tx >= this.camX + VW || ty >= this.camY + VH) return null;
      return [MX + (tx - this.camX) * 2, MY + (ty - this.camY)];
    };
    // Beams
    for (const bm of this.fx.beams) {
      if (bm.delay && bm.delay > 0) continue;
      const k = bm.life / bm.max;
      const len = Math.hypot(bm.x1 - bm.x0, bm.y1 - bm.y0);
      const n = Math.max(1, Math.ceil(len * 2));
      const ang = Math.atan2(bm.y1 - bm.y0, (bm.x1 - bm.x0) * 1);
      const a = ((ang * 180) / Math.PI + 360) % 180;
      const g = a < 22.5 || a >= 157.5 ? '─' : a < 67.5 ? '╲' : a < 112.5 ? '│' : '╱';
      const col = lerp(bm.core, bm.color, Math.min(1, k * 1.6));
      const fade = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
      // Beam grows out from the muzzle during the first 30%
      const reachF = Math.min(1, k / 0.25);
      const head = Math.floor(n * reachF);
      for (let s = 1; s <= head; s++) {
        const x = bm.x0 + ((bm.x1 - bm.x0) * s) / n, y = bm.y0 + ((bm.y1 - bm.y0) * s) / n;
        const p = toScreen(x, y);
        if (!p) continue;
        const tip = s === head && reachF < 1;
        const glyph = tip ? '◆' : bm.crackle ? ['~', '≈', '*', '╳', g][Math.floor(Math.random() * 5)] : g;
        // A thin glowing line: bright core glyph, only a faint halo on the ground beneath
        const bg = lerp(d.getBg(p[0], p[1]), bm.color, (tip ? 0.4 : 0.18) * fade);
        d.wide(p[0], p[1], glyph, tip ? bm.core : lerp(d.getBg(p[0], p[1]), col, fade), bg);
      }
    }
    for (const p of this.fx.parts) {
      if (p.delay && p.delay > 0) continue;
      const s = toScreen(p.x, p.y);
      if (!s) continue;
      const k = Math.min(1, p.life / p.max);
      const col = lerp(p.c0, p.c1, k);
      const glyphs = Array.isArray(p.glyph) ? p.glyph : [p.glyph];
      const gch = glyphs[Math.floor(k * glyphs.length * 0.999)];
      const bgNow = d.getBg(s[0], s[1]);
      if (gch === '░' || gch === '▒') {
        // smoke only tints the background, preserving the glyph beneath
        const a = (gch === '▒' ? 0.5 : 0.3) * (1 - k);
        const i = s[1] * COLS + s[0];
        d.bg[i] = lerp(bgNow, col, a); d.bg[i + 1] = d.bg[i];
        d.fg[i] = lerp(d.fg[i], col, a * 0.5);
        continue;
      }
      d.wide(s[0], s[1], gch, col, lerp(bgNow, col, 0.25 * (1 - k)));
    }
  }

  drawTopBar(ui: UI): void {
    const d = ui.d, b = this.b;
    d.fill(0, 0, COLS, 1, ' ', C.text, '#0c1218');
    const mi = MISSION_INFO[this.rt.spec.type];
    let x = 1;
    x += d.text(x, 0, `${mi.glyph} ${this.title || mi.name.toUpperCase()}`, C.accent, undefined, 36, true) + 2;
    x += d.text(x, 0, `ROUND ${b.round}`, C.bright, undefined, 99, true) + 2;
    for (let p = 5; p >= 1; p--) {
      const cur = p === b.phase;
      const us = b.live().filter((u) => u.phase === p && (SIDE(u.team) === 0 || b.seen[0].has(u.id)));
      const bg = cur ? C.accent : '#16202a';
      d.text(x, 0, ` ${p} `, cur ? C.bg : C.dim, bg, 99, true);
      x += 3;
      for (const u of us) {
        const col = u.team === 0 ? C.player : u.team === 2 ? C.ally : C.enemy;
        const g = this.glyphOf(u);
        d.text(x, 0, g, u.acted ? scale(col, 0.4) : col, '#0c1218', 99, true);
        x += g.length + 1;
      }
      x++;
    }
    // Resolve
    x = 102;
    d.text(x, 0, 'RESOLVE', C.dim);
    const r = b.resolve[0], cost = b.resolveCost();
    simpleBar(d, x + 8, 0, 20, r / b.resolveMax[0], r >= cost ? '#d89a30' : '#7a5a2a', '#1a1a14', cost / b.resolveMax[0]);
    d.text(x + 29, 0, String(Math.floor(r)).padStart(3), r >= cost ? C.accent : C.dim);
    ui.setTip(ui.hover(x, 0, 32, 1) ? [`{#f0a830}Resolve{/} ${Math.floor(r)}/${b.resolveMax[0]}`, `Precision Strike and Vigilance cost ${cost}. Gained by dealing damage, destroying locations and kills, and each round from company morale.`] : undefined);
    if (ui.button(136, 0, 'Withdraw', { style: 'plain', fg: C.dim, tip: 'Call the dropship and abandon the contract.' })) this.confirmWithdraw = true;
    d.text(146, 0, `${this.speed}x`, C.faint);
    if (ui.button(92, 0, isMuted() ? '♪ off' : '♪ on', { style: 'plain', fg: C.dim, tip: 'Toggle sound' })) setMuted(!isMuted());
  }

  drawBottom(ui: UI): void {
    const d = ui.d, b = this.b, m = b.map;
    const y0 = MY + VH;
    d.fill(0, y0, PX - 1, ROWS - y0, ' ', C.text, C.panel);
    d.hline(0, y0, PX - 1, C.border);
    // Tile info
    const ht = this.hoverTile;
    if (ht >= 0) {
      const t = TERRAIN[m.terr[ht]];
      const e = m.elev[ht];
      const s = b.structAt(ht % m.w, (ht / m.w) | 0);
      let info = ` ${s ? s.name : t.name}${e ? ` · Elev ${e}` : ''}${t.cover ? ` · Cover ${Math.round(t.cover * 100)}%` : ''}${t.cool ? ` · +${t.cool} cooling` : ''}${s ? ` · ${Math.max(0, s.hp)}/${s.maxHp} HP${s.objective ? ' · OBJECTIVE' : ''}` : ''} `;
      d.text(1, y0, info, C.dim, C.panel);
    }
    const bi = BIOME_INFO[m.biome];
    const env = ` ${bi.name}${m.night ? ' · Night' : ''} · heat x${bi.heatMult} `;
    d.text(PX - 2 - env.length, y0, env, C.faint, C.panel);
    // Action bar
    this.drawActions(ui, 1, y0 + 1);
    // Log
    const ly = y0 + 4, lh = ROWS - ly;
    const lw = 62;
    const lines: { text: string; color?: string }[] = [];
    for (const l of this.logLines) wrap(l.text, lw - 2).forEach((w, k) => { if (k) for (const v of wrap(w, lw - 4)) lines.push({ text: '  ' + v, color: l.color }); else lines.push({ text: w, color: l.color }); });
    const vis = lh;
    if (this.logScroll.scroll > lines.length - vis) this.logScroll.scroll = Math.max(0, lines.length - vis);
    const whl = ui.wheel(0, ly, lw, lh);
    if (whl) this.logScroll.scroll = Math.max(0, Math.min(lines.length - vis, this.logScroll.scroll + whl));
    for (let k = 0; k < vis; k++) {
      const l = lines[this.logScroll.scroll + k];
      if (!l) break;
      const age = lines.length - (this.logScroll.scroll + k);
      d.ctext(1, ly + k, l.text, age <= 3 ? l.color ?? C.text : scale(l.color ?? C.text, 0.7), C.panel, lw - 2);
    }
    // Objectives
    const ox = lw + 1;
    d.vline(ox - 1, ly - 1, lh + 1, C.border);
    d.text(ox + 1, ly - 1, ' OBJECTIVES ', C.accent, C.panel, 99, true);
    let oy = ly;
    for (const o of this.rt.objectives) {
      const mark = o.status === 'done' ? '{#6ad46a}■{/}' : o.status === 'failed' ? '{#e8503a}✕{/}' : o.primary ? '{#f0a830}□{/}' : '{#6d7f8a}◇{/}';
      const txt = wrap(`${o.text}${o.progress ? ` {#6d7f8a}(${o.progress}){/}` : ''}`, PX - ox - 5);
      d.ctext(ox + 1, oy, mark, C.text, C.panel);
      txt.forEach((t, i) => d.ctext(ox + 3, oy + i, t, o.primary ? C.text : C.dim, C.panel, PX - ox - 5));
      oy += txt.length;
      if (oy >= ROWS) break;
    }
  }

  drawActions(ui: UI, x: number, y: number): void {
    const b = this.b;
    const u = this.sel;
    const act = this.playerTurn() && this.canAct(u);
    if (!act || !u) {
      const busy = this.lastActor === 'ai' || this.queue.length || this.anims.length;
      const who = busy ? (this.playingTeam === 0 && this.lastActor !== 'ai' ? 'RESOLVING' : this.playingTeam === 0 ? 'ALLIED ACTIVITY' : 'ENEMY ACTIVITY') : '';
      ui.d.text(x, y, who ? `▌ ${who}…` : '', who === 'ENEMY ACTIVITY' ? C.enemy : C.cyan, undefined, 99, true);
      if (who) ui.d.text(x, y + 1, '[+/-] change speed', C.faint);
      return;
    }
    const canMove = !u.moved && !u.cannotMove && !(u.attacked && !has(u.pilot ?? undefined, 'ace'));
    const mech = b.isMech(u);
    let cx = x, by = y;
    const btn = (label: string, key: string, active: boolean, disabled: boolean, tip: string, fn: () => void) => {
      if (ui.button(cx, by, label, { key, active, disabled, tip })) fn();
      cx += vlen(label) + key.length + 4;
    };
    btn('Move', 'W', this.mode === 'move', !canMove, 'Click a blue tile to walk, amber to sprint. Click again (or Space) to confirm.', () => { this.mode = 'move'; });
    btn('Jump', 'J', this.mode === 'jump', !canMove || u.stats.jump <= 0, `Jump up to ${u.stats.jump} tiles over any terrain. Generates 3 heat per tile.`, () => { this.mode = this.mode === 'jump' ? 'move' : 'jump'; });
    btn('Melee', 'M', this.mode === 'melee', !canMove || !mech, `Move and strike an adjacent enemy for ${u.stats.meleeDmg} damage and heavy stability damage.`, () => { this.mode = this.mode === 'melee' ? 'move' : 'melee'; this.meleeTarget = null; });
    btn('DFA', 'D', this.mode === 'dfa', !canMove || !mech || u.stats.jump <= 0, `Death From Above: jump onto an enemy for ${u.stats.dfaDmg} damage. Damages your legs.`, () => { this.mode = this.mode === 'dfa' ? 'move' : 'dfa'; this.meleeTarget = null; });
    btn('Fire', 'F', false, !b.canAttack(u) || (!this.target && !this.tStruct), 'Fire selected weapons at the target.', () => this.fire(u));
    btn('Precision', 'P', this.mode === 'called', !this.target || this.target.frame.kind !== 'mech' || !b.canAttack(u) || b.resolve[0] < b.resolveCost(), `Precision Strike (${b.resolveCost()} Resolve): choose the hit location on the target's paper doll. Head only if prone or shut down.`, () => this.togglePrecision(u));
    cx = x; by = y + 1;
    btn('Brace', 'B', false, !mech || u.attacked, 'Guarded (-40% damage), clears stability. Ends activation.', () => this.actBrace(u));
    btn('Vigil', 'V', false, !mech || u.attacked || b.resolve[0] < b.resolveCost(), `Vigilance (${b.resolveCost()} Resolve): Guarded + Entrenched, clears stability and debuffs. Ends activation.`, () => this.actVigilance(u));
    btn('Reserve', 'R', false, b.active === u || u.phase <= 1, 'Delay this unit to the next phase.', () => this.actReserve(u));
    if (has(u.pilot ?? undefined, 'sensorlock')) btn('Lock', 'L', this.mode === 'lock', !b.canAttack(u), 'Sensor Lock a detected enemy: -2 evasion, visible to all. Uses your attack.', () => { this.mode = this.mode === 'lock' ? 'move' : 'lock'; });
    if (mech && (this.ejectArm || this.dangerous(u))) btn(this.ejectArm ? 'EJECT!' : 'Eject', 'X', this.ejectArm, false, 'Eject the pilot. The \'Mech is abandoned but recoverable; the pilot survives. Press twice.', () => this.actEject(u));
    btn(this.mode === 'facing' ? 'Confirm' : 'Done', 'E', this.mode === 'facing', false, 'End activation: choose a facing with the mouse, then click.', () => {
      if (this.mode === 'facing') this.confirmFacing(u); else { this.mode = 'facing'; this.facingDir = u.facing; }
    });
    // Mode hint line
    const hint = this.mode === 'facing' ? 'Point to choose facing. Click or [E] to confirm.' :
      this.mode === 'called' ? 'PRECISION: click a location on the target doll, [F]ire.' :
      this.mode === 'melee' || this.mode === 'dfa' ? (this.meleeTarget ? 'Click a highlighted tile, or the target again.' : 'Click an adjacent-reachable enemy.') :
      this.mode === 'lock' ? 'Click a detected enemy to Sensor Lock.' :
      this.pending ? `Click again/[Space] to move. Evasion: ${pipStr(this.b.pipsFor(u, this.pending.mode, this.pendingSteps(u)), this.b.maxPips(u))}${this.pending.mode === 'jump' ? ` · {#ff8a4a}+${this.pendingSteps(u) * 3} heat → ${Math.round(u.heat + this.pendingSteps(u) * 3)}/${u.stats.heatCap}{/}` : ''}` :
      this.target && b.canAttack(u) && !this.autoPicked ? `Click ${this.glyphOf(this.target)} again or [F] to FIRE ${this.selectedWeapons(u, this.target).length} weapon${this.selectedWeapons(u, this.target).length === 1 ? '' : 's'} (~${Math.round(this.b.expectedDamage(u, this.target, u, this.selectedWeapons(u, this.target)))} dmg).` :
      u.moved || u.attacked ? (b.canAttack(u) ? 'Click a target and [F]ire, or [E] to end.' : '[E] to choose facing and end.') :
      'Move, attack or brace. [Tab] next unit. [?] help.';
    if (this.flashMsg && this.time < this.flashMsg.until) ui.d.text(x, y + 2, this.flashMsg.text, C.red, undefined, 62);
    else ui.d.ctext(x, y + 2, `{#6d7f8a}${hint}{/}`, C.dim, undefined, 62);
  }

  pendingSteps(u: Unit): number {
    if (!this.pending) return 0;
    const m = this.b.map;
    const t = this.pending.tile;
    if (this.pending.mode === 'jump') return Math.round(dist(u.x, u.y, t % m.w, (t / m.w) | 0));
    const r = this.getReach(u);
    return this.b.pathTo(u, this.pending.mode === 'walk' ? r.walk : r.sprint, t, this.pending.mode).length - 1;
  }

  // ---- Right panel ----------------------------------------------------------------------
  drawPanel(ui: UI): void {
    const d = ui.d, b = this.b;
    d.fill(PX, MY, PW, ROWS - MY, ' ', C.text, C.panel);
    const m = b.map;
    const ht = this.hoverTile;
    const hovered = ht >= 0 ? b.unitAt(ht % m.w, (ht / m.w) | 0) : undefined;
    const u = this.sel ?? b.active ?? this.rt.playerUnits.find((x) => x.alive) ?? null;
    let y = MY;
    if (u) y = this.drawUnitCard(ui, u, PX, y, true);
    // Target / hover card
    let t: Unit | null = null;
    if (hovered && hovered !== u && (SIDE(hovered.team) === 0 || b.seen[0].has(hovered.id))) t = hovered;
    else if (this.target) t = this.target;
    if (t) this.drawTargetCard(ui, u, t, PX, y + 1);
    else if (!this.tStruct) this.drawRoster(ui, PX, y + 1);
    else if (this.tStruct) {
      const s = this.tStruct;
      ui.header(PX, y + 1, PW, `TARGET: ${s.name.toUpperCase()}`, C.bg, '#c06040');
      d.text(PX + 1, y + 3, `Structure ${Math.max(0, s.hp)}/${s.maxHp}`, C.text);
      simpleBar(d, PX + 1, y + 4, 30, s.hp / s.maxHp, '#c06040');
      // Why (or how well) the selected unit can hit it
      if (u && u.team === 0 && b.canAttack(u)) {
        const res = b.weaponsOf(u).map((w) => b.hitChance(u, null, item(w.id), this.plan ?? u, undefined, false, s));
        const ok = res.filter((h) => h.ok);
        if (ok.length) d.ctext(PX + 1, y + 6, `{#6ad46a}${ok.length}{/} weapon${ok.length > 1 ? 's' : ''} in range · best {#f2f6f8}${Math.round(Math.max(...ok.map((h) => h.chance)))}%{/}. Click again or [F] to fire.`, C.dim, undefined, PW - 2);
        else d.text(PX + 1, y + 6, `Cannot fire: ${res[0]?.reason ?? 'no weapons'}.`, C.red, undefined, PW - 2);
      }
    }
  }

  drawRoster(ui: UI, x: number, y: number): void {
    const d = ui.d, b = this.b;
    ui.header(x, y, PW, 'LANCE STATUS', C.bg, '#2a5a70');
    let yy = y + 1;
    const units = b.units.filter((u) => SIDE(u.team) === 0 && u.deployed && u.tag !== 'convoy');
    const convoy = b.units.filter((u) => SIDE(u.team) === 0 && u.tag === 'convoy');
    for (const u of units) {
      if (yy >= ROWS - 1) break;
      const f = u.frame;
      let arm = 0, marm = 0, st = 0, mst = 0;
      for (const k in f.maxArmor) { arm += f.armor[k]; marm += f.maxArmor[k]; }
      for (const k in f.maxStruct) { st += Math.max(0, f.struct[k]); mst += f.maxStruct[k]; }
      const hov = ui.hover(x, yy, PW, 2) && u.alive && u.team === 0;
      const bg = hov ? '#16222c' : C.panel;
      d.fill(x, yy, PW, 2, ' ', C.text, bg);
      const col = !u.alive ? C.faint : u.team === 0 ? C.player : C.ally;
      d.text(x + 1, yy, this.glyphOf(u), col, bg, 99, true);
      d.text(x + 4, yy, (u.team === 0 ? u.name : b.chassisName(u)).slice(0, 13), u.alive ? C.bright : C.faint, bg);
      d.text(x + 18, yy, frameTitle(f).slice(0, 18), C.dim, bg);
      const status = !u.alive ? (u.fled ? 'EXITED' : u.destroyHow === 'eject' ? 'EJECTED' : 'DESTROYED') : u.acted ? 'done' : u.phase === b.phase ? 'READY' : `ph ${u.phase}`;
      d.text(x + PW - 1 - status.length, yy, status, !u.alive ? (u.fled ? C.green : C.red) : status === 'READY' ? C.accent : C.faint, bg);
      if (u.alive) {
        d.text(x + 1, yy + 1, 'A', C.faint, bg); simpleBar(d, x + 2, yy + 1, 12, arm / Math.max(1, marm), '#a8b8c0', '#161c22');
        d.text(x + 15, yy + 1, 'S', C.faint, bg); simpleBar(d, x + 16, yy + 1, 10, st / Math.max(1, mst), healthColor(st / Math.max(1, mst)), '#161c22');
        if (b.isMech(u)) { d.text(x + 28, yy + 1, 'H', '#ff8a4a', bg); simpleBar(d, x + 29, yy + 1, 9, u.heat / u.stats.heatCap, '#ff6a2a', '#1a1210', 0.75); }
        if (ui.hover(x, yy, PW, 2)) ui.setTip([`${u.name}: armor ${arm}/${marm}, structure ${st}/${mst}${b.isMech(u) ? `, heat ${Math.round(u.heat)}/${u.stats.heatCap}` : ''}`]);
        if (u.pilot && u.team === 0) d.ctext(x + 41, yy + 1, healthPips(u.pilot), C.text, bg);
      }
      if (hov) { ui.cursor = 'pointer'; if (ui.click(x, yy, PW, 2)) { if (this.canAct(u) && !b.active) this.select(u); this.centerOn(u.x, u.y); } }
      yy += 2;
    }
    // Escorted convoy: one compact row, a health block per vehicle
    if (convoy.length && yy < ROWS - 1) {
      d.text(x + 1, yy, 'CONVOY', C.ally, undefined, 99, true);
      convoy.forEach((v, i) => {
        const f = v.frame;
        let hp = 0, mx = 0;
        for (const k in f.maxArmor) { hp += f.armor[k]; mx += f.maxArmor[k]; }
        for (const k in f.maxStruct) { hp += Math.max(0, f.struct[k]); mx += f.maxStruct[k]; }
        const st = v.fled ? 'SAFE' : !v.alive ? 'LOST' : `${Math.round((hp / Math.max(1, mx)) * 100)}%`;
        d.text(x + 9 + i * 11, yy, this.glyphOf(v), v.alive || v.fled ? C.ally : C.faint);
        d.text(x + 12 + i * 11, yy, st, v.fled ? C.green : !v.alive ? C.red : healthColor(hp / Math.max(1, mx)));
        if (ui.hover(x + 9 + i * 11, yy, 10, 1)) ui.setTip([`${b.fullName(v)}: ${v.fled ? 'reached the exit' : v.alive ? `armor+structure ${hp}/${mx}` : 'destroyed'}`]);
      });
      yy += 2;
    }
    this.drawThreats(ui, x, yy + 1);
  }

  /** Visible enemies ranked by how hard they could hit the selected unit from where they stand. */
  drawThreats(ui: UI, x: number, y: number): void {
    const d = ui.d, b = this.b;
    const u = this.sel ?? b.active ?? this.rt.playerUnits.find((x) => x.alive) ?? null;
    if (!u || !u.alive || SIDE(u.team) !== 0 || y >= ROWS - 4) return;
    const foes = b.units.filter((e) => e.alive && e.deployed && !e.fled && SIDE(e.team) === 1 && this.visibleUnit(e));
    if (!foes.length) return;
    ui.header(x, y, PW, `THREATS TO ${u.name.toUpperCase()}`, C.bg, '#703030');
    const rows = foes.map((e) => ({ e, dmg: Math.round(b.expectedDamage(e, u, { x: e.x, y: e.y, moved: null })), dd: dist(u.x, u.y, e.x, e.y) }))
      .sort((p, q) => q.dmg - p.dmg);
    let yy = y + 1;
    for (const r of rows) {
      if (yy >= ROWS - 1) break;
      const arc = attackArc(u, r.e.x, r.e.y);
      const hov = ui.hover(x, yy, PW, 1);
      const bg = hov ? '#1e1414' : C.panel;
      d.fill(x, yy, PW, 1, ' ', C.text, bg);
      d.text(x + 1, yy, this.glyphOf(r.e), C.enemy, bg, 99, true);
      d.text(x + 4, yy, b.chassisName(r.e), C.text, bg, 20);
      d.text(x + 25, yy, `${r.dd.toFixed(0).padStart(2)}▸`, C.dim, bg);
      d.text(x + 31, yy, arc === 'rear' ? 'REAR' : arc === 'front' ? 'front' : 'side', arc === 'rear' ? C.red : arc === 'front' ? C.faint : C.warn, bg);
      d.text(x + 38, yy, r.dmg ? `~${r.dmg} dmg` : 'no shot', r.dmg >= 60 ? C.red : r.dmg ? C.orange : C.faint, bg);
      if (hov) { ui.setTip([`${b.chassisName(r.e)} (${r.dd.toFixed(0)} tiles away) could deal ~${r.dmg} damage to ${u.name} from its current position.`, `It sees ${u.name}'s ${arc} arc.`]); if (ui.click(x, yy, PW, 1)) this.centerOn(r.e.x, r.e.y); }
      yy++;
    }
  }

  drawUnitCard(ui: UI, u: Unit, x: number, y: number, full: boolean): number {
    const d = ui.d, b = this.b;
    const side = SIDE(u.team);
    const col = u.team === 0 ? C.player : u.team === 2 ? C.ally : C.enemy;
    const hdr = u.pilot && u.team === 0 ? `${u.pilot.callsign.toUpperCase()} · ${frameTitle(u.frame)}` : frameTitle(u.frame);
    ui.header(x, y, PW, hdr, C.bg, side === 0 ? '#3a9ac0' : '#c04a3a');
    d.text(x + PW - 1 - classTag(u.frame).length, y, classTag(u.frame), C.bg, undefined, 99, true);
    y++;
    if (u.pilot) {
      const p = u.pilot;
      d.ctext(x + 1, y, `${u.team === 0 ? p.name : 'Enemy pilot'}  ${skillLine(p)}  ${healthPips(p)}`, C.text);
      const abil = p.abilities.map((a) => ability(a).name).join(', ');
      if (abil) d.text(x + 1, y + 1, abil, C.dim, undefined, PW - 2);
      if (ui.hover(x, y, PW, 2)) ui.setTip([`{#f2f6f8}${p.name}{/} "${p.callsign}"`, `Gunnery ${p.gun} · Piloting ${p.pil} · Guts ${p.gut} · Tactics ${p.tac}`, `Health ${health(p) - p.injuries}/${health(p)}`, ...p.abilities.map((a) => `{#f0a830}${ability(a).name}{/}: ${ability(a).desc}`)]);
    }
    y += 2;
    const rects = drawDoll(ui, x + 1, y, u.frame, {});
    void rects;
    // Stats column right of doll
    const sx = x + 32;
    const s = u.stats;
    if (b.isMech(u)) {
      const wOn = this.sel === u ? this.selectedWeapons(u, this.target, this.tStruct) : [];
      const proj = b.projectedHeat(u, wOn) + (this.pending?.mode === 'jump' ? this.pendingSteps(u) * 3 : 0);
      d.text(sx, y, 'HEAT', '#ff8a4a');
      d.text(sx + 10, y, `${Math.round(u.heat)}/${s.heatCap}`, C.text);
      heatBar(d, sx, y + 1, 16, u.heat, proj, s.heatCap, b.dissipation(u));
      if (ui.hover(sx, y, 17, 2)) ui.setTip([`Heat ${Math.round(u.heat)} → ${Math.round(proj)} after this attack; dissipates ${b.dissipation(u)}/turn.`, 'Above the red line (75%) the \'Mech overheats: -10% accuracy and internal damage. At 100% it shuts down.']);
      d.text(sx, y + 2, 'STABILITY', '#8ab4ff');
      simpleBar(d, sx, y + 3, 16, u.stab / s.stabMax, u.unsteady ? '#f0d050' : '#4a7ad0', '#141a24', 0.5);
      if (ui.hover(sx, y + 2, 17, 2)) ui.setTip(['Stability damage from heavy impacts. Past 50% the unit is Unsteady (loses evasion); at 100% it is knocked down. Bracing clears it.']);
    }
    d.text(sx, y + 4, 'EVASION', C.dim);
    d.text(sx + 8, y + 4, pipStr(u.pips, b.maxPips(u)), '#8ab4ff');
    d.text(sx, y + 5, `Move ${s.walk}/${s.sprint}${s.jump ? ` Jump ${s.jump}` : ''}`, C.dim);
    d.text(sx, y + 6, `Phase ${u.phase}${u.reserved ? ' (res)' : ''}`, C.dim);
    const tags: [string, string][] = [];
    if (u.guarded) tags.push(['GUARDED', '#8ab4ff']);
    if (u.entrenched) tags.push(['ENTRENCHED', '#5fd0e8']);
    if (u.unsteady) tags.push(['UNSTEADY', '#f0d050']);
    if (u.prone) tags.push(['PRONE', '#f0d050']);
    if (u.shutdown) tags.push(['SHUTDOWN', '#ff6a2a']);
    if (u.sensorLocked) tags.push(['LOCKED', '#5fd0e8']);
    if (u.accDebuff) tags.push(['SCRAMBLED', '#b27ae8']);
    if (this.isMechOverheat(u)) tags.push(['OVERHEAT', '#ff6a2a']);
    const tt = TERRAIN[b.map.terr[u.y * b.map.w + u.x]];
    if (tt.cover) tags.push([`COVER ${Math.round(tt.cover * 100)}%`, '#6ad46a']);
    let ty = y + 7, tx = sx;
    for (const [tg, c] of tags) {
      if (tx + tg.length > x + PW - 1) { tx = sx; ty++; }
      if (ty > y + 9) break;
      d.text(tx, ty, tg, C.bg, c);
      tx += tg.length + 1;
    }
    y += DOLL_H_PLUS;
    if (full) y = this.drawWeaponList(ui, u, this.target, x, y, this.tStruct);
    return y;
  }

  isMechOverheat(u: Unit): boolean { return this.b.isMech(u) && u.heat > u.stats.heatCap * 0.75; }

  drawWeaponList(ui: UI, u: Unit, t: Unit | null, x: number, y: number, s: Structure | null): number {
    const d = ui.d, b = this.b;
    d.text(x + 1, y, 'WEAPON', C.faint);
    d.text(x + 19, y, 'DMG  HT  RANGE  AMMO  HIT', C.faint);
    y++;
    const ws = b.weaponsOf(u);
    const deadWs = u.frame.items.filter((c) => c.dead && item(c.id).kind === 'weapon');
    const mine = u === this.sel && u.team === 0;
    ws.forEach((wc, i) => {
      const w = item(wc.id);
      const off = this.weaponsOff.has(wc);
      const ammoOk = b.hasAmmo(u, wc);
      const from = mine && this.plan ? this.plan : u;
      const meleeMode = this.mode === 'melee' || this.mode === 'dfa';
      const multiT = this.multi.get(wc);
      const hc = multiT && mine ? b.hitChance(u, multiT, w, from) : (t || s) && mine && !meleeMode ? b.hitChance(u, t, w, from, undefined, !!this.calledLoc, s ?? undefined) : null;
      const on = mine && !off && ammoOk && (!hc || hc.ok);
      const hov = mine && ui.hover(x, y, PW, 1);
      const bg = hov ? '#1a2630' : C.panel;
      d.fill(x, y, PW, 1, ' ', C.text, bg);
      d.text(x + 1, y, mine ? (on || multiT ? '■' : '□') : ' ', multiT ? C.orange : on ? C.accent : C.faint, bg);
      d.text(x + 3, y, `${i + 1}`, C.faint, bg);
      d.text(x + 5, y, w.name.slice(0, 13), !ammoOk ? C.faint : on ? C.bright : C.text, bg);
      const dmg = (w.shots ?? 1) > 1 ? `${w.dmg}x${w.shots}` : `${w.dmg}`;
      d.text(x + 19, y, dmg.padEnd(5), C.text, bg);
      d.text(x + 24, y, String(w.heat).padStart(2), '#ff8a4a', bg);
      d.text(x + 28, y, `${w.min ? w.min + '-' : ''}${w.lr}`.padEnd(6), C.dim, bg);
      if (w.ammo) {
        const n = u.frame.items.filter((c) => !c.dead && c.id === w.ammo).reduce((a, c) => a + (c.ammo ?? 0), 0);
        const shots = Math.floor(n / (w.shots ?? 1));
        d.text(x + 35, y, String(shots).padStart(3), shots === 0 ? C.red : shots <= 2 ? C.warn : C.text, bg);
      } else d.text(x + 35, y, '  ∞', C.faint, bg);
      if (hc) {
        const txt = hc.ok ? `${Math.round(hc.chance)}%` : '--';
        d.text(x + 41, y, txt.padStart(4), hc.ok ? healthColor(hc.chance / 100) : C.faint, bg);
        if (hc.indirect) d.text(x + 46, y, 'IND', C.purple, bg);
      }
      if (multiT) d.text(x + 46, y, `→${this.glyphOf(multiT)}`, C.orange, bg);
      if (hov) {
        const tip = weaponTip(wc.id);
        if (hc && hc.ok) { tip.push(''); for (const [l, v] of hc.mods) tip.push(`${pad(l, 22)} ${v > 0 && l !== hc.mods[0][0] ? '+' : ''}${v}${l === hc.mods[0][0] ? '%' : ''}`); tip.push(`{#f2f6f8}${pad('Hit chance', 22)} ${Math.round(hc.chance)}%{/}`); }
        else if (hc) tip.push(`{#e8503a}${hc.reason}{/}`);
        ui.setTip(tip);
        if (ui.click(x, y, PW, 1)) { if (off) this.weaponsOff.delete(wc); else this.weaponsOff.add(wc); this.multi.delete(wc); }
      }
      y++;
    });
    for (const wc of deadWs) { d.text(x + 5, y, `${item(wc.id).name} ✕`, '#5a3030'); y++; }
    // Expected damage summary
    if (mine && (t || s) && this.mode !== 'melee' && this.mode !== 'dfa') {
      const sel = this.selectedWeapons(u, t, s);
      let ev = 0, heat = 0;
      const from = this.plan ?? u;
      let red = 1;
      if (t) { const cov = TERRAIN[b.map.terr[t.y * b.map.w + t.x]].cover; const breach = has(u.pilot ?? undefined, 'breaching') && sel.length === 1; if (!breach) red = (1 - cov) * (t.guarded && attackArc(t, from.x, from.y) !== 'rear' ? 0.6 : 1); }
      for (const wc of sel) { const w = item(wc.id); const hc = b.hitChance(u, t, w, from, undefined, false, s ?? undefined); if (!hc.ok) continue; ev += (hc.chance / 100) * (w.dmg ?? 0) * (w.shots ?? 1) * red; heat += w.heat ?? 0; }
      d.ctext(x + 1, y, `Selected: {#f2f6f8}${sel.length}{/} · expected {#f0d050}${Math.round(ev)}{/} dmg${red < 1 ? ` {#6ad46a}(-${Math.round((1 - red) * 100)}% cover/guard){/}` : ''} · {#ff8a4a}+${heat}{/} heat`, C.dim, undefined, PW - 2);
      y++;
      if (b.isMech(u) && b.projectedHeat(u, sel) >= u.stats.heatCap) { d.text(x + 1, y, this.heatConfirm ? '⚠ SHUTDOWN — press F again to fire' : '⚠ THIS ATTACK WILL SHUT YOU DOWN', '#ff6a2a', undefined, PW - 2, true); y++; }
      if (this.plan) { d.text(x + 1, y, `(odds shown from the planned destination)`, C.faint); y++; }
    }
    return y;
  }

  drawTargetCard(ui: UI, a: Unit | null, t: Unit, x: number, y: number): void {
    const d = ui.d, b = this.b;
    const side = SIDE(t.team);
    const hdr = side === 0 && t.pilot ? `${t.pilot.callsign.toUpperCase()} · ${frameTitle(t.frame)}` : `${t.tag === 'target' ? '◎ TARGET · ' : ''}${frameTitle(t.frame)}`;
    ui.header(x, y, PW, hdr, C.bg, side === 0 ? '#2a7a9a' : '#a03a2a');
    d.text(x + PW - 1 - classTag(t.frame).length, y, classTag(t.frame), C.bg, undefined, 99, true);
    y++;
    const pf = a && a === this.sel && this.plan ? this.plan : a;
    const arc = a && pf && a !== t ? attackArc(t, pf.x, pf.y) : null;
    const tags: string[] = [];
    if (t.pilot && side === 1) tags.push(skillLine(t.pilot));
    tags.push(`{#8ab4ff}${pipStr(t.pips, b.maxPips(t))}{/}`);
    if (t.guarded) tags.push('{#8ab4ff}GUARDED -40%{/}');
    const tcov = TERRAIN[b.map.terr[t.y * b.map.w + t.x]].cover;
    if (tcov) tags.push(`{#6ad46a}COVER -${Math.round(tcov * 100)}%{/}`);
    if (t.unsteady) tags.push('{#f0d050}UNSTEADY{/}');
    if (t.prone) tags.push('{#f0d050}PRONE{/}');
    if (t.shutdown) tags.push('{#ff6a2a}SHUTDOWN{/}');
    if (arc) tags.push(`{#6d7f8a}arc{/} {${arc === 'rear' ? '#6ad46a' : arc === 'front' ? '#c8d2d8' : '#f0d050'}}${arc.toUpperCase()}{/}`);
    d.ctext(x + 1, y, tags.join('  '), C.text, undefined, PW - 2);
    y++;
    // Called-shot percentages
    let pct: Record<string, number> | undefined;
    let hl: string | null = this.calledLoc;
    const calling = this.mode === 'called' && t === this.target && a;
    if (calling && t.frame.kind === 'mech' && a) {
      pct = {};
      const allowHead = t.prone || t.shutdown;
      const tb = b.hitTable(t, arc ?? 'front');
      let tot = 0;
      for (const k in tb) tot += tb[k];
      for (const l of ['HD', 'CT', 'LT', 'RT', 'LA', 'RA', 'LL', 'RL']) {
        if (l === 'HD' && !allowHead) continue;
        if ((t.frame.struct[l] ?? 0) <= 0) continue;
        const key = arc === 'rear' && ['CT', 'LT', 'RT'].includes(l) ? l + 'R' : l;
        const boost = tot * (0.35 + (a.pilot?.tac ?? 3) * 0.06);
        pct[l] = (((tb[key] ?? 0) + boost) / (tot + boost)) * 100;
      }
    }
    let hovLoc: string | null = null;
    drawDoll(ui, x + 1, y, t.frame, { highlight: hl, pct, onHover: (l) => { hovLoc = l; } });
    if (calling && hovLoc && pct && (pct as Record<string, number>)[hovLoc] !== undefined) {
      ui.setTip([`Precision Strike: ${locName(hovLoc)}`, `Click to aim. ~${Math.round((pct as Record<string, number>)[hovLoc])}% of hits will land here.`]);
      if (ui.click(x + 1, y, 29, DOLL_H)) this.calledLoc = hovLoc;
    }
    // Right column: summary
    const sx = x + 32;
    const f = t.frame;
    let arm = 0, marm = 0, st = 0, mst = 0;
    for (const k in f.maxArmor) { arm += f.armor[k]; marm += f.maxArmor[k]; }
    for (const k in f.maxStruct) { st += Math.max(0, f.struct[k]); mst += f.maxStruct[k]; }
    d.text(sx, y, 'ARMOR', C.dim); d.text(sx + 10, y, `${arm}`, C.text);
    simpleBar(d, sx, y + 1, 16, arm / Math.max(1, marm), '#a8b8c0');
    d.text(sx, y + 2, 'STRUCTURE', C.dim); d.text(sx + 10, y + 2, `${st}`, C.text);
    simpleBar(d, sx, y + 3, 16, st / Math.max(1, mst), '#d0a040');
    if (b.isMech(t)) {
      d.text(sx, y + 4, 'HEAT', '#ff8a4a');
      simpleBar(d, sx + 5, y + 4, 11, t.heat / t.stats.heatCap, '#ff6a2a', '#1a1210', 0.75);
      d.text(sx, y + 5, 'STAB', '#8ab4ff');
      simpleBar(d, sx + 5, y + 5, 11, t.stab / t.stats.stabMax, t.unsteady ? '#f0d050' : '#4a7ad0', '#141a24', 0.5);
    }
    // Weapons (enemy loadout is visible)
    let wy = y + 6;
    const ws = b.weaponsOf(t);
    const names = new Map<string, number>();
    for (const w of ws) names.set(item(w.id).name, (names.get(item(w.id).name) ?? 0) + 1);
    for (const [n, c] of names) { if (wy > y + 9) break; d.text(sx, wy++, `${c > 1 ? c + 'x ' : ''}${n}`, C.dim, undefined, 17); }
    y += DOLL_H + 1;
    // Melee / DFA preview
    if (a && a.team === 0 && side === 1 && this.canAct(a) && (this.mode === 'melee' || this.mode === 'dfa')) {
      const dfa = this.mode === 'dfa';
      const spots = b.meleeSpots(a, t, dfa);
      const ht = this.hoverTile;
      let spot = spots.has(ht) ? ht : -1;
      if (spot < 0) { let bc = Infinity; for (const [i, [cc]] of spots) if (cc < bc) { bc = cc; spot = i; } }
      d.text(x + 1, y, dfa ? 'DEATH FROM ABOVE' : 'MELEE', C.accent, undefined, 99, true);
      if (!spots.size) { d.text(x + 1, y + 1, 'No reachable attack position.', C.red); return; }
      const mc = b.meleeChance(a, t, dfa);
      const sx = spot % b.map.w, sy = (spot / b.map.w) | 0;
      const marc = attackArc(t, sx, sy);
      const mdmg = dfa ? a.stats.dfaDmg : a.stats.meleeDmg;
      d.ctext(x + 1, y + 1, `Hit {#f2f6f8}${Math.round(mc.chance)}%{/} · damage {#f0d050}${t.guarded && marc !== 'rear' ? Math.round(mdmg * 0.6) : mdmg}{/} · arc {${marc === 'rear' ? '#6ad46a' : '#c8d2d8'}}${marc.toUpperCase()}{/}${spots.has(ht) ? ' {#6d7f8a}(this spot){/}' : ' {#6d7f8a}(nearest spot){/}'}`, C.dim, undefined, PW - 2);
      d.ctext(x + 1, y + 2, `Heavy stability damage${dfa ? ` · your legs take ~${Math.round(frameTons(a.frame) * 0.25)}` : ''}${b.weaponsOf(a).some((w) => item(w.id).hard === 'S') ? ' · support weapons fire too' : ''}`, C.faint, undefined, PW - 2);
      mc.mods.forEach(([l, v], k) => { if (y + 3 + k < ROWS) { d.text(x + 1, y + 3 + k, l.slice(0, 20), C.dim); d.text(x + 22, y + 3 + k, (k === 0 ? `${v}%` : `${v > 0 ? '+' : ''}${v}`).padStart(5), k === 0 ? C.text : v > 0 ? C.green : C.red); } });
      return;
    }
    // Hit chance breakdown vs this target
    if (a && a.team === 0 && t !== a && side === 1 && this.canAct(a)) {
      const sel = this.selectedWeapons(a, t);
      const w0 = sel[0] ?? this.b.weaponsOf(a)[0];
      if (w0) {
        const hc: HitCalc = b.hitChance(a, t, item(w0.id), pf ?? a, undefined, !!this.calledLoc);
        d.text(x + 1, y, `TO-HIT (${item(w0.id).short})`, C.faint);
        y++;
        if (!hc.ok) d.text(x + 1, y, hc.reason, C.red);
        else {
          let yy = y;
          const cols = 2;
          hc.mods.forEach(([l, v], k) => {
            const cx = x + 1 + (k % cols) * 24, cy = yy + Math.floor(k / cols);
            if (cy >= ROWS - 1) return;
            const vs = k === 0 ? `${v}%` : `${v > 0 ? '+' : ''}${v}`;
            d.text(cx, cy, l.slice(0, 17), C.dim);
            d.text(cx + 18, cy, vs.padStart(5), k === 0 ? C.text : v > 0 ? C.green : v < 0 ? C.red : C.dim);
          });
          yy += Math.ceil(hc.mods.length / cols);
          if (yy < ROWS) d.text(x + 1, yy, `= ${Math.round(hc.chance)}% per shot`, C.bright, undefined, 99, true);
        }
      }
    }
    void structLoc;
  }

  // ---- Overlays -------------------------------------------------------------------------
  drawBriefing(ui: UI): void {
    const d = ui.d;
    const w = 70, x = MX + VW - w / 2;
    const lines: string[] = [];
    for (const l of this.rt.briefing) lines.push(...wrap(l, w - 6), '');
    const obs = this.rt.objectives.map((o) => `${o.primary ? '{#f0a830}□ PRIMARY{/}' : '{#6d7f8a}◇ OPTIONAL{/}'} ${o.text}${o.bonus ? ` {#f0c850}(+¢${Math.round(o.bonus).toLocaleString()}){/}` : ''}`);
    const h = lines.length + obs.length + 8;
    const y = MY + Math.floor((VH - h) / 2);
    ui.panel(x, y, w, h, 'MISSION BRIEFING', { fg: C.borderHi, bg: '#0a1016', style: 'double' });
    const mi = MISSION_INFO[this.rt.spec.type];
    d.text(x + 3, y + 2, `${mi.glyph} ${(this.title || mi.name).toUpperCase()}`, C.bright, undefined, w - 6, true);
    d.text(x + 3, y + 3, `${mi.desc}`, C.dim, undefined, w - 6);
    lines.forEach((l, i) => d.ctext(x + 3, y + 5 + i, l, C.text));
    obs.forEach((l, i) => d.ctext(x + 3, y + 5 + lines.length + i, l, C.text, undefined, w - 6));
    if (ui.button(x + w / 2 - 8, y + h - 2, 'DEPLOY LANCE', { key: 'Enter', style: 'block', w: 20, center: true }) || ui.key(' ')) {
      this.briefingOpen = false;
    }
  }

  drawHelp(ui: UI): void {
    const d = ui.d;
    const lines = [
      '{#f0a830}MOVEMENT{/}  Blue tiles: walk (may fire after). Amber: sprint (no attack; +1 evasion).',
      '  Click a tile to preview the path, click again or [Space] to confirm. [J] jump mode.',
      '  Moving further builds EVASION ◆: each pip is -8% to be hit. Each attack strips one pip.',
      '{#f0a830}ATTACKING{/}  Click an enemy to target, click again or [F] to fire. [1]-[9] toggle weapons.',
      '  Hover a weapon for its hit breakdown. Rear shots hit weak rear armor.',
      '  [P] Precision Strike (Resolve): pick the location on the target doll.',
      '  [M] Melee / [D] Death From Above. Great for knocking down Unsteady targets.',
      '{#f0a830}DEFENSE{/}  [B] Brace: Guarded (-40% dmg), clears stability. Forests give cover.',
      '  [V] Vigilance (Resolve): Guarded + Entrenched. [R] Reserve: act one phase later.',
      '{#f0a830}HEAT{/}  Weapons and jumping generate heat. Over 75%: overheating damage.',
      '  At 100% your \'Mech shuts down and is easy to hit. Water helps cooling.',
      '{#f0a830}INITIATIVE{/}  Lights act in phase 4, mediums 3, heavies 2, assaults 1.',
      '{#f0a830}VIEW{/}  Arrows/wheel pan · [C] center · [Z] elevation · [Tab] next unit · [+/-] speed',
    ];
    const w = 94, h = lines.length + 5, x = MX + VW - w / 2, y = MY + 4;
    ui.panel(x, y, w, h, 'FIELD MANUAL', { fg: C.borderHi, bg: '#0a1016', style: 'double' });
    lines.forEach((l, i) => d.ctext(x + 2, y + 2 + i, l, C.text));
    if (ui.button(x + w / 2 - 5, y + h - 2, 'Close', { key: 'Escape' }) || ui.anyKey() || ui.inp.clicked) this.showHelp = false;
  }

  drawWithdraw(ui: UI): void {
    const d = ui.d;
    const w = 54, h = 8, x = MX + VW - w / 2, y = MY + 12;
    ui.panel(x, y, w, h, 'WITHDRAW?', { fg: C.red, bg: '#140a0a', style: 'double' });
    d.ctext(x + 2, y + 2, 'Call the dropship? Extraction takes 2 rounds.', C.text);
    d.ctext(x + 2, y + 3, '{#e8503a}The contract will be failed.{/}', C.text);
    if (ui.button(x + 4, y + 5, 'Withdraw', { key: 'y' })) { this.b.withdraw(); this.pull(); this.confirmWithdraw = false; }
    if (ui.button(x + 30, y + 5, 'Keep fighting', { key: 'Escape' })) this.confirmWithdraw = false;
  }

  drawResult(ui: UI): void {
    const d = ui.d, b = this.b;
    const win = b.result === 'win';
    const w = 64;
    const obs = this.rt.objectives;
    const h = 12 + obs.length;
    const x = MX + VW - w / 2, y = MY + 8;
    ui.panel(x, y, w, h, '', { fg: win ? C.green : C.red, bg: '#080c10', style: 'double' });
    const title = win ? 'MISSION SUCCESS' : b.result === 'withdraw' ? 'WITHDRAWN' : 'MISSION FAILED';
    d.text(x + Math.floor((w - title.length) / 2), y + 2, title, win ? C.green : C.red, undefined, 99, true);
    obs.forEach((o, i) => {
      const mark = o.status === 'done' ? '{#6ad46a}■{/}' : o.status === 'failed' ? '{#e8503a}✕{/}' : '{#6d7f8a}□{/}';
      d.ctext(x + 3, y + 4 + i, `${mark} ${o.text}`, o.primary ? C.text : C.dim, undefined, w - 6);
    });
    const yy = y + 5 + obs.length;
    const kills = this.rt.playerUnits.reduce((a, u) => a + u.kills, 0);
    const lost = this.rt.playerUnits.filter((u) => !u.alive).length;
    d.ctext(x + 3, yy, `Rounds: {#f2f6f8}${b.round}{/}   Enemy destroyed: {#6ad46a}${kills}{/}   Units lost: {#e8503a}${lost}{/}`, C.dim);
    if (ui.button(x + w / 2 - 8, y + h - 2, 'CONTINUE', { key: 'Enter', style: 'block', w: 16, center: true })) this.onDone(this.rt);
  }
}

import { frameTons } from '../game/frame';
function frameTonsOf(u: Unit): number { return frameTons(u.frame); }
const DOLL_H = 10;
const DOLL_H_PLUS = 11;
void rgb; void hex; void Display;
