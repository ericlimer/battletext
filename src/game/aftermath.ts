// Contract execution: build the mission from career state and resolve the results.

import { RNG } from '../engine/rng';
import { Company, Contract, Negotiation, addLog, sys, healDaysFor, queueRepair, mrbLevel, PARTS_NEEDED } from './company';
import { Frame, frameName, refillAmmo, isFrameDamaged } from './frame';
import { Pilot, health } from './pilot';
import { setupMission, MissionRuntime, objectivesSummary } from '../combat/missions';
import { item, bonusesFor, BASE_WEAPONS } from '../data/items';
import { chassis } from '../data/mechs';
import { faction } from '../data/factions';
import { cb } from '../engine/util';

export interface SalvageEntry { kind: 'part' | 'item'; id: string; label: string; value: number; }

export interface MissionResult {
  contract: Contract;
  neg: Negotiation;
  outcome: 'win' | 'loss' | 'withdraw';
  pay: number;
  bonus: number;
  repChanges: [string, number][];
  mrbGain: number;
  xp: [Pilot, number][];
  casualties: string[];
  mechsLost: string[];
  pool: SalvageEntry[];
  salvageShares: number;
  priority: number;
  repairCost: number;
  lines: string[];
}

export function launchContract(c: Company, k: Contract, lance: { mech: Frame; pilot: Pilot }[]): MissionRuntime {
  for (const l of lance) refillAmmo(l.mech);
  return setupMission({
    type: k.type, difficulty: k.diff, biome: k.biome, seed: k.seed, night: k.night,
    employer: k.employer, target: k.target, targetName: k.targetName, basePay: k.pay,
    player: lance.map((l) => ({ frame: l.mech, pilot: l.pilot })),
  });
}

function partsFor(how: string): number {
  if (how === 'ct' || how === 'ammo') return 1;
  if (how === 'legs') return 2;
  return 3; // head, pilot, eject
}

export function resolveContract(c: Company, k: Contract, neg: Negotiation, rt: MissionRuntime): MissionResult {
  const r = new RNG(k.seed ^ 0x9e3779b9);
  const b = rt.battle;
  const outcome = (b.result || 'loss') as 'win' | 'loss' | 'withdraw';
  const { primaryOk, bonus } = objectivesSummary(rt);
  const win = outcome === 'win' && primaryOk;
  const lines: string[] = [];
  const res: MissionResult = { contract: k, neg, outcome: win ? 'win' : outcome === 'withdraw' ? 'withdraw' : 'loss', pay: 0, bonus: 0, repChanges: [], mrbGain: 0, xp: [], casualties: [], mechsLost: [], pool: [], salvageShares: 0, priority: 0, repairCost: 0, lines };
  c.stats.missions++;
  // ---- Money
  if (win) {
    res.pay = neg.cash;
    res.bonus = Math.round(bonus);
    c.funds += res.pay + res.bonus;
    c.stats.earned += res.pay + res.bonus;
    c.stats.wins++;
  }
  // ---- Reputation
  const emp = k.employer, tgt = k.target;
  const d = k.diff;
  if (win) { res.repChanges.push([emp, Math.round(3 + d * 0.9)], [tgt, -Math.round(2 + d * 0.5)]); res.mrbGain = Math.round(6 + d * 4); }
  else if (outcome === 'withdraw') { res.repChanges.push([emp, -Math.round(4 + d * 0.4)]); res.mrbGain = 0; }
  else { res.repChanges.push([emp, -Math.round(3 + d * 0.5)], [tgt, -1]); res.mrbGain = 1; }
  for (const [f, v] of res.repChanges) c.rep[f] = Math.max(-100, Math.min(100, (c.rep[f] ?? 0) + v));
  const oldMrb = mrbLevel(c);
  c.mrb += res.mrbGain;
  if (mrbLevel(c) > oldMrb) lines.push(`MRB rating increased to ${mrbLevel(c)}! Higher-difficulty contracts are now available.`);
  // ---- Pilots & mechs
  const kills = rt.playerUnits.reduce((a, u) => a + u.kills, 0);
  c.stats.kills += kills;
  for (const u of rt.playerUnits) {
    const p = u.pilot!;
    p.missions++;
    p.kills += u.kills;
    const gained = Math.round((350 + d * 140 + u.kills * 120) * (win ? 1 : 0.5));
    p.xp += gained; p.xpTotal += gained;
    res.xp.push([p, gained]);
    let died = false;
    if (!u.alive) {
      if (u.destroyHow === 'head') died = true;
      else if (u.destroyHow === 'ct' || u.destroyHow === 'ammo') died = r.chance(0.25);
      else if (u.destroyHow === 'pilot') died = r.chance(0.35);
    }
    if (died && !p.commander) {
      p.dead = true;
      c.stats.pilotsLost++;
      res.casualties.push(`${p.callsign} (${p.name}) was killed in action.`);
      p.timeline.push(`Killed in action during "${k.name}".`);
    } else if (died && p.commander) {
      p.injuries = health(p) - 1;
      res.casualties.push(`Commander ${p.callsign} was pulled from the wreckage, gravely wounded.`);
    }
    if (!p.dead && p.injuries > 0) {
      p.injuries = Math.min(p.injuries, health(p));
      p.healDays = healDaysFor(c, p.injuries);
      res.casualties.push(`${p.callsign} injured: ${p.injuries} wound${p.injuries > 1 ? 's' : ''}, ${p.healDays} days to recover.`);
    }
    if (!p.dead) p.timeline.push(`Day ${c.day}: "${k.name}" (${win ? 'success' : 'failure'}), ${u.kills} kill${u.kills === 1 ? '' : 's'}.`);
    const m = u.frame;
    if (!u.alive && (u.destroyHow === 'ct' || u.destroyHow === 'ammo')) {
      c.mechs = c.mechs.filter((x) => x.uid !== m.uid);
      c.lance = c.lance.map((x) => (x === m.uid ? null : x));
      c.stats.mechsLost++;
      c.parts[m.defId] = (c.parts[m.defId] ?? 0) + 1;
      res.mechsLost.push(`${frameName(m)} was destroyed. Your techs recovered 1 part.`);
    }
  }
  // Auto-queue repairs
  for (const u of rt.playerUnits) {
    const m = c.mechs.find((x) => x.uid === u.frame.uid);
    if (m && isFrameDamaged(m)) { const q = queueRepair(c, m); if (q) res.repairCost += q.cost; }
    else if (m) refillAmmo(m);
  }
  // ---- Salvage
  if (win && neg.salvage > 0) {
    res.salvageShares = neg.salvage;
    res.priority = Math.min(neg.priority, neg.salvage);
    const pool: SalvageEntry[] = [];
    for (const u of rt.enemyUnits) {
      if (u.alive || u.fled) continue;
      const f = u.frame;
      if (f.kind === 'mech') {
        const n = partsFor(u.destroyHow);
        const ch = chassis(f.defId);
        for (let i = 0; i < n; i++) pool.push({ kind: 'part', id: f.defId, label: `${ch.name} ${ch.id} part`, value: ch.cost / PARTS_NEEDED });
      }
      let hs = 0;
      for (const it of f.items) {
        if (it.dead) continue;
        const dd = item(it.id);
        if (dd.kind === 'ammo') continue;
        if (dd.kind === 'heatsink' && ++hs > 2) continue;
        if (f.kind !== 'mech' && r.chance(0.4)) continue;
        pool.push({ kind: 'item', id: it.id, label: dd.name, value: dd.cost });
      }
    }
    // Bonus loot
    const nb = r.int(1, 2) + Math.floor(d / 4);
    for (let i = 0; i < nb; i++) {
      let id = r.pick(BASE_WEAPONS);
      if (r.chance(0.2 + d * 0.04)) id = `${id}+${r.chance(0.7) ? 1 : 2}${r.pick(bonusesFor(id))}`;
      pool.push({ kind: 'item', id, label: item(id).name, value: item(id).cost });
    }
    pool.sort((a, b2) => b2.value - a.value);
    res.pool = pool;
  }
  // Remove contract
  c.contracts[c.location] = (c.contracts[c.location] ?? []).filter((x) => x.id !== k.id);
  const summary = win ? `Contract "${k.name}" completed for ${faction(emp).short}: ${cb(res.pay + res.bonus)}.` : outcome === 'withdraw' ? `Withdrew from "${k.name}".` : `Contract "${k.name}" failed.`;
  addLog(c, summary, win ? '#6ad46a' : '#e8503a');
  for (const x of res.casualties) addLog(c, x, '#f08a30');
  for (const x of res.mechsLost) addLog(c, x, '#e8503a');
  void sys;
  return res;
}

/** Apply salvage picks: priority picks are chosen, the rest of the shares are random. */
export function claimSalvage(c: Company, res: MissionResult, picks: number[]): SalvageEntry[] {
  const r = new RNG(res.contract.seed ^ 0x51ed);
  const got: SalvageEntry[] = [];
  const remaining = res.pool.map((_, i) => i).filter((i) => !picks.includes(i));
  for (const i of picks) got.push(res.pool[i]);
  const randomShares = Math.max(0, res.salvageShares - picks.length);
  r.shuffle(remaining);
  for (let k = 0; k < randomShares && k < remaining.length; k++) got.push(res.pool[remaining[k]]);
  for (const g of got) {
    if (g.kind === 'part') c.parts[g.id] = (c.parts[g.id] ?? 0) + 1;
    else c.inventory[g.id] = (c.inventory[g.id] ?? 0) + 1;
  }
  if (got.length) addLog(c, `Salvage recovered: ${got.map((g) => g.label).join(', ')}.`, '#f0c850');
  return got;
}
