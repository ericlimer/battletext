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
  while (b.round < 2 && g++ < 500) { const n = b.advance(); const u = n.who === 'ai' ? n.unit! : b.pending(0).find((x) => x.team === 0)!; aiTakeTurn(b, u); }
  const moved = rt.playerUnits.filter((u) => u.alive && u.moved);
  check(moved.length === 0, `round 2 start: no player unit carries last round's movement (${moved.length})`);
  check(rt.playerUnits.every((u) => !u.alive || !u.attacked), 'round 2 start: no player unit carries last round\'s attack');
}
process.exit(fails ? 1 : 0);
