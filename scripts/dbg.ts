import { newCompany, negotiate } from '../src/game/company';
import { launchContract } from '../src/game/aftermath';
import { aiTakeTurn } from '../src/combat/ai';
import { frameName } from '../src/game/frame';
const c = newCompany({ name: 'Sim Co', commander: 'Bot', callsign: 'Bot', background: 'davion', seed: +(process.argv[2] ?? 8), hard: false, ironman: false });
const ks = c.contracts[c.location];
const k = ks.find((x) => x.type === 'battle') ?? ks[0];
console.log('contract', k.type, 'diff', k.diff);
const lance = c.mechs.map((m, i) => ({ mech: m, pilot: c.pilots[i] }));
const rt = launchContract(c, k, lance);
const b = rt.battle;
for (const u of b.units) console.log(u.team, frameName(u.frame), u.pilot?.gun, u.pilot?.pil, u.x, u.y, 'deploy', u.deployRound);
b.start();
let g = 0;
while (!b.result && g++ < 3000) {
  const nx = b.advance();
  if (nx.who === 'none') break;
  const u = nx.who === 'ai' ? nx.unit! : b.pending(0).find((x) => x.team === 0)!;
  aiTakeTurn(b, u);
  if (b.round > 25) b.finish('withdraw');
}
console.log('result', b.result, 'round', b.round);
for (const u of b.units) console.log(u.team, frameName(u.frame), u.alive ? 'ALIVE' : 'dead:' + u.destroyHow, 'dealt', u.dmgDealt, 'taken', u.dmgTaken, 'kills', u.kills);
const logs = b.log.filter((l) => /destroyed|incapacitated|ejects|EXPLOSION|disabled/.test(l.text));
for (const l of logs.slice(0, 30)) console.log(`[r${l.round}] ${l.text}`);
