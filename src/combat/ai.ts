// Tactical AI: utility-scored movement and heat-aware target/weapon selection.

import { item } from '../data/items';
import { Component } from '../game/frame';
import { Battle, Unit, SIDE, MoveMode, attackArc, Assignment } from './battle';
import { TERRAIN, dist, dirTo, los } from './terrain';

/** Feature switches, used by the headless A/B harness. */
export const AI_OPTS = { losThreat: true, killFocus: true, caution: false };

interface Cand {
  i: number;
  mode: MoveMode | null;
  score: number;
  melee?: Unit;
  dfa?: boolean;
}

function roleRange(b: Battle, u: Unit): number {
  // Damage-weighted optimal range of the loadout
  let wsum = 0, rsum = 0;
  for (const c of b.weaponsOf(u)) {
    const w = item(c.id);
    const dmg = (w.dmg ?? 0) * (w.shots ?? 1);
    const opt = w.min ? Math.max(w.min + 1, (w.sr ?? 0) + 1) : Math.max(1.5, (w.sr ?? 0) * 0.9);
    wsum += dmg;
    rsum += dmg * opt;
  }
  return wsum ? rsum / wsum : 5;
}

function targetValue(b: Battle, a: Unit, t: Unit): number {
  const f = t.frame;
  let s = 0, ms = 0;
  for (const k in f.maxStruct) { s += f.struct[k]; ms += f.maxStruct[k]; }
  let a2 = 0, ma = 0;
  for (const k in f.maxArmor) { a2 += f.armor[k]; ma += f.maxArmor[k]; }
  const hp = (s + a2) / Math.max(1, ms + ma);
  let v = 1 + (1 - hp) * 1.2;
  if (t.frame.kind === 'mech') v *= 1.15;
  if (t.tag === 'convoy') v *= SIDE(t.team) === 0 ? 0.6 : 2.2 * (t.ai.goal && dist(t.x, t.y, t.ai.goal[0], t.ai.goal[1]) < 14 ? 1.6 : 1);
  if (t.prone || t.shutdown) v *= 1.3;
  if ((t as any)._hitRound === b.round) v *= 1.2; // focus fire on what the lance is already hitting
  const arc = attackArc(t, a.x, a.y);
  if (arc === 'rear') v *= 1.25;
  return v;
}

function unitHealth(u: Unit): number {
  const f = u.frame;
  let s = 0, ms = 0;
  for (const k in f.maxStruct) { s += f.struct[k]; ms += f.maxStruct[k]; }
  let a = 0, ma = 0;
  for (const k in f.maxArmor) { a += f.armor[k]; ma += f.maxArmor[k]; }
  return (s + a) / Math.max(1, ms + ma);
}

/** Rough incoming damage estimate at a tile, from all known enemies. */
function threatAt(b: Battle, u: Unit, x: number, y: number, pips: number, known: Unit[]): number {
  const t = TERRAIN[b.map.terr[y * b.map.w + x]];
  let total = 0;
  for (const e of known) {
    const d = dist(e.x, e.y, x, y);
    const reach = e.stats.walk * 0.6;
    const gun = e.pilot?.gun ?? 3;
    // Hills and buildings between us and them mean they must move (and spend their turn) to shoot
    const hidden = AI_OPTS.losThreat && d > 1.5 && d < 30 && !los(b.map, e.x, e.y, x, y).clear;
    for (const c of b.weaponsOf(e)) {
      const w = item(c.id);
      const cover = hidden ? (w.indirect ? 0.85 : 0.7) : 1;
      const eff = Math.max(0, d - reach);
      if (eff > (w.lr ?? 0)) continue;
      let p = 55 + gun * 3 - pips * 8;
      if (eff > (w.mr ?? 0)) p -= 15; else if (eff > (w.sr ?? 0)) p -= 5;
      p = Math.max(5, Math.min(95, p));
      total += (p / 100) * (w.dmg ?? 0) * (w.shots ?? 1) * cover;
    }
  }
  return total * (1 - t.cover);
}

export function aiTakeTurn(b: Battle, u: Unit): void {
  if (!b.beginActivation(u)) return;
  // Extracting: an autopilot 'Mech drops whatever it was escorting or guarding and heads for the zone
  if (b.map.extract && u.team === 0) u.ai.goal = undefined;
  const side = SIDE(u.team);
  const m = b.map;
  const enemies = b.enemiesOf(u);
  const visible = enemies.filter((e) => b.seen[side].has(e.id));
  // Known positions: visible units plus recent memory
  const known: Unit[] = [...visible];
  for (const e of enemies) {
    if (visible.includes(e)) continue;
    // Sensor contacts count (their position is known, their loadout is not), then shared lance memory
    if (b.detected[side].has(e.id)) { known.push(e); continue; }
    let lk = u.ai.lastKnown.get(e.id);
    for (const a of b.alliesOf(u)) { const k2 = a.ai.lastKnown.get(e.id); if (k2 && (!lk || k2[2] > lk[2])) lk = k2; }
    if (lk && b.round - lk[2] <= 5) known.push({ ...e, x: lk[0], y: lk[1] } as Unit);
  }

  // ---- A lone surviving vehicle breaks off rather than be hunted down ---------------------
  // Out of usable weapons: vehicles always run; 'Mechs run unless something is close enough to punch
  const noGuns = u.frame.kind !== 'turret' && !b.weaponsOf(u).some((w) => b.hasAmmo(u, w));
  const dry = noGuns && (u.frame.kind === 'vehicle' || !visible.some((e) => dist(e.x, e.y, u.x, u.y) <= u.stats.walk + 1.5));
  if (side === 1 && (u.frame.kind === 'vehicle' || dry) && (!u.tag || u.tag === 'escort' || (dry && u.tag === 'raider')) && !(u as any)._fleeing && (dry || (enemies.length >= 2 && b.alliesOf(u).length === 0
    && !b.units.some((v) => v !== u && SIDE(v.team) === side && v.alive && !v.deployed)))) {
    (u as any)._fleeing = true;
    if (dry) u.tag = ''; // a dry escort is no longer screening anything
    const edges: [number, number][] = [[0, u.y], [m.w - 1, u.y], [u.x, 0], [u.x, m.h - 1]];
    u.ai.goal = edges.sort((p, q) => dist(u.x, u.y, p[0], p[1]) - dist(u.x, u.y, q[0], q[1]))[0];
    b.say(`${b.displayName(u)} ${dry ? 'is out of ammunition and' : ''} breaks off and runs for the map edge!`.replace('  ', ' '), '#f0a830');
  }

  // ---- Convoys drive for the exit -----------------------------------------------------
  if ((u.tag === 'convoy' || (u as any)._fleeing) && u.ai.goal) {
    // Hunted convoys run when they see trouble
    const friendlyConvoy = u.tag === 'convoy' && SIDE(u.team) === 0;
    // An escorted convoy keeps rolling for the exit whatever happens: the lance has to keep up and screen it
    const threatened = visible.some((e) => dist(e.x, e.y, u.x, u.y) <= 10);
    moveToward(b, u, u.ai.goal[0], u.ai.goal[1], (u.tag === 'convoy' && !friendlyConvoy && threatened && unitHealth(u) < 0.5) || ((u as any)._fleeing && !u.tag) ? 'sprint' : 'walk');
    const [gx, gy] = u.ai.goal;
    if (dist(u.x, u.y, gx, gy) <= 2.5) {
      u.fled = true;
      b.say(`${b.displayName(u)} has left the area.`, side === 0 ? '#6ad46a' : '#f0a830');
      b.emit({ k: 'destroyed', u: u.id, how: 'fled' });
    } else if (b.weaponsOf(u).length && visible.length) aiAttack(b, u, visible);
    b.finishActivation(u);
    return;
  }

  // ---- Nothing known: advance on objective / last contact -------------------------------
  if (!known.length) {
    if (u.tag === 'guard' && dist(u.x, u.y, u.startX, u.startY) < 6) { b.finishActivation(u); return; }
    // Objective structures in play: shoot one if possible, otherwise close on the nearest
    const side0 = SIDE(u.team);
    const objs = u.ai.goal ? m.structures.filter((st) => st.objective && !st.destroyed && SIDE(st.team) !== side0) : [];
    if (objs.length && u.frame.kind !== 'turret') {
      if (structureValue(b, u) > 0 && aiAttackStructure(b, u)) { b.finishActivation(u); return; }
      let bt = objs[0].tiles[0], bd = Infinity;
      for (const st of objs) for (const ti of st.tiles) { const dd = dist(u.x, u.y, ti % m.w, (ti / m.w) | 0); if (dd < bd) { bd = dd; bt = ti; } }
      moveToward(b, u, bt % m.w, (bt / m.w) | 0, 'walk');
      if (structureValue(b, u) > 0) aiAttackStructure(b, u);
      b.finishActivation(u);
      return;
    }
    // Hunt: head for the last place anyone in the lance saw an enemy, else sweep toward their side
    let goal = u.ai.goal;
    if (!goal || u.tag === '' || u.tag === 'escort') {
      let best: [number, number, number] | null = null;
      for (const a of [u, ...b.alliesOf(u)]) for (const [, lk] of a.ai.lastKnown) if (!best || lk[2] > best[2]) best = lk;
      goal = best ? [best[0], best[1]] : (u.ai.goal ?? forceCentre(b, enemies));
    }
    if (u.frame.kind !== 'turret') moveToward(b, u, goal[0], goal[1], dist(u.x, u.y, goal[0], goal[1]) > 14 ? 'sprint' : 'walk');
    b.finishActivation(u);
    return;
  }

  // ---- Raiders commit to the objective: sprint in unless an enemy is right on top of them ----
  if (u.tag === 'raider' && u.ai.goal && u.frame.kind !== 'turret' && !u.cannotMove) {
    const [gx, gy] = u.ai.goal;
    const close = visible.some((e) => dist(u.x, u.y, e.x, e.y) <= 5);
    if (dist(u.x, u.y, gx, gy) > 12 && !close) {
      moveToward(b, u, gx, gy, 'sprint');
      b.finishActivation(u);
      return;
    }
  }

  // ---- Evaluate candidate positions -----------------------------------------------------
  const hp = unitHealth(u);
  const allies = b.alliesOf(u);
  const alliedStr = allies.length + 1, enemyStr = Math.max(1, known.length);
  // Standoff breaker: the longer nobody has fired, the bolder the AI gets
  const quiet = Math.max(0, b.round - (b.lastAttackRound ?? 0) - 1);
  let aggr = u.ai.aggression + (alliedStr / enemyStr - 1) * 0.15 - (1 - hp) * 0.25 + Math.min(0.35, quiet * 0.12);
  aggr = Math.max(0.2, Math.min(0.9, aggr));
  const pref = roleRange(b, u);
  const cands: Cand[] = [];
  const objStructs = u.ai.goal ? m.structures.filter((st) => st.objective && !st.destroyed && SIDE(st.team) !== side) : [];
  const cur = u.y * m.w + u.x;
  cands.push({ i: cur, mode: null, score: 0 });
  if (u.frame.kind !== 'turret' && !u.cannotMove) {
    for (const [i] of b.reachable(u, 'walk')) cands.push({ i, mode: 'walk', score: 0 });
    if (u.stats.jump > 0) for (const [i] of b.reachable(u, 'jump')) if (!cands.some((c) => c.i === i)) cands.push({ i, mode: 'jump', score: 0 });
    // Badly hurt units consider sprinting out of danger
    if (hp < 0.4) for (const [i] of b.reachable(u, 'sprint')) if (!cands.some((c) => c.i === i)) cands.push({ i, mode: 'sprint', score: 0 });
  }
  const heatRoom = u.frame.kind === 'mech' ? Math.max(0.35, Math.min(1, (u.stats.heatCap * 0.8 + b.dissipation(u) * 0.3 - u.heat) / Math.max(1, u.stats.alphaHeat))) : 1;
  let best: Cand | null = null;
  for (const c of cands) {
    const x = c.i % m.w, y = (c.i / m.w) | 0;
    const steps = c.mode === 'jump' ? Math.round(dist(u.x, u.y, x, y)) : Math.round(dist(u.x, u.y, x, y));
    const pips = c.mode ? b.pipsFor(u, c.mode, steps) : 0;
    const from = { x, y, moved: c.mode };
    let off = 0;
    let nearest = Infinity;
    if (c.mode !== 'sprint') for (const t of visible) {
      const ed = b.expectedDamage(u, t, from) * heatRoom;
      const v = ed * targetValue(b, { ...u, x, y } as Unit, t);
      if (v > off) off = v;
    }
    let nearT: Unit | null = null;
    for (const t of known) { const dd = dist(x, y, t.x, t.y); if (dd < nearest) { nearest = dd; nearT = t; } }
    // Objective pressure: raiders value positions that let them hit enemy objective structures
    if (objStructs.length && c.mode !== 'sprint') {
      let sev = 0;
      for (const st of objStructs) {
        let dmin = Infinity;
        for (const ti of st.tiles) dmin = Math.min(dmin, dist(x, y, ti % m.w, (ti / m.w) | 0));
        let e = 0;
        for (const wc of b.weaponsOf(u)) { const w = item(wc.id); if (dmin <= (w.lr ?? 0) && dmin >= (w.min ?? 0)) e += (w.dmg ?? 0) * (w.shots ?? 1) * 0.55; }
        sev = Math.max(sev, e);
      }
      off = Math.max(off, sev * 0.8);
    }
    const threat = threatAt(b, u, x, y, pips, known);
    const T = TERRAIN[m.terr[c.i]];
    // Rear exposure: enemies behind us once we turn to face the closest threat
    let exposure = 0;
    if (nearT && u.frame.kind !== 'turret') {
      const f = dirTo(x, y, nearT.x, nearT.y);
      for (const t of known) if (t !== nearT && dist(x, y, t.x, t.y) < 12 && attackArc({ x, y, facing: f }, t.x, t.y) === 'rear') exposure += 7;
    }
    let pos = -exposure + T.cover * 22 + m.elev[c.i] * 3.5 - Math.abs(nearest - pref) * 1.2;
    if (c.mode === 'jump') pos -= (steps * 3 + u.heat > u.stats.heatCap * 0.6 ? 10 : 2);
    if (c.mode === 'jump' && u.team === 0 && steps * 3 + u.heat > u.stats.heatCap * 0.75) continue; // autopilot never jumps into overheat
    if (T.cool > 0 && u.heat > 40) pos += T.cool * 0.4;
    // cohesion
    if (allies.length) {
      let dmin = Infinity;
      for (const a of allies) dmin = Math.min(dmin, dist(x, y, a.x, a.y));
      if (dmin > 10) pos -= (dmin - 10) * 0.8;
    }
    if (u.tag === 'target') pos -= Math.max(0, 12 - nearest) * 2; // assassination targets are timid
    if (u.tag === 'raider' && u.ai.goal) pos -= Math.max(0, dist(x, y, u.ai.goal[0], u.ai.goal[1]) - 6) * 2.2;
    if (u.tag === 'guard' && u.ai.goal) pos -= Math.max(0, dist(x, y, u.ai.goal[0], u.ai.goal[1]) - 7) * 1.5;
    if (u.tag === 'capper' && u.ai.goal) pos -= Math.max(0, dist(x, y, u.ai.goal[0], u.ai.goal[1]) - 1) * 2.5;
    // Once the objective is met, the player's lance (on autopilot) drifts back toward extraction
    const ex = b.map.extract;
    if (ex && u.team === 0) pos -= Math.max(0, dist(x, y, ex.x, ex.y) - ex.r + 0.5) * 3;
    c.score = off * aggr * 1.0 - threat * (1 - aggr) * (AI_OPTS.caution ? 0.6 : 0.35) + pos + b.rng.next() * 0.5;
    if (!best || c.score > best.score) best = c;
  }

  // ---- Melee options ----------------------------------------------------------------------
  if (u.frame.kind === 'mech' && !u.cannotMove) {
    for (const t of visible) {
      if (t.frame.kind === 'turret' && false) continue;
      for (const dfa of u.stats.jump > 0 ? [false, true] : [false]) {
        if (dist(u.x, u.y, t.x, t.y) > (dfa ? u.stats.jump : u.stats.walk) + 1.5) continue;
        if (dfa && u.team === 0 && u.heat + Math.round(dist(u.x, u.y, t.x, t.y)) * 3 > u.stats.heatCap * 0.75) continue; // the jump would overheat
        const spots = b.meleeSpots(u, t, dfa);
        if (!spots.size) continue;
        const hc = b.meleeChance(u, t, dfa);
        const dmg = dfa ? u.stats.dfaDmg : u.stats.meleeDmg;
        let v = (hc.chance / 100) * dmg * targetValue(b, u, t) * (dfa ? 0.85 : 1);
        // melee is attractive vs knocked-down / unsteady targets and for heavies
        if (t.unsteady) v *= 1.3;
        // Punch back at whoever is standing next to us
        if (dist(u.x, u.y, t.x, t.y) <= 1.5) v *= 1.6;
        let bestSpot = -1, bestS = -Infinity;
        for (const [i] of spots) {
          const x = i % m.w, y = (i / m.w) | 0;
          const s = -threatAt(b, u, x, y, 0, known) * (1 - aggr) * 0.35 + TERRAIN[m.terr[i]].cover * 10 + (attackArc(t, x, y) === 'rear' ? 12 : 0);
          if (s > bestS) { bestS = s; bestSpot = i; }
        }
        const score = v * aggr + bestS;
        if (best && score > best.score) best = { i: bestSpot, mode: dfa ? 'jump' : 'walk', score, melee: t, dfa };
      }
    }
  }

  if (!best) { b.finishActivation(u); return; }
  if (best.melee) {
    const t = best.melee;
    const spots = b.meleeSpots(u, t, !!best.dfa);
    const path = best.i === cur ? [] : b.pathTo(u, spots, best.i, best.dfa ? 'jump' : 'walk');
    b.melee(u, t, path, !!best.dfa);
    b.finishActivation(u);
    return;
  }
  if (best.mode && best.i !== cur) {
    const reach = b.reachable(u, best.mode);
    const path = b.pathTo(u, reach, best.i, best.mode);
    b.move(u, path, best.mode);
  }
  if (!u.alive) return;
  const visNow = b.enemiesOf(u).filter((e) => b.seen[side].has(e.id));
  const preferStruct = objStructs.length > 0 && structureValue(b, u) > 0 && (visNow.length === 0 || u.tag === 'raider' || b.rng.chance(0.45));
  const attacked = preferStruct ? aiAttackStructure(b, u) || aiAttack(b, u, visNow) : aiAttack(b, u, visNow) || aiAttackStructure(b, u);
  if (!attacked && u.alive) {
    // No shot: sensor lock, vigilance or brace; face the nearest threat
    const lockT = visNow.find((t) => t.pips >= 3);
    if (u.pilot?.abilities.includes('sensorlock') && lockT) b.sensorLock(u, lockT);
    // Only dig in when someone close could actually shoot back
    else if (hp < 0.55 && b.resolve[side] >= b.resolveCost() && threatAt(b, u, u.x, u.y, u.pips, known) > 20 && u.frame.kind === 'mech') b.vigilance(u);
    else if (u.frame.kind === 'mech' && (u.stab > u.stats.stabMax * 0.3 || (hp < 0.8 && threatAt(b, u, u.x, u.y, u.pips, known) > 10))) b.brace(u);
    const near = known.reduce((a, t) => (dist(u.x, u.y, t.x, t.y) < dist(u.x, u.y, a.x, a.y) ? t : a), known[0]);
    if (near && u.frame.kind === 'mech') b.setFacing(u, dirTo(u.x, u.y, near.x, near.y));
  }
  b.finishActivation(u);
}

/** Travel cost from every tile to (gx, gy) for this unit's movement rules, so units route around cliffs and basins. */
const flowCache = new WeakMap<Battle, Map<string, Float32Array>>();
function flowField(b: Battle, u: Unit, gx: number, gy: number): Float32Array {
  const m = b.map;
  let per = flowCache.get(b);
  if (!per) { per = new Map(); flowCache.set(b, per); }
  const key = `${u.frame.kind}:${gx},${gy}:${b.round}`;
  const hit = per.get(key);
  if (hit) return hit;
  const f = new Float32Array(m.w * m.h).fill(Infinity);
  const gi = gy * m.w + gx;
  f[gi] = 0;
  // Dijkstra outward from the goal; each step is costed as the unit moving toward the goal
  const open: number[] = [gi];
  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
    const i = open.splice(bi, 1)[0];
    const x = i % m.w, y = (i / m.w) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
      const c = b.moveCost(u, nx, ny, x, y);
      if (!isFinite(c)) continue;
      const ni = ny * m.w + nx;
      if (f[i] + c < f[ni]) { f[ni] = f[i] + c; open.push(ni); }
    }
  }
  if (per.size > 24) per.clear();
  per.set(key, f);
  return f;
}

/** Rough centre of a force: where to search when nothing has been seen yet. */
function forceCentre(b: Battle, us: Unit[]): [number, number] {
  const live = us.filter((u) => u.alive && !u.fled);
  if (!live.length) return [Math.floor(b.map.w / 2), Math.floor(b.map.h / 2)];
  return [Math.round(live.reduce((a, u) => a + u.x, 0) / live.length), Math.round(live.reduce((a, u) => a + u.y, 0) / live.length)];
}

function moveToward(b: Battle, u: Unit, gx: number, gy: number, mode: MoveMode): void {
  if (u.cannotMove || u.frame.kind === 'turret') return;
  const m = b.map;
  const reach = b.reachable(u, mode);
  const f = flowField(b, u, gx, gy);
  const here = f[u.y * m.w + u.x];
  // Follow the flow field when the goal is reachable on foot; otherwise fall back to straight-line progress
  const score = (i: number) => (isFinite(here) ? f[i] : dist(i % m.w, (i / m.w) | 0, gx, gy) + TERRAIN[m.terr[i]].cost * 0.05);
  let bi = -1, bd = isFinite(here) ? here : dist(u.x, u.y, gx, gy);
  for (const [i] of reach) { const d = score(i); if (d < bd) { bd = d; bi = i; } }
  if (bi < 0) return;
  b.move(u, b.pathTo(u, reach, bi, mode), mode);
}

/** Pick target + weapons within heat budget and fire. Returns true if an attack was made. */
export function aiAttack(b: Battle, u: Unit, visible: Unit[]): boolean {
  if (!b.canAttack(u) || !visible.length) return false;
  const side = SIDE(u.team);
  const weps = b.weaponsOf(u).filter((w) => b.hasAmmo(u, w));
  if (!weps.length) return false;
  let bestT: Unit | null = null, bestV = 0, bestW: Component[] = [];
  for (const t of visible) {
    const usable: [Component, number, number][] = [];
    for (const wc of weps) {
      const w = item(wc.id);
      const hc = b.hitChance(u, t, w);
      if (!hc.ok || hc.chance < 12) continue;
      usable.push([wc, (hc.chance / 100) * (w.dmg ?? 0) * (w.shots ?? 1), w.heat ?? 0]);
    }
    if (!usable.length) continue;
    const chosen = pickWithinHeat(b, u, usable, unitHealth(t) < 0.25);
    // Prefer targets that threaten us: adjacent brawlers and whoever can hurt us most
    const threat = dist(u.x, u.y, t.x, t.y) <= 1.5 ? 2.4 : 1 + Math.min(0.5, b.expectedDamage(t, u, t) / 250);
    const dmg = chosen.reduce((a, c) => a + c[1], 0);
    let kill = 1;
    if (AI_OPTS.killFocus) {
      // Weight toward shots that can finish a unit: compare expected damage to its weakest vital location
      const f = t.frame;
      const vitals = f.kind === 'mech' ? ['CT', 'HD', 'LT', 'RT', 'LL', 'RL'] : Object.keys(f.struct);
      const weakest = Math.min(...vitals.filter((l) => f.struct[l] > 0).map((l) => f.struct[l] + (f.armor[l] ?? 0) * (l === 'HD' ? 2.5 : 1) + (l === 'LT' || l === 'RT' || l === 'LL' || l === 'RL' ? 40 : 0)));
      kill = 1 + Math.max(0, Math.min(1, (dmg * 0.6) / Math.max(1, weakest))) * 0.8;
    }
    const ev = dmg * targetValue(b, u, t) * threat * kill;
    if (ev > bestV) { bestV = ev; bestT = t; bestW = chosen.map((c) => c[0]); }
  }
  if (!bestT || !bestW.length) return false;
  let called: string | undefined;
  if (u.frame.kind === 'mech' && b.resolve[side] >= b.resolveCost() && bestT.frame.kind === 'mech') {
    if (bestT.prone || bestT.shutdown) called = 'HD';
    else {
      // Only spend Resolve to finish a badly damaged torso
      const f = bestT.frame;
      const weak = ['CT', 'LT', 'RT'].filter((l) => f.struct[l] > 0 && (f.struct[l] + (f.armor[l] ?? 0)) < (f.maxStruct[l] + (f.maxArmor[l] ?? 0)) * 0.35);
      if (weak.length) called = weak.reduce((a, l) => (f.struct[l] + (f.armor[l] ?? 0) < f.struct[a] + (f.armor[a] ?? 0) ? l : a));
    }
    if (called) { b.resolve[side] -= b.resolveCost(); b.say(`${b.displayName(u)} uses PRECISION STRIKE on the ${called}.`, '#f0a830'); }
  }
  const plan: Assignment[] = [{ target: bestT, weapons: bestW }];
  b.attack(u, plan, called);
  return true;
}

function pickWithinHeat(b: Battle, u: Unit, usable: [Component, number, number][], finishing: boolean, strict = false): [Component, number, number][] {
  if (u.frame.kind !== 'mech') return usable;
  const cap = u.stats.heatCap;
  // Overheat damage is checked before dissipation, so the player's autopilot (and anyone shooting a building) stays at or under 75%
  strict ||= u.team === 0;
  const limit = strict ? cap * 0.75 - u.heat : (finishing ? cap * 0.95 : cap * 0.74) - u.heat + (finishing ? 0 : Math.min(15, b.dissipation(u) * 0.25));
  const sorted = [...usable].sort((a, c) => (c[1] / Math.max(1, c[2])) - (a[1] / Math.max(1, a[2])));
  const out: [Component, number, number][] = [];
  let heat = 0;
  for (const s of sorted) {
    if (s[2] === 0 || heat + s[2] <= limit) { out.push(s); heat += s[2]; }
  }
  if (!out.length && sorted.length && !strict) out.push(sorted[sorted.length - 1]);
  return out;
}

/** Shoot at the opposing side's objective structures when no unit targets are available. */
export function aiAttackStructure(b: Battle, u: Unit): boolean {
  if (!b.canAttack(u)) return false;
  const side = SIDE(u.team);
  const m = b.map;
  let best: { s: typeof m.structures[0]; w: Component[]; ev: number } | null = null;
  for (const s of m.structures) {
    if (s.destroyed || !s.objective || SIDE(s.team) === side) continue;
    const ws: Component[] = [];
    let ev = 0;
    for (const wc of b.weaponsOf(u)) {
      if (!b.hasAmmo(u, wc)) continue;
      const w = item(wc.id);
      const hc = b.hitChance(u, null, w, u, undefined, false, s);
      if (!hc.ok) continue;
      ws.push(wc);
      ev += (hc.chance / 100) * (w.dmg ?? 0) * (w.shots ?? 1);
    }
    if (ws.length && (!best || ev > best.ev)) best = { s, w: pickWithinHeat(b, u, ws.map((c) => [c, 1, item(c.id).heat ?? 0] as [Component, number, number]), false, true).map((x) => x[0]), ev };
  }
  if (!best || !best.w.length) return false;
  b.attack(u, [{ target: null, struct: best.s, weapons: best.w }]);
  return true;
}

function structureValue(b: Battle, u: Unit): number {
  const side = SIDE(u.team);
  let best = 0;
  for (const st of b.map.structures) {
    if (st.destroyed || !st.objective || SIDE(st.team) === side) continue;
    let ev = 0;
    for (const wc of b.weaponsOf(u)) { if (!b.hasAmmo(u, wc)) continue; const w = item(wc.id); const hc = b.hitChance(u, null, w, u, undefined, false, st); if (hc.ok) ev += (hc.chance / 100) * (w.dmg ?? 0) * (w.shots ?? 1); }
    best = Math.max(best, ev);
  }
  return best;
}
