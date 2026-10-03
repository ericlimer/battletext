// Idle-run contract board check: duplicate contract ids or seeds on a board mean the RNG rewound.
// node scripts/run.mjs scripts/dupcheck.ts
import { newCompany, advanceDay, sys } from '../src/game/company';
const c = newCompany({ name: 'Dup Co', commander: 'Bot', callsign: 'Bot', background: 'davion', seed: 11, hard: false, ironman: false });
let dupDays = 0;
const ids = new Set<string>();
for (let d = 0; d < 200; d++) {
  advanceDay(c);
  const board = [...(c.contracts[sys(c).id] ?? []), ...(c.travelOffers ?? [])];
  for (const k of board) ids.add(k.id);
  const seen = new Set<string>();
  if (board.some((k) => { const key = `${k.id}`; const dup = seen.has(key) || seen.has('s' + k.seed); seen.add(key); seen.add('s' + k.seed); return dup; })) dupDays++;
}
console.log(`${dupDays === 0 ? 'ok  ' : 'FAIL'} duplicate contracts on ${dupDays}/200 days; ${ids.size} unique contracts seen`);
