import { RNG } from '../src/engine/rng';
import { setupMission, generateForce } from '../src/combat/missions';
import { aiTakeTurn } from '../src/combat/ai';
for (let i = 0; i < 6; i++) {
  const r = new RNG(40 + i);
  const rt = setupMission({ type: 'defendbase', difficulty: 4, biome: 'lowlands', seed: 100 + i, night: false, employer: 'davion', target: 'liao', player: generateForce(r, 4, 'davion', 4, { noVehicles: true }) });
  const b = rt.battle; b.start();
  let g = 0;
  while (!b.result && g++ < 3000) { const nx = b.advance(); if (nx.who === 'none') break; const u = nx.who === 'ai' ? nx.unit! : b.pending(0).find((x) => x.team === 0)!; aiTakeTurn(b, u); if (b.round > 30) b.finish('loss'); }
  const st = b.map.structures.filter((s) => s.objective);
  const turretDmg = b.units.filter((u) => u.team === 2).reduce((a, u) => a + u.dmgDealt, 0);
  console.log(b.result, 'rounds', b.round, 'structs', st.map((s) => `${Math.max(0, s.hp)}/${s.maxHp}`).join(' '), 'turret dmg', turretDmg);
}
