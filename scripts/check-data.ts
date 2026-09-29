import { CHASSIS, SLOTS, slotsUsed } from '../src/data/mechs';
import { item, MECH_LOCS, HardType } from '../src/data/items';
let bad = 0;
for (const c of CHASSIS) {
  const probs: string[] = [];
  for (const l of MECH_LOCS) {
    const u = slotsUsed(c.stockItems, l);
    if (u > SLOTS[l]) probs.push(`${l} slots ${u}/${SLOTS[l]}`);
    const hp = [...(c.hardpoints[l] ?? [])];
    for (const it of c.stockItems.filter((i) => i.loc === l)) {
      const d = item(it.id);
      if (d.kind === 'weapon') {
        const k = hp.indexOf(d.hard as HardType);
        if (k < 0) probs.push(`${l} no ${d.hard} hardpoint for ${it.id}`); else hp.splice(k, 1);
      }
      if (d.locs && !d.locs.includes(l)) probs.push(`${it.id} not allowed in ${l}`);
    }
  }
  const jj = c.stockItems.filter((i) => item(i.id).kind === 'jumpjet').length;
  if (jj !== c.jump) probs.push(`jj ${jj} != jump ${c.jump}`);
  const ratio = c.coreTons / c.tons;
  if (ratio < 0.3 || ratio > 0.85) probs.push(`core ratio ${ratio.toFixed(2)}`);
  const line = `${c.id.padEnd(9)} ${String(c.tons).padStart(3)}t core ${c.coreTons.toFixed(1).padStart(5)} (${(ratio*100).toFixed(0)}%) cost ${c.cost}`;
  console.log(line + (probs.length ? '  !! ' + probs.join('; ') : ''));
  if (probs.length) bad++;
}
console.log(bad ? `${bad} problems` : 'all ok');
