// Headless career bot: plays a full career with AI-controlled combat to validate the economy.
// node scripts/run.mjs scripts/career-sim.ts [seed] [verbose]
import { maxSlider, sellPrice, newCompany, advanceDay, maxContractDiff, mechReady, sys, startTravel, queueRepair, assembleMech, PARTS_NEEDED, monthlyExpenses, mrbLevel, careerScore, bays, negotiate, rngOf } from '../src/game/company';
import { launchContract, resolveContract, claimSalvage } from '../src/game/aftermath';
import { aiTakeTurn } from '../src/combat/ai';
import { isAvailable, trainSkill, SKILLS, xpCost } from '../src/game/pilot';
import { frameTons, isFrameDamaged, newMechFrame, repairEstimate } from '../src/game/frame';
import { chassis } from '../src/data/mechs';
import { route } from '../src/game/world';

const seed = +(process.argv[2] ?? 7);
const verbose = process.argv.includes('v');
const c = newCompany({ name: 'Sim Co', commander: 'Bot', callsign: 'Bot', background: 'davion', seed, hard: false, ironman: false });
let lastReport = 0;
const res: Record<string, number> = {};
let guard = 0;
let repairSpend = 0, income = 0, wrecks = 0, lostM = 0;
while (!c.gameOver && guard++ < 5000) {
  // Assemble any complete part sets
  for (const [id, n] of Object.entries(c.parts)) if (n >= PARTS_NEEDED && c.mechs.length + c.storage.length < bays(c) + 4) assembleMech(c, id);
  // Train pilots greedily (gunnery first)
  for (const p of c.pilots) for (const s of ['gun', 'pil', 'tac', 'gut'] as const) while (p[s] < 10 && p.xp >= xpCost(p[s]) && trainSkill(p, s) !== 'Not enough experience') { /* */ }
  // Buy replacement 'Mechs when short and flush
  if (!c.travel && c.mechs.length < 4) {
    const st = c.stores[c.location] ?? [];
    const m = st.filter((x) => x.kind === 'mech' && x.qty > 0 && c.funds - x.price > monthlyExpenses(c).total).sort((a, b) => a.price - b.price)[0];
    if (m) { c.funds -= m.price; m.qty--; c.mechs.push(newMechFrame(m.id)); if (verbose) console.log('bought', m.id, m.price); }
    const pt = st.filter((x) => x.kind === 'part' && x.qty > 0 && (c.parts[x.id] ?? 0) + x.qty >= PARTS_NEEDED && c.funds - x.price * x.qty > monthlyExpenses(c).total * 2)[0];
    if (pt) { while (pt.qty > 0) { c.funds -= pt.price; pt.qty--; c.parts[pt.id] = (c.parts[pt.id] ?? 0) + 1; } }
  }
  // Sell surplus salvage (keep a couple of spares)
  if (!c.travel) for (const [id, n] of Object.entries(c.inventory)) if (n > 2) { c.funds += sellPrice(c, id) * (n - 2); c.inventory[id] = 2; }
  // Hire when short of pilots
  if (!c.travel) {
    const living = c.pilots.filter((p) => !p.dead);
    const hires = (c.hires[c.location] ?? []).sort((a, b) => (a.hireCost ?? 0) - (b.hireCost ?? 0));
    while (living.length < Math.max(4, c.mechs.length) && hires.length && c.funds - (hires[0].hireCost ?? 0) > monthlyExpenses(c).total * 1.5) {
      const p = hires.shift()!; c.funds -= p.hireCost ?? 0; c.pilots.push(p); living.push(p);
      c.hires[c.location] = hires;
      if (verbose) console.log('hired', p.callsign);
    }
  }
  // Repair anything damaged
  for (const m of c.mechs) if (isFrameDamaged(m) && c.funds - repairEstimate(m).cost > monthlyExpenses(c).total) { const q = queueRepair(c, m); if (q) repairSpend += q.cost; }
  const ready = c.mechs.filter((m) => mechReady(c, m)).sort((a, b) => frameTons(b) - frameTons(a));
  const pilots = c.pilots.filter(isAvailable).sort((a, b) => b.gun + b.pil - (a.gun + a.pil));
  const n = Math.min(4, ready.length, pilots.length);
  if (!c.travel && (n >= 3 || (n === 2 && c.mechs.length <= 2))) {
    const lanceTons = ready.slice(0, n).reduce((a, m) => a + frameTons(m), 0);
    const cap = n < 3 ? 1 : Math.max(1, Math.min(maxContractDiff(c), Math.round((lanceTons / n - 22) / 7.2) + 1));
    const ks = (c.contracts[c.location] ?? []).filter((k) => k.diff <= cap && ['battle', 'ambush', 'assassinate', 'escort'].includes(k.type)).sort((a, b) => b.diff - a.diff || b.pay - a.pay);
    const k = ks[0];
    if (k) {
      const neg = negotiate(k, Math.min(4, maxSlider(c, k)));
      const lance = ready.slice(0, n).map((m, i) => ({ mech: m, pilot: pilots[i] }));
      const hc = process.argv.includes('h');
      if (hc) for (const l of lance) { l.pilot.gun += 2; l.pilot.pil += 1; }
      const rt = launchContract(c, k, lance);
      const b = rt.battle;
      b.start();
      let g = 0;
      while (!b.result && g++ < 3000) {
        const nx = b.advance();
        if (nx.who === 'none') break;
        const u = nx.who === 'ai' ? nx.unit! : b.pending(0).find((x) => x.team === 0)!;
        aiTakeTurn(b, u);
        const lost = b.units.filter((x) => x.team === 0 && !x.alive).length;
        if ((lost >= 1 && b.withdrawIn < 0 && rt.enemyUnits.filter((e) => e.alive).length > 1) || b.round > 25) b.withdraw();
      }
      if (hc) for (const l of lance) { l.pilot.gun -= 2; l.pilot.pil -= 1; }
      const r = resolveContract(c, k, neg, rt);
      for (let dd = 0; dd < r.days; dd++) advanceDay(c);
      income += r.pay + r.bonus; repairSpend += r.repairCost; wrecks += r.mechsLost.filter((x) => x.includes('hauled')).length; lostM += r.mechsLost.filter((x) => x.includes('could not')).length;
      if (r.pool.length) {
        const picks = r.pool.map((e, i) => ({ e, i, v: e.value * (e.kind === 'part' && ((c.parts[e.id] ?? 0) > 0 || c.mechs.some((m) => m.defId === e.id)) ? 2 : 1) })).sort((a, b) => b.v - a.v).map((x) => x.i).slice(0, r.priority);
        claimSalvage(c, r.pool, picks.slice(0, r.salvageShares));
      }
      const key = `${k.type}:${r.outcome}`;
      res[key] = (res[key] ?? 0) + 1;
      if (verbose) {
        console.log(`day ${c.day} ${k.type} d${k.diff} ${r.outcome} rounds ${b.round} pay ${r.pay + r.bonus} repairs ${r.repairCost} funds ${c.funds} mechsLeft ${c.mechs.length}`);
        for (const u of b.units) console.log(`   t${u.team} ${u.frame.defId.padEnd(10)} ${u.alive ? 'alive' : 'DEAD:' + u.destroyHow} dealt ${u.dmgDealt} taken ${u.dmgTaken} deploy r${u.deployRound}`);
      }
      continue;
    }
  }
  // Nothing to do here: if no suitable contracts, travel somewhere with similar difficulty
  if (!c.travel) {
    const k = c.contracts[c.location] ?? [];
    const cap = maxContractDiff(c);
    const good = k.some((x) => x.diff <= cap && ['battle', 'ambush', 'assassinate', 'escort'].includes(x.type));
    if (!good && n >= 2) {
      const cand = c.systems.filter((s) => s.id !== c.location && s.diff <= cap + 1).map((s) => ({ s, r: route(c.systems, c.location, s.id) })).filter((x) => x.r).sort((a, b) => a.r!.days - b.r!.days);
      if (cand[0]) startTravel(c, cand[0].s.id);
    }
  }
  const rep = advanceDay(c);
  if (rep.event) void rngOf(c);
  if (c.day - lastReport >= 120) {
    lastReport = c.day;
    console.log(`day ${String(c.day).padStart(4)} | funds ${String(Math.round(c.funds / 1000)).padStart(6)}K | burn ${Math.round(monthlyExpenses(c).total / 1000)}K | mechs ${c.mechs.length}+${c.storage.length} (${c.mechs.map((m) => chassis(m.defId).tons).join(',')}) | pilots ${c.pilots.filter((p) => !p.dead).length} | MRB ${mrbLevel(c)} | W/L ${c.stats.wins}/${c.stats.missions} | at ${sys(c).name} d${sys(c).diff}`);
  }
}
console.log(`income ${Math.round(income/1000)}K repairs ${Math.round(repairSpend/1000)}K wrecks ${wrecks} lost ${lostM} missions ${c.stats.missions}`);
console.log('END', c.gameOver, 'day', c.day, 'score', careerScore(c), 'funds', c.funds);
console.log(res);
