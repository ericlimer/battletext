// Regression checks: node scripts/run.mjs scripts/regress.ts
import { RNG } from '../src/engine/rng';
import { setupMission, generateForce, objectivesSummary } from '../src/combat/missions';
import { aiTakeTurn } from '../src/combat/ai';
import { COLORS as PILOT_COLORS, COMMANDER_COLOR } from '../src/game/pilot';
let fails = 0;
const check = (ok: boolean, msg: string) => { if (!ok) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
// A player unit that moved in round 1 must be free to move again in round 2
{
  const r = new RNG(5);
  const rt = setupMission({ type: 'battle', difficulty: 3, biome: 'lowlands', seed: 21, night: false, employer: 'davion', target: 'liao', player: generateForce(r, 3, 'davion', 4, { noVehicles: true }) });
  const b = rt.battle; b.start();
  let g = 0;
  while (g++ < 500) { const n = b.advance(); if (b.round >= 2) break; const u = n.who === 'ai' ? n.unit! : b.pending(0).find((x) => x.team === 0)!; aiTakeTurn(b, u); }
  const moved = rt.playerUnits.filter((u) => u.alive && u.moved);
  check(moved.length === 0, `round 2 start: no player unit carries last round's movement (${moved.length})`);
  check(rt.playerUnits.every((u) => !u.alive || !u.attacked), 'round 2 start: no player unit carries last round\'s attack');
}
// Melee and DFA events carry the target's armour before and after, for the attack view's record sheet
{
  const r = new RNG(7);
  const rt = setupMission({ type: 'battle', difficulty: 3, biome: 'lowlands', seed: 9, night: false, employer: 'davion', target: 'liao', player: generateForce(r, 3, 'davion', 4, { noVehicles: true }) });
  const b = rt.battle; b.start();
  const a = rt.playerUnits[0], t = rt.enemyUnits.find((u) => u.frame.kind === 'mech')!;
  t.x = a.x + 1; t.y = a.y;
  let hitSeen = false;
  for (let i = 0; i < 8 && t.alive; i++) {
    a.attacked = false;
    b.melee(a, t, [], i % 2 === 1);
    const e = b.events.filter((x) => x.k === 'melee').pop() as any;
    check(!!(e && e.arm0 && e.arm && e.str0 && e.str), `melee ${i}: event carries before/after armour`);
    if (e?.hit) { hitSeen = true; const lost = Object.keys(e.arm0).reduce((s, k) => s + e.arm0[k] - e.arm[k], 0) + Object.keys(e.str0).reduce((s, k) => s + Math.max(0, e.str0[k]) - Math.max(0, e.str[k]), 0); check(lost > 0, `melee ${i}: a hit shows up as lost armour/structure (${lost})`); }
  }
  check(hitSeen, 'melee: at least one blow landed in 8 tries');
}
// Meeting the objective with hostiles left opens an extraction zone; the lance wins by reaching it
{
  const r = new RNG(11);
  const rt = setupMission({ type: 'assassinate', difficulty: 3, biome: 'lowlands', seed: 31, night: false, employer: 'davion', target: 'liao', player: generateForce(r, 3, 'davion', 4, { noVehicles: true }) });
  const b = rt.battle; b.start();
  const tg = rt.enemyUnits.find((u) => u.tag === 'target')!;
  tg.alive = false;
  b.check();
  check(!b.result && !!b.map.extract, 'assassinate: target down with escorts alive opens extraction, mission continues');
  check(rt.objectives.some((o) => o.id === 'extract' && o.primary && o.status === 'active'), 'assassinate: extraction is a primary objective');
  const ex = b.map.extract!;
  for (const u of rt.playerUnits) { u.x = ex.x; u.y = ex.y; }
  b.check();
  check(b.result === 'win' && rt.objectives.find((o) => o.id === 'extract')!.status === 'done', 'assassinate: whole lance in the zone wins');
}
// Turned maps keep each unit's recorded drop point in step with where it actually stands
for (let o = 0; o < 8; o++) {
  const rt = setupMission({ type: 'capture', difficulty: 3, biome: 'lowlands', seed: 62, orientation: o, night: false, employer: 'davion', target: 'liao', player: generateForce(new RNG(3), 3, 'davion', 4, { noVehicles: true }) } as any);
  const off = rt.playerUnits.filter((u) => u.x !== u.startX || u.y !== u.startY).length;
  check(off === 0, `orientation ${o}: drop points follow the turned map (${off} off)`);
}
// A lance wiped out during extraction still gets paid: the objective was met
{
  const rt = setupMission({ type: 'assassinate', difficulty: 3, biome: 'lowlands', seed: 31, night: false, employer: 'davion', target: 'liao', player: generateForce(new RNG(11), 3, 'davion', 4, { noVehicles: true }) });
  const b = rt.battle; b.start();
  rt.enemyUnits.find((u) => u.tag === 'target')!.alive = false;
  b.check();
  for (const u of rt.playerUnits) u.alive = false;
  b.check();
  check(b.result === 'win' && objectivesSummary(rt).primaryOk, `assassinate: wiped during extraction still pays (${b.result})`);
}// Escort: wiping out the opposing force completes the contract without waiting for the haulers to drive off
{
  const rt = setupMission({ type: 'escort', difficulty: 3, biome: 'lowlands', seed: 44, night: false, employer: 'davion', target: 'liao', player: generateForce(new RNG(12), 3, 'davion', 4, { noVehicles: true }) });
  const b = rt.battle; b.start();
  for (const u of rt.enemyUnits) { u.deployed = true; if (u.tag !== 'convoy') u.alive = false; }
  b.check();
  check(b.result === 'win' && objectivesSummary(rt).primaryOk, `escort: opfor wiped out completes the contract (${b.result})`);
}

// Pilot colours stay out of the enemy red/orange band; the player's autopilot never cooks its own 'Mechs; an attacker is named once it fires
{
  const hue = (h: string) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx === mn) return -1; const d = mx - mn; const x = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (x * 60 + 360) % 360; };
  const bad = [...PILOT_COLORS, COMMANDER_COLOR].filter((c) => { const h = hue(c); return h >= 0 && (h < 45 || h > 340); });
  check(!bad.length, `pilot colours avoid the enemy red/orange hues (${bad.join(' ')})`);
  let cooked = 0;
  for (const [i, type] of (['destroybase', 'battle', 'defendbase'] as const).entries()) {
    const rt = setupMission({ type, difficulty: 4, biome: 'desert', seed: 90 + i, night: false, employer: 'davion', target: 'liao', player: generateForce(new RNG(40 + i), 4, 'davion', 4, { noVehicles: true }), basePay: 500000 } as any);
    const b = rt.battle; b.start(); let g = 0;
    while (!b.result && g++ < 1500 && b.round <= 12) { const n = b.advance(); if (n.who === 'none') break; const u = n.who === 'ai' ? n.unit! : b.pending(0).find((x) => x.team === 0)!; const l0 = b.log.length, hot = u.heat > u.stats.heatCap * 0.75; aiTakeTurn(b, u); if (u.team === 0 && !hot && b.log.slice(l0).some((l) => l.text.includes('internal heat damage'))) cooked++; }
  }
  check(cooked === 0, `autopilot: no self-inflicted heat damage on the player's side (${cooked}; enemy flamers aside)`);
  const rt = setupMission({ type: 'battle', difficulty: 3, biome: 'lowlands', seed: 9, night: true, employer: 'davion', target: 'liao', player: generateForce(new RNG(7), 3, 'davion', 4, { noVehicles: true }) });
  const b = rt.battle; b.start();
  const a = rt.enemyUnits.find((u) => u.frame.kind === 'mech')!, t = rt.playerUnits[0];
  b.seen[0].delete(a.id);
  const before = b.displayName(a);
  a.x = t.x + 1; a.y = t.y; b.melee(a, t, [], false); b.seen[0].delete(a.id);
  check(before === 'Unknown contact' && b.displayName(a) !== 'Unknown contact', `attacking reveals the attacker's name (${before} → ${b.displayName(a)})`);
}

// Assassination progress ("round N of 9") is refreshed as each round starts, before anyone acts
{
  const rt = setupMission({ type: 'assassinate', difficulty: 3, biome: 'lowlands', seed: 31, night: false, employer: 'davion', target: 'liao', player: generateForce(new RNG(11), 3, 'davion', 4, { noVehicles: true }) });
  const b = rt.battle; b.start();
  let g = 0;
  while (!b.result && g++ < 800 && b.round < 3) { const n = b.advance(); if (n.who === 'none' || b.round >= 3) break; aiTakeTurn(b, n.who === 'ai' ? n.unit! : b.pending(0).find((x) => x.team === 0)!); }
  const o = rt.objectives.find((x) => x.id === 'target')!;
  check(b.round < 3 || b.result !== '' || o.status !== 'active' || !!o.progress?.includes(`round ${b.round} of 9`) || !!o.progress?.startsWith('ESCAPING'), `assassinate: progress matches the round at round start (r${b.round}: ${o.progress})`);
}

process.exit(fails ? 1 : 0);
