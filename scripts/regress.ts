// Regression checks: node scripts/run.mjs scripts/regress.ts
import { RNG } from '../src/engine/rng';
import { setupMission, generateForce } from '../src/combat/missions';
import { aiTakeTurn } from '../src/combat/ai';
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
process.exit(fails ? 1 : 0);
