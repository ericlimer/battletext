// Map generator statistics: impassable share per archetype, walking connectivity, path detours, jump shortcuts.
//   node scripts/run.mjs scripts/mapstats.ts [count=320] [style|all] [dump]
// 'dump' prints one ASCII map per archetype (pre-rotation is not available: maps are shown as played).
import { RNG } from '../src/engine/rng';
import { setupMission, generateForce, MissionType } from '../src/combat/missions';
import { BIOMES, MAP_STYLES, MapStyle, TERRAIN, BattleMap, setMapStyleOverride, walkComponents, dist, inb, DIRS } from '../src/combat/terrain';
import { SIDE, Unit, Battle } from '../src/combat/battle';

const TYPES: MissionType[] = ['battle', 'assassinate', 'destroybase', 'defendbase', 'ambush', 'escort', 'capture'];
const N = +(process.argv[2] ?? 320);
const only = process.argv[3] && process.argv[3] !== 'all' ? (process.argv[3] as MapStyle) : null;
const dump = process.argv.includes('dump');

/** Dijkstra in steps for a unit's walking rules; optional jump edges of range J (cost = distance). */
function paths(b: Battle, u: Unit, sx: number, sy: number, J = 0): Float32Array {
  const m = b.map;
  const d = new Float32Array(m.w * m.h).fill(Infinity);
  const s = sy * m.w + sx;
  d[s] = 0;
  const open = [s];
  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (d[open[k]] < d[open[bi]]) bi = k;
    const i = open[bi]; open[bi] = open[open.length - 1]; open.pop();
    const x = i % m.w, y = (i / m.w) | 0;
    const relax = (j: number, c: number) => { if (d[i] + c < d[j]) { d[j] = d[i] + c; open.push(j); } };
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (!inb(m, nx, ny)) continue;
      if (dx && dy && !isFinite(TERRAIN[m.terr[y * m.w + nx]].cost) && !isFinite(TERRAIN[m.terr[ny * m.w + x]].cost)) continue;
      const c = b.moveCost(u, x, y, nx, ny);
      if (isFinite(c)) relax(ny * m.w + nx, dx && dy ? 1.41 : 1);
    }
    if (J > 0) for (let yy = y - J; yy <= y + J; yy++) for (let xx = x - J; xx <= x + J; xx++) {
      if (!inb(m, xx, yy)) continue;
      const dd = dist(x, y, xx, yy);
      if (dd > J + 0.01 || dd < 1.5) continue;
      const j = yy * m.w + xx;
      if (!isFinite(TERRAIN[m.terr[j]].cost) || m.terr[j] === 'deep') continue;
      relax(j, dd + 1); // a jump costs a little extra (heat, no evasion bonus from walking)
    }
  }
  return d;
}

interface Acc { n: number; chasm: number; imp: number; shelf: number; fail: number; multi: number; road: number; walk: number; straight: number; jump: number; pairs: number; unreach: number }
const acc = new Map<string, Acc>();
const get = (k: string) => { let a = acc.get(k); if (!a) { a = { n: 0, chasm: 0, imp: 0, shelf: 0, fail: 0, multi: 0, road: 0, walk: 0, straight: 0, jump: 0, pairs: 0, unreach: 0 }; acc.set(k, a); } return a; };
const fails: string[] = [];
const dumped = new Set<string>();

function ascii(m: BattleMap): string {
  const G: Record<string, string> = { plain: '.', rough: ',', lforest: 't', hforest: 'T', water: '~', deep: '=', rock: '#', road: ':', building: 'B', rubble: '%', wall: 'W', chasm: ' ' };
  let s = '';
  for (let y = 0; y < m.h; y++) { for (let x = 0; x < m.w; x++) { const i = y * m.w + x; const t = m.terr[i]; s += t === 'plain' || t === 'rough' ? (m.elev[i] === 3 ? '^' : m.elev[i] === 2 ? '/' : G[t]) : G[t]; } s += '\n'; }
  return s;
}

for (let k = 0; k < N; k++) {
  const style = only ?? MAP_STYLES[k % MAP_STYLES.length];
  setMapStyleOverride(style);
  const type = TYPES[Math.floor(k / MAP_STYLES.length) % TYPES.length];
  const biome = BIOMES[Math.floor(k / (MAP_STYLES.length * TYPES.length)) % BIOMES.length];
  const seed = 5000 + k * 101;
  const rt = setupMission({ type, difficulty: 1 + (k % 8), biome, seed, night: false, employer: 'davion', target: 'liao', player: generateForce(new RNG(seed + 1), 4, 'davion', 4, { noVehicles: true }), basePay: 100000, orientation: k % 8 } as any);
  const b = rt.battle, m = b.map;
  const a = get(m.style ?? '?');
  a.n++;
  let imp = 0, shelf = 0, chasm = 0;
  for (let i = 0; i < m.w * m.h; i++) { if (!isFinite(TERRAIN[m.terr[i]].cost)) { imp++; if (m.terr[i] === "chasm") chasm++; } else if (m.style !== 'open' && m.elev[i] === 3) shelf++; }
  a.imp += imp / (m.w * m.h); a.shelf += shelf / (m.w * m.h); a.chasm += chasm / (m.w * m.h);
  const { comp, sizes } = walkComponents(m);
  if (sizes.length > 1) a.multi++;
  // Every deployed ground unit must share a walking component
  const us = b.units.filter((u) => u.frame.kind !== 'turret');
  const c0 = comp[us[0].y * m.w + us[0].x];
  const bad = us.filter((u) => comp[u.y * m.w + u.x] !== c0);
  if (bad.length) { a.fail++; fails.push(`${m.style} ${type} ${biome} seed ${seed} orient ${k % 8}: ${bad.length} units cut off`); }
  // Convoy road: drivable edge to edge for a vehicle
  const convoy = b.units.find((u) => u.tag === 'convoy');
  if (convoy) {
    const goal = convoy.ai.goal;
    if (goal) { const d = paths(b, convoy, convoy.x, convoy.y); let best = Infinity; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (inb(m, goal[0] + dx, goal[1] + dy)) best = Math.min(best, d[(goal[1] + dy) * m.w + goal[0] + dx]); if (!isFinite(best)) { a.road++; fails.push(`${m.style} ${type} ${biome} seed ${seed}: convoy can't reach its exit`); } }
  }
  // Player-to-enemy walking distance vs straight line, and with jump jets (range 5)
  const p = rt.playerUnits.find((u) => u.frame.kind === 'mech');
  const es = rt.enemyUnits.filter((u) => u.frame.kind !== 'turret' && u.tag !== 'convoy');
  if (p && es.length) {
    const dw = paths(b, p, p.x, p.y), dj = paths(b, p, p.x, p.y, 5);
    for (const e of es) {
      const i = e.y * m.w + e.x;
      if (!isFinite(dw[i])) { a.unreach++; continue; }
      a.walk += dw[i]; a.jump += dj[i]; a.straight += dist(p.x, p.y, e.x, e.y); a.pairs++;
    }
  }
  if (dump && !dumped.has(m.style!)) { dumped.add(m.style!); console.log(`--- ${m.style} (${biome}, ${type}, seed ${seed})\n${ascii(m)}`); }
}
setMapStyleOverride(null);
console.log('style       maps  impass% (chasm)  shelf%  cut-off  multiComp  roadFail  walk/straight  jump/walk  unreachPairs');
let total = 0;
for (const [k, a] of [...acc].sort()) {
  total += a.fail + a.road + a.unreach;
  console.log(`${k.padEnd(10)} ${String(a.n).padStart(5)} ${(100 * a.imp / a.n).toFixed(1).padStart(8)} ${("(" + (100 * a.chasm / a.n).toFixed(1) + ")").padStart(7)} ${(100 * a.shelf / a.n).toFixed(1).padStart(7)} ${String(a.fail).padStart(8)} ${String(a.multi).padStart(10)} ${String(a.road).padStart(9)} ${(a.walk / Math.max(1, a.straight)).toFixed(2).padStart(14)} ${(a.jump / Math.max(1, a.walk)).toFixed(2).padStart(10)} ${String(a.unreach).padStart(13)}`);
}
for (const f of fails.slice(0, 20)) console.log('FAIL ' + f);
console.log(total ? `${total} connectivity failures` : 'connectivity: all ok');

// How often each archetype comes up when nothing forces it
import { generateMap } from '../src/combat/terrain';
console.log('\nrandom picks per biome (400 maps each):');
for (const biome of BIOMES) {
  const n: Record<string, number> = {};
  for (let s = 0; s < 400; s++) { const m = generateMap(new RNG(s * 7919 + 1), { w: 64, h: 44, biome, clear: [] }); n[m.style!] = (n[m.style!] ?? 0) + 1; }
  console.log(`  ${biome.padEnd(10)} ` + Object.entries(n).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round(v / 4)}%`).join(', '));
}
