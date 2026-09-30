// A "frame" is a concrete unit: a chassis/vehicle definition plus its loadout and damage state.
// Career 'Mechs persist as frames; combat copies them into battle units and writes damage back.

import { item, Loc, MECH_LOCS, SLOTS, ARMOR_PER_TON, HardType, jumpJetFor, ARMOR_COST_PER_PT, ItemDef } from '../data/items';
import { chassis, structureFor, maxArmorFor, ChassisDef, WeightClass, classOf, armorTons } from '../data/mechs';
import { vehicle, vehicleStructure, VehicleDef } from '../data/vehicles';

export interface Component {
  id: string;
  loc: string;
  dead?: boolean;
  ammo?: number; // current shots for ammo bins
}

export interface Frame {
  uid: string;
  kind: 'mech' | 'vehicle' | 'turret';
  defId: string;
  items: Component[];
  armor: Record<string, number>;
  maxArmor: Record<string, number>; // configured armor (mechlab)
  struct: Record<string, number>;
  maxStruct: Record<string, number>;
  nickname?: string;
}

let uidCounter = 0;
export function newUid(): string {
  uidCounter++;
  return Date.now().toString(36).slice(-4) + Math.floor(Math.random() * 1e6).toString(36) + uidCounter.toString(36);
}

export const ARMOR_KEYS: string[] = ['HD', 'CT', 'CTR', 'LT', 'LTR', 'RT', 'RTR', 'LA', 'RA', 'LL', 'RL'];

export function newMechFrame(chassisId: string): Frame {
  const c = chassis(chassisId);
  const s = structureFor(c.tons);
  const items: Component[] = c.stockItems.map((i) => ({ id: i.id, loc: i.loc }));
  const f: Frame = {
    uid: newUid(),
    kind: 'mech',
    defId: chassisId,
    items,
    armor: { ...c.stockArmor },
    maxArmor: { ...c.stockArmor },
    struct: { ...s },
    maxStruct: { ...s },
  };
  refillAmmo(f);
  return f;
}

export function newVehicleFrame(id: string): Frame {
  const v = vehicle(id);
  const loc = v.kind === 'turret' ? 'T' : v.armor.T ? 'T' : 'F';
  const items: Component[] = v.items.map((w) => ({ id: w, loc }));
  // Vehicles carry two bins of each ammo type they use
  const ammoTypes = new Set(v.items.map((w) => item(w).ammo).filter(Boolean) as string[]);
  for (const a of ammoTypes) { items.push({ id: a, loc: v.kind === 'turret' ? 'T' : 'B' }); items.push({ id: a, loc: v.kind === 'turret' ? 'T' : 'B' }); }
  const armor: Record<string, number> = {};
  for (const [k, n] of Object.entries(v.armor)) if ((n ?? 0) > 0) armor[k] = n!;
  const st = vehicleStructure(v) as Record<string, number>;
  const f: Frame = { uid: newUid(), kind: v.kind, defId: id, items, armor: { ...armor }, maxArmor: { ...armor }, struct: { ...st }, maxStruct: { ...st } };
  refillAmmo(f);
  return f;
}

export function cloneFrame(f: Frame): Frame {
  return JSON.parse(JSON.stringify(f));
}

export function refillAmmo(f: Frame): void {
  for (const c of f.items) if (item(c.id).kind === 'ammo') c.ammo = item(c.id).ammoShots;
}

export function isMech(f: Frame): boolean { return f.kind === 'mech'; }
export function chassisOf(f: Frame): ChassisDef { return chassis(f.defId); }
export function vehicleOf(f: Frame): VehicleDef { return vehicle(f.defId); }

export function frameTons(f: Frame): number {
  return f.kind === 'mech' ? chassis(f.defId).tons : vehicle(f.defId).tons;
}
export function frameClass(f: Frame): WeightClass { return classOf(frameTons(f)); }
export function frameName(f: Frame): string {
  if (f.kind === 'mech') { const c = chassis(f.defId); return `${c.name} ${c.id}`; }
  return vehicle(f.defId).name;
}
export function frameShort(f: Frame): string {
  if (f.kind === 'mech') return chassis(f.defId).name.toUpperCase();
  return vehicle(f.defId).short;
}
export function frameGlyph(f: Frame): string {
  if (f.kind === 'mech') return chassis(f.defId).name[0].toUpperCase();
  return vehicle(f.defId).glyph;
}

// ---- Derived stats --------------------------------------------------------------------------
export interface FrameStats {
  tonsUsed: number;
  tonsMax: number;
  armorTotal: number;
  armorMax: number;
  structTotal: number;
  walk: number;
  sprint: number;
  jump: number;
  dissip: number;
  heatCap: number;
  stabMax: number;
  stabReduce: number;
  meleeDmg: number;
  dfaDmg: number;
  accBonus: number;
  sensor: number;
  initBonus: number;
  injuryResist: number;
  meleeBonus: number;
  weapons: Component[];
  alphaDmg: number;
  alphaHeat: number;
  jumpHeat: number;
}

export const BASE_DISSIPATION = 30;
export const BASE_HEAT_CAP = 100;

export function frameStats(f: Frame, liveOnly = true): FrameStats {
  const tonsMax = frameTons(f);
  const alive = f.items.filter((c) => !liveOnly || !c.dead);
  let tonsUsed = 0;
  let dissip = f.kind === 'mech' ? BASE_DISSIPATION : 999;
  let heatCap = BASE_HEAT_CAP;
  let jump = 0, accBonus = 0, sensor = 0, initBonus = 0, injuryResist = 0, stabReduce = 0, meleeBonus = 0;
  let alphaDmg = 0, alphaHeat = 0;
  for (const c of f.items) tonsUsed += item(c.id).tons;
  for (const c of alive) {
    const d = item(c.id);
    if (d.dissip) dissip += d.dissip;
    if (d.heatCap) heatCap += d.heatCap;
    if (d.kind === 'jumpjet') jump++;
    accBonus += d.accBonus ?? 0;
    sensor += d.sensorBonus ?? 0;
    initBonus += d.initBonus ?? 0;
    injuryResist += d.injuryResist ?? 0;
    stabReduce += d.stabBonus ?? 0;
    meleeBonus += d.meleeBonus ?? 0;
    if (d.kind === 'weapon') { alphaDmg += (d.dmg ?? 0) * (d.shots ?? 1); alphaHeat += d.heat ?? 0; }
  }
  let armorTotal = 0, structTotal = 0, armorMax = 0;
  for (const k in f.maxArmor) { tonsUsed += f.maxArmor[k] / ARMOR_PER_TON; armorMax += f.maxArmor[k]; }
  for (const k in f.armor) armorTotal += f.armor[k];
  for (const k in f.struct) structTotal += f.struct[k];
  let walk: number, sprint: number;
  if (f.kind === 'mech') {
    const c = chassis(f.defId);
    tonsUsed += c.coreTons;
    walk = c.walk + 2;
    // Legged 'Mechs limp
    const legs = (f.struct.LL > 0 ? 1 : 0) + (f.struct.RL > 0 ? 1 : 0);
    if (legs < 2) walk = 2;
    sprint = legs < 2 ? 2 : Math.round(walk * 1.6);
    if (legs < 2) jump = 0;
    if (jump > 0) jump = jump + 1;
  } else if (f.kind === 'vehicle') {
    const v = vehicle(f.defId);
    tonsUsed = tonsMax;
    walk = v.mp + 2;
    sprint = Math.round(walk * 1.5);
  } else {
    tonsUsed = tonsMax;
    walk = 0; sprint = 0;
  }
  const tons = tonsMax;
  const stabMax = f.kind === 'mech' ? 60 + tons * 0.6 : 9999;
  const meleeDmg = Math.round(tons * 0.9 * (1 + meleeBonus / 100));
  const dfaDmg = Math.round(tons * 1.4);
  return {
    tonsUsed, tonsMax, armorTotal, armorMax, structTotal, walk, sprint, jump, dissip, heatCap, stabMax,
    stabReduce: Math.min(60, stabReduce), meleeDmg, dfaDmg, accBonus, sensor, initBonus, injuryResist, meleeBonus,
    weapons: alive.filter((c) => item(c.id).kind === 'weapon'), alphaDmg, alphaHeat, jumpHeat: 0,
  };
}

// ---- Mech lab validation --------------------------------------------------------------------
export interface Problem { severity: 'error' | 'warn'; text: string; }

export function hardpointsFree(f: Frame, loc: Loc): Record<HardType, [number, number]> {
  const c = chassis(f.defId);
  const hp = c.hardpoints[loc] ?? [];
  const out: Record<HardType, [number, number]> = { B: [0, 0], E: [0, 0], M: [0, 0], S: [0, 0] };
  for (const h of hp) out[h][1]++;
  for (const it of f.items) if (it.loc === loc) { const d = item(it.id); if (d.kind === 'weapon' && d.hard) out[d.hard][0]++; }
  return out;
}

export function slotsUsedIn(f: Frame, loc: string): number {
  return f.items.filter((i) => i.loc === loc).reduce((a, i) => a + item(i.id).slots, 0);
}

/** Can this item be placed in this location (ignoring tonnage)? Returns reason if not. */
export function canMount(f: Frame, id: string, loc: Loc, ignoreIndex = -1): string | null {
  const d = item(id);
  const c = chassis(f.defId);
  if (d.locs && !d.locs.includes(loc)) return `${d.name} cannot mount in the ${loc}`;
  const used = f.items.reduce((a, it, i) => (it.loc === loc && i !== ignoreIndex ? a + item(it.id).slots : a), 0);
  if (used + d.slots > SLOTS[loc]) return `Not enough slots (${SLOTS[loc] - used} free, needs ${d.slots})`;
  if (d.kind === 'weapon' && d.hard) {
    const hp = (c.hardpoints[loc] ?? []).filter((h) => h === d.hard).length;
    const usedHp = f.items.filter((it, i) => i !== ignoreIndex && it.loc === loc && item(it.id).kind === 'weapon' && item(it.id).hard === d.hard).length;
    if (usedHp >= hp) return `No free ${({ B: 'Ballistic', E: 'Energy', M: 'Missile', S: 'Support' } as const)[d.hard]} hardpoint`;
  }
  if (d.kind === 'jumpjet') {
    if (d.id !== jumpJetFor(c.tons)) return `Wrong jump jet class for a ${c.tons}t 'Mech`;
    const jj = f.items.filter((it, i) => i !== ignoreIndex && item(it.id).kind === 'jumpjet').length;
    if (jj >= c.jump) return c.jump === 0 ? 'This chassis cannot mount jump jets' : `Maximum ${c.jump} jump jets`;
  }
  if (d.initBonus && f.items.some((it, i) => i !== ignoreIndex && item(it.id).initBonus)) return 'Only one command console';
  return null;
}

export function validate(f: Frame): Problem[] {
  const out: Problem[] = [];
  if (f.kind !== 'mech') return out;
  const s = frameStats(f, false);
  if (s.tonsUsed > s.tonsMax + 1e-6) out.push({ severity: 'error', text: `Overweight by ${(s.tonsUsed - s.tonsMax).toFixed(1)}t` });
  for (const l of MECH_LOCS) if (slotsUsedIn(f, l) > SLOTS[l]) out.push({ severity: 'error', text: `${l}: too many components` });
  const mx = maxArmorFor(frameTons(f));
  for (const l of MECH_LOCS) {
    const tot = (f.maxArmor[l] ?? 0) + (f.maxArmor[l + 'R'] ?? 0);
    if (tot > mx[l]) out.push({ severity: 'error', text: `${l}: armor exceeds maximum` });
  }
  const weps = f.items.filter((i) => item(i.id).kind === 'weapon');
  if (weps.length === 0) out.push({ severity: 'error', text: 'No weapons installed' });
  const ammoNeeded = new Set(weps.map((w) => item(w.id).ammo).filter(Boolean) as string[]);
  const ammoHave = new Set(f.items.filter((i) => item(i.id).kind === 'ammo').map((i) => i.id));
  for (const a of ammoNeeded) if (!ammoHave.has(a)) out.push({ severity: 'warn', text: `No ${item(a).name} for installed weapons` });
  for (const a of ammoHave) if (!ammoNeeded.has(a)) out.push({ severity: 'warn', text: `${item(a).name} has no weapon to feed` });
  if (s.alphaHeat > s.dissip + 60) out.push({ severity: 'warn', text: 'Alpha strikes will overheat quickly' });
  for (const k of ARMOR_KEYS) if ((f.maxArmor[k] ?? 0) === 0 && (k === 'HD' || k === 'CT')) out.push({ severity: 'warn', text: `${k} has no armor` });
  return out;
}

// ---- Repair ---------------------------------------------------------------------------------
export interface RepairEstimate {
  armorPts: number;
  structPts: number;
  deadItems: Component[];
  cost: number;
  hours: number;
}

export function repairEstimate(f: Frame): RepairEstimate {
  let armorPts = 0, structPts = 0;
  for (const k in f.maxArmor) armorPts += Math.max(0, f.maxArmor[k] - (f.armor[k] ?? 0));
  for (const k in f.maxStruct) structPts += Math.max(0, f.maxStruct[k] - (f.struct[k] ?? 0));
  const deadItems = f.items.filter((c) => c.dead);
  const tons = frameTons(f);
  let cost = armorPts * ARMOR_COST_PER_PT + structPts * (60 + tons);
  let hours = armorPts / 12 + structPts / 3;
  for (const c of deadItems) { const d: ItemDef = item(c.id); cost += d.cost * 0.2; hours += 2 + d.tons * 0.8; }
  if ((f as any).wreck && f.kind === 'mech') { cost += chassis(f.defId).cost * 0.08; hours += 40 + tons; }
  return { armorPts, structPts, deadItems, cost: Math.round(cost / 100) * 100, hours: Math.ceil(hours) };
}

export function repairFully(f: Frame): void {
  delete (f as any).wreck;
  for (const k in f.maxArmor) f.armor[k] = f.maxArmor[k];
  for (const k in f.maxStruct) f.struct[k] = f.maxStruct[k];
  for (const c of f.items) c.dead = false;
  refillAmmo(f);
}

export function isFrameDamaged(f: Frame): boolean {
  const e = repairEstimate(f);
  return e.armorPts > 0 || e.structPts > 0 || e.deadItems.length > 0;
}

/** Market value of a frame including installed equipment. */
export function frameValue(f: Frame): number {
  if (f.kind !== 'mech') return vehicle(f.defId).cost;
  const c = chassis(f.defId);
  const stockItemCost = c.stockItems.reduce((a, i) => a + item(i.id).cost, 0);
  const curItemCost = f.items.reduce((a, i) => a + item(i.id).cost, 0);
  const liveItemCost = f.items.filter((i) => !i.dead).reduce((a, i) => a + item(i.id).cost, 0);
  void curItemCost;
  return Math.max(Math.round(c.cost * 0.1), Math.round(c.cost - stockItemCost * 0.8 + liveItemCost * 0.8 - repairEstimate(f).cost));
}

export function maxArmorPer(f: Frame): Record<Loc, number> {
  return maxArmorFor(frameTons(f));
}

export function armorTonsOf(f: Frame): number {
  return armorTons(f.maxArmor);
}

export function weaponSummary(f: Frame): string {
  const counts = new Map<string, number>();
  for (const c of f.items) {
    const d = item(c.id);
    if (d.kind !== 'weapon') continue;
    counts.set(d.short.trim(), (counts.get(d.short.trim()) ?? 0) + 1);
  }
  return [...counts.entries()].map(([k, n]) => (n > 1 ? `${n}x${k}` : k)).join(' ');
}
