// One-off corrections to a player's save, applied once on load and recorded in company.fixes.

import { RNG } from '../engine/rng';
import { Company, addLog } from './company';
import { newMechFrame } from './frame';
import { salvagePool } from './aftermath';
import { cb } from '../engine/util';

interface Fix { id: string; applies: (c: Company) => boolean; apply: (c: Company) => void }

const FIXES: Fix[] = [
  {
    // Escort "Pathfinder" (day 42): the opposing force was wiped out but the haulers waited for an escort and the
    // stalemate guard withdrew the lance. Both rules changed; the employer pays and the salvage is offered as for
    // a win. Damage, injuries and reputation stand.
    id: 'pathfinder-escort-2026-10-06',
    applies: (c) => c.log.some((l) => l.text === 'Withdrew from "Pathfinder".' && l.day === 42) && !c.pendingSalvage,
    apply: (c) => {
      const pay = 360000;
      c.funds += pay;
      c.stats.earned += pay;
      const wrecks = [['JR7-D', 'ct'], ['JR7-D', 'eject'], ['HBK-4G', 'ct'], ['HBK-4P', 'ct'], ['CDA-2A', 'ct']] as const;
      const pool = salvagePool(c, new RNG(42042), 3, wrecks.map(([id, how]) => ({ frame: newMechFrame(id), how })));
      c.pendingSalvage = { pool, shares: 4, priority: 2, seed: 42042, name: 'Pathfinder' };
      addLog(c, `Employer review of "Pathfinder": the hostiles were all destroyed, so the convoy was safe. Paid in full (${cb(pay)}) and salvage released.`, '#6ad46a');
    },
  },
];

/** Returns true when the save changed and should be written back. */
export function applyFixes(c: Company): boolean {
  c.fixes ??= [];
  let changed = false;
  for (const f of FIXES) {
    if (c.fixes.includes(f.id)) continue;
    if (f.applies(c)) f.apply(c);
    c.fixes.push(f.id);
    changed = true;
  }
  return changed;
}
