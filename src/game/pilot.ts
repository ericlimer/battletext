// MechWarriors: skills, abilities, XP, injuries, salaries.

import { RNG } from '../engine/rng';

export type Skill = 'gun' | 'pil' | 'gut' | 'tac';
export const SKILLS: Skill[] = ['gun', 'pil', 'gut', 'tac'];
export const SKILL_NAMES: Record<Skill, string> = { gun: 'Gunnery', pil: 'Piloting', gut: 'Guts', tac: 'Tactics' };
export const SKILL_DESC: Record<Skill, string> = {
  gun: 'Accuracy with all ranged weapons (+3% per level) and critical hit chance.',
  pil: 'Evasion from movement, melee accuracy, and resistance to stability damage.',
  gut: 'Pilot health (+1 at 4, 7 and 10), overheat tolerance and ejection resistance.',
  tac: 'Indirect fire accuracy, Precision Strike focus, and initiative awareness.',
};

export interface AbilityDef { id: string; name: string; skill: Skill; tier: 5 | 8; desc: string; active?: boolean; }
export const ABILITIES: AbilityDef[] = [
  { id: 'multitarget', name: 'Multi-Target', skill: 'gun', tier: 5, active: true, desc: 'Split weapons between up to three different targets in a single attack.' },
  { id: 'breaching', name: 'Breaching Shot', skill: 'gun', tier: 8, desc: 'When firing a single weapon, the shot ignores cover and Guarded damage reduction.' },
  { id: 'evasive', name: 'Evasive Movement', skill: 'pil', tier: 5, desc: '+1 maximum evasion, and evasion is gained more quickly when moving.' },
  { id: 'ace', name: 'Ace Pilot', skill: 'pil', tier: 8, desc: 'May move after attacking, if the unit has not moved yet this activation.' },
  { id: 'bulwark', name: 'Bulwark', skill: 'gut', tier: 5, desc: 'The unit is Guarded (-40% damage) if it does not move during its activation.' },
  { id: 'juggernaut', name: 'Juggernaut', skill: 'gut', tier: 8, desc: 'Melee attacks knock the target back one initiative phase and deal 50% more stability damage.' },
  { id: 'sensorlock', name: 'Sensor Lock', skill: 'tac', tier: 5, active: true, desc: 'Instead of attacking, lock onto a target within sensor range: it loses 2 evasion and is revealed to all allies.' },
  { id: 'mastertactician', name: 'Master Tactician', skill: 'tac', tier: 8, desc: '+1 initiative. This pilot\'s unit always acts one phase earlier.' },
];
/** Roles are assigned by the player to mark which two skills a MechWarrior is being trained in. */
export type RoleId = 'skirmisher' | 'gunslinger' | 'artillerist' | 'bruiser' | 'scout' | 'anchor';
export interface RoleDef { id: RoleId; name: string; skills: [Skill, Skill]; desc: string }
export const ROLES: RoleDef[] = [
  { id: 'skirmisher', name: 'Skirmisher', skills: ['gun', 'pil'], desc: 'Accurate on the move: hit-and-run in fast \'Mechs.' },
  { id: 'gunslinger', name: 'Gunslinger', skills: ['gun', 'gut'], desc: 'Stands in the open trading alphas and runs hot.' },
  { id: 'artillerist', name: 'Artillerist', skills: ['gun', 'tac'], desc: 'Long-range and indirect fire from the back line.' },
  { id: 'bruiser', name: 'Bruiser', skills: ['pil', 'gut'], desc: 'Closes in for melee, DFA and stability damage.' },
  { id: 'scout', name: 'Scout', skills: ['pil', 'tac'], desc: 'Evasive spotter: sensor locks and initiative.' },
  { id: 'anchor', name: 'Anchor', skills: ['gut', 'tac'], desc: 'Holds a position and soaks fire.' },
];
export function roleOf(p: Pilot | null | undefined): RoleDef | null { return p?.role ? ROLES.find((r) => r.id === p.role) ?? null : null; }
/** The role whose two skills are this pilot's strongest pair: highest sum, then the higher of the two, then ROLES order. */
export function suggestRole(p: Pilot): RoleId {
  let best = ROLES[0], bs = -1;
  for (const r of ROLES) {
    const sc = (p[r.skills[0]] + p[r.skills[1]]) * 100 + Math.max(p[r.skills[0]], p[r.skills[1]]);
    if (sc > bs) { bs = sc; best = r; }
  }
  return best.id;
}
export function isRoleSkill(p: Pilot | null | undefined, s: Skill): boolean { return !!roleOf(p)?.skills.includes(s); }
/** Name of the ability the next point in a skill would unlock, if any. */
export function nextUnlock(p: Pilot, s: Skill): string | null {
  if (p[s] >= 10) return null;
  const q: Pilot = { ...p, abilities: [...p.abilities] };
  q[s]++;
  const g = grantAbilities(q);
  return g ? g.replace('New ability: ', '') : null;
}

export function ability(id: string): AbilityDef {
  return ABILITIES.find((a) => a.id === id)!;
}

export interface Pilot {
  id: string;
  name: string;
  callsign: string;
  gun: number;
  pil: number;
  gut: number;
  tac: number;
  xp: number; // unspent
  xpTotal: number;
  abilities: string[];
  injuries: number;
  healDays: number;
  dead?: boolean;
  commander?: boolean;
  bio: string;
  origin: string;
  kills: number;
  missions: number;
  diedDay?: number;
  memorial?: boolean;
  sigil: string;
  color: string;
  hireCost?: number;
  timeline: string[];
  quirks?: string[];
  /** Player-assigned role: which two skills this MechWarrior is being trained in. Hire candidates come with one suggested. */
  role?: RoleId;
  /** Day the pilot joined the company. */
  joined?: number;
  /** How the pilot died, recorded at death (older saves only have diedDay). */
  fell?: { day: number; where: string; mech: string; mission: string; by?: string };
}

export interface QuirkDef { id: string; name: string; desc: string; good: boolean; }
export const QUIRKS: QuirkDef[] = [
  { id: 'sharpshooter', name: 'Sharpshooter', desc: '+5% accuracy at long range.', good: true },
  { id: 'brawler', name: 'Brawler', desc: 'Melee attacks deal 15% more damage and are 5% more accurate.', good: true },
  { id: 'coolhead', name: 'Cool Head', desc: 'Ignores the accuracy penalty for overheating.', good: true },
  { id: 'nightowl', name: 'Night Owl', desc: 'Ignores the night-fighting accuracy penalty.', good: true },
  { id: 'tough', name: 'Tough as Nails', desc: '+1 health.', good: true },
  { id: 'jumpy', name: 'Jumpy', desc: '+1 maximum evasion.', good: true },
  { id: 'loyal', name: 'Loyal', desc: 'Will never desert, however bad morale gets.', good: true },
  { id: 'greedy', name: 'Greedy', desc: 'Demands 25% more salary.', good: false },
  { id: 'fickle', name: 'Fickle', desc: 'The first to leave when morale drops.', good: false },
  { id: 'reckless', name: 'Reckless', desc: '-5% accuracy after moving, but +5% melee accuracy.', good: false },
];
export function quirk(id: string): QuirkDef { return QUIRKS.find((q) => q.id === id)!; }
export function hasQuirk(p: Pilot | null | undefined, id: string): boolean { return !!p?.quirks?.includes(id); }

export function health(p: Pilot): number {
  return 3 + (p.gut >= 4 ? 1 : 0) + (p.gut >= 7 ? 1 : 0) + (p.gut >= 10 ? 1 : 0) + (p.quirks?.includes('tough') ? 1 : 0);
}
export function has(p: Pilot | undefined, ab: string): boolean {
  return !!p && p.abilities.includes(ab);
}
export function skillTotal(p: Pilot): number {
  return p.gun + p.pil + p.gut + p.tac;
}
export function salary(p: Pilot): number {
  if (p.commander) return 0;
  const t = skillTotal(p);
  return Math.round(((4000 + t * t * 38) * (p.quirks?.includes('greedy') ? 1.25 : 1)) / 500) * 500;
}
export function xpCost(level: number): number {
  // cost to raise from level to level+1
  return Math.round(level * level * 110 + level * 150);
}
export function isAvailable(p: Pilot): boolean {
  return !p.dead && p.injuries === 0;
}
export function pilotRank(p: Pilot): string {
  const t = skillTotal(p);
  return t >= 32 ? 'Elite' : t >= 26 ? 'Veteran' : t >= 20 ? 'Regular' : t >= 14 ? 'Green' : 'Rookie';
}

/** Raise a skill if affordable. Grants abilities at 5 and 8 within HBS-style limits. */
export function trainSkill(p: Pilot, s: Skill): string | null {
  if (p[s] >= 10) return 'Already at maximum';
  const cost = xpCost(p[s]);
  if (p.xp < cost) return 'Not enough experience';
  p.xp -= cost;
  p[s]++;
  return grantAbilities(p);
}

export function grantAbilities(p: Pilot): string | null {
  let granted: string | null = null;
  for (const a of ABILITIES) {
    if (p.abilities.includes(a.id)) continue;
    if (p[a.skill] < a.tier) continue;
    if (p.abilities.length >= 3) break;
    if (a.tier === 8 && p.abilities.some((x) => ability(x).tier === 8)) continue;
    // Tier 8 requires the tier 5 of the same skill
    if (a.tier === 8 && !p.abilities.some((x) => ability(x).skill === a.skill)) continue;
    p.abilities.push(a.id);
    granted = a.name;
  }
  return granted ? `New ability: ${granted}` : null;
}

// ---- Generation ---------------------------------------------------------------------------
const FIRST = ['Aleksandr', 'Ines', 'Tomas', 'Yuki', 'Darius', 'Mira', 'Oskar', 'Leilani', 'Kaito', 'Farah', 'Rhys', 'Nadia', 'Bram', 'Solene', 'Idris', 'Petra',
  'Marcus', 'Anya', 'Juno', 'Viktor', 'Sasha', 'Ravi', 'Hollis', 'Esme', 'Callum', 'Dagny', 'Emeka', 'Ayla', 'Jonah', 'Keiko', 'Lucan', 'Maren', 'Nico', 'Odile',
  'Pieter', 'Quinn', 'Rosalind', 'Stellan', 'Tamsin', 'Ulla', 'Vasco', 'Wren', 'Xiadani', 'Yusuf', 'Zora', 'Behrouz', 'Catalina', 'Dmitri', 'Elif', 'Gideon',
  'Hana', 'Ivo', 'Jasna', 'Kofi', 'Liesl', 'Matteo', 'Noor', 'Orla', 'Priya', 'Ruslan', 'Signe', 'Teodor', 'Vesna', 'Anselm', 'Brigid', 'Casimir', 'Delphine'];
const LAST = ['Vance', 'Okonkwo', 'Lindqvist', 'Moreau', 'Tanaka', 'Kerensky', 'Albescu', 'Haldane', 'Ruiz', 'Novak', 'Achterberg', 'Cho', 'Delacroix', 'Eze',
  'Fairweather', 'Grimaldi', 'Hayashi', 'Ivanova', 'Jansen', 'Kowalczyk', 'Laurent', 'Mbeki', 'Nakamura', 'Oyelaran', 'Petrov', 'Quist', 'Rasmussen', 'Sato',
  'Thorne', 'Uzun', 'Varga', 'Whitlock', 'Xu', 'Yilmaz', 'Zaragoza', 'Arkwright', 'Bellweather', 'Castellanos', 'Dunmore', 'Everard', 'Falkenrath', 'Garrow',
  'Hesse', 'Ibarra', 'Kalani', 'Lorne', 'Mastrangelo', 'Nkemelu', 'Ortega', 'Pryce', 'Reinholt', 'Sokolova', 'Tamura', 'Valdez', 'Wexley', 'Ashgrove'];
const CALLSIGNS = ['Ghost', 'Hammer', 'Vixen', 'Deadeye', 'Tinman', 'Bishop', 'Rattler', 'Sparrow', 'Mako', 'Halo', 'Grim', 'Jinx', 'Nomad', 'Ember', 'Wrench',
  'Saint', 'Bulldog', 'Magpie', 'Cinder', 'Onyx', 'Rook', 'Kestrel', 'Tank', 'Pyro', 'Dutch', 'Longshot', 'Echo', 'Lucky', 'Frostbite', 'Havoc', 'Ironside',
  'Juggler', 'Knuckles', 'Lynx', 'Mongoose', 'Nightjar', 'Oracle', 'Pitbull', 'Quicksilver', 'Rampart', 'Scythe', 'Tallboy', 'Umbra', 'Viper', 'Wildcard',
  'Yardstick', 'Zealot', 'Anvil', 'Banshee', 'Cobalt', 'Dervish', 'Flint', 'Gambit', 'Hex', 'Icarus', 'Jackal', 'Kingpin', 'Lancer', 'Mortar', 'Needle',
  'Outlaw', 'Patch', 'Reaper', 'Shrike', 'Thistle', 'Vandal', 'Warden', 'Boomer', 'Cricket', 'Dozer', 'Fang', 'Glitch', 'Hotshot', 'Mustang', 'Static'];
const ORIGINS = ['Federated Suns', 'Capellan Confederation', 'Free Worlds League', 'Taurian Concordat', 'Magistracy of Canopus', 'Aurigan Reach',
  'Lyran Commonwealth', 'Draconis Combine', 'the Periphery', 'Outworlds Alliance', 'a pirate band', 'a Solaris VII stable'];
// Backgrounds follow from origin: academies and home-guard units of their realm, or a mercenary outfit
const ACADEMY_VERBS = ['Washed out of the', 'Graduated near the top of the', 'Was expelled from the', 'Finished a hard-won commission at the',
  'Scraped through the', 'Taught simulator classes at the', 'Left in their final year at the', 'Graduated dead last from the',
  'Was quietly asked to leave the', 'Holds two disciplinary records from the'];
const UNIT_VERBS = ['Deserted from the', 'Was a decorated officer in the', 'Spent a decade in the', 'Was blacklisted by the', 'Bought out a contract from the', 'Washed out of the',
  'Was cashiered from the', 'Lost a lance and a promotion in the', 'Spent six years as a tech in the', 'Was the last survivor of a company in the',
  'Resigned a commission in the', 'Was court-martialled and acquitted by the', 'Pulled garrison duty for years in the'];
const SCHOOLS: Record<string, [string, 'academy' | 'unit'][]> = {
  'Federated Suns': [['Robinson Battle Academy', 'academy'], ['Davion Light Guards', 'unit'], ['planetary militia', 'unit'], ['New Avalon Military Academy', 'academy'], ['Crucis Lancers', 'unit'], ['March Militia', 'unit']],
  'Capellan Confederation': [['Sian Military Academy', 'academy'], ['Capellan Hussars', 'unit'], ['planetary militia', 'unit'], ['Sarna Military Academy', 'academy'], ['Liao Reserves', 'unit'], ['Capellan home guard', 'unit']],
  'Free Worlds League': [['Allison MechWarrior Institute', 'academy'], ['Fusiliers of Oriente', 'unit'], ['planetary militia', 'unit'], ['Princefield Academy', 'academy'], ['Marik Militia', 'unit'], ['Atreus garrison regiment', 'unit']],
  'Taurian Concordat': [['Taurian Defense Force', 'unit'], ['Taurian Military Academy', 'academy'], ['Pleiades Hussars', 'unit'], ['Concordat border pickets', 'unit']],
  'Magistracy of Canopus': [['Canopian Institute of War', 'academy'], ['Magistracy Royal Guard', 'unit'], ['Canopian Highlanders', 'unit'], ['Crater Cobras training cadre', 'academy']],
  'Aurigan Reach': [['Aurigan Coalition', 'unit'], ['Aurigan Royal Academy', 'academy'], ['planetary militia', 'unit'], ['Directorate house guard', 'unit'], ['Coromodir cadet school', 'academy'], ['Reach border patrol', 'unit']],
  'Lyran Commonwealth': [['Nagelring', 'academy'], ['Lyran Guards', 'unit'], ['planetary militia', 'unit'], ['Tharkad Military College', 'academy'], ['Donegal Guards', 'unit'], ['Lyran Regulars', 'unit']],
  'Draconis Combine': [['Sun Zhang Academy', 'academy'], ['Sword of Light', 'unit'], ['Wisdom of the Dragon academy', 'academy'], ['Combine regular army', 'unit']],
  'the Periphery': [['planetary militia', 'unit'], ['frontier caravan guard', 'unit'], ['mining-concern security force', 'unit'], ['colony defence corps', 'unit']],
  'Outworlds Alliance': [['Outworlds Alliance Militia', 'unit'], ['planetary militia', 'unit'], ['Alliance Military Academy', 'academy'], ['Alliance aerospace reserve', 'unit']],
  'a pirate band': [['Tortuga raiders', 'unit'], ['Marian Hegemony slave-legions', 'unit'], ['Rim Collection reavers', 'unit'], ['Oberon Confederation raiders', 'unit']],
  'a Solaris VII stable': [['Solaris arena circuit', 'unit'], ['Solaris VII training stables', 'academy'], ['Factory district pit fights', 'unit'], ['Steiner Stadium junior league', 'academy']],
};
const MERCS: string[] = ['Kell Hounds', 'Blackhearts', 'Eridani Light Horse', 'Northwind Highlanders', 'Gray Death Legion', 'Waco Rangers', 'Hansen\'s Roughriders', 'Snord\'s Irregulars',
  'Avanti\'s Angels', 'Fighting Urukhai'];
/** First half of a bio: where the pilot learned their trade. */
function bioFor(r: RNG, origin: string): string {
  const own = SCHOOLS[origin] ?? [['planetary militia', 'unit']];
  const [where, kind] = r.chance(0.7) || origin === 'a pirate band' ? r.pick(own) : [r.pick(MERCS), 'unit' as const];
  return `${r.pick(kind === 'academy' ? ACADEMY_VERBS : UNIT_VERBS)} ${where}.`;
}
// Second half: a character note. Kept unique within the company (see takenBios in company.ts).
const BIO_C = ['Quiet, methodical, and deeply superstitious about their cockpit.', 'Talks constantly over comms. Nobody minds, because they never miss.',
  'Carries a battered holo of a family nobody has ever met.', 'Has a reputation for pushing reactors past redline.', 'Collects enemy callsigns in a notebook.',
  'Refuses to pilot anything without a proper hand actuator.', 'Owes money to at least three different crime syndicates.',
  'Believes, sincerely, that the Star League will return.', 'Sings off-key during combat drops.', 'Once walked a legged Centurion forty kilometers home.',
  'Keeps the company\'s morale up with an endless supply of bad jokes.', 'Speaks rarely; when they do, people listen.',
  'Survived an ejection at 400 meters and has not stopped talking about it.', 'Is convinced the dropship\'s coffee is poisoned.',
  'Sleeps in the cockpit before every drop. Says the bunks are too quiet.', 'Keeps a tally of every heat sink they have ever cooked.',
  'Pays the techs in cigarettes and gossip. It works.', 'Has a bounty on their head in two star systems and is proud of neither.',
  'Reads old military manuals for fun and quotes them at the worst moments.', 'Never names their \'Mech. Says it is bad luck to get attached.',
  'Lost two fingers to a coolant leak and still fires with that hand.', 'Writes letters home every week and never sends them.',
  'Can strip a medium laser blindfolded and will bet you on it.', 'Distrusts anyone who has never walked a \'Mech through a swamp.',
  'Gambles away every bonus by the next jump.', 'Has a scar from a Solaris duel they refuse to discuss.',
  'Hums the same four bars of a lullaby while lining up a shot.', 'Treats every briefing like a negotiation.',
  'Once held a bridge for six hours with a jammed autocannon.', 'Insists on checking every weld after the techs are done.',
  'Was declared dead once. The paperwork was never corrected.', 'Keeps a dried flower from a world that no longer exists taped to the HUD.',
  'Refuses to eat before a drop and is foul-tempered until after.', 'Knows every bar owner within three jumps of the Argo by name.',
  'Has an opinion about every \'Mech design and most of them are insulting.', 'Volunteers for the night watch and nobody asks why.',
  'Learned to pilot on an agricultural IndustrialMech and it shows.', 'Is unfailingly polite over open channels, especially to the enemy.',
  'Counts their ammunition aloud. Every round. Every time.', 'Took a neurohelmet from a dead mentor and still wears it.'];
/** The parts of a bio that should not repeat within a company: the background and the character note. */
export function bioFragments(bio: string): string[] {
  const c = BIO_C.find((x) => bio.endsWith(x));
  return c ? [bio.slice(0, bio.length - c.length).trim(), c].filter(Boolean) : [bio];
}
/** A bio built from pools, steering clear of fragments already in `taken`. With nothing taken it draws exactly as before. */
export function makeBio(r: RNG, origin: string, taken?: Set<string>): string {
  let a = bioFor(r, origin);
  for (let k = 0; k < 8 && taken?.has(a); k++) a = bioFor(r, origin);
  let b = r.pick(BIO_C);
  if (taken?.has(b)) { const free = BIO_C.filter((x) => !taken.has(x)); if (free.length) b = r.pick(free); }
  return `${a} ${b}`;
}
// Pilot icons: a symbol + colour pair unique within the company. Symbols avoid glyphs the battle map uses.
export const SIGILS = ['☼', '♦', '♥', '§', 'Ω', 'Δ', 'Ψ', 'Σ', '†', '‡', '¥', 'Φ', 'Θ', 'λ', 'µ', '☾', '✦', '♪', '¶', 'Ж'];
// No reds, oranges or browns (hue ~340-45°): those read as enemy (C.enemy) on the map. Old colours are reassigned on load.
export const COLORS = ['#f0e050', '#8ae878', '#4ad8c8', '#5fa8ff', '#b27ae8', '#ff7ad0', '#e8e8e8', '#c8f060', '#9a9aff', '#a0e8ff'];
export const COMMANDER_COLOR = '#ffd84a'; // gold, clear of the enemy red/orange band

/** Gives p an icon nobody in `others` has, preferring a symbol and a colour that are both unused. */
export function assignIcon(p: Pilot, others: Pilot[], rnd: () => number = Math.random): void {
  const live = others.filter((o) => o !== p && !o.dead);
  const usedS = new Set(live.map((o) => o.sigil)), usedC = new Set(live.map((o) => o.color));
  const usedPair = new Set(live.map((o) => o.sigil + o.color));
  const shuffled = <T,>(a: T[]) => a.map((v) => [rnd(), v] as const).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
  let best: [string, string] | null = null, bestScore = -1;
  for (const sg of shuffled(SIGILS)) for (const col of shuffled(COLORS)) {
    if (usedPair.has(sg + col)) continue;
    const sc = (usedS.has(sg) ? 0 : 2) + (usedC.has(col) ? 0 : 1);
    if (sc > bestScore) { bestScore = sc; best = [sg, col]; if (sc === 3) break; }
    if (bestScore === 3) break;
  }
  if (best) { p.sigil = best[0]; p.color = best[1]; }
}

/** Repairs duplicate or legacy icons (the commander keeps the gold star). */
export function ensureIcons(pilots: Pilot[]): void {
  const done: Pilot[] = [];
  const live = pilots.filter((p) => !p.dead);
  const symbolsLeft = live.length <= SIGILS.length;
  for (const p of live) {
    if (p.commander) { p.sigil = '★'; p.color = COMMANDER_COLOR; done.push(p); continue; }
    // While there are symbols to spare, each pilot gets their own symbol, not just their own colour
    const clash = done.some((q) => q.sigil === p.sigil && (symbolsLeft || q.color === p.color));
    if (!SIGILS.includes(p.sigil) || !COLORS.includes(p.color) || clash) assignIcon(p, done);
    done.push(p);
  }
}

/** Markup for a pilot's icon, for ctext. */
export function iconTag(p: Pilot): string { return `{${p.color}}${p.sigil}{/}`; }

let pid = 0;
/** `taken`: bio fragments already in use in the company (see bioFragments); the new pilot avoids them. */
export function makePilot(r: RNG, tier: number, opts: Partial<Pilot> = {}, taken?: Set<string>): Pilot {
  // tier: 0 rookie .. 4 elite; distribute skill points
  const budget = 12 + tier * 5 + r.int(-1, 2);
  const s = { gun: 1, pil: 1, gut: 1, tac: 1 };
  let pts = budget - 4;
  const focus = r.pick(SKILLS);
  while (pts > 0) {
    const k = r.chance(0.35) ? focus : r.pick(SKILLS);
    if (s[k] >= Math.min(10, 4 + tier * 2)) continue;
    s[k]++;
    pts--;
  }
  const origin = r.pick(ORIGINS);
  const p: Pilot = {
    id: 'p' + (++pid) + r.int(0, 1e6).toString(36),
    name: `${r.pick(FIRST)} ${r.pick(LAST)}`,
    callsign: r.pick(CALLSIGNS),
    ...s,
    xp: 0,
    xpTotal: tier * 4000,
    abilities: [],
    injuries: 0,
    healDays: 0,
    bio: makeBio(r, origin, taken),
    origin,
    kills: 0,
    missions: tier * r.int(2, 6),
    sigil: r.pick(SIGILS),
    color: r.pick(COLORS),
    timeline: [],
    quirks: r.shuffle([...QUIRKS]).slice(0, r.chance(0.35) ? 2 : r.chance(0.6) ? 1 : 0).map((q) => q.id),
    ...opts,
  };
  grantAbilities(p);
  return p;
}

export function uniqueCallsign(r: RNG, taken: Set<string>): string {
  for (let i = 0; i < 50; i++) {
    const c = r.pick(CALLSIGNS);
    if (!taken.has(c)) return c;
  }
  return r.pick(CALLSIGNS) + '-' + r.int(2, 9);
}
