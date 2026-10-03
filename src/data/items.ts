// Weapons, ammunition and equipment. Numbers follow BATTLETECH (2018) scale: damage/armor are 5x
// tabletop, heat sinks dissipate 3/turn, ranges are tabletop hexes (1 tile = 30m).

export type HardType = 'B' | 'E' | 'M' | 'S'; // Ballistic, Energy, Missile, Support
export type ItemKind = 'weapon' | 'ammo' | 'heatsink' | 'jumpjet' | 'equip';
export type Loc = 'HD' | 'CT' | 'LT' | 'RT' | 'LA' | 'RA' | 'LL' | 'RL';
export const MECH_LOCS: Loc[] = ['HD', 'LA', 'LT', 'CT', 'RT', 'RA', 'LL', 'RL'];
export const LOC_NAMES: Record<string, string> = {
  HD: 'Head', CT: 'Center Torso', LT: 'Left Torso', RT: 'Right Torso', LA: 'Left Arm', RA: 'Right Arm', LL: 'Left Leg', RL: 'Right Leg',
  CTR: 'CT (Rear)', LTR: 'LT (Rear)', RTR: 'RT (Rear)',
  F: 'Front', L: 'Left Side', R: 'Right Side', B: 'Rear', T: 'Turret', S: 'Structure',
};
export const SLOTS: Record<Loc, number> = { HD: 1, CT: 4, LT: 10, RT: 10, LA: 8, RA: 8, LL: 4, RL: 4 };

export interface ItemDef {
  id: string;
  base: string; // base id for variants
  name: string;
  short: string;
  kind: ItemKind;
  hard?: HardType;
  tons: number;
  slots: number;
  cost: number;
  rarity: number; // 0 common .. 5 lostech
  desc: string;
  // weapon stats
  dmg?: number;
  heat?: number;
  stab?: number;
  shots?: number; // projectiles per attack (missiles, MG bursts)
  min?: number;
  sr?: number;
  mr?: number;
  lr?: number;
  ammo?: string;
  acc?: number; // accuracy bonus in percentage points
  crit?: number; // crit chance multiplier
  targetHeat?: number;
  indirect?: boolean;
  debuffAcc?: number; // PPC style: target accuracy penalty next activation
  tier?: number; // +, ++, +++
  bonusText?: string;
  // ammo
  ammoFor?: string;
  ammoShots?: number;
  explode?: number; // explosion damage per remaining shot
  // equipment
  dissip?: number;
  heatCap?: number;
  jumpClass?: 'L' | 'H' | 'A';
  locs?: Loc[]; // allowed locations
  stabBonus?: number; // % reduction to stability damage taken
  meleeBonus?: number; // % melee damage
  sensorBonus?: number; // tiles
  accBonus?: number;
  injuryResist?: number;
  initBonus?: number;
  evasionBonus?: number;
}

type WDef = Omit<ItemDef, 'base' | 'kind'> & { kind?: ItemKind };

const W: WDef[] = [
  // ---- Energy
  { id: 'ML', name: 'Medium Laser', short: 'ML', hard: 'E', tons: 1, slots: 1, dmg: 25, heat: 10, stab: 0, min: 0, sr: 3, mr: 6, lr: 9, cost: 40000, rarity: 0,
    desc: 'The workhorse of the Inner Sphere. Light, reliable, ammunition-free.' },
  { id: 'LL', name: 'Large Laser', short: 'LL', hard: 'E', tons: 5, slots: 2, dmg: 40, heat: 18, stab: 0, min: 0, sr: 5, mr: 10, lr: 15, cost: 100000, rarity: 1,
    desc: 'Long-range laser with a punishing heat profile.' },
  { id: 'PPC', name: 'PPC', short: 'PPC', hard: 'E', tons: 7, slots: 3, dmg: 50, heat: 30, stab: 10, min: 3, sr: 6, mr: 12, lr: 18, cost: 200000, rarity: 1, debuffAcc: 10,
    desc: 'Particle Projector Cannon. Its ion storm scrambles the target\'s sensors (-10% accuracy on its next attack). Inaccurate inside 90m.' },
  // ---- Support
  { id: 'SL', name: 'Small Laser', short: 'SL', hard: 'S', tons: 0.5, slots: 1, dmg: 15, heat: 5, stab: 0, min: 0, sr: 1, mr: 2, lr: 3, cost: 11000, rarity: 0,
    desc: 'Anti-personnel laser. Short ranged but nearly heat-free.' },
  { id: 'MG', name: 'Machine Gun', short: 'MG', hard: 'S', tons: 0.5, slots: 1, dmg: 5, heat: 0, stab: 1, shots: 2, min: 0, sr: 1, mr: 2, lr: 3, ammo: 'A-MG', crit: 2.5, cost: 8000, rarity: 0,
    desc: 'Twin-burst anti-personnel gun. Excellent at finding critical hits in exposed structure.' },
  { id: 'FL', name: 'Flamer', short: 'FLAMER', hard: 'S', tons: 1, slots: 1, dmg: 10, heat: 8, stab: 0, min: 0, sr: 1, mr: 2, lr: 3, targetHeat: 15, cost: 12000, rarity: 0,
    desc: 'Sprays burning fuel gel. Adds 15 heat to the target.' },
  // ---- Ballistic
  { id: 'AC2', name: 'AC/2', short: 'AC/2', hard: 'B', tons: 6, slots: 1, dmg: 25, heat: 3, stab: 10, min: 4, sr: 8, mr: 16, lr: 24, ammo: 'A-AC2', cost: 60000, rarity: 0, acc: 5,
    desc: 'Light autocannon with exceptional reach and accuracy.' },
  { id: 'AC5', name: 'AC/5', short: 'AC/5', hard: 'B', tons: 8, slots: 2, dmg: 45, heat: 5, stab: 15, min: 3, sr: 6, mr: 12, lr: 18, ammo: 'A-AC5', cost: 125000, rarity: 0,
    desc: 'Medium autocannon. A balanced, dependable weapon.' },
  { id: 'AC10', name: 'AC/10', short: 'AC/10', hard: 'B', tons: 12, slots: 3, dmg: 60, heat: 10, stab: 25, min: 0, sr: 5, mr: 10, lr: 15, ammo: 'A-AC10', cost: 200000, rarity: 1,
    desc: 'Heavy autocannon. Staggering impacts destabilize targets.' },
  { id: 'AC20', name: 'AC/20', short: 'AC/20', hard: 'B', tons: 14, slots: 4, dmg: 100, heat: 20, stab: 40, min: 0, sr: 3, mr: 6, lr: 9, ammo: 'A-AC20', cost: 300000, rarity: 1,
    desc: 'The biggest gun in the Inner Sphere. A single shell can core a light \'Mech.' },
  { id: 'GAUSS', name: 'Gauss Rifle', short: 'GAUSS', hard: 'B', tons: 15, slots: 5, dmg: 75, heat: 5, stab: 35, min: 2, sr: 7, mr: 15, lr: 22, ammo: 'A-GAUSS', cost: 650000, rarity: 5, acc: 5,
    desc: 'LOSTECH. Magnetic accelerator firing nickel-ferrous slugs. Nearly heatless — but its capacitors explode if critically hit.' },
  // ---- Missile
  { id: 'SRM2', name: 'SRM2', short: 'SRM2', hard: 'M', tons: 1, slots: 1, dmg: 8, heat: 4, stab: 3, shots: 2, min: 0, sr: 3, mr: 6, lr: 9, ammo: 'A-SRM', cost: 20000, rarity: 0,
    desc: 'Twin short-range missile rack.' },
  { id: 'SRM4', name: 'SRM4', short: 'SRM4', hard: 'M', tons: 2, slots: 1, dmg: 8, heat: 6, stab: 3, shots: 4, min: 0, sr: 3, mr: 6, lr: 9, ammo: 'A-SRM', cost: 40000, rarity: 0,
    desc: 'Four-tube short-range missile rack.' },
  { id: 'SRM6', name: 'SRM6', short: 'SRM6', hard: 'M', tons: 3, slots: 2, dmg: 8, heat: 8, stab: 3, shots: 6, min: 0, sr: 3, mr: 6, lr: 9, ammo: 'A-SRM', cost: 60000, rarity: 0,
    desc: 'Six-tube short-range missile rack. Brutal at knife-fighting range.' },
  { id: 'LRM5', name: 'LRM5', short: 'LRM5', hard: 'M', tons: 2, slots: 1, dmg: 4, heat: 6, stab: 2, shots: 5, min: 6, sr: 7, mr: 14, lr: 21, ammo: 'A-LRM', indirect: true, cost: 30000, rarity: 0,
    desc: 'Long-range missiles. Capable of indirect fire at targets spotted by allies.' },
  { id: 'LRM10', name: 'LRM10', short: 'LRM10', hard: 'M', tons: 5, slots: 2, dmg: 4, heat: 8, stab: 2, shots: 10, min: 6, sr: 7, mr: 14, lr: 21, ammo: 'A-LRM', indirect: true, cost: 100000, rarity: 0,
    desc: 'Long-range missiles. Capable of indirect fire at targets spotted by allies.' },
  { id: 'LRM15', name: 'LRM15', short: 'LRM15', hard: 'M', tons: 7, slots: 3, dmg: 4, heat: 10, stab: 2, shots: 15, min: 6, sr: 7, mr: 14, lr: 21, ammo: 'A-LRM', indirect: true, cost: 175000, rarity: 1,
    desc: 'Long-range missiles. Capable of indirect fire at targets spotted by allies.' },
  { id: 'LRM20', name: 'LRM20', short: 'LRM20', hard: 'M', tons: 10, slots: 4, dmg: 4, heat: 12, stab: 2, shots: 20, min: 6, sr: 7, mr: 14, lr: 21, ammo: 'A-LRM', indirect: true, cost: 250000, rarity: 1,
    desc: 'The heaviest missile rack. Saturates a target with twenty warheads.' },
];

const AMMO: WDef[] = [
  { id: 'A-MG', kind: 'ammo', name: 'MG Ammo', short: 'MG AM', tons: 1, slots: 1, ammoFor: 'MG', ammoShots: 100, explode: 5, cost: 2000, rarity: 0, desc: 'Machine gun ammunition. 100 rounds.' },
  { id: 'A-AC2', kind: 'ammo', name: 'AC/2 Ammo', short: 'AC2 AM', tons: 1, slots: 1, ammoFor: 'AC2', ammoShots: 25, explode: 12, cost: 3000, rarity: 0, desc: 'AC/2 ammunition. 25 shots.' },
  { id: 'A-AC5', kind: 'ammo', name: 'AC/5 Ammo', short: 'AC5 AM', tons: 1, slots: 1, ammoFor: 'AC5', ammoShots: 15, explode: 22, cost: 4500, rarity: 0, desc: 'AC/5 ammunition. 15 shots.' },
  { id: 'A-AC10', kind: 'ammo', name: 'AC/10 Ammo', short: 'AC10 AM', tons: 1, slots: 1, ammoFor: 'AC10', ammoShots: 8, explode: 30, cost: 6000, rarity: 0, desc: 'AC/10 ammunition. 8 shots.' },
  { id: 'A-AC20', kind: 'ammo', name: 'AC/20 Ammo', short: 'AC20 AM', tons: 1, slots: 1, ammoFor: 'AC20', ammoShots: 5, explode: 50, cost: 10000, rarity: 0, desc: 'AC/20 ammunition. 5 shots.' },
  { id: 'A-GAUSS', kind: 'ammo', name: 'Gauss Ammo', short: 'GSS AM', tons: 1, slots: 1, ammoFor: 'GAUSS', ammoShots: 8, explode: 0, cost: 20000, rarity: 3, desc: 'Gauss slugs. 8 shots. Inert — cannot explode.' },
  { id: 'A-SRM', kind: 'ammo', name: 'SRM Ammo', short: 'SRM AM', tons: 1, slots: 1, ammoFor: 'SRM', ammoShots: 100, explode: 4, cost: 4000, rarity: 0, desc: 'Short-range missiles. 100 warheads shared by all SRM launchers.' },
  { id: 'A-LRM', kind: 'ammo', name: 'LRM Ammo', short: 'LRM AM', tons: 1, slots: 1, ammoFor: 'LRM', ammoShots: 120, explode: 2, cost: 5000, rarity: 0, desc: 'Long-range missiles. 120 warheads shared by all LRM launchers.' },
];

const EQ: WDef[] = [
  { id: 'HS', kind: 'heatsink', name: 'Heat Sink', short: 'HS', tons: 1, slots: 1, dissip: 3, cost: 30000, rarity: 0,
    desc: 'Dissipates 3 heat per turn. Every \'Mech carries 10 in its engine.' },
  { id: 'DHS', kind: 'heatsink', name: 'Double Heat Sink', short: 'DHS', tons: 1, slots: 3, dissip: 6, cost: 280000, rarity: 5,
    desc: 'LOSTECH. Star League freezer. Dissipates 6 heat per turn.' },
  { id: 'HB', kind: 'heatsink', name: 'Heat Bank', short: 'H.BANK', tons: 1, slots: 1, heatCap: 15, cost: 45000, rarity: 1,
    desc: 'Coolant reservoir. +15 heat capacity before overheating.' },
  { id: 'JJ-L', kind: 'jumpjet', name: 'Jump Jet (L/M)', short: 'JJ', tons: 0.5, slots: 1, jumpClass: 'L', locs: ['LT', 'RT', 'CT', 'LL', 'RL'], cost: 30000, rarity: 0,
    desc: 'Jump jet for \'Mechs up to 55 tons. Each adds one tile of jump distance.' },
  { id: 'JJ-H', kind: 'jumpjet', name: 'Jump Jet (H)', short: 'JJ', tons: 1, slots: 1, jumpClass: 'H', locs: ['LT', 'RT', 'CT', 'LL', 'RL'], cost: 50000, rarity: 0,
    desc: 'Jump jet for \'Mechs of 60–85 tons.' },
  { id: 'JJ-A', kind: 'jumpjet', name: 'Jump Jet (A)', short: 'JJ', tons: 2, slots: 1, jumpClass: 'A', locs: ['LT', 'RT', 'CT', 'LL', 'RL'], cost: 90000, rarity: 1,
    desc: 'Jump jet for \'Mechs of 90 tons and above.' },
  { id: 'TTS', kind: 'equip', name: 'Targeting Tracking System', short: 'TTS', tons: 1, slots: 1, accBonus: 5, locs: ['LT', 'RT', 'CT', 'HD'], cost: 150000, rarity: 2,
    desc: '+5% accuracy for all weapons.' },
  { id: 'TTS2', kind: 'equip', name: 'Targeting Tracking System +', short: 'TTS+', tons: 1, slots: 1, accBonus: 10, locs: ['LT', 'RT', 'CT', 'HD'], cost: 400000, rarity: 4,
    desc: '+10% accuracy for all weapons.' },
  { id: 'GYRO', kind: 'equip', name: 'Gyro +', short: 'GYRO+', tons: 1, slots: 2, stabBonus: 20, locs: ['CT'], cost: 120000, rarity: 2,
    desc: 'Enhanced gyroscope. -20% stability damage taken.' },
  { id: 'GYRO2', kind: 'equip', name: 'Gyro ++', short: 'GYRO++', tons: 1, slots: 2, stabBonus: 35, locs: ['CT'], cost: 300000, rarity: 4,
    desc: 'Star League gyroscope. -35% stability damage taken.' },
  { id: 'ACT', kind: 'equip', name: 'Arm Actuator +', short: 'ACTU+', tons: 1, slots: 1, meleeBonus: 25, locs: ['LA', 'RA'], cost: 80000, rarity: 1,
    desc: 'Reinforced arm actuators. +25% melee damage.' },
  { id: 'SENS', kind: 'equip', name: 'Sensor Array +', short: 'SENS+', tons: 1, slots: 1, sensorBonus: 4, locs: ['HD'], cost: 90000, rarity: 1,
    desc: 'Cockpit mod. +4 tiles sensor range.' },
  { id: 'CPIT', kind: 'equip', name: 'Cockpit Mod: Safety Cage', short: 'CAGE', tons: 1, slots: 1, injuryResist: 1, locs: ['HD'], cost: 110000, rarity: 2,
    desc: 'Cockpit mod. Ignores the first pilot injury each mission.' },
  { id: 'CMD', kind: 'equip', name: 'Command Console', short: 'C.CON', tons: 3, slots: 1, initBonus: 1, locs: ['HD'], cost: 500000, rarity: 4,
    desc: 'Cockpit mod. +1 initiative for this \'Mech.' },
];

// ---- Variant generation (+, ++, +++) ---------------------------------------------------------
export type Bonus = 'd' | 'a' | 'h' | 's' | 'c';
const BONUS_NAMES: Record<Bonus, string> = { d: 'Damage', a: 'Accuracy', h: 'Heat', s: 'Stability dmg', c: 'Crit chance' };
const MFR = ['Magna', 'Diverse Optics', 'Martell', 'Defiance', 'Harmon', 'Imperator', 'Federated', 'Corean', 'Delta', 'Holly', 'Zeus', 'Kali Yama', 'Armstrong', 'Mydron'];

// Each weapon class handles differently: precise small arms and light rifles hit more often, heavy
// autocannons and missile clusters less. Unlisted weapons keep their own acc (or 0).
const CLASS_ACC: Record<string, number> = { SL: 10, MG: 5, FL: 5, ML: 0, LL: 0, PPC: -5, AC2: 5, AC5: 0, AC10: -5, AC20: -10, GAUSS: 5, SRM2: -5, SRM4: -5, SRM6: -5, LRM5: -5, LRM10: -5, LRM15: -5, LRM20: -5 };
for (const w of W) if (CLASS_ACC[w.id] !== undefined) w.acc = CLASS_ACC[w.id];
const REG = new Map<string, ItemDef>();
for (const w of W) REG.set(w.id, { ...w, base: w.id, kind: 'weapon' } as ItemDef);
for (const a of AMMO) REG.set(a.id, { ...a, base: a.id, kind: 'ammo' } as ItemDef);
for (const e of EQ) REG.set(e.id, { ...e, base: e.id, kind: e.kind ?? 'equip' } as ItemDef);

export const BASE_WEAPONS = W.map((w) => w.id);
export const ALL_BASE_ITEMS = [...REG.keys()];

export function bonusesFor(base: string): Bonus[] {
  const b = REG.get(base);
  if (!b || b.kind !== 'weapon') return [];
  const out: Bonus[] = ['d', 'a'];
  if ((b.heat ?? 0) >= 5) out.push('h');
  if ((b.stab ?? 0) >= 5) out.push('s');
  out.push('c');
  return out;
}

/** Resolve an item id; variant ids look like "ML+2d" (tier 2 damage variant). */
export function item(id: string): ItemDef {
  let it = REG.get(id);
  if (it) return it;
  const m = /^([A-Z0-9-]+)\+(\d)([dahsc])$/.exec(id);
  if (!m) throw new Error('Unknown item ' + id);
  const base = REG.get(m[1]);
  if (!base) throw new Error('Unknown base item ' + id);
  const tier = +m[2];
  const bonus = m[3] as Bonus;
  const v: ItemDef = { ...base, id, tier };
  v.name = `${base.name} ${'+'.repeat(tier)}`;
  v.short = `${base.short}${'+'.repeat(tier)}`;
  const perShotDmg = base.dmg ?? 0;
  switch (bonus) {
    case 'd': {
      const inc = Math.max(1, Math.round((perShotDmg * 0.1 * tier) / (perShotDmg >= 10 ? 5 : 1)) * (perShotDmg >= 10 ? 5 : 1));
      v.dmg = perShotDmg + (base.shots && base.shots > 2 ? Math.max(1, Math.round(perShotDmg * 0.12 * tier)) : inc);
      v.bonusText = `+${v.dmg - perShotDmg} Damage${base.shots && base.shots > 1 ? ' per shot' : ''}`;
      break;
    }
    case 'a': v.acc = (base.acc ?? 0) + 5 * tier; v.bonusText = `+${5 * tier}% Accuracy`; break;
    case 'h': v.heat = Math.max(0, Math.round((base.heat ?? 0) * (1 - 0.15 * tier))); v.bonusText = `-${(base.heat ?? 0) - v.heat} Heat`; break;
    case 's': v.stab = Math.round((base.stab ?? 0) * (1 + 0.3 * tier)); v.bonusText = `+${v.stab - (base.stab ?? 0)} Stability dmg`; break;
    case 'c': v.crit = (base.crit ?? 1) + 0.5 * tier; v.bonusText = `+${50 * tier}% Crit chance`; break;
  }
  const mfr = MFR[(hashStr(id) >>> 0) % MFR.length];
  v.desc = `${mfr} ${BONUS_NAMES[bonus].toLowerCase()} variant. ${base.desc}`;
  v.cost = Math.round(base.cost * (1 + tier * 1.2) / 1000) * 1000;
  v.rarity = Math.min(5, base.rarity + tier + 1);
  REG.set(id, v);
  return v;
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function isWeapon(id: string): boolean { return item(id).kind === 'weapon'; }

export function ammoType(weaponId: string): string | undefined {
  return item(weaponId).ammo;
}

/** Does this ammo bin feed this weapon? */
export function ammoFeeds(ammoId: string, weaponId: string): boolean {
  const a = item(ammoId), w = item(weaponId);
  return a.kind === 'ammo' && w.ammo === ammoId;
}

export function jumpJetFor(tons: number): string {
  return tons <= 55 ? 'JJ-L' : tons <= 85 ? 'JJ-H' : 'JJ-A';
}

export function hardName(h: HardType): string {
  return { B: 'Ballistic', E: 'Energy', M: 'Missile', S: 'Support' }[h];
}
export const HARD_COLORS: Record<HardType, string> = { B: '#e8c24a', E: '#e86a5a', M: '#6ab8e8', S: '#b8b8b8' };
export const ARMOR_PER_TON = 80;
export const ARMOR_COST_PER_PT = 40;
