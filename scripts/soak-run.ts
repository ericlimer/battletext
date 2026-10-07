// Combat soak test: headless AI-vs-AI missions with invariant checks and balance telemetry.
//   node scripts/run.mjs scripts/soak-run.ts batch <start> <count> <mode: matched|calib> <out.jsonl>
//   node scripts/run.mjs scripts/soak-run.ts one <type> <diff> <biome> <seed> <night 0|1> <orient> <pdiff> <pseed>   (repro, verbose)
import fs from 'fs';
import { RNG } from '../src/engine/rng';
import { setupMission, generateForce, objectivesSummary, MissionType } from '../src/combat/missions';
import { aiTakeTurn } from '../src/combat/ai';
import { BIOMES, Biome, inb } from '../src/combat/terrain';
import { SIDE, Unit, Battle } from '../src/combat/battle';
import { frameStats, Frame } from '../src/game/frame';

const TYPES: MissionType[] = ['battle', 'assassinate', 'destroybase', 'defendbase', 'ambush', 'escort', 'capture'];
const CAP = 40;

interface Args { type: MissionType; diff: number; biome: Biome; seed: number; night: boolean; orient: number; pdiff: number; pseed: number; }

// Same math as survey.ts unitPower/fightOdds (copied: survey.ts pulls in the display layer)
function unitPower(f: Frame, gun: number) {
  const st = frameStats(f);
  const acc = Math.max(0.25, Math.min(0.95, (45 + gun * 3) / 100));
  return { fp: st.alphaDmg * acc, dur: st.armorTotal + st.structTotal };
}

function invariants(b: Battle, where: string, issues: Set<string>) {
  const occ = new Map<number, Unit>();
  for (const u of b.units) {
    const f = u.frame;
    for (const k of ['heat', 'stab', 'pips', 'x', 'y'] as const) if (!Number.isFinite((u as any)[k])) issues.add(`NaN:${k}`);
    for (const [k, v] of Object.entries(f.armor)) { if (!Number.isFinite(v)) issues.add(`NaN:armor`); else if (v < 0) issues.add(`negArmor:${f.kind}`); }
    for (const [k, v] of Object.entries(f.struct)) { if (!Number.isFinite(v)) issues.add(`NaN:struct`); else if (v < 0 && u.alive) issues.add(`negStructAlive:${f.kind}`); }
    if (!u.alive || !u.deployed || u.fled) continue;
    if (f.kind === 'mech') {
      if (f.struct.CT <= 0) issues.add('aliveWithDeadCT');
      if (f.struct.HD <= 0) issues.add('aliveWithDeadHD');
      if (f.struct.LL <= 0 && f.struct.RL <= 0) issues.add('aliveWithNoLegs');
    } else if (f.kind === 'vehicle') {
      if (Object.values(f.struct).some((v) => v <= 0)) issues.add('vehicleAliveWithDeadLoc');
    }
    if (!inb(b.map, u.x, u.y)) issues.add('offMap');
    const i = u.y * b.map.w + u.x;
    const o = occ.get(i);
    if (o) issues.add(`stacked:${SIDE(o.team) === SIDE(u.team) ? 'same' : 'opp'}`);
    occ.set(i, u);
    if (u.heat < 0) issues.add('negHeat');
    if (u.stab < 0) issues.add('negStab');
  }
}

function runOne(A: Args, verbose = false) {
  const t0 = Date.now();
  const rec: any = { ...A, result: '', rounds: 0, issues: [] as string[], err: null };
  const issues = new Set<string>();
  const hc = { hist: new Array(20).fill(0), floor: 0, cap95: 0, n: 0, floorPipsOnly: 0, floorWithPips: 0, floorNoPips: 0, pipsHist: new Array(8).fill(0), bands: {} as Record<string, number>, floorMods: {} as Record<string, number>, bySide: [0, 0], floorBySide: [0, 0], sumChance: [0, 0], melee: 0, meleeSum: 0, indirect: 0, hits: 0 };
  try {
    const pr = new RNG(A.pseed);
    const player = generateForce(pr, A.pdiff, 'davion', 4, { noVehicles: true });
    const rt = setupMission({ type: A.type, difficulty: A.diff, biome: A.biome, seed: A.seed, night: A.night, employer: 'davion', target: 'liao', player, basePay: 500000, orientation: A.orient } as any);
    const b = rt.battle;
    // Odds as the survey screen computes them
    let pf = 0, pd = 0, ef = 0, ed = 0;
    for (const u of rt.playerUnits) { const p = unitPower(u.frame, u.pilot?.gun ?? 3); pf += p.fp; pd += p.dur; }
    for (const u of b.units) { if (SIDE(u.team) !== 1 || u.tag === 'convoy') continue; const p = unitPower(u.frame, u.pilot?.gun ?? 3); ef += p.fp; ed += p.dur; }
    rec.ratio = Math.sqrt((pf * pd) / Math.max(1, ef * ed));
    rec.nEnemy = b.units.filter((u) => SIDE(u.team) === 1 && u.tag !== 'convoy').length;
    // Record every rolled ranged attack
    const orig = (b as any).fireAtUnit;
    (b as any).fireAtUnit = function (a: Unit, t: Unit, w: any, shots: number, h: any, ...rest: any[]) {
      const s = SIDE(a.team);
      hc.n++; hc.bySide[s]++; hc.sumChance[s] += h.chance;
      hc.hist[Math.min(19, Math.floor(h.chance / 5))]++;
      hc.bands[h.band] = (hc.bands[h.band] ?? 0) + 1;
      if (h.indirect) hc.indirect++;
      const pipMod = h.mods.filter((m: any) => String(m[0]).startsWith('Evasion')).reduce((x: number, m: any) => x + m[1], 0);
      hc.pipsHist[Math.min(7, Math.round(-pipMod / 8))]++;
      const raw = h.mods.reduce((x: number, m: any) => x + m[1], 0);
      if (h.chance >= 95) hc.cap95++;
      if (h.chance <= 5) {
        hc.floor++; hc.floorBySide[s]++;
        if (pipMod < 0 && raw - pipMod > 5) hc.floorPipsOnly++;
        if (pipMod < 0) hc.floorWithPips++; else hc.floorNoPips++;
        for (const [name, v] of h.mods) { if (v >= 0) continue; const k = String(name).replace(/[◆]+.*$/, '').replace(/\d+/g, '').trim(); hc.floorMods[k] = (hc.floorMods[k] ?? 0) + 1; }
      }
      return orig.call(this, a, t, w, shots, h, ...rest);
    };
    const origM = (b as any).meleeChance;
    (b as any).meleeChance = function (...xs: any[]) { const r = origM.apply(this, xs); hc.melee++; hc.meleeSum += r.chance; return r; };
    b.start();
    let steps = 0, same = 0, last: Unit | null = null;
    while (!b.result) {
      const n = b.advance();
      if (n.who === 'none') break;
      const u = n.who === 'ai' ? n.unit! : b.pending(0).find((x) => x.team === 0);
      if (!u) { issues.add('playerTurnButNoPending'); break; }
      if (u === last) { if (++same > 30) { issues.add(`stuckSameUnit:${u.frame.kind}:${u.tag}`); break; } } else { same = 0; last = u; }
      aiTakeTurn(b, u);
      if (!u.acted && u.alive && b.pending(null).includes(u) && same > 3) issues.add('activationNotConsumed');
      invariants(b, 'act', issues);
      if (++steps > 20000) { issues.add('stepGuard'); break; }
      if (b.round > CAP) { issues.add('roundCap40'); break; }
    }
    rec.result = b.result;
    rec.rounds = b.round;
    rec.stalemate = b.log.some((l) => l.text.startsWith('Neither side can make progress'));
    const sum = objectivesSummary(rt);
    rec.primaryOk = sum.primaryOk;
    rec.objectives = rt.objectives.map((o) => `${o.id}${o.primary ? '*' : ''}:${o.status}`);
    rec.extract = !!b.map.extract;
    if (!b.result && !issues.has('roundCap40') && !issues.has('stuckSameUnit')) issues.add('noResult');
    if (b.result === 'win' && !sum.primaryOk) issues.add('winButPrimaryNotDone');
    if (b.result === 'loss' && sum.primaryOk) issues.add('lossButPrimaryOk');
    if (b.result && rt.objectives.some((o) => o.primary && o.status === 'active' && o.id !== 'extract') && b.result !== 'withdraw') issues.add(`ended-${b.result}-withPrimaryActive`);
    const ex = rt.objectives.find((o) => o.id === 'extract');
    if (ex && b.result && ex.status === 'active') issues.add(`extractStuckActive-${b.result}`);
    if (b.result === 'withdraw' && sum.primaryOk) issues.add('withdrawButPrimaryOk');
    rec.pLost = rt.playerUnits.filter((u) => !u.alive).length;
    rec.eLost = rt.enemyUnits.filter((u) => !u.alive && u.tag !== 'convoy').length;
    if (A.type === 'escort') { const cv = b.units.filter((u) => u.tag === 'convoy'); rec.convoy = { n: cv.length, dead: cv.filter((u) => !u.alive).length, safe: cv.filter((u) => u.fled).length }; }
    if (A.type === 'ambush') { const cv = b.units.filter((u) => u.tag === 'convoy'); rec.convoy = { n: cv.length, dead: cv.filter((u) => !u.alive).length, fled: cv.filter((u) => u.fled).length }; }
    if (A.type === 'assassinate') rec.targetFled = !!rt.enemyUnits.find((u) => u.tag === 'target')?.fled;
    if (verbose) { for (const l of b.log.slice(-25)) console.log(`r${l.round} ${l.text}`); console.log(rt.objectives); }
  } catch (e: any) {
    rec.err = { msg: String(e?.message ?? e), stack: String(e?.stack ?? '').split('\n').slice(0, 6).join(' | ') };
  }
  rec.issues = [...issues];
  rec.hc = hc;
  rec.ms = Date.now() - t0;
  return rec;
}

function argsFor(i: number, mode: string): Args {
  if (mode === 'escort') {
    const r = new RNG(77001 + i * 7919);
    return { type: 'escort', diff: 1 + (i % 8), biome: BIOMES[r.int(0, BIOMES.length - 1)], seed: 300000 + i * 17, night: ((i >> 6) & 1) === 1, orient: (i >> 3) % 8, pdiff: 1 + (i % 8), pseed: 9000 + i * 37 };
  }
  const r = new RNG(9001 + i * 7919 + (mode === 'calib' ? 555555 : 0));
  const type = TYPES[i % 7];
  const k = Math.floor(i / 7);
  const diff = 1 + (k % 8);
  const orient = Math.floor(k / 8) % 8;
  const night = (Math.floor(k / 64) + i) % 2 === 1;
  const biome = BIOMES[r.int(0, BIOMES.length - 1)];
  const delta = mode === 'calib' ? r.pick([-3, -2, -1, 0, 1, 2, 3]) : 0;
  return { type, diff, biome, seed: 100000 + i * 13 + (mode === 'calib' ? 7 : 0), night, orient, pdiff: Math.max(1, Math.min(8, diff + delta)), pseed: 5000 + i * 31 + (mode === 'calib' ? 3 : 0) };
}

const cmd = process.argv[2];
if (cmd === 'batch') {
  const start = +process.argv[3], count = +process.argv[4], mode = process.argv[5], out = process.argv[6];
  const fd = fs.openSync(out, 'w');
  for (let i = start; i < start + count; i++) {
    const rec = runOne(argsFor(i, mode));
    rec.i = i; rec.mode = mode;
    fs.writeSync(fd, JSON.stringify(rec) + '\n');
  }
  fs.closeSync(fd);
} else if (cmd === 'one') {
  const [type, diff, biome, seed, night, orient, pdiff, pseed] = process.argv.slice(3);
  const rec = runOne({ type: type as MissionType, diff: +diff, biome: biome as Biome, seed: +seed, night: night === '1', orient: +orient, pdiff: +pdiff, pseed: +pseed }, true);
  delete rec.hc;
  console.log(JSON.stringify(rec, null, 1));
}
