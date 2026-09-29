// Random Argo events with choices, in the spirit of BATTLETECH's travel events.

import { RNG } from '../engine/rng';
import { Company, addLog, sys } from './company';
import { Pilot, SKILLS, SKILL_NAMES } from './pilot';
import { cb } from '../engine/util';

export interface EventChoice {
  text: string;
  req?: (c: Company, ctx: EventCtx) => string | null; // reason if unavailable
  apply: (c: Company, ctx: EventCtx, r: RNG) => string; // result text
}
export interface GameEvent {
  id: string;
  title: string;
  where: 'travel' | 'docked' | 'any';
  text: (c: Company, ctx: EventCtx) => string;
  choices: EventChoice[];
  weight?: (c: Company) => number;
}
export interface EventCtx { pilot: Pilot; pilot2: Pilot; sysName: string; }

const funds = (n: number) => (c: Company) => (c.funds >= n ? null : `Requires ${cb(n)}`);
const pay = (c: Company, n: number) => { c.funds -= n; c.stats.spent += Math.max(0, n); };
const mor = (c: Company, n: number) => { c.moraleMod += n; };
const xp = (p: Pilot, n: number) => { p.xp += n; p.xpTotal += n; };
const injure = (c: Company, p: Pilot, days: number) => { p.injuries = Math.max(1, p.injuries); p.healDays = Math.max(p.healDays, days); void c; };

export const EVENTS: GameEvent[] = [
  {
    id: 'poker', title: 'High Stakes', where: 'travel',
    text: (c, x) => `${x.pilot.callsign} has been running a poker game in the mess. Tonight the pot is enormous — and ${x.pilot2.callsign} has bet their share of the next paycheck. Tempers are rising.`,
    choices: [
      { text: 'Let them play. A MechWarrior\'s money is their own.', apply: (c, x, r) => { if (r.chance(0.5)) { mor(c, 2); return `${x.pilot2.callsign} wins big and buys a round for the whole crew. Morale +2.`; } mor(c, -3); return `${x.pilot2.callsign} loses everything and sulks for a week. Morale -3.`; } },
      { text: 'Break it up and confiscate the pot for the company.', apply: (c) => { c.funds += 25000; mor(c, -4); return `The company gains ${cb(25000)}. Nobody is happy about it. Morale -4.`; } },
      { text: 'Cover the loser\'s debts yourself.', req: funds(40000), apply: (c, x) => { pay(c, 40000); mor(c, 4); xp(x.pilot2, 300); return `You pay ${cb(40000)}. ${x.pilot2.callsign} will not forget it. Morale +4.`; } },
    ],
  },
  {
    id: 'reactor', title: 'Reactor Scare', where: 'travel',
    text: () => 'Alarms scream across the Argo: a coolant leak in the auxiliary reactor. The chief engineer wants to vent the section immediately, which will spoil the stores kept there.',
    choices: [
      { text: 'Vent it. Safety first.', apply: (c) => { mor(c, -2); pay(c, 30000); return `The stores are lost (${cb(30000)}). The crew grumbles about canned rations. Morale -2.`; } },
      { text: 'Send a team in to patch the leak by hand.', apply: (c, x, r) => { if (r.chance(0.65)) { mor(c, 3); xp(x.pilot, 400); return `${x.pilot.callsign} leads the repair team heroically. Morale +3.`; } injure(c, x.pilot, 14); return `The patch holds, but ${x.pilot.callsign} is burned badly. Injured for 14 days.`; } },
    ],
  },
  {
    id: 'stowaway', title: 'Stowaway', where: 'travel',
    text: () => 'The loadmaster has found a teenager hiding in a spare parts crate. They claim they want to be a MechWarrior and will work for nothing.',
    choices: [
      { text: 'Put them to work in the \'Mech bay.', apply: (c) => { mor(c, 2); c.inventory['HS'] = (c.inventory['HS'] ?? 0) + 1; return 'The kid is a natural with a hydro-spanner and salvages a heat sink from the scrap heap. Morale +2.'; } },
      { text: 'Drop them at the next port.', apply: (c) => { mor(c, -1); return 'The kid is handed over to port authorities, heartbroken. Morale -1.'; } },
    ],
  },
  {
    id: 'smugglers', title: 'Friends of Friends', where: 'docked',
    text: (c, x) => `A local fixer on ${x.sysName} offers a crate of "surplus" weapons at a steep discount. No questions asked, no paperwork given.`,
    choices: [
      { text: `Buy the crate (${cb(120000)}).`, req: funds(120000), apply: (c, x, r) => { pay(c, 120000); const pool = ['LL', 'AC5', 'SRM6', 'LRM10', 'PPC', 'ML+1d', 'AC10']; const a = r.pick(pool), b = r.pick(pool); c.inventory[a] = (c.inventory[a] ?? 0) + 1; c.inventory[b] = (c.inventory[b] ?? 0) + 1; c.rep['locals'] -= 3; return `The crate holds a ${a} and a ${b}. Local authorities hear about it. Planetary rep -3.`; } },
      { text: 'Report the fixer to the authorities.', apply: (c) => { c.rep['locals'] += 4; return 'The planetary government appreciates your honesty. Planetary rep +4.'; } },
      { text: 'Decline politely.', apply: () => 'The fixer shrugs and disappears into the crowd.' },
    ],
  },
  {
    id: 'rivalry', title: 'Bad Blood', where: 'any',
    text: (c, x) => `${x.pilot.callsign} and ${x.pilot2.callsign} came to blows in the simulator bay over who gets the next heavy \'Mech assignment. Both are nursing bruises.`,
    choices: [
      { text: 'Let them settle it in the simulator. Winner gets bragging rights.', apply: (c, x) => { xp(x.pilot, 350); xp(x.pilot2, 350); mor(c, -1); return 'Both pilots gain 350 XP from the grudge match. Morale -1.'; } },
      { text: 'Dock both of their pay.', apply: (c) => { c.funds += 15000; mor(c, -2); return `Order restored. The company saves ${cb(15000)}. Morale -2.`; } },
      { text: 'Talk it out over drinks, your treat.', req: funds(10000), apply: (c) => { pay(c, 10000); mor(c, 3); return 'By the end of the night they are best friends again. Morale +3.'; } },
    ],
  },
  {
    id: 'derelict', title: 'Derelict Signal', where: 'travel',
    text: () => 'Sensors pick up an old Star League distress beacon from a derelict freighter drifting near the jump point. Salvage could be valuable — or a trap.',
    choices: [
      { text: 'Send a boarding team.', apply: (c, x, r) => { const roll = r.next(); if (roll < 0.25) { injure(c, x.pilot, 18); return `A booby-trap detonates. ${x.pilot.callsign} is injured for 18 days.`; } if (roll < 0.55) { c.funds += 150000; return `The hold contains old transpondable bonds worth ${cb(150000)}.`; } const lt = r.pick(['DHS', 'TTS', 'GYRO', 'HB', 'SENS']); c.inventory[lt] = (c.inventory[lt] ?? 0) + 1; return `The team recovers intact LosTech: a ${lt}!`; } },
      { text: 'Log it and move on.', apply: () => 'The beacon fades behind you.' },
    ],
  },
  {
    id: 'medtech', title: 'Doctor\'s Orders', where: 'any',
    weight: (c) => (c.pilots.some((p) => p.injuries > 0) ? 3 : 0.2),
    text: () => 'The ship\'s doctor has a lead on an experimental regenerative treatment. It is expensive, but could put the wounded back on their feet quickly.',
    choices: [
      { text: `Pay for the treatment (${cb(90000)}).`, req: funds(90000), apply: (c) => { pay(c, 90000); let n = 0; for (const p of c.pilots) if (p.injuries > 0) { p.healDays = Math.max(1, Math.floor(p.healDays / 3)); n++; } return `${n} injured MechWarrior${n === 1 ? '' : 's'} recover much faster.`; } },
      { text: 'Too risky. Stick with conventional care.', apply: () => 'The doctor sighs and returns to the medbay.' },
    ],
  },
  {
    id: 'bounty', title: 'Wanted Poster', where: 'docked',
    text: (c, x) => `A pirate captain with a price on their head is drinking in a bar on ${x.sysName}. The bounty is generous — dead or alive.`,
    choices: [
      { text: 'Send a squad to collect.', apply: (c, x, r) => { if (r.chance(0.6)) { c.funds += 110000; c.rep['locals'] += 3; xp(x.pilot, 300); return `${x.pilot.callsign}'s squad brings the pirate in. Bounty ${cb(110000)}, planetary rep +3.`; } injure(c, x.pilot, 10); mor(c, -2); return `The pirate had friends. ${x.pilot.callsign} is injured for 10 days. Morale -2.`; } },
      { text: 'Not our business.', apply: () => 'You finish your drink and leave.' },
    ],
  },
  {
    id: 'training', title: 'Sparring Offer', where: 'docked',
    text: (c, x) => `A local militia commander on ${x.sysName} offers to run live-fire exercises with your lance. They'll cover the ammunition if you cover the repairs.`,
    choices: [
      { text: `Accept (${cb(35000)} in repairs).`, req: funds(35000), apply: (c) => { pay(c, 35000); for (const p of c.pilots) if (!p.dead) xp(p, 500); c.rep['locals'] += 2; return 'Every MechWarrior gains 500 XP. Planetary rep +2.'; } },
      { text: 'Decline.', apply: () => 'The commander is disappointed.' },
    ],
  },
  {
    id: 'birthday', title: 'Anniversary', where: 'any',
    text: (c) => `Someone noticed: it has been ${Math.floor(c.day / 30)} months since ${c.name} was founded. The crew wants a party.`,
    weight: (c) => (c.day > 90 ? 1 : 0),
    choices: [
      { text: `Throw a proper party (${cb(50000)}).`, req: funds(50000), apply: (c) => { pay(c, 50000); mor(c, 6); return 'The party is legendary. Morale +6.'; } },
      { text: 'A few crates of beer will do.', apply: (c) => { pay(c, 8000); mor(c, 2); return 'Modest, but appreciated. Morale +2.'; } },
      { text: 'We have work to do.', apply: (c) => { mor(c, -3); return 'The crew grumbles. Morale -3.'; } },
    ],
  },
  {
    id: 'mentor', title: 'Old Hand', where: 'any',
    text: (c, x) => `${x.pilot.callsign} has been quietly coaching ${x.pilot2.callsign} after hours. The rookie is improving fast, but the veteran looks exhausted.`,
    choices: [
      { text: 'Encourage it.', apply: (c, x, r) => { const s = r.pick(SKILLS); if (x.pilot2[s] < 10) x.pilot2[s]++; return `${x.pilot2.callsign}'s ${SKILL_NAMES[s]} improves to ${x.pilot2[s]}.`; } },
      { text: 'Order the veteran to rest.', apply: (c, x) => { xp(x.pilot, 400); return `${x.pilot.callsign} returns refreshed and gains 400 XP.`; } },
    ],
  },
  {
    id: 'contract-dispute', title: 'Fine Print', where: 'docked',
    text: () => 'A lawyer from the Mercenary Review Board claims your company\'s bonding paperwork is out of date. There is a "processing fee".',
    choices: [
      { text: `Pay the fee (${cb(60000)}).`, req: funds(60000), apply: (c) => { pay(c, 60000); c.mrb += 15; return 'The paperwork is in order. MRB rating +15.'; } },
      { text: 'Tell them where to file it.', apply: (c) => { c.mrb = Math.max(0, c.mrb - 10); return 'The MRB notes your attitude. MRB rating -10.'; } },
    ],
  },
  {
    id: 'refugees', title: 'Refugees', where: 'docked',
    text: (c, x) => `Refugees from a burned-out settlement on ${x.sysName} are begging for passage off-world. The Argo has room, but supplies are tight.`,
    choices: [
      { text: 'Take them aboard.', apply: (c) => { pay(c, 40000); mor(c, 4); c.rep['locals'] += 5; return `Feeding them costs ${cb(40000)}, but the crew is proud. Morale +4, planetary rep +5.`; } },
      { text: 'We are not a charity.', apply: (c) => { mor(c, -2); return 'The crew watches in silence as the Argo departs. Morale -2.'; } },
    ],
  },
  {
    id: 'tech-find', title: 'Scrapyard Treasure', where: 'docked',
    text: (c, x) => `Your MechTechs have spotted a promising 'Mech wreck in a ${x.sysName} scrapyard. The owner wants cash.`,
    choices: [
      { text: `Buy the wreck (${cb(180000)}).`, req: funds(180000), apply: (c, x, r) => { pay(c, 180000); const ids = ['SHD-2H', 'WVR-6R', 'GRF-1N', 'DRG-1N', 'CPLT-C1', 'TDR-5S', 'QKD-4G', 'CN9-A', 'HBK-4G']; const id = r.pick(ids); const n = r.int(1, 2); c.parts[id] = (c.parts[id] ?? 0) + n; return `The techs strip ${n} usable ${id} part${n > 1 ? 's' : ''} from it.`; } },
      { text: 'Pass.', apply: () => 'Probably full of rust anyway.' },
    ],
  },
];

export function pickEvent(c: Company, r: RNG, where: 'travel' | 'docked'): { ev: GameEvent; ctx: EventCtx } | null {
  const alive = c.pilots.filter((p) => !p.dead);
  if (alive.length < 2) return null;
  const pool = EVENTS.filter((e) => e.where === where || e.where === 'any');
  const ev = r.weighted(pool, (e) => e.weight?.(c) ?? 1);
  if (!ev) return null;
  const pa = r.shuffle([...alive]);
  return { ev, ctx: { pilot: pa[0], pilot2: pa[1], sysName: sys(c).name } };
}

export function resolveChoice(c: Company, ev: GameEvent, ctx: EventCtx, i: number, r: RNG): string {
  const res = ev.choices[i].apply(c, ctx, r);
  addLog(c, `${ev.title}: ${res}`, '#b27ae8');
  return res;
}
