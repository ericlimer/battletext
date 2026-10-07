// Career soak test: drives a bot through a full career (1200 days or game over), round-tripping the company
// through the real save/load path every few days, checking invariants daily and fuzzing every event choice.
// node scripts/run.mjs scripts/soak-career-run.ts <seed> [hard] [iron] [boost=N] [bg=id] [rt=N] [exp=N]
// Prints one JSON line (prefixed SOAK ) with issues and metrics.

// ---- localStorage polyfill so save.ts runs unchanged
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };

import { Company, maxSlider, sellPrice, newCompany, advanceDay, maxContractDiff, mechReady, startTravel, queueRepair, assembleMech, assembleFee, PARTS_NEEDED, monthlyExpenses, mrbLevel, bays, negotiate, rngOf, saveRng, morale, UPGRADES, has, healMult, pilotCap, CAREER_DAYS } from '../src/game/company';
import { launchContract, resolveContract, claimSalvage, employerCut } from '../src/game/aftermath';
import { EVENTS, pickEvent, resolveChoice, EventCtx } from '../src/game/events';
import { saveGame, loadGame, saveBackup } from '../src/game/save';
import { aiTakeTurn } from '../src/combat/ai';
import { isAvailable, trainSkill, xpCost, health, ROLES } from '../src/game/pilot';
import { frameTons, isFrameDamaged, newMechFrame, repairEstimate } from '../src/game/frame';
import { CHASSIS } from '../src/data/mechs';
import { route } from '../src/game/world';
import { RNG } from '../src/engine/rng';

const argv = process.argv.slice(2);
const seed = +(argv[0] ?? 1);
const hard = argv.includes('hard'), ironman = argv.includes('iron');
const opt = (k: string, d: number) => { const a = argv.find((x) => x.startsWith(k + '=')); return a ? +a.split('=')[1] : d; };
const boost = opt('boost', 2), rtEvery = opt('rt', 7), expLevel = opt('exp', 2);
const bg = (argv.find((x) => x.startsWith('bg=')) ?? 'bg=davion').slice(3);

// ---- issue collection
const issues = new Map<string, { n: number; first: string; detail: string }>();
function issue(key: string, detail: string, day: number) {
  const e = issues.get(key);
  if (e) e.n++; else issues.set(key, { n: 1, first: `seed ${seed}${hard ? ' hard' : ''}${ironman ? ' iron' : ''} day ${day}`, detail: detail.slice(0, 400) });
}
const bad = (v: unknown) => typeof v !== 'number' || !Number.isFinite(v);

const woSeen = new Map<string, number>();
const bookedSeen = new Map<string, string>(), played = new Set<string>();
function check(c: Company, where: string) {
  const d = c.day;
  if (bad(c.funds)) issue('funds-nan', `${where}: funds=${c.funds}`, d);
  if (bad(c.mrb) || c.mrb < 0) issue('mrb-bad', `${where}: mrb=${c.mrb}`, d);
  if (bad(c.moraleMod) || bad(morale(c))) issue('morale-nan', `${where}: moraleMod=${c.moraleMod}`, d);
  for (const [k, v] of Object.entries(c.rep)) if (bad(v)) issue('rep-nan', `${where}: rep ${k}=${v}`, d);
  for (const [k, v] of Object.entries(c.parts)) { if (bad(v) || v < 0 || !Number.isInteger(v)) issue('parts-bad', `${where}: parts ${k}=${v}`, d); if (!CHASSIS.some((ch) => ch.id === k)) issue('parts-unknown-chassis', `${k}`, d); }
  for (const [k, v] of Object.entries(c.inventory)) if (bad(v) || v < 0 || !Number.isInteger(v)) issue('inventory-bad', `${where}: inv ${k}=${v}`, d);
  for (const db of c.debts ?? []) if (bad(db.amount) || bad(db.day)) issue('debt-nan', JSON.stringify(db), d);
  for (const p of c.pilots) {
    if (p.dead) continue;
    if (bad(p.healDays) || p.healDays < 0) issue('healdays-bad', `${where}: ${p.callsign} healDays=${p.healDays}`, d);
    if (bad(p.injuries) || p.injuries < 0) issue('injuries-bad', `${where}: ${p.callsign} injuries=${p.injuries}`, d);
    if (p.injuries > 0 && p.healDays <= 0) issue('injured-no-healdays', `${where}: ${p.callsign} injuries=${p.injuries} healDays=${p.healDays} (never heals: advanceDay only clears at healDays<=0 after decrement… check)`, d);
    if (p.injuries === 0 && p.healDays > 0) issue('healdays-without-injury', `${where}: ${p.callsign} healDays=${p.healDays}`, d);
    if (p.injuries > health(p)) issue('injuries-over-health', `${where}: ${p.callsign} ${p.injuries}/${health(p)}`, d);
    if (bad(p.xp) || p.xp < 0) issue('xp-bad', `${where}: ${p.callsign} xp=${p.xp}`, d);
    for (const s of ['gun', 'pil', 'gut', 'tac'] as const) if (bad(p[s]) || p[s] < 1 || p[s] > 10) issue('skill-range', `${where}: ${p.callsign} ${s}=${p[s]}`, d);
  }
  const uids = new Set([...c.mechs, ...c.storage].map((m) => m.uid));
  if (uids.size !== c.mechs.length + c.storage.length) issue('mech-dup-uid', where, d);
  for (const m of [...c.mechs, ...c.storage]) {
    for (const [k, v] of Object.entries(m.armor)) if (bad(v) || v < 0) issue('armor-bad', `${where}: ${m.defId} armor ${k}=${v}`, d);
    for (const [k, v] of Object.entries(m.struct)) if (bad(v) || v < 0) issue('struct-bad', `${where}: ${m.defId} struct ${k}=${v}`, d);
    for (const it of m.items) if (it.ammo !== undefined && (bad(it.ammo) || it.ammo < 0)) issue('ammo-bad', `${where}: ${m.defId} ${it.id} ammo=${it.ammo}`, d);
  }
  for (const u of c.lance) if (u && !c.mechs.some((m) => m.uid === u)) issue('lance-missing-mech', `${where}: lance uid ${u} not in active mechs${c.storage.some((m) => m.uid === u) ? ' (in storage)' : ''}`, d);
  for (const id of c.lancePilots) { if (!id) continue; const p = c.pilots.find((q) => q.id === id); if (!p) issue('lancepilot-missing', `${where}: ${id}`, d); else if (p.dead) issue('lancepilot-dead', `${where}: ${p.callsign}`, d); }
  for (const w of c.work) {
    if (!uids.has(w.mechUid)) issue('workorder-orphan', `${where}: ${w.kind} ${w.desc} hours ${w.hours}`, d);
    if (bad(w.hours) || w.hours <= 0) issue('workorder-hours-bad', `${where}: ${w.desc} ${w.hours}`, d);
    if (!woSeen.has(w.id)) woSeen.set(w.id, d);
    else if (d - woSeen.get(w.id)! > 120) issue('workorder-stale-120d', `${where}: ${w.kind} ${w.desc} hours left ${w.hours}/${w.total}, queue ${c.work.length}`, d);
  }
  for (const [sid, ks] of Object.entries(c.contracts)) for (const k of ks) if (k.booked) bookedSeen.set(k.id, `${k.name} d${k.diff} at ${sid} expires ${k.expires}`);
  for (const [id, desc] of bookedSeen) if (!Object.values(c.contracts).some((ks) => ks.some((k) => k.id === id)) && !played.has(id)) { issue('booked-contract-vanished', `${where}: ${desc}, day ${c.day}`, d); bookedSeen.delete(id); }
  const board = c.contracts[c.location] ?? [];
  for (const k of [...(c.travel ? [] : board), ...(c.travelOffers ?? [])]) {
    if (bad(k.pay) || k.pay <= 0) issue('contract-pay-bad', `${where}: ${k.name} pay=${k.pay}`, d);
    if (bad(k.salvageMax) || k.salvageMax < 0) issue('contract-salvage-bad', `${k.name} ${k.salvageMax}`, d);
    if (k.diff < 1 || k.diff > 10 || bad(k.diff)) issue('contract-diff-bad', `${k.name} ${k.diff}`, d);
    if (k.expires <= c.day && !k.booked && !(c.travelOffers ?? []).includes(k)) issue('contract-expired-on-board', `${where}: ${k.name} expires ${k.expires} day ${c.day}`, d);
  }
  if (c.pilots.filter((p) => !p.dead).length > pilotCap(c)) issue('pilots-over-cap', `${c.pilots.filter((p) => !p.dead).length}/${pilotCap(c)}`, d);
  if (c.mechs.length > bays(c)) issue('mechs-over-bays', `${c.mechs.length}/${bays(c)}`, d);
  if (!c.pilots.some((p) => p.id === c.commanderId && !p.dead)) issue('commander-missing-or-dead', where, d);
}

// ---- metrics
const M = {
  seed, hard, ironman, boost, bg, end: '', endDay: 0, funds: [] as number[], missions: 0, wins: 0, deaths: 0, deserted: 0,
  wounds: [] as [number, number][], injuredPilotDays: 0, alivePilotDays: 0, partsGained: {} as Record<string, number>, assembled: 0,
  partsSold: 0, maxGapDays: 0, loans: 0, events: 0, eventFuzz: 0, roundtrips: 0, mrbEnd: 0, upgrades: [] as string[], peakFunds: 0, minFunds: 0,
  mechsLost: 0, partsAtEnd: {} as Record<string, number>, ledgerMonths: 0, idleDays: 0, firstNegDay: -1,
  outcomes: {} as Record<string, number>, recoveries: [] as number[], noContractDays: 0, noContractStreak: 0, maxNoContractStreak: 0,
  chassisWithParts: 0, chassisReached3: 0, travelDays: 0, eventInjuries: [] as number[],
};
const chSeen = new Set<string>(), ch3 = new Set<string>();
const injuredSince = new Map<string, number>();
function giveRoles(c: Company) { for (const p of c.pilots) if (!p.dead && !p.role) p.role = ROLES[(p.id.length * 7 + p.callsign.charCodeAt(0)) % ROLES.length].id; }

function roundtrip(c: Company, why: string): Company {
  const before = JSON.stringify(c);
  saveGame(c);
  const c2 = loadGame();
  M.roundtrips++;
  if (!c2) { issue('load-null', `${why}: loadGame returned null`, c.day); return c; }
  // carry the live RNG state (rngOf caches per object; save.ts persists rngState only)
  const after = JSON.stringify({ ...c2, fixes: undefined });
  const b2 = JSON.stringify({ ...JSON.parse(before), fixes: undefined });
  if (after !== b2) {
    // find the differing top-level keys
    const A = JSON.parse(after), B = JSON.parse(b2);
    const keys = Object.keys({ ...A, ...B }).filter((k) => JSON.stringify(A[k]) !== JSON.stringify(B[k]));
    const diffs: string[] = [];
    const walk = (a: any, b: any, path: string) => {
      if (diffs.length > 6) return;
      if (JSON.stringify(a) === JSON.stringify(b)) return;
      if (a && b && typeof a === 'object' && typeof b === 'object') { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], `${path}.${k}`); return; }
      diffs.push(`${path}: ${JSON.stringify(b)?.slice(0, 80)} -> ${JSON.stringify(a)?.slice(0, 80)}`);
    };
    for (const k of keys) walk(A[k], B[k], k);
    issue('load-mutates:' + keys.join(','), `${why}: ${diffs.join(' | ')}`, c.day);
  }
  if (c2.log.length !== c.log.length || c2.funds !== c.funds) issue('fix-applied-in-sim', `${c2.fixes} funds ${c.funds}->${c2.funds} log ${c.log.length}->${c2.log.length}`, c.day);
  for (const f of c.fixes ?? []) if (!(c2.fixes ?? []).includes(f)) issue('fix-id-lost', f, c.day);
  if (!(c2.fixes ?? []).length) issue('fixes-empty-after-load', '', c.day);
  for (const p of c.pilots) { const q = c2.pilots.find((x) => x.id === p.id); if (!q) issue('pilot-lost-in-roundtrip', p.callsign, c.day); else if (q.role !== p.role) issue('role-lost-in-roundtrip', `${p.callsign} ${p.role}->${q.role}`, c.day); }
  if (!!c.pendingSalvage !== !!c2.pendingSalvage) issue('pendingSalvage-roundtrip', '', c.day);
  return c2;
}

function fuzzEvents(c: Company) {
  const bs = new Map(bookedSeen);
  const alive = c.pilots.filter((p) => !p.dead);
  if (alive.length < 2) return;
  for (const ev of EVENTS) {
    for (let ci = 0; ci < ev.choices.length; ci++) {
      for (let rs = 0; rs < 3; rs++) {
        const cc: Company = JSON.parse(JSON.stringify(c));
        const al = cc.pilots.filter((p) => !p.dead);
        const r = new RNG(seed * 1000 + c.day * 7 + rs);
        const f = ev.focus ? ev.focus(r.shuffle([...al])) : al[0];
        if (!f) continue;
        const ctx: EventCtx = { pilot: f, pilot2: al.find((p) => p !== f)!, sysName: 'X' };
        if (ev.weight && ev.weight(cc) <= 0) continue;
        try {
          ev.text(cc, ctx);
          if (ev.choices[ci].req?.(cc, ctx)) continue;
          const out = ev.choices[ci].apply(cc, ctx, r);
          if (/NaN|undefined|Infinity/.test(out)) issue(`event-text:${ev.id}#${ci}`, out, c.day);
          M.eventFuzz++;
          woSeen.clear(); bookedSeen.clear(); for (const [a, b] of bs) bookedSeen.set(a, b);
          check(cc, `event ${ev.id}#${ci}`);
          // advance a few days to make sure the result is stable
          for (let i = 0; i < 3; i++) advanceDay(cc);
          check(cc, `event ${ev.id}#${ci} +3d`);
        } catch (e) { issue(`event-throw:${ev.id}#${ci}`, String((e as Error).stack).split('\n').slice(0, 3).join(' '), c.day); }
      }
    }
  }
  woSeen.clear(); bookedSeen.clear(); for (const [a, b] of bs) bookedSeen.set(a, b);
}

function handleEvent(c: Company, where: 'travel' | 'docked') {
  const r = rngOf(c);
  const e = pickEvent(c, r, where);
  saveRng(c, r);
  if (!e) return;
  M.events++;
  const ok = e.ev.choices.map((ch, i) => (ch.req?.(c, e.ctx) ? -1 : i)).filter((i) => i >= 0);
  if (!ok.length) { issue(`event-no-choice:${e.ev.id}`, 'every choice requires something', c.day); return; }
  const i = ok[(c.day * 31 + seed) % ok.length];
  const alive = c.pilots.filter((p) => !p.dead).length, debtsBefore = (c.debts ?? []).length;
  try {
    const r2 = rngOf(c);
    resolveChoice(c, e.ev, e.ctx, i, r2);
    saveRng(c, r2);
  } catch (err) { issue(`event-throw:${e.ev.id}#${i}`, String((err as Error).stack).split('\n').slice(0, 3).join(' '), c.day); }
  if (c.pilots.filter((p) => !p.dead).length < alive) M.deserted++;
  if ((c.debts ?? []).length > debtsBefore) M.loans++;
}

function day(c: Company): Company {
  const before = c.ledger?.length ?? 0;
  const injBefore = new Map(c.pilots.map((p) => [p.id, p.healDays]));
  const rep = advanceDay(c);
  for (const p of c.pilots) if (!p.dead && p.injuries > 0 && p.healDays >= (injBefore.get(p.id) ?? 0) && (injBefore.get(p.id) ?? 0) > 0 && !rep.event) issue('heal-not-progressing', `${p.callsign} healDays ${injBefore.get(p.id)} -> ${p.healDays}`, c.day);
  M.alivePilotDays += c.pilots.filter((p) => !p.dead).length;
  M.injuredPilotDays += c.pilots.filter((p) => !p.dead && p.injuries > 0).length;
  if (c.funds < 0 && M.firstNegDay < 0) M.firstNegDay = c.day;
  if (rep.monthEnd && c.ledger?.length) {
    const L = c.ledger![c.ledger!.length - 1];
    M.ledgerMonths++;
    const full = L.start + L.contracts + L.sales + (L.loans ?? 0) - L.other - L.operating;
    if (Math.abs(full - L.end) > 1) issue('ledger-identity', JSON.stringify(L), c.day);
    const shown = L.start + L.contracts + L.sales - L.other - L.operating; // rows the month report screen prints
    if (Math.abs(shown - L.end) > 1) issue('monthreport-rows-dont-sum (loans row missing)', `loans=${L.loans} ${JSON.stringify(L)}`, c.day);
    if (L.sales < 0) issue('ledger-negative-sales', JSON.stringify(L), c.day);
    if (L.other < 0) issue('ledger-negative-other', JSON.stringify(L), c.day);
    const prev = c.ledger!.length > 1 ? c.ledger![c.ledger!.length - 2] : null;
    if (prev && prev.end !== L.start) issue('ledger-start-ne-prev-end', `${prev.end} vs ${L.start}`, c.day);
  }
  for (const p of c.pilots) if (!p.dead && p.injuries === 0 && injuredSince.has(p.id)) { M.recoveries.push(c.day - injuredSince.get(p.id)!); injuredSince.delete(p.id); }
  if (c.travel) M.travelDays++;
  if (rep.event) {
    const hb = new Map(c.pilots.map((p) => [p.id, p.healDays]));
    handleEvent(c, rep.event as 'travel' | 'docked');
    for (const p of c.pilots) if (!p.dead && p.healDays > (hb.get(p.id) ?? 0) && (hb.get(p.id) ?? 0) === 0) { M.eventInjuries.push(p.healDays); injuredSince.set(p.id, c.day); }
  }
  for (const [id, n] of Object.entries(c.parts)) { if (n > 0) chSeen.add(id); if (n >= PARTS_NEEDED) ch3.add(id); }
  check(c, 'day');
  if (c.day % 30 === 0) M.funds.push(Math.round(c.funds / 1000));
  M.peakFunds = Math.max(M.peakFunds, c.funds); M.minFunds = Math.min(M.minFunds, c.funds);
  if (c.day % 100 === 50) fuzzEvents(c);
  if (c.day % rtEvery === 0) c = roundtrip(c, 'periodic');
  return c;
}

let c = newCompany({ name: 'Soak Co', commander: 'Bot', callsign: 'Bot', background: bg, seed, hard, ironman });
c.expense = expLevel;
check(c, 'new');
c = roundtrip(c, 'new');
let guard = 0, lastMission = 0;
const PREF = ['battle', 'ambush', 'assassinate', 'escort', 'destroybase', 'defendbase', 'capture'];
try {
  while (!c.gameOver && guard++ < 6000) {
    if (c.pendingSalvage) { issue('pendingSalvage-stuck', c.pendingSalvage.name, c.day); claimSalvage(c, c.pendingSalvage.pool, []); }
    const burn = monthlyExpenses(c).total;
    for (const [id, n] of Object.entries(c.parts)) if (n >= PARTS_NEEDED && c.mechs.length + c.storage.length < bays(c) + 2 && c.funds - assembleFee(id) > burn) { const before = c.parts[id]; const err = assembleMech(c, id); if (!err) { M.assembled++; if (c.parts[id] !== before - PARTS_NEEDED) issue('assemble-parts-math', `${id}`, c.day); } }
    giveRoles(c);
    for (const p of c.pilots) if (!p.dead) for (const s of ['gun', 'pil', 'tac', 'gut'] as const) while (p[s] < 10 && p.xp >= xpCost(p[s]) && trainSkill(p, s) !== 'Not enough experience') { /* */ }
    if (!c.travel) {
      // Buy replacement 'Mechs when short
      if (c.mechs.length + c.storage.length < 4) {
        const st = c.stores[c.location] ?? [];
        const m = st.filter((x) => x.kind === 'mech' && x.qty > 0 && c.funds - x.price > burn).sort((a, b) => a.price - b.price)[0];
        if (m) { c.funds -= m.price; c.stats.spent += m.price; m.qty--; const f = newMechFrame(m.id.replace('USED:', '')); if (m.id.startsWith('USED:')) f.usedPrice = m.price; if (c.mechs.length < bays(c)) c.mechs.push(f); else c.storage.push(f); }
      }
      // Complete a part set from the store
      const st = c.stores[c.location] ?? [];
      const pt = st.find((x) => x.kind === 'part' && x.qty > 0 && (c.parts[x.id] ?? 0) > 0 && (c.parts[x.id] ?? 0) + x.qty >= PARTS_NEEDED && c.funds - x.price * x.qty > burn * 2);
      if (pt) while (pt.qty > 0 && (c.parts[pt.id] ?? 0) < PARTS_NEEDED) { c.funds -= pt.price; c.stats.spent += pt.price; pt.qty--; c.parts[pt.id] = (c.parts[pt.id] ?? 0) + 1; }
      // Sell surplus gear (keep 2)
      for (const [id, n] of Object.entries(c.inventory)) if (n > 2) { c.funds += sellPrice(c, id) * (n - 2); c.inventory[id] = 2; }
      // Hire when short
      const living = c.pilots.filter((p) => !p.dead);
      const hires = (c.hires[c.location] ?? []).sort((a, b) => (a.hireCost ?? 0) - (b.hireCost ?? 0));
      while (living.length < Math.min(pilotCap(c), Math.max(5, c.mechs.length + 1)) && hires.length && c.funds - (hires[0].hireCost ?? 0) > burn * 1.5) {
        const p = hires.shift()!; c.funds -= p.hireCost ?? 0; c.stats.spent += p.hireCost ?? 0; c.pilots.push(p); living.push(p); c.hires[c.location] = hires;
      }
      // Upgrades when rich
      for (const id of ['med1', 'tech1', 'hydro', 'train1', 'comms', 'med2']) {
        const u = UPGRADES.find((x) => x.id === id)!;
        if (!has(c, id) && !(c.installing ?? []).some((q) => q.id === id) && (!u.requires || has(c, u.requires)) && c.funds - u.cost > burn * 4) {
          const days = Math.max(3, Math.round(u.cost / 180000));
          const queueEnd = Math.max(c.day, ...(c.installing ?? []).map((q) => q.doneDay));
          c.funds -= u.cost; c.stats.spent += u.cost; (c.installing ??= []).push({ id: u.id, doneDay: c.day + queueEnd - c.day + days }); M.upgrades.push(`${id}@${c.day}`);
          break;
        }
      }
      // Bank loan when short (as argo.ts)
      const hasBank = (c.debts ?? []).some((db) => db.who === 'Aurigan Merchant Bank');
      if (!hasBank && c.funds >= 0 && !c.negativeMonths && c.funds < burn && c.day % 30 > 20) {
        const loanAmt = 750000 + mrbLevel(c) * 250000;
        c.funds += loanAmt; c.borrowed = (c.borrowed ?? 0) + loanAmt; (c.debts ??= []).push({ day: c.day + 90, amount: Math.round(loanAmt * 1.25), who: 'Aurigan Merchant Bank' }); M.loans++;
      }
    }
    for (const m of c.mechs) if (isFrameDamaged(m) && c.funds - repairEstimate(m).cost > burn) queueRepair(c, m);
    const ready = c.mechs.filter((m) => mechReady(c, m)).sort((a, b) => frameTons(b) - frameTons(a));
    const pilots = c.pilots.filter(isAvailable).sort((a, b) => b.gun + b.pil - (a.gun + a.pil));
    const n = Math.min(4, ready.length, pilots.length);
    if (!c.travel && (n >= 3 || (n >= 1 && c.mechs.length <= 2 && c.day - lastMission > 20))) {
      const lanceTons = ready.slice(0, n).reduce((a, m) => a + frameTons(m), 0);
      const cap = n < 3 ? 1 : Math.max(1, Math.min(maxContractDiff(c), Math.round((lanceTons / n - 22) / 7.2) + 1 + (boost >= 3 ? 1 : 0)));
      const ks = (c.contracts[c.location] ?? []).filter((k) => k.diff <= cap && k.expires > c.day).sort((a, b) => (b.booked ? 1 : 0) - (a.booked ? 1 : 0) || b.diff - a.diff || PREF.indexOf(a.type) - PREF.indexOf(b.type) || b.pay - a.pay);
      const k = ks[0];
      if (!k) { M.noContractDays++; M.noContractStreak++; M.maxNoContractStreak = Math.max(M.maxNoContractStreak, M.noContractStreak); }
      if (k) {
        M.noContractStreak = 0;
        const neg = k.booked ?? negotiate(k, Math.min(5, maxSlider(c, k)));
        const lance = ready.slice(0, n).map((m, i) => ({ mech: m, pilot: pilots[i] }));
        c.lance = [0, 1, 2, 3].map((i) => lance[i]?.mech.uid ?? null);
        c.lancePilots = [0, 1, 2, 3].map((i) => lance[i]?.pilot.id ?? null);
        saveBackup(c);
        for (const l of lance) { l.pilot.gun += boost; l.pilot.pil += Math.ceil(boost / 2); }
        played.add(k.id);
        const rt = launchContract(c, k, lance);
        const b = rt.battle;
        b.start();
        let g = 0;
        try {
          while (!b.result && g++ < 4000) {
            const nx = b.advance();
            if (nx.who === 'none') break;
            const u = nx.who === 'ai' ? nx.unit! : b.pending(0).find((x) => x.team === 0)!;
            aiTakeTurn(b, u);
            const lost = b.units.filter((x) => x.team === 0 && !x.alive).length;
            const mine = b.units.filter((x) => x.team === 0 && x.alive).length, theirs = rt.enemyUnits.filter((e) => e.alive).length;
            if ((lost >= 2 && b.withdrawIn < 0 && theirs > mine + 1) || b.round > 25) b.withdraw();
          }
        } finally { for (const l of lance) { l.pilot.gun -= boost; l.pilot.pil -= Math.ceil(boost / 2); } }
        const pre = new Map(c.pilots.map((p) => [p.id, p.injuries]));
        const r = resolveContract(c, k, neg, rt);
        M.missions++; if (r.outcome === 'win') M.wins++;
        lastMission = c.day;
        for (const p of c.pilots) if (!p.dead && p.injuries > (pre.get(p.id) ?? 0) && r.xp.some(([q]) => q === p)) { M.wounds.push([p.injuries, p.healDays]); if (!injuredSince.has(p.id)) injuredSince.set(p.id, c.day); }
        M.outcomes[`${k.type}:${r.outcome}`] = (M.outcomes[`${k.type}:${r.outcome}`] ?? 0) + 1;
        for (const kk of [k]) { if (bad(r.pay) || r.pay < 0 || bad(r.bonus)) issue('result-pay-bad', `${r.pay} ${r.bonus}`, c.day); }
        if (r.pool.length && !c.pendingSalvage) issue('salvage-pool-not-pending', k.name, c.day);
        check(c, 'post-resolve');
        c = roundtrip(c, 'post-resolve (salvage pending)');
        // Salvage screen: priority picks, employer cut, then the rest
        const ps = c.pendingSalvage;
        if (ps) {
          const score = (i: number) => { const e = ps.pool[i]; return e.value * (e.kind === 'part' && ((c.parts[e.id] ?? 0) > 0 || c.mechs.some((m) => m.defId === e.id)) ? 2.5 : 1); };
          const idx = ps.pool.map((_, i) => i).sort((a, b2) => score(b2) - score(a));
          const picks = idx.slice(0, Math.min(ps.priority, ps.pool.length));
          const cut = employerCut({ pool: ps.pool, salvageShares: ps.shares }, picks, ps.seed);
          const need = Math.max(0, Math.min(ps.shares - picks.length, ps.pool.length - picks.length - cut.length));
          const rest = idx.filter((i) => !picks.includes(i) && !cut.includes(i)).slice(0, need);
          if (picks.length + rest.length > ps.shares) issue('salvage-overshare', `${picks.length}+${rest.length}>${ps.shares}`, c.day);
          const got = claimSalvage(c, ps.pool, [...picks, ...rest]);
          for (const gg of got) if (gg.kind === 'part') M.partsGained[gg.id] = (M.partsGained[gg.id] ?? 0) + 1;
          if (c.pendingSalvage) issue('pendingSalvage-not-cleared', '', c.day);
        }
        // Sell part singletons of chassis we'll never complete? Keep (measure scatter).
        while ((c.deployDays ?? 0) > 0 && !c.gameOver) { c.deployDays!--; c = day(c); }
        continue;
      }
    }
    if (!c.travel) {
      const cap = maxContractDiff(c);
      const good = (c.contracts[c.location] ?? []).some((x) => x.diff <= cap);
      // Book a travel contract now and then, else wander when the board is empty
      const offer = (c.travelOffers ?? []).find((t) => t.expires > c.day && t.sysId && t.diff <= Math.min(cap, 2 + mrbLevel(c)));
      if (offer && n >= 3 && (c.day % 3 === 0 || !good)) {
        const dest = offer.sysId!;
        const days = route(c.systems, c.location, dest)?.days ?? 10;
        offer.booked = negotiate(offer, Math.min(5, maxSlider(c, offer)));
        offer.expires = c.day + days + 12;
        c.travelOffers = (c.travelOffers ?? []).filter((t) => t !== offer);
        offer.sysId = undefined;
        (c.contracts[dest] ??= []).unshift(offer);
        const err = startTravel(c, dest);
        if (err) issue('travel-offer-start-failed', err, c.day);
      } else if (!good && n >= 2) {
        const cand = c.systems.filter((s) => s.id !== c.location && s.diff <= cap + 1).map((s) => ({ s, r: route(c.systems, c.location, s.id) })).filter((x) => x.r).sort((a, b) => a.r!.days - b.r!.days);
        if (cand[0]) startTravel(c, cand[0].s.id);
      }
    }
    if (c.day - lastMission > M.maxGapDays) M.maxGapDays = c.day - lastMission;
    M.idleDays++;
    c = day(c);
  }
} catch (e) {
  issue('THROW:' + String((e as Error).message).slice(0, 80), String((e as Error).stack).split('\n').slice(0, 4).join(' '), c.day);
}
if (!c.gameOver && c.day < CAREER_DAYS) issue('loop-guard-exhausted', `day ${c.day}`, c.day);
M.end = c.gameOver; M.endDay = c.day; M.deaths = c.stats.pilotsLost; M.mrbEnd = mrbLevel(c); M.mechsLost = c.stats.mechsLost;
M.chassisWithParts = chSeen.size; M.chassisReached3 = ch3.size;
M.partsAtEnd = Object.fromEntries(Object.entries(c.parts).filter(([, v]) => v > 0));
void healMult;
console.log('SOAK ' + JSON.stringify({ M, issues: Object.fromEntries(issues) }));
