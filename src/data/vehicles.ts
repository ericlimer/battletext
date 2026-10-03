// Combat vehicles and emplacements. Vehicles have Front/Left/Right/Rear/Turret locations and are
// destroyed when any location's structure is gone. They generate no heat and cannot be knocked down.

export type VLoc = 'F' | 'L' | 'R' | 'B' | 'T';
export const VEH_LOCS: VLoc[] = ['F', 'L', 'R', 'B', 'T'];

export interface VehicleDef {
  id: string;
  name: string;
  short: string;
  tons: number;
  mp: number; // cruise tiles-ish (tabletop cruise MP)
  armor: Partial<Record<VLoc, number>>;
  items: string[]; // weapons; ammo is auto-added
  kind: 'vehicle' | 'turret';
  glyph: string;
  role: string;
  rarity: number;
  cost: number;
  desc: string;
}

export const VEHICLES: VehicleDef[] = [
  { id: 'APC', name: 'Armored Personnel Carrier', short: 'APC', tons: 20, mp: 6, kind: 'vehicle', glyph: 'a', role: 'scout',
    armor: { F: 60, L: 45, R: 45, B: 35, T: 40 }, items: ['MG', 'MG'], rarity: 0, cost: 250000, desc: 'A lightly armed troop transport.' },
  { id: 'JEDGAR', name: 'J. Edgar Hovertank', short: 'J.EDGAR', tons: 25, mp: 8, kind: 'vehicle', glyph: 'h', role: 'scout',
    armor: { F: 70, L: 50, R: 50, B: 40, T: 50 }, items: ['ML', 'SRM2'], rarity: 0, cost: 400000, desc: 'A fast hover tank used for raids and reconnaissance.' },
  { id: 'SCORPION', name: 'Scorpion Light Tank', short: 'SCORPION', tons: 25, mp: 4, kind: 'vehicle', glyph: 't', role: 'striker',
    armor: { F: 90, L: 65, R: 65, B: 45, T: 60 }, items: ['AC5', 'MG'], rarity: 0, cost: 420000, desc: 'A cheap tracked tank with an AC/5.' },
  { id: 'GALLEON', name: 'Galleon Light Tank', short: 'GALLEON', tons: 30, mp: 6, kind: 'vehicle', glyph: 't', role: 'striker',
    armor: { F: 90, L: 70, R: 70, B: 50, T: 70 }, items: ['ML', 'ML', 'MG'], rarity: 0, cost: 450000, desc: 'A quick light tank mounting twin medium lasers.' },
  { id: 'STRIKER', name: 'Striker Light Tank', short: 'STRIKER', tons: 35, mp: 6, kind: 'vehicle', glyph: 't', role: 'support',
    armor: { F: 100, L: 80, R: 80, B: 55, T: 80 }, items: ['LRM10', 'SRM6'], rarity: 0, cost: 550000, desc: 'A wheeled missile tank. Dangerous in numbers.' },
  { id: 'VEDETTE', name: 'Vedette Medium Tank', short: 'VEDETTE', tons: 50, mp: 5, kind: 'vehicle', glyph: 'T', role: 'striker',
    armor: { F: 130, L: 100, R: 100, B: 70, T: 100 }, items: ['AC5', 'MG'], rarity: 0, cost: 600000, desc: 'The most common tank in the Inner Sphere. Mass-produced and reliable.' },
  { id: 'BULLDOG', name: 'Bulldog Medium Tank', short: 'BULLDOG', tons: 60, mp: 4, kind: 'vehicle', glyph: 'T', role: 'brawler',
    armor: { F: 160, L: 120, R: 120, B: 80, T: 120 }, items: ['LL', 'SRM4', 'SRM4'], rarity: 0, cost: 800000, desc: 'A sturdy tank with a large laser and twin SRM racks.' },
  { id: 'PIKE', name: 'Pike Support Vehicle', short: 'PIKE', tons: 60, mp: 4, kind: 'vehicle', glyph: 'T', role: 'sniper',
    armor: { F: 140, L: 110, R: 110, B: 70, T: 100 }, items: ['AC2', 'AC2', 'AC2'], rarity: 0, cost: 750000, desc: 'An anti-aircraft vehicle that turns its triple AC/2s on ground targets.' },
  { id: 'MANTICORE', name: 'Manticore Heavy Tank', short: 'MANTICORE', tons: 60, mp: 4, kind: 'vehicle', glyph: 'T', role: 'brawler',
    armor: { F: 170, L: 130, R: 130, B: 90, T: 150 }, items: ['PPC', 'LRM10', 'SRM6', 'ML'], rarity: 1, cost: 1100000, desc: 'A heavy tank that can fight on equal terms with medium \'Mechs.' },
  { id: 'LRMC', name: 'LRM Carrier', short: 'LRM CARR', tons: 60, mp: 3, kind: 'vehicle', glyph: 'C', role: 'support',
    armor: { F: 90, L: 70, R: 70, B: 50, T: 0 }, items: ['LRM20', 'LRM20'], rarity: 1, cost: 1000000, desc: 'Forty long-range missiles per volley. Kill it before it finds your range.' },
  { id: 'SRMC', name: 'SRM Carrier', short: 'SRM CARR', tons: 60, mp: 3, kind: 'vehicle', glyph: 'C', role: 'brawler',
    armor: { F: 100, L: 80, R: 80, B: 50, T: 0 }, items: ['SRM6', 'SRM6', 'SRM6', 'SRM6'], rarity: 1, cost: 900000, desc: 'A rolling SRM battery that can gut a \'Mech at close range.' },
  { id: 'SCHREK', name: 'Schrek PPC Carrier', short: 'SCHREK', tons: 80, mp: 3, kind: 'vehicle', glyph: 'C', role: 'sniper',
    armor: { F: 140, L: 110, R: 110, B: 70, T: 0 }, items: ['PPC', 'PPC', 'PPC'], rarity: 2, cost: 1400000, desc: 'Three PPCs on a tracked chassis. A fearsome long-range threat.' },
  { id: 'DEMOLISHER', name: 'Demolisher Heavy Tank', short: 'DEMOLISHR', tons: 80, mp: 3, kind: 'vehicle', glyph: 'D', role: 'brawler',
    armor: { F: 220, L: 170, R: 170, B: 110, T: 180 }, items: ['AC20', 'AC20'], rarity: 2, cost: 1600000, desc: 'Twin AC/20s. The terror of city fighting.' },
  { id: 'HAULER', name: 'Cargo Hauler', short: 'HAULER', tons: 40, mp: 3, kind: 'vehicle', glyph: 'c', role: 'convoy',
    armor: { F: 90, L: 70, R: 70, B: 50, T: 0 }, items: [], rarity: 0, cost: 300000, desc: 'An unarmed armored supply truck.' },
  // ---- Emplacements
  { id: 'TUR-L', name: 'Light Turret', short: 'L.TURRET', tons: 20, mp: 0, kind: 'turret', glyph: 'τ', role: 'turret',
    armor: { T: 90 }, items: ['ML', 'ML'], rarity: 0, cost: 0, desc: 'A hardened laser emplacement.' },
  { id: 'TUR-M', name: 'Medium Turret', short: 'M.TURRET', tons: 40, mp: 0, kind: 'turret', glyph: 'τ', role: 'turret',
    armor: { T: 160 }, items: ['LRM10', 'AC5'], rarity: 0, cost: 0, desc: 'A missile and autocannon emplacement.' },
  { id: 'TUR-H', name: 'Heavy Turret', short: 'H.TURRET', tons: 60, mp: 0, kind: 'turret', glyph: 'Ŧ', role: 'turret',
    armor: { T: 240 }, items: ['LRM15', 'PPC', 'AC10'], rarity: 0, cost: 0, desc: 'A heavy fortified weapons emplacement.' },
];

const BY_ID = new Map(VEHICLES.map((v) => [v.id, v]));
export function vehicle(id: string): VehicleDef {
  const v = BY_ID.get(id);
  if (!v) throw new Error('Unknown vehicle ' + id);
  return v;
}

export function vehicleStructure(v: VehicleDef): Partial<Record<VLoc, number>> {
  const s = Math.ceil(v.tons / 10) * 10;
  const o: Partial<Record<VLoc, number>> = {};
  for (const l of Object.keys(v.armor) as VLoc[]) {
    if (v.kind === 'turret') o[l] = 60 + v.tons * 1.5;
    else if ((v.armor[l] ?? 0) > 0) o[l] = s;
  }
  return o;
}
