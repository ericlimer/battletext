// Targeted repros for career-layer bugs found by soak-career-run.ts.
// node scripts/run.mjs scripts/soak-career-repro.ts
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
import { newCompany, advanceDay, queueRepair, addLog, monthlyExpenses, negotiate, startTravel } from '../src/game/company';
import { route } from '../src/game/world';
import { EVENTS } from '../src/game/events';
import { saveGame, loadGame } from '../src/game/save';
import { RNG } from '../src/engine/rng';

const mk = () => newCompany({ name: 'R', commander: 'B', callsign: 'B', background: 'davion', seed: 5, hard: false, ironman: false });

// 1. Creditors seize a 'Mech with a work order: the order is orphaned and keeps eating tech-hours
{
  const c = mk();
  for (const m of c.mechs) { m.armor.CT = 0; m.struct.LA = 1; queueRepair(c, m); }
  c.funds = -5_000_000; c.day = 29;
  advanceDay(c);
  const uids = new Set([...c.mechs, ...c.storage].map((m) => m.uid));
  const orphans = c.work.filter((w) => !uids.has(w.mechUid));
  console.log(`[1] liquidation: mechs left ${c.mechs.length}, work orders ${c.work.length}, orphaned ${orphans.length} (${orphans.reduce((a, w) => a + w.hours, 0)} tech-hours wasted, prepaid ${orphans.reduce((a, w) => a + (w.cost ?? 0), 0)} not refunded)`);
}
// 2. One-off save fix fires on any career that withdraws from an escort named "Pathfinder" (a generated escort name) logged on day 42, if the save has not yet recorded the fix id (newCompany does not pre-seed c.fixes)
{
  const c = mk();
  addLog(c, 'Withdrew from "Pathfinder".', '#e8503a', 42);
  const f0 = c.funds;
  saveGame(c); const c2 = loadGame()!;
  console.log(`[2] fixes: funds ${f0} -> ${c2.funds} (+${c2.funds - f0}), pendingSalvage ${!!c2.pendingSalvage}, fixes ${c2.fixes}`);
}
// 3. Event loan ("loan") is not recorded in c.borrowed: the ledger books it as sales; repayment books as purchases
{
  const c = mk();
  c.day = 1; c.monthStart = { day: 0, funds: c.funds, earned: 0, spent: 0, borrowed: 0 };
  const ev = EVENTS.find((e) => e.id === 'loan');
  if (ev) {
    ev.choices[0].apply(c, { pilot: c.pilots[0], pilot2: c.pilots[1], sysName: 'X' }, new RNG(1));
    while (c.day < 30) advanceDay(c);
    const L = c.ledger!.at(-1)!;
    console.log(`[3] event loan: borrowed=${c.borrowed ?? 0}; ledger sales=${L.sales} loans=${L.loans}`);
  } else console.log('[3] no loan event');
}
// 4. Bank loan: the month report screen omits the loans row, so its lines do not sum to "Funds now"
{
  const c = mk();
  c.day = 1; c.monthStart = { day: 0, funds: c.funds, earned: 0, spent: 0, borrowed: 0 };
  c.funds += 750000; c.borrowed = 750000; (c.debts ??= []).push({ day: c.day + 90, amount: 937500, who: 'Aurigan Merchant Bank' });
  while (c.day < 30) advanceDay(c);
  const L = c.ledger!.at(-1)!;
  const shown = L.start + L.contracts + L.sales - L.other - L.operating;
  console.log(`[4] month report rows sum to ${shown}, funds now ${L.end} (gap ${L.end - shown} = loans ${L.loans})`);
  while (c.day < 120) advanceDay(c);
  const L2 = c.ledger!.find((l) => l.day === 120)!;
  console.log(`    repayment month: other (shown as "Repairs, refits and purchases") = ${L2.other}, operating ${L2.operating}`);
}
// 5. Event injuries ignore the Medical Bay; mission injuries get healMult
{
  const c = mk(); c.upgrades.push('med1', 'med2');
  const ev = EVENTS.find((e) => e.choices.some((ch) => /injured for 14 days|burned badly/.test(String(ch.apply))));
  console.log(`[5] event injury with Surgical Suite: fixed 10-18 days regardless (injure() in events.ts ignores healMult); mission wound = ${Math.max(3, Math.round(14 * 0.3))}d. sample event ${ev?.id}`);
  void monthlyExpenses;
}
// 6. A booked travel contract expires 12 days after arrival and is silently dropped from the board (no log, no penalty)
{
  const c = mk();
  const k = (c.travelOffers ?? [])[0];
  if (k) {
    const dest = k.sysId!;
    const days = route(c.systems, c.location, dest)!.days;
    k.booked = negotiate(k, 3); k.expires = c.day + days + 12; k.sysId = undefined;
    c.travelOffers = c.travelOffers!.filter((t) => t !== k);
    (c.contracts[dest] ??= []).unshift(k);
    startTravel(c, dest);
    const logN = c.log.length;
    while (c.day < k.expires + 1) advanceDay(c);
    const still = (c.contracts[dest] ?? []).some((x) => x.id === k.id);
    const said = c.log.slice(logN).some((l) => l.text.includes(k.name));
    console.log(`[6] booked "${k.name}" after ${c.day} days: on board ${still}, mentioned in log ${said}`);
  }
}
