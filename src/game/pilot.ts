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
const BIO_A = ['Washed out of the', 'Graduated near the top of the', 'Deserted from the', 'Was a decorated officer in the', 'Trained informally with the',
  'Spent a decade in the', 'Was blacklisted by the', 'Bought out a contract from the'];
const BIO_B = ['Robinson Battle Academy', 'Sian Military Academy', 'Allison MechWarrior Institute', 'Taurian Defense Force', 'Canopian Institute of War',
  'planetary militia', 'Kell Hounds', 'Blackhearts', 'Eridani Light Horse', 'Northwind Highlanders', 'Solaris arena circuit', 'Aurigan Coalition'];
const BIO_C = ['Quiet, methodical, and deeply superstitious about their cockpit.', 'Talks constantly over comms. Nobody minds, because they never miss.',
  'Carries a battered holo of a family nobody has ever met.', 'Has a reputation for pushing reactors past redline.', 'Collects enemy callsigns in a notebook.',
  'Refuses to pilot anything without a proper hand actuator.', 'Owes money to at least three different crime syndicates.',
  'Believes, sincerely, that the Star League will return.', 'Sings off-key during combat drops.', 'Once walked a legged Centurion forty kilometers home.',
  'Keeps the company\'s morale up with an endless supply of bad jokes.', 'Speaks rarely; when they do, people listen.',
  'Survived an ejection at 400 meters and has not stopped talking about it.', 'Is convinced the dropship\'s coffee is poisoned.'];
const SIGILS = ['☼', '♠', '♣', '♦', '♥', '§', '¤', 'Ω', 'Δ', 'Ψ', 'Σ', '†', '‡', '¥', '∞', '≡', 'Φ', 'Θ', 'λ', 'µ'];
const COLORS = ['#5fc8f0', '#f0a830', '#8ae878', '#e878b0', '#b27ae8', '#f0d050', '#6ab8e8', '#e86a5a', '#78e8d0', '#d8a878'];

let pid = 0;
export function makePilot(r: RNG, tier: number, opts: Partial<Pilot> = {}): Pilot {
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
    bio: `${r.pick(BIO_A)} ${r.pick(BIO_B)}. ${r.pick(BIO_C)}`,
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
