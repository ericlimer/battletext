// BattleMech chassis. Stock loadouts follow the 3025-era technical readouts used by BATTLETECH.
// Each location lists hardpoints (B/E/M/S) and stock equipment. The fixed "core" tonnage (engine,
// gyro, cockpit, internal structure) is derived so that the stock configuration is exactly at max.

import { HardType, Loc, item, ARMOR_PER_TON, MECH_LOCS, SLOTS } from './items';

export type WeightClass = 'L' | 'M' | 'H' | 'A';

export interface ChassisDef {
  id: string;
  name: string;
  tons: number;
  walk: number; // tabletop walking MP
  jump: number; // max jump jets
  hp: Partial<Record<Loc, string>>;
  stock: Partial<Record<Loc, string>>;
  armor: number; // stock armor as a fraction of maximum
  rarity: number;
  desc: string;
  // derived
  cls: WeightClass;
  coreTons: number;
  hardpoints: Partial<Record<Loc, HardType[]>>;
  stockItems: { id: string; loc: Loc }[];
  stockArmor: Record<string, number>;
  cost: number;
}

type Raw = Omit<ChassisDef, 'cls' | 'coreTons' | 'hardpoints' | 'stockItems' | 'stockArmor' | 'cost'>;

const RAW: Raw[] = [
  // ------------------------------------------------------------------ LIGHT
  { id: 'LCT-1V', name: 'Locust', tons: 20, walk: 8, jump: 0, armor: 0.92, rarity: 0,
    hp: { CT: 'E', LA: 'S', RA: 'S', LT: 'S' },
    stock: { CT: 'ML', LA: 'MG', RA: 'MG', LT: 'A-MG' },
    desc: 'A fast, fragile scout. Locusts are cheap enough that nobody weeps when one is lost.' },
  { id: 'LCT-1M', name: 'Locust', tons: 20, walk: 8, jump: 0, armor: 0.8, rarity: 1,
    hp: { CT: 'E', LA: 'M', RA: 'M' },
    stock: { CT: 'ML', LA: 'LRM5', RA: 'LRM5', LT: 'A-LRM' },
    desc: 'A missile-armed Locust variant that trades its machine guns for twin LRM5 racks.' },
  { id: 'COM-2D', name: 'Commando', tons: 25, walk: 6, jump: 0, armor: 0.72, rarity: 0,
    hp: { LA: 'M', RA: 'EM', RT: 'M', HD: 'S' },
    stock: { LA: 'SRM4', RA: 'ML', RT: 'SRM6', LT: 'A-SRM' },
    desc: 'Coventry\'s pugnacious light brawler. Packs a heavy SRM punch for its weight.' },
  { id: 'SDR-5V', name: 'Spider', tons: 30, walk: 8, jump: 8, armor: 0.55, rarity: 0,
    hp: { CT: 'EE', LT: 'S' },
    stock: { CT: 'ML ML', LL: 'JJ-L JJ-L', RL: 'JJ-L JJ-L', LT: 'JJ-L JJ-L', RT: 'JJ-L JJ-L' },
    desc: 'Jump jets let the Spider leap 240 meters. Hard to hit, harder to pin down.' },
  { id: 'UM-R60', name: 'UrbanMech', tons: 30, walk: 2, jump: 2, armor: 0.86, rarity: 0,
    hp: { RA: 'B', LA: 'S', CT: 'S' },
    stock: { RA: 'AC10', LA: 'SL', RT: 'A-AC10', LL: 'JJ-L', RL: 'JJ-L' },
    desc: 'A slow-moving trash can with an AC/10. Beloved by garrison commanders and memes alike.' },
  { id: 'JR7-D', name: 'Jenner', tons: 35, walk: 7, jump: 5, armor: 0.66, rarity: 0,
    hp: { LA: 'EE', RA: 'EE', CT: 'M' },
    stock: { LA: 'ML ML', RA: 'ML ML', CT: 'SRM4', LT: 'A-SRM JJ-L', RT: 'JJ-L', LL: 'JJ-L', RL: 'JJ-L JJ-L' },
    desc: 'The Draconis Combine\'s premier striker: four medium lasers on a fast, jumping chassis.' },
  { id: 'PNT-9R', name: 'Panther', tons: 35, walk: 4, jump: 4, armor: 0.86, rarity: 0,
    hp: { RA: 'E', CT: 'M', LA: 'S' },
    stock: { RA: 'PPC', CT: 'SRM4', LT: 'A-SRM HS', RT: 'HS HS', LL: 'JJ-L JJ-L', RL: 'JJ-L JJ-L' },
    desc: 'A light \'Mech with a heavy \'Mech\'s gun. The PPC makes the Panther a respectable sniper.' },
  { id: 'FS9-H', name: 'Firestarter', tons: 35, walk: 6, jump: 6, armor: 0.74, rarity: 1,
    hp: { LA: 'SS', RA: 'SS', LT: 'E', RT: 'E', CT: 'SS' },
    stock: { LA: 'FL FL', RA: 'FL FL', LT: 'ML', RT: 'ML', CT: 'MG MG', HD: 'A-MG', LL: 'JJ-L JJ-L JJ-L', RL: 'JJ-L JJ-L JJ-L' },
    desc: 'An arsonist\'s dream. Four flamers push enemy \'Mechs into shutdown.' },
  { id: 'CDA-2A', name: 'Cicada', tons: 40, walk: 8, jump: 0, armor: 0.58, rarity: 0,
    hp: { LT: 'E', RT: 'E', CT: 'S', HD: 'S' },
    stock: { LT: 'ML', RT: 'ML', CT: 'SL' },
    desc: 'Built as a Locust killer: fast, lightly armed, and quick to outflank.' },
  // ------------------------------------------------------------------ MEDIUM
  { id: 'VL-2T', name: 'Vulcan', tons: 40, walk: 6, jump: 6, armor: 0.62, rarity: 1,
    hp: { RA: 'B', LA: 'SE', CT: 'S' },
    stock: { RA: 'AC2', LA: 'ML FL', CT: 'MG', LT: 'A-AC2', RT: 'A-MG', LL: 'JJ-L JJ-L JJ-L', RL: 'JJ-L JJ-L JJ-L' },
    desc: 'An anti-infantry medium. Its long-ranged AC/2 is its only answer to other \'Mechs.' },
  { id: 'BJ-1', name: 'Blackjack', tons: 45, walk: 4, jump: 4, armor: 0.72, rarity: 0,
    hp: { LA: 'BE', RA: 'BE', LT: 'E', RT: 'E' },
    stock: { LA: 'AC2 ML', RA: 'AC2 ML', LT: 'ML A-AC2', RT: 'ML HS', LL: 'JJ-L JJ-L', RL: 'JJ-L JJ-L' },
    desc: 'A fire-support medium with twin AC/2s and a respectable laser battery.' },
  { id: 'VND-1R', name: 'Vindicator', tons: 45, walk: 4, jump: 4, armor: 0.78, rarity: 0,
    hp: { LA: 'E', LT: 'M', HD: 'E', CT: 'S' },
    stock: { LA: 'PPC', LT: 'LRM5 A-LRM', HD: 'ML', CT: 'SL', RT: 'HS HS HS', RA: 'HS HS', LL: 'JJ-L JJ-L', RL: 'JJ-L JJ-L' },
    desc: 'The Capellan Confederation\'s tough, cheap backbone. A PPC and missiles on a jumping frame.' },
  { id: 'CN9-A', name: 'Centurion', tons: 50, walk: 4, jump: 0, armor: 0.74, rarity: 0,
    hp: { RA: 'B', LT: 'M', CT: 'EE', LA: 'S' },
    stock: { RA: 'AC10', LT: 'LRM10 A-LRM', CT: 'ML ML', RT: 'A-AC10 A-AC10' },
    desc: 'A durable line \'Mech known for losing an arm and fighting on. AC/10 and LRM10.' },
  { id: 'CN9-AL', name: 'Centurion', tons: 50, walk: 4, jump: 0, armor: 0.8, rarity: 1,
    hp: { RA: 'E', LT: 'M', CT: 'EE', LA: 'E' },
    stock: { RA: 'LL', LT: 'LRM10 A-LRM', CT: 'ML ML', LA: 'ML', RT: 'HS HS HS' },
    desc: 'A field refit replacing the ammunition-hungry AC/10 with a large laser.' },
  { id: 'HBK-4G', name: 'Hunchback', tons: 50, walk: 4, jump: 0, armor: 0.94, rarity: 0,
    hp: { RT: 'B', LA: 'E', RA: 'E', HD: 'S' },
    stock: { RT: 'AC20 A-AC20 A-AC20', LA: 'ML', RA: 'ML', HD: 'SL', LT: 'HS HS HS' },
    desc: 'The legendary city fighter. Its AC/20 "hunch" can decapitate a \'Mech in one volley.' },
  { id: 'HBK-4P', name: 'Hunchback', tons: 50, walk: 4, jump: 0, armor: 0.9, rarity: 2,
    hp: { RT: 'EEEEEE', LA: 'E', RA: 'E', HD: 'S' },
    stock: { RT: 'ML ML ML ML ML ML', LA: 'ML HS HS', RA: 'ML HS HS', HD: 'SL', LT: 'HS HS HS HS HS HS', LL: 'HS HS', RL: 'HS HS' },
    desc: 'The "Swayback": eight medium lasers and a cooling system to match.' },
  { id: 'ENF-4R', name: 'Enforcer', tons: 50, walk: 4, jump: 4, armor: 0.84, rarity: 0,
    hp: { RA: 'B', LA: 'E', LT: 'S' },
    stock: { RA: 'AC10', LA: 'LL', LT: 'SL', RT: 'A-AC10 A-AC10', LL: 'JJ-L JJ-L', RL: 'JJ-L JJ-L' },
    desc: 'The Federated Suns\' urban brawler. AC/10 and large laser on a jumping chassis.' },
  { id: 'TBT-5N', name: 'Trebuchet', tons: 50, walk: 5, jump: 0, armor: 0.62, rarity: 0,
    hp: { LT: 'M', RT: 'M', LA: 'E', RA: 'E', CT: 'E' },
    stock: { LT: 'LRM15 A-LRM', RT: 'LRM15 A-LRM', LA: 'ML', RA: 'ML', CT: 'ML' },
    desc: 'A missile boat with a medium \'Mech\'s speed. Keep it behind your front line.' },
  { id: 'KTO-18', name: 'Kintaro', tons: 55, walk: 5, jump: 0, armor: 0.84, rarity: 1,
    hp: { LT: 'M', RT: 'M', CT: 'ME', LA: 'E', RA: 'E' },
    stock: { LT: 'SRM6 A-SRM', RT: 'SRM6 A-SRM', CT: 'LRM5', LA: 'ML A-LRM', RA: 'ML' },
    desc: 'A mid-weight missile brawler that saturates targets with SRM fire.' },
  { id: 'GRF-1N', name: 'Griffin', tons: 55, walk: 5, jump: 5, armor: 0.72, rarity: 0,
    hp: { RA: 'E', LT: 'M', HD: 'S' },
    stock: { RA: 'PPC', LT: 'LRM10 A-LRM', RT: 'HS HS', LL: 'JJ-L JJ-L', RL: 'JJ-L JJ-L', CT: 'JJ-L' },
    desc: 'A long-ranged jumping skirmisher. PPC and LRMs let it pick fights at a distance.' },
  { id: 'SHD-2H', name: 'Shadow Hawk', tons: 55, walk: 5, jump: 3, armor: 0.72, rarity: 0,
    hp: { RT: 'B', LT: 'M', HD: 'M', RA: 'E', LA: 'S' },
    stock: { RT: 'AC5 A-AC5', LT: 'LRM5 A-LRM', HD: 'SRM2', RA: 'ML', CT: 'A-SRM JJ-L', LA: 'HS HS', LL: 'JJ-L', RL: 'JJ-L' },
    desc: 'A versatile all-rounder carrying a little of everything.' },
  { id: 'WVR-6R', name: 'Wolverine', tons: 55, walk: 5, jump: 5, armor: 0.82, rarity: 0,
    hp: { RA: 'B', LT: 'M', HD: 'E' },
    stock: { RA: 'AC5 A-AC5', LT: 'SRM6 A-SRM', HD: 'ML', RT: 'HS', LL: 'JJ-L JJ-L', RL: 'JJ-L JJ-L', CT: 'JJ-L' },
    desc: 'A fast, jumping medium with a solid mix of weapons. Respected by pilots everywhere.' },
  // ------------------------------------------------------------------ HEAVY
  { id: 'DRG-1N', name: 'Dragon', tons: 60, walk: 5, jump: 0, armor: 0.78, rarity: 0,
    hp: { RA: 'B', CT: 'M', LA: 'E', LT: 'E' },
    stock: { RA: 'AC5 A-AC5', CT: 'LRM10', LA: 'ML', LT: 'ML A-LRM A-AC5' },
    desc: 'A fast heavy \'Mech with a battering-ram build. The Dragon excels at charging.' },
  { id: 'QKD-4G', name: 'Quickdraw', tons: 60, walk: 5, jump: 5, armor: 0.66, rarity: 0,
    hp: { CT: 'M', LT: 'EM', RT: 'E', LA: 'E', RA: 'E' },
    stock: { LT: 'ML SRM4 A-LRM A-SRM', RT: 'ML HS HS HS', LA: 'ML HS', RA: 'ML HS', LL: 'JJ-H JJ-H', RL: 'JJ-H JJ-H', CT: 'LRM10 JJ-H' },
    desc: 'A jumping heavy, fast for its size, with a powerful laser battery.' },
  { id: 'CPLT-C1', name: 'Catapult', tons: 65, walk: 4, jump: 4, armor: 0.72, rarity: 0,
    hp: { LA: 'M', RA: 'M', LT: 'EE', RT: 'EE' },
    stock: { LA: 'LRM15', RA: 'LRM15', LT: 'ML ML A-LRM', RT: 'ML ML A-LRM', LL: 'JJ-H JJ-H', RL: 'JJ-H JJ-H', CT: 'HS HS' },
    desc: 'The archetypal fire-support \'Mech. Two LRM15 racks rain death at 600 meters.' },
  { id: 'CPLT-K2', name: 'Catapult', tons: 65, walk: 4, jump: 0, armor: 0.78, rarity: 1,
    hp: { LA: 'E', RA: 'E', LT: 'ES', RT: 'ES' },
    stock: { LA: 'PPC HS', RA: 'PPC HS', LT: 'ML MG A-MG', RT: 'ML MG', CT: 'HS HS', LL: 'HS HS', RL: 'HS HS' },
    desc: 'A Kuritan refit replacing the missile arms with twin PPCs.' },
  { id: 'JM6-S', name: 'JagerMech', tons: 65, walk: 4, jump: 0, armor: 0.5, rarity: 0,
    hp: { LA: 'BB', RA: 'BB', LT: 'E', RT: 'E' },
    stock: { LA: 'AC5 AC2', RA: 'AC5 AC2', LT: 'ML A-AC5 A-AC2', RT: 'ML A-AC5 A-AC2' },
    desc: 'An anti-aircraft platform pressed into line service. Great guns, thin armor.' },
  { id: 'TDR-5S', name: 'Thunderbolt', tons: 65, walk: 4, jump: 0, armor: 0.96, rarity: 0,
    hp: { RA: 'E', LT: 'M', LA: 'MSS', RT: 'EEE' },
    stock: { RA: 'LL', LT: 'LRM15 A-LRM A-SRM', LA: 'SRM2 MG MG', RT: 'ML ML ML A-MG', CT: 'HS HS', LL: 'HS HS', RL: 'HS' },
    desc: 'Heavily armored and bristling with weapons. The Thunderbolt is built to stand its ground.' },
  { id: 'GHR-5H', name: 'Grasshopper', tons: 70, walk: 4, jump: 4, armor: 0.9, rarity: 1,
    hp: { CT: 'E', LA: 'E', RA: 'E', LT: 'E', RT: 'E', HD: 'M' },
    stock: { CT: 'LL', LA: 'ML HS HS', RA: 'ML HS HS', LT: 'ML A-LRM HS HS', RT: 'ML HS HS HS HS', HD: 'LRM5', LL: 'JJ-H JJ-H', RL: 'JJ-H JJ-H' },
    desc: 'A jumping, heat-efficient laser platform. Deadly in close-quarters maneuver fights.' },
  { id: 'ON1-K', name: 'Orion', tons: 75, walk: 4, jump: 0, armor: 0.9, rarity: 1,
    hp: { RT: 'B', LT: 'MM', LA: 'E', RA: 'E' },
    stock: { RT: 'AC10 A-AC10 A-AC10', LT: 'LRM15 SRM4 A-LRM A-SRM', LA: 'ML', RA: 'ML' },
    desc: 'A heavy line \'Mech with a legendary reputation. Tough, balanced, reliable.' },
  // ------------------------------------------------------------------ ASSAULT
  { id: 'VTR-9B', name: 'Victor', tons: 80, walk: 4, jump: 4, armor: 0.8, rarity: 1,
    hp: { RA: 'B', LA: 'EE', LT: 'M' },
    stock: { RA: 'AC20', LA: 'ML ML', LT: 'SRM4 A-SRM', RT: 'A-AC20 A-AC20 HS HS', LL: 'JJ-H JJ-H', RL: 'JJ-H JJ-H' },
    desc: 'A jumping assault \'Mech with an AC/20. Victors love to drop in on flanks.' },
  { id: 'AWS-8Q', name: 'Awesome', tons: 80, walk: 3, jump: 0, armor: 0.92, rarity: 1,
    hp: { LA: 'S', RA: 'E', LT: 'E', RT: 'E', HD: 'S' },
    stock: { RA: 'PPC HS HS', LT: 'PPC HS HS HS HS', RT: 'PPC HS HS HS HS', HD: 'SL', LA: 'HS HS HS', LL: 'HS HS', RL: 'HS HS', CT: 'HS' },
    desc: 'Three PPCs and the heat sinks to fire them. A slow, relentless energy fortress.' },
  { id: 'ZEU-6S', name: 'Zeus', tons: 80, walk: 4, jump: 0, armor: 0.84, rarity: 1,
    hp: { LA: 'E', RA: 'M', RT: 'B', LT: 'E', CT: 'E' },
    stock: { LA: 'LL', RA: 'LRM15', RT: 'AC5 A-AC5 A-AC5 A-LRM', LT: 'ML', CT: 'ML', LL: 'HS', RL: 'HS' },
    desc: 'The Lyran Commonwealth\'s balanced assault. Mobile, well-armed and unglamorous.' },
  { id: 'BLR-1G', name: 'BattleMaster', tons: 85, walk: 4, jump: 0, armor: 0.86, rarity: 1,
    hp: { RA: 'E', LT: 'MEE', RT: 'EE', CT: 'EE', LA: 'SS' },
    stock: { RA: 'PPC', LT: 'SRM6 ML ML A-SRM', RT: 'ML ML HS HS HS', CT: 'ML ML', LA: 'MG MG A-MG', LL: 'HS HS', RL: 'HS HS' },
    desc: 'A command \'Mech built to lead from the front. Its PPC and six lasers can fight anything.' },
  { id: 'STK-3F', name: 'Stalker', tons: 85, walk: 3, jump: 0, armor: 0.8, rarity: 1,
    hp: { LA: 'EEE', RA: 'EEE', LT: 'MM', RT: 'MM' },
    stock: { LA: 'LL ML ML', RA: 'LL ML ML', LT: 'LRM10 SRM6 A-LRM A-SRM', RT: 'LRM10 SRM6 A-LRM A-SRM', CT: 'HS HS', LL: 'HS HS HS', RL: 'HS HS HS' },
    desc: 'A walking arsenal. Slow, but there is no range at which the Stalker is not dangerous.' },
  { id: 'HGN-732', name: 'Highlander', tons: 90, walk: 3, jump: 3, armor: 0.9, rarity: 3,
    hp: { RA: 'B', LT: 'M', RT: 'M', LA: 'E', CT: 'E' },
    stock: { RA: 'GAUSS A-GAUSS A-GAUSS', LT: 'LRM20 A-LRM A-LRM', RT: 'SRM6 A-SRM', LA: 'ML', CT: 'ML JJ-A', LL: 'JJ-A', RL: 'JJ-A' },
    desc: 'A Star League-era assault \'Mech with a Gauss rifle. Famous for the "Highlander Burial".' },
  { id: 'BNC-3E', name: 'Banshee', tons: 95, walk: 4, jump: 0, armor: 0.66, rarity: 1,
    hp: { RT: 'E', LT: 'B', HD: 'S', LA: 'E', RA: 'E' },
    stock: { RT: 'PPC', LT: 'AC5 A-AC5', HD: 'SL', LA: 'HS HS', RA: 'HS HS' },
    desc: 'An assault \'Mech with a light \'Mech\'s arsenal. Fast for its size; an ideal refit candidate.' },
  { id: 'KGC-0000', name: 'King Crab', tons: 100, walk: 3, jump: 0, armor: 0.88, rarity: 3,
    hp: { LA: 'B', RA: 'B', RT: 'M', LT: 'E', HD: 'S' },
    stock: { LA: 'AC20', RA: 'AC20', RT: 'LRM15 A-LRM A-AC20 A-AC20', LT: 'ML A-AC20 A-AC20 HS HS', CT: 'HS HS', LL: 'HS', RL: 'HS' },
    desc: 'Two AC/20 "claws" make the King Crab the most feared close-range \'Mech in the Inner Sphere.' },
  { id: 'AS7-D', name: 'Atlas', tons: 100, walk: 3, jump: 0, armor: 0.98, rarity: 2,
    hp: { RT: 'B', LT: 'MM', LA: 'E', RA: 'E', CT: 'EE' },
    stock: { RT: 'AC20 A-AC20 A-AC20 HS HS HS HS', LT: 'LRM20 SRM6 A-LRM A-LRM A-SRM HS', LA: 'ML', RA: 'ML', CT: 'ML ML HS', LL: 'HS HS', RL: 'HS' },
    desc: 'The skull-faced king of the battlefield. When an Atlas walks in, lesser \'Mechs walk out.' },
];

// ---- Internal structure (tabletop x5): [CT, side torso, arm, leg]; head is always 15
const IS_TABLE: Record<number, [number, number, number, number]> = {
  20: [6, 5, 3, 4], 25: [8, 6, 4, 6], 30: [10, 7, 5, 7], 35: [11, 8, 6, 8], 40: [12, 10, 6, 10],
  45: [14, 11, 7, 11], 50: [16, 12, 8, 12], 55: [18, 13, 9, 13], 60: [20, 14, 10, 14], 65: [21, 15, 10, 15],
  70: [22, 15, 11, 15], 75: [23, 16, 12, 16], 80: [25, 17, 13, 17], 85: [27, 18, 14, 18], 90: [29, 19, 15, 19],
  95: [30, 20, 16, 20], 100: [31, 21, 17, 21],
};

export function structureFor(tons: number): Record<Loc, number> {
  const t = IS_TABLE[tons];
  return { HD: 15, CT: t[0] * 5, LT: t[1] * 5, RT: t[1] * 5, LA: t[2] * 5, RA: t[2] * 5, LL: t[3] * 5, RL: t[3] * 5 };
}

export function maxArmorFor(tons: number): Record<Loc, number> {
  const s = structureFor(tons);
  const o = {} as Record<Loc, number>;
  for (const l of MECH_LOCS) o[l] = l === 'HD' ? 45 : s[l] * 2;
  return o;
}

export function classOf(tons: number): WeightClass {
  return tons < 40 ? 'L' : tons < 60 ? 'M' : tons < 80 ? 'H' : 'A';
}
export const CLASS_NAMES: Record<WeightClass, string> = { L: 'Light', M: 'Medium', H: 'Heavy', A: 'Assault' };

/** Split stock armor into front/rear per location, rounded to 5s. */
function stockArmorFor(tons: number, frac: number): Record<string, number> {
  const mx = maxArmorFor(tons);
  const out: Record<string, number> = {};
  const r5 = (n: number) => Math.round(n / 5) * 5;
  for (const l of MECH_LOCS) {
    const total = r5(mx[l] * frac);
    if (l === 'CT' || l === 'LT' || l === 'RT') {
      const rear = r5(total * 0.26);
      out[l] = total - rear;
      out[l + 'R'] = rear;
    } else out[l] = total;
  }
  return out;
}

export function armorTons(a: Record<string, number>): number {
  let s = 0;
  for (const k in a) s += a[k];
  return s / ARMOR_PER_TON;
}

export const CHASSIS: ChassisDef[] = RAW.map((r) => {
  const hardpoints: Partial<Record<Loc, HardType[]>> = {};
  for (const [l, s] of Object.entries(r.hp)) hardpoints[l as Loc] = [...(s as string)] as HardType[];
  const stockItems: { id: string; loc: Loc }[] = [];
  for (const [l, s] of Object.entries(r.stock)) {
    if (!(MECH_LOCS as string[]).includes(l)) continue;
    for (const id of (s as string).split(' ').filter(Boolean)) stockItems.push({ id, loc: l as Loc });
  }
  const stockArmor = stockArmorFor(r.tons, r.armor);
  const itemTons = stockItems.reduce((a, it) => a + item(it.id).tons, 0);
  const coreTons = r.tons - itemTons - armorTons(stockArmor);
  const itemCost = stockItems.reduce((a, it) => a + item(it.id).cost, 0);
  const speedF = 1 + (r.walk - 4) * 0.12 + r.jump * 0.02;
  const cost = Math.round((r.tons * 60000 * speedF + itemCost * 0.8 + armorTons(stockArmor) * 10000) / 5000) * 5000;
  return { ...r, cls: classOf(r.tons), coreTons, hardpoints, stockItems, stockArmor, cost };
});

const BY_ID = new Map(CHASSIS.map((c) => [c.id, c]));
export function chassis(id: string): ChassisDef {
  const c = BY_ID.get(id);
  if (!c) throw new Error('Unknown chassis ' + id);
  return c;
}

export function slotsUsed(items: { id: string; loc: Loc }[], loc: Loc): number {
  return items.filter((i) => i.loc === loc).reduce((a, i) => a + item(i.id).slots, 0);
}
export { SLOTS };
