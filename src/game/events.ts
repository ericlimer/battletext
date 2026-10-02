// Random Argo events with choices, in the spirit of BATTLETECH's travel events.

import { RNG } from '../engine/rng';
import { Company, addLog, sys, monthlyExpenses, morale, dateStr } from './company';
import { item } from '../data/items';
import { Pilot, SKILLS, SKILL_NAMES, makePilot, hasQuirk, health } from './pilot';
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
  /** Chooses the focal MechWarrior; returning undefined rules the event out. */
  focus?: (alive: Pilot[]) => Pilot | undefined;
}
export interface EventCtx { pilot: Pilot; pilot2: Pilot; sysName: string; }

const fallen = (c: Company) => c.pilots.find((p) => p.dead && !p.memorial && (p.diedDay ?? -99) >= c.day - 20);
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
      { text: `Buy the crate (${cb(120000)}).`, req: funds(120000), apply: (c, x, r) => { pay(c, 120000); const pool = ['LL', 'AC5', 'SRM6', 'LRM10', 'PPC', 'ML+1d', 'AC10']; const a = r.pick(pool), b = r.pick(pool); c.inventory[a] = (c.inventory[a] ?? 0) + 1; c.inventory[b] = (c.inventory[b] ?? 0) + 1; c.rep['locals'] -= 3; return `The crate holds a ${item(a).name} and a ${item(b).name}. Local authorities hear about it. Planetary rep -3.`; } },
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
      { text: `Pay for the treatment (${cb(90000)}).`, req: funds(90000), apply: (c) => { pay(c, 90000); let n = 0; for (const p of c.pilots) if (p.injuries > 0) { p.healDays = Math.max(1, Math.floor(p.healDays / 3)); n++; } return n ? `${n} injured MechWarrior${n === 1 ? ' recovers' : 's recover'} much faster.` : 'Nobody needed it after all. The money is spent.'; } },
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
  {
    id: 'ghost-signal', title: 'Ghost in the Machine', where: 'travel',
    text: (c, x) => `${x.pilot.callsign} swears their neurohelmet is picking up voices — old SLDF battle chatter, looping. The techs can find nothing wrong.`,
    choices: [
      { text: 'Have the techs strip the cockpit and look again.', apply: (c) => { pay(c, 20000); return `Nothing. ${cb(20000)} of labor later, the voices have stopped anyway.`; } },
      { text: 'Tell them to get some sleep.', apply: (c, x, r) => { if (r.chance(0.5)) { xp(x.pilot, 500); return `${x.pilot.callsign} spends nights transcribing the chatter and learns a trick or two. +500 XP.`; } mor(c, -2); return 'The story spreads through the crew. Nobody sleeps well. Morale -2.'; } },
    ],
  },
  {
    id: 'price-war', title: 'Price War', where: 'docked',
    text: (c, x) => `Two arms dealers on ${x.sysName} are undercutting each other. One offers to sell you everything in his stall at cost, if you buy today.`,
    choices: [
      { text: `Buy a crate of ammunition (${cb(30000)}).`, req: funds(30000), apply: (c) => { pay(c, 30000); for (const a of ['A-SRM', 'A-LRM', 'A-AC5', 'A-AC10']) c.inventory[a] = (c.inventory[a] ?? 0) + 2; return 'Eight tons of assorted ammunition are loaded aboard.'; } },
      { text: `Buy his best laser (${cb(90000)}).`, req: funds(90000), apply: (c, x, r) => { pay(c, 90000); const id = r.pick(['ML+2d', 'LL+1d', 'ML+2a', 'LL+1a']); c.inventory[id] = (c.inventory[id] ?? 0) + 1; return `You acquire a ${id}.`; } },
      { text: 'Walk on.', apply: () => 'The dealers are still shouting at each other as you leave.' },
    ],
  },
  {
    id: 'deserter', title: 'The Deserter', where: 'docked',
    text: () => 'A young MechWarrior in a torn militia uniform asks to join. She deserted her unit rather than fire on civilians, and her former commander wants her back.',
    choices: [
      { text: 'Take her on and face the consequences.', apply: (c, x, r) => { c.rep['locals'] -= 6; mor(c, 3); const p = makePilot(r, 1); p.callsign = 'Maverick'; p.bio = 'Deserted her militia unit rather than fire on civilians.'; c.pilots.push(p); return 'Maverick joins the company. The locals are furious. Planetary rep -6, morale +3.'; } },
      { text: 'Hand her over.', apply: (c) => { c.rep['locals'] += 4; mor(c, -4); return 'The militia thanks you. The crew does not. Planetary rep +4, morale -4.'; } },
    ],
  },
  {
    id: 'cracked-gyro', title: 'Cracked Gyro', where: 'any',
    weight: (c) => (c.mechs.length ? 1 : 0),
    text: (c, x) => `A routine scan finds a hairline crack in a 'Mech gyroscope. ${x.pilot.callsign} says it "feels fine".`,
    choices: [
      { text: `Replace it now (${cb(45000)}).`, req: funds(45000), apply: (c) => { pay(c, 45000); return 'The gyro is replaced. Better safe than knocked down.'; } },
      { text: 'Patch it and hope.', apply: (c, x, r) => { if (r.chance(0.6)) return 'The patch holds. For now.'; const m = r.pick(c.mechs); for (const k in m.armor) m.armor[k] = Math.round(m.armor[k] * 0.7); return 'During a drill the gyro fails and the \'Mech topples into a gantry. Its armor needs repairs.'; } },
    ],
  },
  {
    id: 'holovid', title: 'Lights, Camera', where: 'docked',
    text: (c, x) => `A holovid crew on ${x.sysName} wants to film a documentary about "real mercenaries". They'll pay, but they want access to everything.`,
    choices: [
      { text: 'Give them the tour.', apply: (c) => { c.funds += 60000; mor(c, 2); c.mrb += 5; return `The crew pays ${cb(60000)}. The company is famous, briefly. MRB +5, morale +2.`; } },
      { text: 'No cameras on my ship.', apply: () => 'They leave, disappointed, to film a Solaris dueling stable instead.' },
    ],
  },
  {
    id: 'plague', title: 'Quarantine', where: 'docked',
    text: () => 'A fever is spreading through the starport. Port authority offers vaccines for the crew, at a price, or you can seal the Argo and wait it out.',
    choices: [
      { text: `Vaccinate everyone (${cb(35000)}).`, req: funds(35000), apply: (c) => { pay(c, 35000); return 'Everyone gets a sore arm and nothing worse.'; } },
      { text: 'Seal the ship.', apply: (c, x, r) => { if (r.chance(0.5)) { injure(c, x.pilot, 10); injure(c, x.pilot2, 10); return `${x.pilot.callsign} and ${x.pilot2.callsign} catch the fever. Both are off duty for 10 days.`; } return 'The fever passes the Argo by.'; } },
    ],
  },
  {
    id: 'rival-merc', title: 'Rival Company', where: 'docked',
    text: (c, x) => `A rival mercenary commander in a ${x.sysName} bar challenges ${x.pilot.callsign} to a simulator duel. The stakes: a crate of spare parts.`,
    choices: [
      { text: 'Accept the challenge.', apply: (c, x, r) => { const win = r.next() < 0.35 + x.pilot.gun * 0.05; if (win) { c.inventory['HS'] = (c.inventory['HS'] ?? 0) + 2; c.inventory['ML'] = (c.inventory['ML'] ?? 0) + 1; mor(c, 3); return `${x.pilot.callsign} wins decisively. Two heat sinks and a medium laser change hands. Morale +3.`; } mor(c, -2); pay(c, 20000); return `${x.pilot.callsign} loses, and the company pays ${cb(20000)} in bets. Morale -2.`; } },
      { text: 'Decline.', apply: () => 'The rival laughs all the way to the bar.' },
    ],
  },
  {
    id: 'jump-glitch', title: 'Misjump', where: 'travel',
    text: () => 'The K-F drive hiccups during the jump. The Argo emerges off-course, and the navigator needs time to plot a correction.',
    choices: [
      { text: 'Burn extra fuel to catch up.', apply: (c) => { pay(c, 40000); return `The detour costs ${cb(40000)} in reaction mass.`; } },
      { text: 'Take the slow way.', apply: (c) => { if (c.travel) c.travel.legLeft += 3; return 'The trip takes three days longer.'; } },
    ],
  },
  {
    id: 'medal', title: 'Recognition', where: 'docked',
    weight: (c) => (c.stats.wins >= 3 ? 1 : 0),
    text: (c, x) => `A local dignitary on ${x.sysName} wants to decorate ${x.pilot.callsign} for services to the planet. There will be speeches.`,
    choices: [
      { text: 'Attend the ceremony.', apply: (c, x) => { mor(c, 4); c.rep['locals'] += 3; xp(x.pilot, 250); return `${x.pilot.callsign} receives the Star of ${x.sysName}. Morale +4, planetary rep +3.`; } },
      { text: 'We have work to do.', apply: (c) => { c.rep['locals'] -= 2; return 'The dignitary is offended. Planetary rep -2.'; } },
    ],
  },
  {
    id: 'lostech-map', title: 'The Map', where: 'any',
    text: (c, x) => `${x.pilot.callsign} won a data chip in a card game. It claims to show a Star League supply cache — but the seller wants it back, badly.`,
    choices: [
      { text: `Pay the techs to decrypt it (${cb(70000)}).`, req: funds(70000), apply: (c, x, r) => { pay(c, 70000); if (r.chance(0.45)) { const id = r.pick(['DHS', 'GAUSS', 'TTS2', 'GYRO2', 'CMD']); c.inventory[id] = (c.inventory[id] ?? 0) + 1; return `It's real. A recovery team comes back with a ${id}!`; } return 'The chip is a clever fake. The seller must be laughing.'; } },
      { text: 'Sell it back to the seller.', apply: (c) => { c.funds += 40000; return `The seller pays ${cb(40000)}, looking very relieved.`; } },
    ],
  },
  {
    id: 'memorial', title: 'Empty Bunk', where: 'any',
    weight: (c) => (fallen(c) ? 6 : 0),
    text: (c) => { const f = fallen(c)!; return `${f.callsign}'s bunk is still made up the way they left it. The crew has gone quiet, and they are looking to you to decide how the company says goodbye to ${f.name}.`; },
    choices: [
      { text: `Hold a proper wake (${cb(25000)}).`, req: funds(25000), apply: (c) => { const f = fallen(c)!; f.memorial = true; pay(c, 25000); mor(c, 5); return `Stories about ${f.callsign} run until dawn. Morale +5.`; } },
      { text: 'Paint their callsign on the bay doors.', apply: (c) => { const f = fallen(c)!; f.memorial = true; mor(c, 2); return `${f.callsign}'s name greets every 'Mech that leaves the Argo. Morale +2.`; } },
      { text: 'Clear the bunk. There is work to do.', apply: (c) => { const f = fallen(c)!; f.memorial = true; mor(c, -3); return 'The bunk is cleared by morning. Some of the crew think less of you for it. Morale -3.'; } },
    ],
  },
  {
    id: 'itching', title: 'Itching to Fight', where: 'any',
    focus: (a) => a.find((p) => p.injuries > 0 && p.injuries < health(p) && p.healDays > 6),
    text: (c, x) => `${x.pilot.callsign} has been hobbling around the 'Mech bay against the doctor's orders, insisting they are fit for the next drop. The ${x.pilot.healDays} days of bed rest are driving them mad.`,
    choices: [
      { text: 'Clear them for light duty in the simulators.', apply: (c, x, r) => { if (r.chance(0.7)) { x.pilot.healDays = Math.max(1, Math.round(x.pilot.healDays * 0.6)); xp(x.pilot, 200); return `Keeping busy agrees with ${x.pilot.callsign}: recovery time cut to ${x.pilot.healDays} days.`; } x.pilot.healDays += 7; return `${x.pilot.callsign} tears their stitches in a simulator crash. Recovery extended by 7 days.`; } },
      { text: 'Order them back to the infirmary.', apply: (c) => { mor(c, -1); return 'The order is obeyed, with poor grace. Morale -1.'; } },
    ],
  },
  {
    id: 'loan', title: 'Easy Money', where: 'docked',
    weight: (c) => (c.funds < monthlyExpenses(c).total * 1.5 ? 4 : 0),
    text: (c, x) => `Word of your company's finances has spread. A smiling banker from the ${x.sysName} Mercantile Exchange offers an emergency line of credit: ${cb(400000)} now, ${cb(520000)} due in 60 days.`,
    choices: [
      { text: `Take the loan (+${cb(400000)}).`, apply: (c) => { c.funds += 400000; c.debts = [...(c.debts ?? []), { day: c.day + 60, amount: 520000, who: 'Mercantile Exchange' }]; return `The C-Bills hit your account. ${cb(520000)} will be collected on ${dateStr(c.day + 60)}.`; } },
      { text: 'Decline. The company will survive on its own.', apply: (c) => { mor(c, 1); return 'Your stubbornness earns quiet nods from the crew. Morale +1.'; } },
    ],
  },
  {
    id: 'party', title: 'Shore Leave', where: 'docked',
    weight: (c) => (morale(c) >= 30 ? 2 : 0.3),
    text: (c, x) => `The crew wants to blow off steam on ${x.sysName}. ${x.pilot.callsign} has already found a bar that will take the whole company — if the company is buying.`,
    choices: [
      { text: `Open a tab (${cb(35000)}).`, req: funds(35000), apply: (c, x, r) => { pay(c, 35000); mor(c, 4); if (r.chance(0.2)) { c.rep['locals'] = (c.rep['locals'] ?? 0) - 2; return `A legendary night. Some furniture does not survive. Morale +4, planetary rep -2.`; } return 'A legendary night. Morale +4.'; } },
      { text: 'Everyone pays their own way.', apply: (c) => { mor(c, 1); return 'Smaller celebrations break out across the docks. Morale +1.'; } },
      { text: 'No leave. Drills instead.', apply: (c) => { mor(c, -3); for (const p of c.pilots) if (!p.dead) xp(p, 150); return 'Every MechWarrior gains 150 XP. Nobody thanks you. Morale -3.'; } },
    ],
  },
  {
    id: 'raise', title: 'A Matter of Pay', where: 'docked',
    focus: (a) => a.find((p) => !p.commander && hasQuirk(p, 'greedy') && p.missions >= 2) ?? a.find((p) => !p.commander && p.kills >= 6),
    text: (c, x) => `${x.pilot.callsign} has ${x.pilot.kills} confirmed kills and a recruiter's card from another company. They want a one-time bonus to stay — or they will walk.`,
    choices: [
      { text: `Pay the bonus (${cb(90000)}).`, req: funds(90000), apply: (c, x) => { pay(c, 90000); mor(c, 1); x.pilot.timeline.push(`Paid a retention bonus on day ${c.day}.`); return `${x.pilot.callsign} signs on for another tour. Morale +1.`; } },
      { text: 'Appeal to loyalty.', apply: (c, x, r) => { if (hasQuirk(x.pilot, 'loyal') || r.chance(0.45)) { mor(c, 2); return `${x.pilot.callsign} laughs and tears up the card. Morale +2.`; } c.pilots = c.pilots.filter((q) => q !== x.pilot); c.lancePilots = c.lancePilots.map((id) => (id === x.pilot.id ? null : id)); mor(c, -3); return `${x.pilot.callsign} packs their kit and leaves the company. Morale -3.`; } },
    ],
  },
  {
    id: 'cookoff', title: 'Hot Cargo', where: 'travel',
    weight: (c) => (Object.entries(c.inventory).some(([id, n]) => n > 0 && id.startsWith('A-')) ? 1 : 0.4),
    text: () => 'A fire breaks out in the forward cargo hold, two bulkheads from the ammunition lockers. The damage-control team is standing by for orders.',
    choices: [
      { text: 'Jettison the cargo in that hold.', apply: (c, x, r) => { const ids = Object.keys(c.inventory).filter((id) => c.inventory[id] > 0); const lost = r.shuffle(ids).slice(0, 2); for (const id of lost) c.inventory[id]--; return lost.length ? `Spare parts tumble into the void: lost ${lost.map((id) => item(id).name).join(' and ')}.` : 'The hold was nearly empty anyway.'; } },
      { text: 'Fight the fire.', apply: (c, x, r) => { if (r.chance(0.6)) { mor(c, 2); return 'The fire is out within the hour. The damage-control team drinks free for a week. Morale +2.'; } pay(c, 80000); injure(c, x.pilot, 10); return `The fire spreads before it is contained: ${cb(80000)} in repairs, and ${x.pilot.callsign} is injured for 10 days.`; } },
    ],
  },
  {
    id: 'friendship', title: 'Wingmates', where: 'any',
    text: (c, x) => `${x.pilot.callsign} and ${x.pilot2.callsign} have started flying as a pair in the simulators, and their drills are the best on the ship. They ask to be kept together in the lance.`,
    choices: [
      { text: 'Make it official. Pair them up.', apply: (c, x) => { xp(x.pilot, 400); xp(x.pilot2, 400); mor(c, 2); return `Both gain 400 XP from their drills. Morale +2.`; } },
      { text: 'Assignments are based on need, not friendship.', apply: (c) => { mor(c, -1); return 'They accept it, but the spark goes out of the drills. Morale -1.'; } },
    ],
  },
  {
    id: 'rival-offer', title: 'Poaching', where: 'docked',
    focus: (a) => a.find((p) => !p.commander && p.gun + p.pil >= 11),
    text: (c, x) => `A rival company has made ${x.pilot.callsign} a generous offer to jump ship. ${x.pilot.callsign} brought the offer straight to you.`,
    choices: [
      { text: `Match it with a bonus (${cb(60000)}).`, req: funds(60000), apply: (c, x) => { pay(c, 60000); mor(c, 2); return `${x.pilot.callsign} stays, and word spreads that you look after your people. Morale +2.`; } },
      { text: 'Thank them for their loyalty.', apply: (c, x, r) => { if (hasQuirk(x.pilot, 'loyal') || r.chance(0.65)) { mor(c, 1); return `${x.pilot.callsign} tears up the offer. Morale +1.`; } c.pilots = c.pilots.filter((q) => q !== x.pilot); c.lancePilots = c.lancePilots.map((id) => (id === x.pilot.id ? null : id)); mor(c, -2); return `${x.pilot.callsign} takes the offer after all. Morale -2.`; } },
    ],
  },
  {
    id: 'faction-gift', title: 'Diplomatic Pouch', where: 'docked',
    text: (c, x) => `A courier from the ${x.sysName} governor's office arrives with a sealed case: a token of gratitude for keeping the peace, and an implied request to keep doing it.`,
    choices: [
      { text: 'Accept the gift.', apply: (c, x, r) => { const id = r.pick(['HS', 'JJ-L', 'ML+1a', 'SRM4+1d', 'ACT', 'SENS']); c.inventory[id] = (c.inventory[id] ?? 0) + 1; c.rep['locals'] = (c.rep['locals'] ?? 0) + 2; return `The case holds a ${item(id).name}. Planetary rep +2.`; } },
      { text: 'Politely decline. Mercenaries stay neutral.', apply: (c) => { mor(c, 1); return 'The courier is surprised but respectful. Morale +1.'; } },
    ],
  },
  {
    id: 'sim-crash', title: 'Simulator Fault', where: 'any',
    weight: (c) => (c.upgrades.includes('train1') ? 2 : 0.5),
    text: (c, x) => `A power surge fried the simulator cockpit while ${x.pilot.callsign} was strapped in. The techs say the rig can be repaired, or stripped for parts.`,
    choices: [
      { text: `Repair it (${cb(45000)}).`, req: funds(45000), apply: (c, x) => { pay(c, 45000); xp(x.pilot, 200); return `The rig is back online within the week. ${x.pilot.callsign} gains 200 XP from the extra hours.`; } },
      { text: 'Strip it for parts.', apply: (c) => { c.inventory['HS'] = (c.inventory['HS'] ?? 0) + 1; mor(c, -1); return 'The techs recover a heat sink. The pilots miss their simulator. Morale -1.'; } },
    ],
  },
  {
    id: 'low-supplies', title: 'Short Rations', where: 'travel',
    weight: (c) => (c.expense <= 1 ? 3 : 0.3),
    text: () => 'The quartermaster reports that the galley stores are running thin. The crew has noticed the portions shrinking.',
    choices: [
      { text: `Buy supplies at the next jump point (${cb(50000)}).`, req: funds(50000), apply: (c) => { pay(c, 50000); mor(c, 3); return 'Fresh supplies come aboard. Morale +3.'; } },
      { text: 'Tighten belts.', apply: (c) => { mor(c, -4); return 'The crew mutters about being treated like conscripts. Morale -4.'; } },
    ],
  },
  {
    id: 'veteran-advice', title: 'War Stories', where: 'any',
    focus: (a) => a.find((p) => p.missions >= 6),
    text: (c, x) => `${x.pilot.callsign} has seen more drops than anyone aboard. ${x.pilot2.callsign} keeps asking about them.`,
    choices: [
      { text: 'Let them teach.', apply: (c, x) => { xp(x.pilot2, 500); return `${x.pilot2.callsign} absorbs every lesson. +500 XP.`; } },
      { text: 'Have them write a field manual for the whole company.', apply: (c, x) => { for (const p of c.pilots) if (!p.dead && p !== x.pilot) xp(p, 150); return 'Every other MechWarrior gains 150 XP.'; } },
    ],
  },
  {
    id: 'damaged-mech', title: 'Cannibalize?', where: 'docked',
    weight: (c) => (c.mechs.some((m) => (m as any).wreck) ? 4 : 0),
    text: () => 'The chief tech has a proposal: the wrecked \'Mech in bay four will take weeks to rebuild. Stripping it would get the rest of the lance back in fighting shape faster.',
    choices: [
      { text: 'Keep rebuilding it.', apply: (c) => { mor(c, 1); return 'The techs grumble, but they respect the decision. Morale +1.'; } },
      { text: 'Strip it for parts.', apply: (c) => { const w = c.mechs.find((m) => (m as any).wreck)!; c.mechs = c.mechs.filter((m) => m !== w); c.lance = c.lance.map((u) => (u === w.uid ? null : u)); c.parts[w.defId] = (c.parts[w.defId] ?? 0) + 2; for (const it of w.items) if (!it.dead) c.inventory[it.id] = (c.inventory[it.id] ?? 0) + 1; c.work = c.work.filter((o) => o.mechUid !== w.uid); return 'The wreck is stripped to the frame: 2 chassis parts and its surviving equipment go into storage.'; } },
    ],
  },
  {
    id: 'press', title: 'Interview Request', where: 'docked',
    weight: (c) => (c.stats.wins >= 3 ? 1.5 : 0.3),
    text: (c, x) => `A ${x.sysName} news network wants to interview the commander of the company that has been winning contracts all over the Reach.`,
    choices: [
      { text: 'Give the interview.', apply: (c, x, r) => { if (r.chance(0.7)) { c.mrb += 15; mor(c, 2); return 'The piece is flattering. MRB +15, morale +2.'; } c.rep['locals'] = (c.rep['locals'] ?? 0) - 2; return 'The journalist twists your words. Planetary rep -2.'; } },
      { text: 'No comment.', apply: () => 'The network runs the story anyway, without your side of it.' },
    ],
  },
];

export function pickEvent(c: Company, r: RNG, where: 'travel' | 'docked'): { ev: GameEvent; ctx: EventCtx } | null {
  const alive = c.pilots.filter((p) => !p.dead);
  if (alive.length < 2) return null;
  // Events are spaced out and don't repeat until several others have fired
  if (c.lastEventDay !== undefined && c.day - c.lastEventDay < 7) return null;
  const recent = c.recentEvents ?? [];
  const focal = new Map<string, Pilot>();
  const pool = EVENTS.filter((e) => {
    if ((e.where !== where && e.where !== 'any') || recent.includes(e.id)) return false;
    if (!e.focus) return true;
    const p = e.focus(r.shuffle([...alive]));
    if (p) focal.set(e.id, p);
    return !!p;
  });
  const ev = r.weighted(pool, (e) => e.weight?.(c) ?? 1);
  if (!ev || (ev.weight && ev.weight(c) <= 0)) return null;
  c.lastEventDay = c.day;
  c.recentEvents = [...recent, ev.id].slice(-6);
  const pa = r.shuffle([...alive]);
  const f = focal.get(ev.id);
  if (f) { pa.splice(pa.indexOf(f), 1); pa.unshift(f); }
  return { ev, ctx: { pilot: pa[0], pilot2: pa[1], sysName: sys(c).name } };
}

export function resolveChoice(c: Company, ev: GameEvent, ctx: EventCtx, i: number, r: RNG): string {
  const res = ev.choices[i].apply(c, ctx, r);
  addLog(c, `${ev.title}: ${res}`, '#b27ae8');
  return res;
}
