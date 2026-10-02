// Career state and rules: time, finances, reputation, contracts, markets, hiring, repairs.

import { RNG } from '../engine/rng';
import { Frame, newMechFrame, frameTons, repairEstimate, repairFully, frameValue, refillAmmo, frameName, isFrameDamaged } from './frame';
import { Pilot, makePilot, salary, health, uniqueCallsign, grantAbilities } from './pilot';
import { StarSystem, generateStarMap, route } from './world';
import { MissionType, MISSION_INFO, pilotTier } from '../combat/missions';
import { FACTIONS, faction, repLevel } from '../data/factions';
import { CHASSIS, chassis } from '../data/mechs';
import { item, BASE_WEAPONS, ALL_BASE_ITEMS, bonusesFor } from '../data/items';
import { Biome } from '../combat/terrain';
import { cb } from '../engine/util';

export const CAREER_DAYS = 1200;
export const PARTS_NEEDED = 3;
export const START_YEAR = 3025;

export interface Contract {
  id: string;
  name: string;
  type: MissionType;
  employer: string;
  target: string;
  diff: number;
  biome: Biome;
  night: boolean;
  seed: number;
  pay: number; // max cash
  salvageMax: number;
  expires: number;
  flavor: string;
  targetName?: string;
  maxTons?: number;
  sysId?: string; // travel contract destination
  booked?: Negotiation; // accepted travel contract: terms locked in
}

export interface Negotiation { slider: number; cash: number; salvage: number; priority: number; }

export interface StoreItem { kind: 'item' | 'part' | 'mech'; id: string; qty: number; price: number; }

export interface WorkOrder {
  id: string;
  mechUid: string;
  kind: 'repair' | 'refit' | 'ready' | 'assemble';
  hours: number;
  total: number;
  desc: string;
  cost?: number; // C-Bills paid up front (refundable pro rata on cancel)
}

export interface LogEntry { day: number; text: string; color?: string; }

export interface Upgrade { id: string; name: string; cost: number; upkeep: number; desc: string; requires?: string; }
export const UPGRADES: Upgrade[] = [
  { id: 'tech1', name: 'MechTech Crew II', cost: 700000, upkeep: 15000, desc: '+50% MechTech hours per day for repairs and refits.' },
  { id: 'tech2', name: 'MechTech Crew III', cost: 1600000, upkeep: 30000, desc: '+100% MechTech hours per day.', requires: 'tech1' },
  { id: 'bay2', name: '\'Mech Bay Pod', cost: 1200000, upkeep: 25000, desc: '+4 active \'Mech bays (from 6 to 10).' },
  { id: 'med1', name: 'Medical Bay', cost: 650000, upkeep: 12000, desc: 'Injured MechWarriors heal 40% faster.' },
  { id: 'med2', name: 'Surgical Suite', cost: 1400000, upkeep: 25000, desc: 'Injured MechWarriors heal 70% faster.', requires: 'med1' },
  { id: 'train1', name: 'Training Pods', cost: 900000, upkeep: 15000, desc: 'Every MechWarrior gains 25 XP per day.' },
  { id: 'train2', name: 'Advanced Simulators', cost: 1800000, upkeep: 30000, desc: 'Every MechWarrior gains 60 XP per day.', requires: 'train1' },
  { id: 'hydro', name: 'Hydroponics & Galley', cost: 500000, upkeep: 10000, desc: '+4 Morale from real food.' },
  { id: 'rec', name: 'Recreation Deck', cost: 1300000, upkeep: 22000, desc: '+6 Morale.', requires: 'hydro' },
  { id: 'barracks', name: 'Barracks Expansion', cost: 450000, upkeep: 8000, desc: 'Room for 14 MechWarriors (from 8).' },
  { id: 'drive', name: 'K-F Drive Tuning', cost: 1800000, upkeep: 20000, desc: 'Travel between systems takes 25% less time.' },
  { id: 'comms', name: 'HPG Uplink', cost: 800000, upkeep: 14000, desc: '+1 contract offered in every system; contracts last longer.' },
];

export const EXPENSE_LEVELS = [
  { name: 'Spartan', mult: 0.5, morale: -10 },
  { name: 'Restricted', mult: 0.75, morale: -5 },
  { name: 'Normal', mult: 1.0, morale: 0 },
  { name: 'Generous', mult: 1.25, morale: 5 },
  { name: 'Extravagant', mult: 1.5, morale: 10 },
];

export const MRB_LEVELS = [0, 60, 180, 380, 650, 1000];

export interface Company {
  version: number;
  seed: number;
  name: string;
  day: number;
  funds: number;
  expense: number; // index into EXPENSE_LEVELS
  rep: Record<string, number>;
  mrb: number;
  pilots: Pilot[];
  mechs: Frame[];
  storage: Frame[];
  parts: Record<string, number>;
  inventory: Record<string, number>;
  location: string;
  travel: { path: string[]; legLeft: number; total: number; dest: string } | null;
  systems: StarSystem[];
  contracts: Record<string, Contract[]>; // by system id
  stores: Record<string, StoreItem[]>;
  hires: Record<string, Pilot[]>;
  upgrades: string[];
  work: WorkOrder[];
  lance: (string | null)[]; // mech uids
  lancePilots: (string | null)[];
  log: LogEntry[];
  moraleMod: number; // temporary, decays
  stats: { missions: number; wins: number; kills: number; earned: number; spent: number; mechsLost: number; pilotsLost: number };
  negativeMonths: number;
  gameOver: '' | 'bankrupt' | 'retired' | 'destroyed';
  rngState: number;
  lastExpenses: number;
  pendingEvent?: string;
  ironman: boolean;
  commanderId: string;
  pendingSalvage?: { pool: { kind: 'part' | 'item'; id: string; label: string; value: number }[]; shares: number; priority: number; seed: number; name: string };
  lastEventDay?: number;
  recentEvents?: string[];
  deployDays?: number; // days owed for the last deployment
  travelOffers?: Contract[];
  travelOffersDay?: number;
  installing?: { id: string; doneDay: number }[];
  debts?: { day: number; amount: number; who: string }[];
  fundsHistory?: number[]; // sampled every 3 days
  blackMarket?: boolean; // membership bought from a pirate contact
  blackStores?: Record<string, StoreItem[]>;
  blackStoreDay?: Record<string, number>;
}

export const BLACK_MARKET_FEE = 300000;
/** Pirate havens and frontier worlds host a black market. */
export function hasBlackMarket(s: StarSystem): boolean { return s.owner === 'pirates' || s.tags.includes('frontier'); }

/** Members-only stock: rare equipment, high-tier weapons, the odd rare 'Mech — at a steep markup. */
export function blackStore(c: Company, s: StarSystem): StoreItem[] {
  c.blackStores ??= {}; c.blackStoreDay ??= {};
  if (c.blackStores[s.id] && c.day - (c.blackStoreDay[s.id] ?? -999) <= 30) return c.blackStores[s.id];
  const r = new RNG((c.seed ^ (c.day * 7919) ^ s.id.charCodeAt(1) * 131) >>> 0);
  const out: StoreItem[] = [];
  const mark = 1.6;
  const rare = ALL_BASE_ITEMS.filter((id) => item(id).rarity >= 2 && item(id).kind !== 'ammo');
  for (let i = 0; i < r.int(3, 5); i++) {
    const id = r.pick(rare);
    if (!out.some((o) => o.id === id)) out.push({ kind: 'item', id, qty: 1, price: Math.round((item(id).cost * mark) / 1000) * 1000 });
  }
  const guns = ALL_BASE_ITEMS.filter((id) => item(id).kind === 'weapon' && item(id).rarity <= 1);
  for (let i = 0; i < r.int(3, 5); i++) {
    const base = r.pick(guns);
    const id = `${base}+${r.chance(0.6) ? 2 : 3}${r.pick(bonusesFor(base))}`;
    if (!out.some((o) => o.id === id)) out.push({ kind: 'item', id, qty: 1, price: Math.round((item(id).cost * mark) / 1000) * 1000 });
  }
  if (out.some((o) => o.id === 'GAUSS')) out.push({ kind: 'item', id: 'A-GAUSS', qty: 4, price: Math.round((item('A-GAUSS').cost * mark) / 100) * 100 });
  const mechs = CHASSIS.filter((ch) => ch.rarity >= 1);
  if (mechs.length && r.chance(0.5)) { const ch = r.pick(mechs); out.unshift({ kind: 'mech', id: ch.id, qty: 1, price: Math.round((ch.cost * 1.35) / 5000) * 5000 }); }
  c.blackStores[s.id] = out; c.blackStoreDay[s.id] = c.day;
  return out;
}

export function rngOf(c: Company): RNG {
  const r = new RNG(c.rngState);
  return r;
}
export function saveRng(c: Company, r: RNG): void { c.rngState = r.state; }

export function sys(c: Company, id: string = c.location): StarSystem {
  return c.systems.find((s) => s.id === id)!;
}

export function dateStr(day: number): string {
  const d = new Date(Date.UTC(2025, 2, 1 + day));
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${d.getUTCDate().toString().padStart(2, '0')} ${mon} ${START_YEAR + d.getUTCFullYear() - 2025}`;
}

export function addLog(c: Company, text: string, color?: string, day = c.day): void {
  c.log.push({ day, text, color });
  if (c.log.length > 300) c.log.splice(0, c.log.length - 300);
}

// ---- New career ---------------------------------------------------------------------------
export interface Background { id: string; name: string; desc: string; skills: Partial<Record<'gun' | 'pil' | 'gut' | 'tac', number>>; rep: Record<string, number>; funds: number; }
export const BACKGROUNDS: Background[] = [
  { id: 'davion', name: 'Davion Officer', desc: 'Former lieutenant of the AFFS. Trusted by House Davion, loathed by Liao.', skills: { tac: 2, gun: 1 }, rep: { davion: 15, liao: -15 }, funds: 0 },
  { id: 'liao', name: 'Capellan Defector', desc: 'Fled the Maskirovka with a price on your head. The Canopians like you, though.', skills: { gut: 2, gun: 1 }, rep: { liao: -25, canopus: 15, davion: 5 }, funds: 150000 },
  { id: 'pirate', name: 'Reformed Pirate', desc: 'You know the Periphery\'s dark corners. Governments are wary; smugglers are generous.', skills: { pil: 2, gut: 1 }, rep: { locals: -10, taurian: -10 }, funds: 400000 },
  { id: 'solaris', name: 'Solaris Champion', desc: 'A celebrated arena duelist. Superb pilot, poor tactician, nice bank account.', skills: { pil: 2, gun: 2, tac: -1 }, rep: {}, funds: 600000 },
  { id: 'noble', name: 'Aurigan Noble', desc: 'Exiled from the Reach\'s aristocracy. The Directorate watches you closely.', skills: { tac: 3 }, rep: { aurigan: -15, locals: 15, canopus: 10 }, funds: 250000 },
];

export function newCompany(opts: { name: string; commander: string; callsign: string; background: string; seed: number; hard: boolean; ironman: boolean }): Company {
  const r = new RNG(opts.seed);
  const { systems, start } = generateStarMap(r);
  const bg = BACKGROUNDS.find((b) => b.id === opts.background) ?? BACKGROUNDS[0];
  const rep: Record<string, number> = {};
  for (const f of FACTIONS) rep[f.id] = f.id === 'pirates' ? -30 : 0;
  for (const [k, v] of Object.entries(bg.rep)) rep[k] = (rep[k] ?? 0) + v;
  const cmd = makePilot(r, 2, { name: opts.commander, callsign: opts.callsign, commander: true, bio: `Commander of ${opts.name}. ${bg.desc}`, origin: bg.name, sigil: '★', color: '#f0a830' });
  cmd.gun = 4; cmd.pil = 4; cmd.gut = 4; cmd.tac = 4;
  for (const [k, v] of Object.entries(bg.skills)) (cmd as any)[k] = Math.max(1, Math.min(10, (cmd as any)[k] + v));
  cmd.abilities = [];
  cmd.quirks = (cmd.quirks ?? []).filter((q) => q !== 'greedy' && q !== 'loyal' && q !== 'fickle');
  cmd.missions = 0;
  grantAbilities(cmd);
  const pilots = [cmd];
  const taken = new Set([cmd.callsign]);
  for (const t of [1, 1, 0, 0]) {
    const p = makePilot(r, t);
    p.callsign = uniqueCallsign(r, taken);
    taken.add(p.callsign);
    pilots.push(p);
  }
  // Starting lance: two mediums, two lights (HBS-style random start)
  const meds = ['SHD-2H', 'CN9-A', 'BJ-1', 'VND-1R', 'ENF-4R', 'HBK-4G', 'GRF-1N', 'WVR-6R'];
  const lights = ['JR7-D', 'COM-2D', 'PNT-9R', 'SDR-5V', 'LCT-1V', 'FS9-H'];
  const m1 = r.pick(meds), m2 = r.pick(meds.filter((x) => x !== m1)), l1 = r.pick(lights), l2 = r.pick(lights.filter((x) => x !== l1));
  const mechs = [m1, m2, l1, l2].map((id) => newMechFrame(id));
  const c: Company = {
    version: 1, seed: opts.seed, name: opts.name, day: 0,
    funds: (opts.hard ? 900000 : 1600000) + bg.funds,
    expense: 2, rep, mrb: 0, pilots, mechs, storage: [], parts: {},
    inventory: { ML: 2, SL: 1, HS: 2, 'SRM4': 1, 'A-SRM': 1, 'A-LRM': 1 },
    location: start, travel: null, systems, contracts: {}, stores: {}, hires: {}, upgrades: [], work: [],
    lance: mechs.map((m) => m.uid), lancePilots: pilots.slice(0, 4).map((p) => p.id), log: [], moraleMod: 0,
    stats: { missions: 0, wins: 0, kills: 0, earned: 0, spent: 0, mechsLost: 0, pilotsLost: 0 },
    negativeMonths: 0, gameOver: '', rngState: r.seed(), lastExpenses: 0, ironman: opts.ironman, commanderId: cmd.id,
  };
  refreshSystem(c, true);
  addLog(c, `${opts.name} is founded. The Argo's reactor hums to life above ${sys(c).name}.`, '#f0a830');
  addLog(c, `Contract offers are waiting. Monthly expenses will be ${cb(monthlyExpenses(c).total)}.`);
  return c;
}

// ---- Derived ----------------------------------------------------------------------------
export function has(c: Company, u: string): boolean { return c.upgrades.includes(u); }
export function bays(c: Company): number { return 6 + (has(c, 'bay2') ? 4 : 0); }
export function pilotCap(c: Company): number { return has(c, 'barracks') ? 14 : 8; }
export function techHours(c: Company): number { return Math.round(40 * (1 + (has(c, 'tech1') ? 0.5 : 0) + (has(c, 'tech2') ? 0.5 : 0))); }
export function healMult(c: Company): number { return has(c, 'med2') ? 0.3 : has(c, 'med1') ? 0.6 : 1; }
export function travelMult(c: Company): number { return has(c, 'drive') ? 0.75 : 1; }
export function mrbLevel(c: Company): number { let l = 0; for (let i = 0; i < MRB_LEVELS.length; i++) if (c.mrb >= MRB_LEVELS[i]) l = i; return l; }
export function maxContractDiff(c: Company): number { return Math.min(10, 4 + mrbLevel(c) * 1.5); }

export function morale(c: Company): number {
  let m = 25 + EXPENSE_LEVELS[c.expense].morale + c.moraleMod;
  if (has(c, 'hydro')) m += 4;
  if (has(c, 'rec')) m += 6;
  return Math.max(0, Math.min(50, Math.round(m)));
}

/** Itemised morale sources, for tooltips. */
export function moraleBreakdown(c: Company): [string, number][] {
  const rows: [string, number][] = [['Base', 25], [`Expenses: ${EXPENSE_LEVELS[c.expense].name}`, EXPENSE_LEVELS[c.expense].morale]];
  if (has(c, 'hydro')) rows.push(['Hydroponics & Galley', 4]);
  if (has(c, 'rec')) rows.push(['Recreation Deck', 6]);
  if (c.moraleMod) rows.push(['Recent events (fades 1 per 5 days)', c.moraleMod]);
  return rows;
}

export function moraleName(m: number): string {
  return m >= 40 ? 'Inspired' : m >= 30 ? 'High' : m >= 20 ? 'Content' : m >= 10 ? 'Low' : 'Abysmal';
}

export function monthlyExpenses(c: Company): { argo: number; mechs: number; pilots: number; upgrades: number; total: number; mult: number } {
  const argo = 60000;
  const mechs = c.mechs.reduce((a, m) => a + 12000 + frameTons(m) * 450, 0);
  const pilots = c.pilots.filter((p) => !p.dead).reduce((a, p) => a + salary(p), 0);
  const upgrades = c.upgrades.reduce((a, u) => a + (UPGRADES.find((x) => x.id === u)?.upkeep ?? 0), 0);
  const mult = EXPENSE_LEVELS[c.expense].mult;
  return { argo, mechs, pilots: Math.round(pilots * mult), upgrades, total: Math.round((argo + mechs + upgrades) + pilots * mult), mult };
}

export function mechBusy(c: Company, uid: string): WorkOrder | undefined {
  return c.work.find((w) => w.mechUid === uid);
}

export function mechReady(c: Company, m: Frame): boolean {
  return !mechBusy(c, m.uid) && m.struct.CT > 0 && m.struct.HD > 0;
}

export function companyValue(c: Company): number {
  let v = c.funds;
  for (const m of [...c.mechs, ...c.storage]) v += frameValue(m) * 0.6;
  for (const [id, n] of Object.entries(c.inventory)) v += item(id).cost * 0.4 * n;
  return Math.round(v);
}

export function careerScore(c: Company): number {
  const rep = Object.values(c.rep).reduce((a, v) => a + Math.max(0, v), 0);
  return Math.max(0, Math.round(companyValue(c) / 25000 + c.mrb * 2 + rep * 3 + c.stats.wins * 40 + c.stats.kills * 5 - c.stats.pilotsLost * 30));
}

// ---- Contracts ----------------------------------------------------------------------------
const CONTRACT_NAMES: Record<MissionType, string[]> = {
  battle: ['Clean Sweep', 'Hold the Line', 'Scorched Earth', 'Iron Rain', 'Border Dispute', 'Show of Force', 'Burning Bridges'],
  assassinate: ['Cut the Head', 'Silent Knife', 'Blood Money', 'Last Rites', 'Decapitation Strike', 'The Long Goodbye'],
  destroybase: ['Demolition Crew', 'Wrecking Ball', 'Leveled', 'Foundation Crack', 'Fire Sale', 'Urban Renewal'],
  defendbase: ['Siege Breaker', 'Stand Fast', 'Bulwark', 'The Alamo', 'Garrison Duty', 'Walls of Iron'],
  ambush: ['Highway Robbery', 'Road Toll', 'Supply Cut', 'Dead End', 'Hijack', 'Toll Booth'],
  escort: ['Precious Cargo', 'Shepherd', 'Safe Passage', 'Special Delivery', 'Milk Run', 'Caravan'],
};

export function basePay(diff: number): number {
  return Math.round((240000 + diff * 100000 + diff * diff * 9000) / 5000) * 5000;
}

export function genContract(c: Company, r: RNG, s: StarSystem): Contract {
  const types: MissionType[] = ['battle', 'battle', 'assassinate', 'destroybase', 'defendbase', 'ambush', 'escort'];
  const board0 = c.contracts[s.id] ?? [];
  const type = r.weighted(types, (t) => 1 / (1 + board0.filter((k) => k.type === t).length * 1.2));
  // Employers: owner, locals, and neighbouring powers
  const neigh = new Set<string>([s.owner, 'locals']);
  for (const l of s.links) neigh.add(sys(c, l).owner);
  const employers = [...neigh].filter((f) => faction(f).employer);
  if (!employers.length) employers.push('locals');
  const board = c.contracts[s.id] ?? [];
  const employer = r.weighted(employers, (f) => (f === s.owner ? 2 : f === 'locals' ? 0.9 : 1.4) * (c.rep[f] < -50 ? 0.1 : 1) / (1 + board.filter((k) => k.employer === f).length * 0.8));
  const enemies = faction(employer).enemies.filter((e) => e !== employer);
  let target = r.weighted(enemies, (e) => (neigh.has(e) ? 3 : 1) * (e === 'pirates' ? 1.5 : 1));
  if (!target) target = 'pirates';
  const diff = Math.max(1, Math.min(10, s.diff + r.int(-1, 1) + (type === 'assassinate' ? 1 : 0)));
  const repF = 1 + Math.max(-0.2, Math.min(0.25, (c.rep[employer] ?? 0) / 300));
  const pay = Math.round((basePay(diff) * r.range(0.9, 1.15) * repF * (s.tags.includes('capital') ? 1.15 : 1)) / 5000) * 5000;
  const salvageMax = Math.min(14, 5 + Math.floor(diff / 2) + (repLevel(c.rep[employer] ?? 0).idx >= 5 ? 2 : repLevel(c.rep[employer] ?? 0).idx >= 4 ? 1 : 0));
  const tgtF = faction(target), empF = faction(employer);
  const flavors: Record<MissionType, string> = {
    battle: `${tgtF.short} forces are operating on ${s.name} without authorization. ${empF.short} wants them driven off.`,
    assassinate: `A ${tgtF.short} field commander has become a problem for ${empF.short}. Make it permanent.`,
    destroybase: `${tgtF.short} has established a forward base on ${s.name}. ${empF.short} will pay to see it burn.`,
    defendbase: `${empF.short} intelligence expects a ${tgtF.short} raid on a critical facility. Hold it.`,
    ambush: `A ${tgtF.short} supply convoy is moving through the ${s.name} highlands. Intercept it.`,
    escort: `${empF.short} needs a supply convoy escorted through contested territory on ${s.name}.`,
  };
  return {
    id: 'k' + r.int(0, 1e9).toString(36),
    name: (() => { const used = new Set((c.contracts[s.id] ?? []).map((x) => x.name)); const opts = CONTRACT_NAMES[type].filter((n) => !used.has(n)); return r.pick(opts.length ? opts : CONTRACT_NAMES[type]); })(),
    type, employer, target, diff,
    biome: r.pick(s.biomes),
    night: r.chance(0.18),
    seed: r.seed(),
    pay, salvageMax,
    expires: c.day + r.int(12, 28) + (has(c, 'comms') ? 10 : 0),
    flavor: flavors[type],
    targetName: type === 'assassinate' ? r.pick(['Red Baron', 'The Butcher', 'Iron Duke', 'Cobra', 'Warlord', 'Grendel', 'Mad Dog', 'The Colonel', 'Vulture']) : undefined,
  };
}

export function contractDays(k: Contract): number { return 2 + Math.ceil(k.diff / 3); }

/** How far toward salvage the employer will let you negotiate (HBS: limited by standing). */
export function maxSlider(c: Company, k: Contract): number {
  return Math.max(2, Math.min(10, 2 + repLevel(c.rep[k.employer] ?? 0).idx + mrbLevel(c)));
}

export function negotiate(k: Contract, slider: number): Negotiation {
  // slider 0..10: 0 = all cash, 10 = maximum salvage
  const cash = Math.round((k.pay * (1 - slider * 0.065)) / 1000) * 1000;
  const salvage = Math.round((k.salvageMax * slider) / 10);
  const priority = salvage > 0 ? Math.max(1, Math.ceil(salvage / 3)) : 0;
  return { slider, cash, salvage, priority };
}

// ---- Market / hiring ------------------------------------------------------------------------
export function priceMult(c: Company, s: StarSystem): number {
  const rep = c.rep[s.owner] ?? 0;
  return Math.max(0.8, Math.min(1.35, 1.1 - rep / 400)) * (s.tags.includes('industrial') ? 0.92 : 1);
}
export function sellPrice(c: Company, id: string): number { return Math.round((item(id).cost * 0.35) / 100) * 100; }

function genStore(c: Company, r: RNG, s: StarSystem): StoreItem[] {
  const out: StoreItem[] = [];
  const pm = priceMult(c, s);
  const rich = s.tags.includes('industrial') || s.tags.includes('research') ? 1.6 : s.tags.includes('agricultural') ? 0.6 : 1;
  const maxR = Math.floor(s.diff / 3) + (s.tags.includes('research') ? 2 : 0) + (s.tags.includes('ruins') ? 1 : 0);
  const pool = ALL_BASE_ITEMS.filter((id) => item(id).rarity <= maxR + 1);
  const n = Math.round(r.int(10, 16) * rich);
  for (let i = 0; i < n; i++) {
    let id = r.weighted(pool, (x) => 1 / (1 + item(x).rarity * 1.5));
    if (item(id).kind === 'weapon' && r.chance(0.12 + s.diff * 0.02)) id = `${id}+${r.chance(0.8) ? 1 : 2}${r.pick(bonusesFor(id))}`;
    const ex = out.find((o) => o.id === id);
    if (ex) { ex.qty++; continue; }
    out.push({ kind: 'item', id, qty: item(id).kind === 'ammo' ? r.int(3, 8) : r.int(1, 3), price: Math.round((item(id).cost * pm) / 100) * 100 });
  }
  // Ammo always stocked
  for (const a of ['A-SRM', 'A-LRM', 'A-AC2', 'A-AC5', 'A-AC10', 'A-AC20', 'A-MG']) if (!out.some((o) => o.id === a)) out.push({ kind: 'item', id: a, qty: 5, price: Math.round((item(a).cost * pm) / 100) * 100 });
  // Mech parts and occasionally a complete 'Mech
  const nParts = s.tags.includes('industrial') ? r.int(2, 4) : r.int(0, 2);
  for (let i = 0; i < nParts; i++) {
    const cands = CHASSIS.filter((ch) => ch.rarity <= maxR && Math.abs(ch.tons - (20 + s.diff * 8)) < 30);
    if (!cands.length) break;
    const ch = r.pick(cands);
    out.push({ kind: 'part', id: ch.id, qty: r.int(1, 2), price: Math.round((ch.cost * 0.26 * pm) / 1000) * 1000 });
  }
  const nMechs = (r.chance(s.tags.includes('industrial') ? 0.85 : 0.45) ? 1 : 0) + (s.tags.includes('industrial') && r.chance(0.4) ? 1 : 0);
  for (let i = 0; i < nMechs; i++) {
    const cands = CHASSIS.filter((ch) => ch.rarity <= maxR && Math.abs(ch.tons - (25 + s.diff * 8)) < 25);
    if (cands.length) { const ch = r.pick(cands); out.push({ kind: 'mech', id: ch.id, qty: 1, price: Math.round((ch.cost * 1.1 * pm) / 5000) * 5000 }); }
  }
  return out.sort((a, b) => (a.kind === b.kind ? item2sort(a) - item2sort(b) : a.kind === 'mech' ? -1 : b.kind === 'mech' ? 1 : a.kind === 'part' ? -1 : 1));
}
function item2sort(s: StoreItem): number {
  if (s.kind !== 'item') return 0;
  const d = item(s.id);
  const k = d.kind === 'weapon' ? 0 : d.kind === 'ammo' ? 2 : 1;
  return k * 1000 + (BASE_WEAPONS.indexOf(d.base) + 1) * 10 + (d.tier ?? 0);
}

function genHires(c: Company, r: RNG, s: StarSystem): Pilot[] {
  const n = r.int(2, 3) + (s.tags.includes('starport') ? 2 : 0);
  const taken = new Set(c.pilots.map((p) => p.callsign));
  const out: Pilot[] = [];
  for (let i = 0; i < n; i++) {
    const tier = Math.max(0, Math.min(4, Math.floor(s.diff / 3) + r.int(-1, 1)));
    const p = makePilot(r, tier);
    p.callsign = uniqueCallsign(r, taken);
    taken.add(p.callsign);
    p.hireCost = Math.round((salary(p) * 5 + tier * 40000) / 1000) * 1000;
    out.push(p);
  }
  return out;
}

export function refreshSystem(c: Company, force = false): void {
  const s = sys(c);
  const r = rngOf(c);
  const k = c.contracts[s.id] ?? [];
  const valid = k.filter((x) => x.expires > c.day);
  const want = 5 + (has(c, 'comms') ? 1 : 0) + (s.tags.includes('capital') ? 1 : 0);
  c.contracts[s.id] = valid; // genContract reads the board it is filling (variety, name dedupe)
  if (force || valid.length < want - 2 || c.day - s.contractsDay > 12) {
    while (valid.length < want) valid.push(genContract(c, r, s));
    s.contractsDay = c.day;
  }
  c.contracts[s.id] = valid;
  // Travel contracts: employers in neighbouring systems post work through the local HPG
  if (force || !c.travelOffers || c.day - (c.travelOffersDay ?? -99) > 12) {
    const offers: Contract[] = [];
    for (const l of r.shuffle([...s.links]).slice(0, 4)) {
      const ts = sys(c, l);
      const k = genContract(c, r, ts);
      k.sysId = ts.id;
      k.pay = Math.round((k.pay * 1.2) / 5000) * 5000;
      k.expires = c.day + 25;
      offers.push(k);
    }
    c.travelOffers = offers;
    c.travelOffersDay = c.day;
  }
  if (force || c.day - s.storeDay > 30 || !c.stores[s.id]) { c.stores[s.id] = genStore(c, r, s); s.storeDay = c.day; }
  if (force || c.day - s.hiresDay > 30 || !c.hires[s.id]) { c.hires[s.id] = genHires(c, r, s); s.hiresDay = c.day; }
  // Lifeline: a battered light 'Mech is always for sale when the company is short-handed
  const st = c.stores[s.id];
  const lastUsed = (s as any).usedDay ?? -999;
  if (c.mechs.length + c.storage.length < 3 && st && c.day - lastUsed >= 30 && !st.some((x) => x.kind === 'mech' && x.id.startsWith('USED:'))) {
    (s as any).usedDay = c.day;
    const cand = CHASSIS.filter((ch) => ch.cls === 'L' && ch.rarity === 0);
    const ch = r.pick(cand);
    st.unshift({ kind: 'mech', id: 'USED:' + ch.id, qty: 1, price: Math.round((ch.cost * 0.45) / 5000) * 5000 });
  }
  s.visited = true;
  saveRng(c, r);
}

// ---- Time ------------------------------------------------------------------------------------
export interface DayReport { lines: LogEntry[]; event?: string; gameOver?: string; arrived?: boolean; monthEnd?: boolean; }

export function advanceDay(c: Company): DayReport {
  const rep: DayReport = { lines: [] };
  const say = (text: string, color?: string) => { addLog(c, text, color); rep.lines.push({ day: c.day, text, color }); };
  const r = rngOf(c);
  c.day++;
  // Work orders
  let hours = techHours(c);
  for (const w of [...c.work]) {
    if (hours <= 0) break;
    const use = Math.min(hours, w.hours);
    w.hours -= use;
    hours -= use;
    if (w.hours <= 0) {
      c.work.splice(c.work.indexOf(w), 1);
      const m = c.mechs.find((x) => x.uid === w.mechUid) ?? c.storage.find((x) => x.uid === w.mechUid);
      if (w.kind === 'repair' && m) { repairFully(m); say(`Repairs complete: ${frameName(m)}.`, '#6ad46a'); }
      else if (w.kind === 'refit' && m) say(`Refit complete: ${frameName(m)}.`, '#6ad46a');
      else if (w.kind === 'assemble' && m) say(`Assembly complete: ${frameName(m)} is ready for duty.`, '#6ad46a');
      else if (w.kind === 'ready' && m) say(`${frameName(m)} readied from storage.`, '#6ad46a');
    }
  }
  // Argo refits under way
  for (const ins of [...(c.installing ?? [])]) if (c.day >= ins.doneDay) {
    c.installing = (c.installing ?? []).filter((x) => x !== ins);
    c.upgrades.push(ins.id);
    say(`Argo refit complete: ${UPGRADES.find((u) => u.id === ins.id)?.name ?? ins.id} is online.`, '#6ad46a');
  }
  // Healing & training
  const trainXP = has(c, 'train2') ? 60 : has(c, 'train1') ? 25 : 0;
  for (const p of c.pilots) {
    if (p.dead) continue;
    if (p.injuries > 0) {
      p.healDays--;
      if (p.healDays <= 0) { p.injuries = 0; p.healDays = 0; say(`${p.callsign} has recovered and is fit for duty.`, '#6ad46a'); }
    }
    if (trainXP) { p.xp += trainXP; p.xpTotal += trainXP; }
  }
  // Morale modifier decays toward 0
  if (c.day % 3 === 0) c.fundsHistory = [...(c.fundsHistory ?? []), c.funds].slice(-120);
  if (c.day % 5 === 0 && c.moraleMod !== 0) c.moraleMod += c.moraleMod > 0 ? -1 : 1;
  for (const debt of (c.debts ?? []).filter((x) => c.day >= x.day)) {
    c.funds -= debt.amount; c.stats.spent += debt.amount;
    say(`The ${debt.who} collected ${cb(debt.amount)} in loan repayments.`, '#f0a830');
  }
  if (c.debts?.length) c.debts = c.debts.filter((x) => c.day < x.day);
  // Travel
  if (c.travel) {
    c.travel.legLeft--;
    if (c.travel.legLeft <= 0) {
      c.travel.path.shift();
      c.location = c.travel.path[0];
      if (c.travel.path.length <= 1) {
        const dest = sys(c);
        c.travel = null;
        refreshSystem(c);
        say(`Arrived at ${dest.name}. ${c.contracts[dest.id].length} contracts on offer.`, '#5fd0e8');
        rep.arrived = true;
      } else {
        const next = sys(c, c.travel.path[1]);
        const leg = route(c.systems, c.location, next.id, travelMult(c));
        c.travel.legLeft = leg?.days ?? 5;
        say(`Jump complete: ${sys(c).name}. Next jump to ${next.name}.`, '#5fd0e8');
      }
    }
    if (r.chance(0.045)) rep.event = 'travel';
  } else if (r.chance(0.012)) rep.event = 'docked';
  // Month end
  if (c.day % 30 === 0) {
    const e = monthlyExpenses(c);
    c.funds -= e.total;
    c.stats.spent += e.total;
    c.lastExpenses = e.total;
    say(`Month end: paid ${cb(e.total)} in operating costs.`, '#f0c850');
    rep.monthEnd = true;
    const mor = morale(c);
    if (mor >= 40) say('The crew is inspired. MechWarriors will learn faster on the next contracts.', '#6ad46a');
    if (mor < 12) {
      const cands = c.pilots.filter((p) => !p.dead && !p.commander);
      const flight = cands.filter((p) => !p.quirks?.includes('loyal'));
      if (flight.length && r.chance(mor < 6 ? 0.6 : 0.3)) {
        const p = r.weighted(flight, (q) => (q.quirks?.includes('fickle') ? 3 : 1));
        c.pilots = c.pilots.filter((q) => q !== p);
        c.lancePilots = c.lancePilots.map((id) => (id === p.id ? null : id));
        say(`Morale is ${moraleName(mor).toLowerCase()}: ${p.callsign} has deserted the company.`, '#e8503a');
      } else say('The crew is grumbling about conditions aboard the Argo. Morale is dangerously low.', '#f0a830');
    }
    if (c.funds < 0) liquidate(c, say);
    if (c.funds < 0) {
      c.negativeMonths++;
      if (c.negativeMonths >= 2) { c.gameOver = 'bankrupt'; rep.gameOver = 'bankrupt'; }
      else say('WARNING: The company is in debt. Another month in the red and the creditors will seize the Argo.', '#e8503a');
    } else c.negativeMonths = 0;
  }
  // Contract boards refill while docked (refreshSystem applies its own cadence)
  if (!c.travel) refreshSystem(c);
  if (c.day >= CAREER_DAYS && !c.gameOver) { c.gameOver = 'retired'; rep.gameOver = 'retired'; }
  // Out of 'Mechs with no way to get more: the company is finished
  if (!c.gameOver && c.mechs.length + c.storage.length === 0 && !Object.values(c.parts).some((n) => n >= PARTS_NEEDED)) {
    const onSale = (c.stores[c.location] ?? []).filter((x) => x.kind === 'mech' && x.qty > 0).map((x) => x.price);
    const cheapest = Math.min(...onSale, Math.round(Math.min(...CHASSIS.filter((ch) => ch.cls === 'L').map((ch) => ch.cost)) * 0.45));
    if (c.funds < cheapest) { c.gameOver = 'destroyed'; rep.gameOver = 'destroyed'; say('With no \'Mechs left and no money to buy one, the company dissolves.', '#e8503a'); }
  }
  saveRng(c, r);
  return rep;
}

/** Creditors force a sale of spare equipment, then stored and finally active 'Mechs. */
function liquidate(c: Company, say: (t: string, col?: string) => void): void {
  let raised = 0;
  for (const [id, n] of Object.entries(c.inventory)) { if (c.funds >= 0) break; const v = sellPrice(c, id) * n; c.funds += v; raised += v; c.inventory[id] = 0; }
  for (const [id, n] of Object.entries(c.parts)) { if (c.funds >= 0) break; const v = Math.round(chassis(id).cost * 0.12) * n; c.funds += v; raised += v; c.parts[id] = 0; }
  const sellM = (arr: Frame[]) => { while (c.funds < 0 && arr.length) { const m = arr.pop()!; const v = Math.round(frameValue(m) * 0.35); c.funds += v; raised += v; c.lance = c.lance.map((u) => (u === m.uid ? null : u)); say(`Creditors seized ${frameName(m)}.`, '#e8503a'); } };
  sellM(c.storage);
  if (c.funds < 0 && c.mechs.length > 1) { const keep = c.mechs.slice(0, 1); const rest = c.mechs.slice(1); sellM(rest); c.mechs = [...keep, ...rest]; }
  if (raised) say(`Forced liquidation raised ${cb(raised)} to cover debts.`, '#f0a830');
}

export function startTravel(c: Company, dest: string): string | null {
  if (c.travel) return 'Already travelling';
  if (dest === c.location) return 'Already here';
  const rt = route(c.systems, c.location, dest, travelMult(c));
  if (!rt) return 'No route';
  const first = route(c.systems, c.location, rt.path[1], travelMult(c))!;
  c.travel = { path: rt.path, legLeft: first.days, total: rt.days, dest };
  addLog(c, `Setting course for ${sys(c, dest).name}: ${rt.path.length - 1} jump${rt.path.length > 2 ? 's' : ''}, ${rt.days} days.`, '#5fd0e8');
  return null;
}

export function travelDaysLeft(c: Company): number {
  if (!c.travel) return 0;
  let d = c.travel.legLeft;
  for (let i = 1; i < c.travel.path.length - 1; i++) d += route(c.systems, c.travel.path[i], c.travel.path[i + 1], travelMult(c))?.days ?? 0;
  return d;
}

// ---- Repairs, refits, assembly ---------------------------------------------------------------
export function queueRepair(c: Company, m: Frame): { cost: number; hours: number } | null {
  if (mechBusy(c, m.uid)) return null;
  if (!isFrameDamaged(m)) { refillAmmo(m); return null; }
  const e = repairEstimate(m);
  c.funds -= e.cost;
  c.stats.spent += e.cost;
  c.work.push({ id: 'w' + Math.random().toString(36).slice(2), mechUid: m.uid, kind: 'repair', hours: e.hours, total: e.hours, desc: `Repair ${frameName(m)}`, cost: e.cost });
  return { cost: e.cost, hours: e.hours };
}

export function assembleMech(c: Company, chassisId: string): string | null {
  if ((c.parts[chassisId] ?? 0) < PARTS_NEEDED) return 'Not enough parts';
  c.parts[chassisId] -= PARTS_NEEDED;
  const f = newMechFrame(chassisId);
  // Salvaged 'Mechs arrive stripped of some weapons, like in BATTLETECH
  const rr = rngOf(c);
  f.items = f.items.filter((it) => item(it.id).kind !== 'weapon' || rr.chance(0.5));
  saveRng(c, rr);
  const hrs = 24 + Math.round(chassis(chassisId).tons * 0.6);
  if (c.mechs.length < bays(c)) c.mechs.push(f); else c.storage.push(f);
  c.work.push({ id: 'w' + Math.random().toString(36).slice(2), mechUid: f.uid, kind: 'assemble', hours: hrs, total: hrs, desc: `Assemble ${frameName(f)}` });
  addLog(c, `Assembling ${frameName(f)} from salvaged parts (${hrs} tech-hours).`, '#6ad46a');
  return null;
}

export function hoursToDays(c: Company, h: number): number {
  return Math.ceil(h / techHours(c));
}

export function workQueueDays(c: Company, uid: string): number {
  let acc = 0;
  for (const w of c.work) { acc += w.hours; if (w.mechUid === uid) return Math.ceil(acc / techHours(c)); }
  return 0;
}

export function healDaysFor(c: Company, injuries: number): number {
  return Math.max(3, Math.round(injuries * 14 * healMult(c)));
}

export function pilotStatus(c: Company, p: Pilot): { ok: boolean; text: string; color: string } {
  if (p.dead) return { ok: false, text: 'KIA', color: '#e8503a' };
  if (p.injuries > 0) return { ok: false, text: `Injured ${p.healDays}d`, color: '#f0a830' };
  void c;
  return { ok: true, text: 'Ready', color: '#6ad46a' };
}

export function hireTier(s: StarSystem): number { return pilotTier(s.diff); }
export function missionName(t: MissionType): string { return MISSION_INFO[t].name; }
export { health };
