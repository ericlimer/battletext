// Convoy mission diagnostics: node scripts/run.mjs scripts/convoy.ts <type> <n> <diff>
import { RNG } from '../src/engine/rng';
import { setupMission, generateForce, MissionType } from '../src/combat/missions';
import { aiTakeTurn } from '../src/combat/ai';
import { BIOMES } from '../src/combat/terrain';
const type = (process.argv[2] ?? 'escort') as MissionType, N = +(process.argv[3] ?? 6), diff = +(process.argv[4] ?? 4);
for (let i = 0; i < N; i++) {
  const r = new RNG(1000 + i);
  const player = generateForce(r, diff, 'davion', 4, { noVehicles: true });
  const rt = setupMission({ type, difficulty: diff, biome: BIOMES[i % BIOMES.length], seed: 77 + i, night: false, employer: 'davion', target: 'liao', player, basePay: 500000 });
  const b = rt.battle; b.start();
  let g = 0;
  while (!b.result && g++ < 2000) { const n = b.advance(); if (n.who === 'none') break; const u = n.who === 'ai' ? n.unit! : b.pending(0).find((x) => x.team === 0)!; aiTakeTurn(b, u); if (b.round > 30) b.finish('loss'); }
  const cv = b.units.filter((u) => u.tag === 'convoy');
  console.log(`#${i} ${b.result} r${b.round} convoy: ${cv.map((u) => (u.fled ? 'ESC' : u.alive ? `${u.x},${u.y}` : 'dead')).join(' ')} | ${rt.objectives.map((o) => `${o.id}:${o.status}${o.progress ? '(' + o.progress + ')' : ''}`).join(' ')}`);
}
