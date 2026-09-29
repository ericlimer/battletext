import { RNG } from '../src/engine/rng';
import { setupMission, generateForce } from '../src/combat/missions';
import { aiTakeTurn } from '../src/combat/ai';
import { cloneFrame } from '../src/game/frame';
const d = +(process.argv[2] ?? 2);
let pw = 0, ew = 0, n = 0, pdmg = 0, edmg = 0;
for (let i = 0; i < 16; i++) {
  const r = new RNG(500 + i);
  const A = generateForce(r, d, 'davion', 4, { noVehicles: true });
  const B = generateForce(r, d, 'liao', 4, { noVehicles: true });
  for (const swap of [false, true]) {
    const P = (swap ? B : A).map((c) => ({ frame: cloneFrame(c.frame), pilot: { ...c.pilot!, injuries: 0 } }));
    const E = (swap ? A : B).map((c) => ({ frame: cloneFrame(c.frame), pilot: { ...c.pilot!, injuries: 0 } }));
    const rt = setupMission({ type: 'battle', difficulty: d, biome: 'lowlands', seed: 900 + i, night: false, employer: 'davion', target: 'liao', player: P, enemies: E });
    const b = rt.battle; b.start();
    let g = 0;
    while (!b.result && g++ < 3000) { const nx = b.advance(); if (nx.who === 'none') break; const u = nx.who === 'ai' ? nx.unit! : b.pending(0).find((x) => x.team === 0)!; aiTakeTurn(b, u); if (b.round > 30) b.finish('withdraw'); }
    n++; if (b.result === 'win') pw++; else if (b.result === 'loss') ew++;
    pdmg += b.units.filter((u) => u.team === 0).reduce((a, u) => a + u.dmgDealt, 0);
    edmg += b.units.filter((u) => u.team === 1).reduce((a, u) => a + u.dmgDealt, 0);
  }
}
console.log(`d${d}: player wins ${pw}/${n}, enemy wins ${ew}/${n}, dmg dealt player ${pdmg} enemy ${edmg}`);
