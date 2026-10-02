// A/B the AI: flag on for one team, off for the other, across force swaps and AI swaps.
// node scripts/run.mjs scripts/ab.ts <flag> <difficulty> <seeds>
import { RNG } from '../src/engine/rng';
import { setupMission, generateForce } from '../src/combat/missions';
import { aiTakeTurn, AI_OPTS } from '../src/combat/ai';
import { cloneFrame } from '../src/game/frame';
const flag = process.argv[2] as keyof typeof AI_OPTS;
const d = +(process.argv[3] ?? 3), N = +(process.argv[4] ?? 12);
let nw = 0, ow = 0, n = 0;
for (let i = 0; i < N; i++) {
  const r = new RNG(500 + i);
  const A = generateForce(r, d, 'davion', 4, { noVehicles: true });
  const B = generateForce(r, d, 'liao', 4, { noVehicles: true });
  for (const swap of [false, true]) for (const newTeam of [0, 1]) {
    const P = (swap ? B : A).map((c) => ({ frame: cloneFrame(c.frame), pilot: { ...c.pilot!, injuries: 0 } }));
    const E = (swap ? A : B).map((c) => ({ frame: cloneFrame(c.frame), pilot: { ...c.pilot!, injuries: 0 } }));
    const rt = setupMission({ type: 'battle', difficulty: d, biome: 'lowlands', seed: 900 + i, night: false, employer: 'davion', target: 'liao', player: P, enemies: E });
    const b = rt.battle; b.start();
    let g = 0;
    while (!b.result && g++ < 3000) {
      const nx = b.advance(); if (nx.who === 'none') break;
      const u = nx.who === 'ai' ? nx.unit! : b.pending(0).find((x) => x.team === 0)!;
      (AI_OPTS as any)[flag] = (u.team === 0 ? 0 : 1) === newTeam;
      aiTakeTurn(b, u);
      if (b.round > 30) b.finish('withdraw');
    }
    n++;
    const t0won = b.result === 'win', t1won = b.result === 'loss';
    if ((newTeam === 0 && t0won) || (newTeam === 1 && t1won)) nw++;
    else if (t0won || t1won) ow++;
  }
}
console.log(`${flag} d${d}: NEW wins ${nw}/${n}, OLD wins ${ow}/${n}`);
