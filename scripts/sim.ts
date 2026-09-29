// Headless AI-vs-AI battles for balance testing: node scripts/run.mjs scripts/sim.ts [n] [type] [diff]
import { RNG } from '../src/engine/rng';
import { setupMission, generateForce, MissionType } from '../src/combat/missions';
import { aiTakeTurn } from '../src/combat/ai';
import { BIOMES } from '../src/combat/terrain';
import { frameName } from '../src/game/frame';

const N = +(process.argv[2] ?? 20);
const types = (process.argv[3] ?? 'battle,assassinate,destroybase,defendbase,ambush,escort').split(',') as MissionType[];
const diff = +(process.argv[4] ?? 4);
const res: Record<string, number> = {};
let rounds = 0, t0 = Date.now(), errors = 0, deaths = 0, crits = 0, knock = 0, shut = 0, ammo = 0;
for (let i = 0; i < N; i++) {
  const r = new RNG(1000 + i);
  const type = types[i % types.length];
  const player = generateForce(r, diff, 'davion', 4, { noVehicles: true });
  const rt = setupMission({ type, difficulty: diff, biome: BIOMES[i % BIOMES.length], seed: 77 + i, night: i % 7 === 3, employer: 'davion', target: 'liao', player, basePay: 500000 });
  const b = rt.battle;
  try {
    b.start();
    let guard = 0;
    while (!b.result && guard++ < 2000) {
      const n = b.advance();
      if (n.who === 'none') break;
      const u = n.who === 'ai' ? n.unit! : b.pending(0).find((x) => x.team === 0)!;
      aiTakeTurn(b, u);
      if (b.round > 30) { b.finish('loss'); }
    }
  } catch (e) { errors++; console.error(type, e); }
  const key = `${type}:${b.result}`;
  res[key] = (res[key] ?? 0) + 1;
  rounds += b.round;
  for (const l of b.log) {
    if (l.text.startsWith('CRIT')) crits++;
    if (l.text.includes('knocked down')) knock++;
    if (l.text.includes('SHUT DOWN')) shut++;
    if (l.text.includes('AMMO EXPLOSION')) ammo++;
  }
  deaths += b.units.filter((u) => u.team === 0 && !u.alive).length;
  if (i === 0) for (const l of b.log.slice(0, 60)) console.log(`  [r${l.round}] ${l.text}`);
}
console.log(res);
console.log(`avg rounds ${(rounds / N).toFixed(1)}, player units lost/battle ${(deaths / N).toFixed(2)}, crits ${(crits / N).toFixed(1)}, knockdowns ${(knock / N).toFixed(1)}, shutdowns ${(shut / N).toFixed(1)}, ammo booms ${(ammo/N).toFixed(2)}, errors ${errors}, ${((Date.now() - t0) / N).toFixed(0)}ms/battle`);
