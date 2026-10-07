// Aggregate soak-run.ts JSONL output: node scripts/soak-report.mjs file1.jsonl [file2 ...]
import fs from 'fs';
const recs = process.argv.slice(2).flatMap((f) => fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)));
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(0) + '%' : '-');
const med = (xs) => { if (!xs.length) return '-'; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const repro = (r) => `one ${r.type} ${r.diff} ${r.biome} ${r.seed} ${r.night ? 1 : 0} ${r.orient} ${r.pdiff} ${r.pseed}`;
console.log(`missions: ${recs.length} (matched ${recs.filter((r) => r.mode === 'matched').length}, calib ${recs.filter((r) => r.mode === 'calib').length}); mean ${(recs.reduce((a, r) => a + r.ms, 0) / recs.length / 1000).toFixed(2)}s each`);

console.log('\n== Errors ==');
const errs = new Map();
for (const r of recs) if (r.err) { const k = r.err.msg + ' @ ' + (r.err.stack.split(' | ')[1] ?? '').trim(); const e = errs.get(k) ?? { n: 0, r, types: new Set() }; e.n++; e.types.add(r.type); errs.set(k, e); }
for (const [k, e] of errs) console.log(`${e.n}x [${[...e.types]}] ${k}\n   repro: ${repro(e.r)}\n   ${e.r.err.stack}`);
console.log('\n== Issues ==');
const iss = new Map();
for (const r of recs) for (const i of r.issues) { const e = iss.get(i) ?? { n: 0, r, types: {} }; e.n++; e.types[r.type] = (e.types[r.type] ?? 0) + 1; iss.set(i, e); }
for (const [k, e] of [...iss].sort((a, b) => b[1].n - a[1].n)) console.log(`${String(e.n).padStart(4)} ${k.padEnd(34)} ${JSON.stringify(e.types)}  repro: ${repro(e.r)}`);
const stal = recs.filter((r) => r.stalemate);
console.log(`stalemate withdrawals: ${stal.length} ${JSON.stringify(stal.reduce((a, r) => ((a[r.type] = (a[r.type] ?? 0) + 1), a), {}))}${stal[0] ? '  e.g. ' + repro(stal[0]) : ''}`);

const M = recs.filter((r) => r.mode === 'matched' && !r.err);
const TYPES = ['battle', 'assassinate', 'destroybase', 'defendbase', 'ambush', 'escort', 'capture'];
console.log('\n== Matched lance (player force at contract difficulty): win% / median rounds ==');
console.log('type'.padEnd(12) + [1, 2, 3, 4, 5, 6, 7, 8].map((d) => `d${d}`.padStart(10)).join('') + '     all   W/L/Wd/cap');
for (const t of TYPES) {
  const row = [1, 2, 3, 4, 5, 6, 7, 8].map((d) => { const xs = M.filter((r) => r.type === t && r.diff === d); return `${pct(xs.filter((r) => r.result === 'win').length, xs.length)}/${med(xs.map((r) => r.rounds))}`.padStart(10); }).join('');
  const xs = M.filter((r) => r.type === t);
  const c = (f) => xs.filter(f).length;
  console.log(t.padEnd(12) + row + `${pct(c((r) => r.result === 'win'), xs.length)}`.padStart(8) + `   ${c((r) => r.result === 'win')}/${c((r) => r.result === 'loss')}/${c((r) => r.result === 'withdraw')}/${c((r) => !r.result)}`);
}
const rounds = M.map((r) => r.rounds);
console.log(`rounds overall: p10 ${q(rounds, 0.1)} p25 ${q(rounds, 0.25)} median ${q(rounds, 0.5)} p75 ${q(rounds, 0.75)} p90 ${q(rounds, 0.9)} max ${Math.max(...rounds)}`);
for (const t of TYPES) { const xs = M.filter((r) => r.type === t).map((r) => r.rounds); console.log(`  ${t.padEnd(12)} p25 ${q(xs, 0.25)} med ${q(xs, 0.5)} p75 ${q(xs, 0.75)} p90 ${q(xs, 0.9)}`); }
console.log(`player 'Mechs lost per mission (matched): mean ${(M.reduce((a, r) => a + (r.pLost ?? 0), 0) / M.length).toFixed(2)}`);
console.log('  by diff: ' + [1, 2, 3, 4, 5, 6, 7, 8].map((d) => { const xs = M.filter((r) => r.diff === d); return `d${d} ${(xs.reduce((a, r) => a + (r.pLost ?? 0), 0) / xs.length).toFixed(2)}`; }).join('  '));

console.log('\n== Escort ==');
for (const d of [1, 2, 3, 4, 5, 6, 7, 8]) {
  const xs = recs.filter((r) => r.type === 'escort' && r.diff === d && !r.err && r.mode === 'matched');
  const f = xs.filter((r) => r.result === 'loss').length;
  const avgDead = xs.reduce((a, r) => a + (r.convoy?.dead ?? 0), 0) / Math.max(1, xs.length);
  const lanceAlive = xs.filter((r) => r.result === 'loss' && r.objectives.some((o) => o.startsWith('escort') && o.endsWith('failed'))).length;
  console.log(`d${d}: n=${xs.length} fail ${pct(f, xs.length)} (convoy-killed ${lanceAlive}), withdraw ${xs.filter((r) => r.result === 'withdraw').length}, avg haulers lost ${avgDead.toFixed(2)}/${xs[0]?.convoy?.n}, all-safe ${pct(xs.filter((r) => r.convoy?.dead === 0 && r.result === 'win').length, xs.length)}`);
}
const ass = recs.filter((r) => r.type === 'assassinate' && r.mode === 'matched');
console.log(`assassinate: target escaped in ${pct(ass.filter((r) => r.targetFled).length, ass.length)}`);
const amb = recs.filter((r) => r.type === 'ambush' && r.mode === 'matched');
console.log(`ambush: losses ${pct(amb.filter((r) => r.result === 'loss').length, amb.length)}, avg convoy fled ${(amb.reduce((a, r) => a + (r.convoy?.fled ?? 0), 0) / amb.length).toFixed(2)}`);

console.log('\n== Hit chances (all rolled ranged attacks, all missions) ==');
const H = { hist: new Array(20).fill(0), n: 0, floor: 0, cap95: 0, floorPipsOnly: 0, floorWithPips: 0, floorNoPips: 0, pipsHist: new Array(8).fill(0), bands: {}, floorMods: {}, bySide: [0, 0], floorBySide: [0, 0], sumChance: [0, 0], melee: 0, meleeSum: 0, indirect: 0 };
for (const r of recs) { const h = r.hc; if (!h) continue; for (const k of ['n', 'floor', 'cap95', 'floorPipsOnly', 'floorWithPips', 'floorNoPips', 'melee', 'meleeSum', 'indirect']) H[k] += h[k]; for (let i = 0; i < 20; i++) H.hist[i] += h.hist[i]; for (let i = 0; i < 8; i++) H.pipsHist[i] += h.pipsHist[i]; for (const s of [0, 1]) { H.bySide[s] += h.bySide[s]; H.floorBySide[s] += h.floorBySide[s]; H.sumChance[s] += h.sumChance[s]; } for (const [k, v] of Object.entries(h.bands)) H.bands[k] = (H.bands[k] ?? 0) + v; for (const [k, v] of Object.entries(h.floorMods)) H.floorMods[k] = (H.floorMods[k] ?? 0) + v; }
console.log(`weapon rolls ${H.n}; at 5% floor ${pct(H.floor, H.n)} (player side ${pct(H.floorBySide[0], H.bySide[0])}, enemy ${pct(H.floorBySide[1], H.bySide[1])}); at 95% cap ${pct(H.cap95, H.n)}; indirect ${pct(H.indirect, H.n)}`);
console.log(`mean chance: player side ${(H.sumChance[0] / H.bySide[0]).toFixed(1)}%, enemy side ${(H.sumChance[1] / H.bySide[1]).toFixed(1)}%; melee rolls ${H.melee} mean ${(H.meleeSum / Math.max(1, H.melee)).toFixed(1)}%`);
console.log('histogram (5% bins): ' + H.hist.map((v, i) => `${i * 5}:${pct(v, H.n)}`).join(' '));
console.log('target evasion pips at roll: ' + H.pipsHist.map((v, i) => `${i}:${pct(v, H.n)}`).join(' '));
console.log('range band: ' + Object.entries(H.bands).map(([k, v]) => `${k} ${pct(v, H.n)}`).join(', '));
console.log(`floor rolls: with evasion ${pct(H.floorWithPips, H.floor)}, would be >5% without evasion ${pct(H.floorPipsOnly, H.floor)}, no evasion at all ${pct(H.floorNoPips, H.floor)}`);
console.log('negative mods present on floor rolls: ' + Object.entries(H.floorMods).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v, H.floor)}`).join(', '));

console.log('\n== Odds calibration (survey fightOdds ratio vs simulated win rate) ==');
const bands = [['badly outgunned <0.65', 0, 0.65], ['outgunned 0.65-0.85', 0.65, 0.85], ['even 0.85-1.1', 0.85, 1.1], ['favourable 1.1-1.35', 1.1, 1.35], ['strongly fav >=1.35', 1.35, 99]];
const A = recs.filter((r) => !r.err && r.ratio);
console.log('band'.padEnd(24) + 'all'.padStart(12) + TYPES.map((t) => t.slice(0, 7).padStart(9)).join(''));
for (const [name, lo, hi] of bands) {
  const xs = A.filter((r) => r.ratio >= lo && r.ratio < hi);
  console.log(name.padEnd(24) + `${pct(xs.filter((r) => r.result === 'win').length, xs.length)} n${xs.length}`.padStart(12) + TYPES.map((t) => { const ys = xs.filter((r) => r.type === t); return `${pct(ys.filter((r) => r.result === 'win').length, ys.length)}/${ys.length}`.padStart(9); }).join(''));
}
console.log('fine bins (all types): ' + [0.3, 0.5, 0.65, 0.75, 0.85, 1, 1.1, 1.25, 1.35, 1.6, 2, 3, 99].map((hi, i, arr) => { const lo = i ? arr[i - 1] : 0; const xs = A.filter((r) => r.ratio >= lo && r.ratio < hi); return `<${hi}: ${pct(xs.filter((r) => r.result === 'win').length, xs.length)}(${xs.length})`; }).join('  '));
console.log('ratio distribution (matched): ' + [0.1, 0.25, 0.5, 0.75, 0.9].map((p) => q(M.map((r) => r.ratio), p).toFixed(2)).join(' / '));
console.log('median ratio by type (matched): ' + TYPES.map((t) => `${t} ${med(M.filter((r) => r.type === t).map((r) => r.ratio)).toFixed(2)}`).join(', '));
