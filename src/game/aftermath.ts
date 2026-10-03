// Contract execution: build the mission from career state and resolve the results.

import { RNG } from '../engine/rng';
import { Company, Contract, Negotiation, addLog, sys, healDaysFor, queueRepair, mrbLevel, PARTS_NEEDED, monthlyExpenses, dateStr, morale, contractDays, has, genContract, maxContractDiff } from './company';
import { Frame, frameName, refillAmmo, isFrameDamaged, repairEstimate } from './frame';
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
  /** 'Mechs written off this mission, with why the wreck was not recovered. */
  writtenOff?: [string, string][];
  /** uids of the 'Mechs that dropped. */
  deployed?: string[];
  /** Primary objectives left unmet, for a failed or abandoned contract. */
  failed?: string[];
  pool: SalvageEntry[];
  salvageShares: number;
  priority: number;
  repairCost: number;
  lines: string[];
  days: number;
}

export function launchContract(c: Company, k: Contract, lance: { mech: Frame; pilot: Pilot }[]): MissionRuntime {
  for (const l of lance) refillAmmo(l.mech);
  return setupMission({
    type: k.type, difficulty: k.diff, biome: k.biome, seed: k.seed, night: k.night,
    employer: k.employer, target: k.target, targetName: k.targetName, basePay: k.pay,
    player: lance.map((l) => ({ frame: l.mech, pilot: l.pilot })), morale: morale(c), startResolve: has(c, 'toc') ? 15 : 0,
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
  const res: MissionResult = { contract: k, neg, outcome: win ? 'win' : outcome === 'withdraw' ? 'withdraw' : 'loss', pay: 0, bonus: 0, repChanges: [], mrbGain: 0, xp: [], casualties: [], mechsLost: [], pool: [], salvageShares: 0, priority: 0, repairCost: 0, lines, days: 0 };
  c.stats.missions++;
  res.deployed = rt.playerUnits.map((u) => u.frame.uid);
  if (!win) res.failed = outcome === 'withdraw' ? ['The lance withdrew before the objectives were met.'] : [...rt.objectives.filter((o) => o.primary && o.status !== 'done').map((o) => `${o.status === 'failed' ? 'Failed' : 'Not achieved'}: ${o.text}${o.progress ? ` (${o.progress})` : ''}`), ...(rt.playerUnits.every((u) => !u.alive || u.fled) && rt.playerUnits.some((u) => !u.alive) ? ['The lance was knocked out of the fight.'] : [])];
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
  if (mrbLevel(c) > oldMrb) {
    lines.push(`MRB rating increased to ${mrbLevel(c)}! Higher-difficulty contracts are now available.`);
    // Word gets around: a bigger job is waiting on the local board
    const board = (c.contracts[c.location] ??= []);
    const big = genContract(c, r, sys(c), { minDiff: Math.min(10, Math.floor(maxContractDiff(c)) - 1) });
    big.expires = c.day + contractDays(k) + 20;
    board.push(big);
    lines.push(`A high-stakes contract has been posted for the newly bonded company: "${big.name}".`);
  }
  // ---- Pilots & mechs
  // Wrecks are recovered unless the whole lance was lost
  const wiped = rt.playerUnits.every((u) => !u.alive);
  const kills = rt.playerUnits.reduce((a, u) => a + u.kills, 0);
  c.stats.kills += kills;
  const inspired = morale(c) >= 40;
  for (const u of rt.playerUnits) {
    const p = u.pilot!;
    p.missions++;
    p.kills += u.kills;
    const gained = Math.round((350 + d * 140 + u.kills * 120) * (win ? 1 : 0.5) * (inspired ? 1.15 : 1));
    p.xp += gained; p.xpTotal += gained;
    res.xp.push([p, gained]);
    let died = false;
    if (!u.alive) {
      // HBS-style: a cored 'Mech wounds its pilot; death comes from a destroyed cockpit or
      // from wounds exceeding the pilot's health.
      if (u.destroyHow === 'head') died = true;
      else if (u.destroyHow === 'ct' || u.destroyHow === 'ammo') {
        p.injuries++;
        const risk = (u.destroyHow === 'ammo' ? 0.22 : 0.09) * Math.max(0.4, 1 - p.gut * 0.06);
        if (p.injuries > health(p) || r.chance(risk)) died = true;
        else res.casualties.push(`${p.callsign} survived the loss of their ${frameName(u.frame)} — the ejection system fired as the ${u.destroyHow === 'ammo' ? 'ammunition cooked off' : 'reactor shielding failed'} (${Math.round(risk * 100)}% fatal at Guts ${p.gut}).`);
      }
      else if (u.destroyHow === 'pilot') died = r.chance(0.2);
    }
    if (died && !p.commander) {
      p.dead = true;
      p.diedDay = c.day;
      c.stats.pilotsLost++;
      c.lancePilots = c.lancePilots.map((id) => (id === p.id ? null : id));
      res.casualties.push(`${p.callsign} (${p.name}) was killed in action.`);
      p.timeline.push(`Killed in action during "${k.name}".`);
    } else if (died && p.commander) {
      p.injuries = health(p) - 1;
      res.casualties.push(`Commander ${p.callsign} was pulled from the wreckage, gravely wounded.`);
    }
    if (!p.dead && p.injuries > 0) {
      p.injuries = Math.min(p.injuries, health(p));
      p.healDays = healDaysFor(c, p.injuries);
      res.casualties.push(`${p.callsign} injured: ${p.injuries} wound${p.injuries > 1 ? 's' : ''}, ${p.healDays} day${p.healDays === 1 ? '' : 's'} to recover.`);
    }
    if (!p.dead) p.timeline.push(`${dateStr(c.day + contractDays(k))}: "${k.name}" (${win ? 'success' : 'failure'}), ${u.kills} kill${u.kills === 1 ? '' : 's'}.`);
    const m = u.frame;
    if (!u.alive && (u.destroyHow === 'ct' || u.destroyHow === 'ammo')) {
      // Recovery team: likely when the field is held, possible on a withdrawal, never when wiped out
      const recovered = r.chance(wiped ? 0.3 : win ? 0.9 : 0.7);
      if (recovered) {
        (m as any).wreck = true;
        res.mechsLost.push(`${frameName(m)} was cored, but the recovery team hauled the wreck aboard. It needs a full rebuild.`);
      } else {
        c.mechs = c.mechs.filter((x) => x.uid !== m.uid);
        c.lance = c.lance.map((x) => (x === m.uid ? null : x));
        c.stats.mechsLost++;
        const back = wiped ? 0 : 1;
        if (back) c.parts[m.defId] = (c.parts[m.defId] ?? 0) + back;
        res.mechsLost.push(`${frameName(m)} was destroyed and could not be recovered${back ? ' — your techs salvaged 1 part' : ''}.`);
        (res.writtenOff ??= []).push([frameName(m), wiped ? 'lance wiped out — the recovery team could not reach this wreck' : win ? 'wreck too badly burned to haul out (1 in 10)' : `field abandoned before the wreck could be hauled out${back ? '; 1 part salvaged' : ''}`]);
      }
    }
  }
  // The crew's mood follows the company's fortunes
  const deaths = rt.playerUnits.filter((u) => u.pilot!.dead).length;
  const moodDelta = (win ? 2 : outcome === 'withdraw' ? -2 : -4) - deaths * 5 + (win && kills >= 4 ? 1 : 0);
  if (moodDelta) {
    c.moraleMod = Math.max(-20, Math.min(10, c.moraleMod + moodDelta));
    lines.push(`Crew morale ${moodDelta > 0 ? '+' : ''}${moodDelta}: ${win ? 'a victory to celebrate' : outcome === 'withdraw' ? 'the retreat stings' : 'a bitter defeat'}${deaths ? `, ${deaths} comrade${deaths > 1 ? 's' : ''} lost` : ''}.`);
  }
  if (inspired) lines.push('Inspired crew: +15% MechWarrior experience.');
  // Auto-queue repairs the company can afford (keeping a month of expenses in reserve)
  const reserve = monthlyExpenses(c).total;
  for (const u of rt.playerUnits) {
    const m = c.mechs.find((x) => x.uid === u.frame.uid);
    if (m && isFrameDamaged(m)) {
      if (c.funds - repairEstimate(m).cost >= reserve) { const q = queueRepair(c, m); if (q) res.repairCost += q.cost; }
      else lines.push(`${frameName(m)} needs ${cb(repairEstimate(m).cost)} of repairs — queue them in the Mech Bay when funds allow.`);
    } else if (m) refillAmmo(m);
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
        if (pool.filter((pe) => pe.id === it.id).length >= 3) continue;
        if (f.kind !== 'mech' && r.chance(0.4)) continue;
        pool.push({ kind: 'item', id: it.id, label: dd.name, value: dd.cost });
      }
    }
    // Bonus loot
    const nb = r.int(1, 2) + Math.floor(d / 4);
    for (let i = 0; i < nb; i++) {
      // Rarer gear only turns up on harder contracts (lostech such as Gauss only at 9+ skulls)
      const maxR = Math.floor((d + 1) / 2);
      const pool2 = BASE_WEAPONS.filter((w) => item(w).rarity <= maxR);
      let id = r.weighted(pool2.length ? pool2 : BASE_WEAPONS, (w) => 1 / (1 + item(w).rarity * 1.5));
      if (r.chance(0.12 + d * 0.04)) id = `${id}+${r.chance(0.7) ? 1 : 2}${r.pick(bonusesFor(id))}`;
      pool.push({ kind: 'item', id, label: item(id).name, value: item(id).cost });
    }
    // The employer's quartermaster can often turn up a part for a chassis you're already collecting
    const collecting = Object.entries(c.parts).filter(([, n]) => n > 0 && n < PARTS_NEEDED).map(([id]) => id);
    if (collecting.length && r.chance(0.35 + d * 0.04)) {
      const id = r.pick(collecting), ch = chassis(id);
      pool.push({ kind: 'part', id, label: `${ch.name} ${ch.id} part`, value: ch.cost / PARTS_NEEDED });
    }
    pool.sort((a, b2) => b2.value - a.value);
    res.pool = pool;
  }
  res.days = contractDays(k);
  c.deployDays = (c.deployDays ?? 0) + res.days;
  if (res.pool.length) c.pendingSalvage = { pool: res.pool, shares: res.salvageShares, priority: res.priority, seed: k.seed, name: k.name };
  // Remove contract
  c.contracts[c.location] = (c.contracts[c.location] ?? []).filter((x) => x.id !== k.id);
  const summary = win ? `Contract "${k.name}" completed for ${faction(emp).short}: ${cb(res.pay + res.bonus)}.` : outcome === 'withdraw' ? `Withdrew from "${k.name}".` : `Contract "${k.name}" failed.`;
  const back = c.day + res.days;
  addLog(c, summary, win ? '#6ad46a' : '#e8503a', back);
  for (const x of res.casualties) addLog(c, x, '#f08a30', back);
  for (const x of res.mechsLost) addLog(c, x, '#e8503a', back);
  void sys;
  return res;
}

/** Employer takes its cut of the pool (after priority picks); the player then chooses the rest. */
export function employerCut(res: { pool: SalvageEntry[]; salvageShares: number }, picks: number[], seed: number): number[] {
  const r = new RNG(seed ^ 0x51ed);
  const rest = res.pool.map((_, i) => i).filter((i) => !picks.includes(i));
  r.shuffle(rest);
  // The employer claims roughly half of what remains (never leaving less than the player's shares)
  const keepForPlayer = Math.max(0, res.salvageShares - picks.length);
  const cut = Math.max(0, Math.min(rest.length - keepForPlayer, Math.ceil(rest.length * 0.5)));
  return rest.slice(0, cut);
}

export function claimSalvage(c: Company, pool: SalvageEntry[], picks: number[]): SalvageEntry[] {
  const got = picks.map((i) => pool[i]);
  for (const g of got) {
    if (g.kind === 'part') c.parts[g.id] = (c.parts[g.id] ?? 0) + 1;
    else c.inventory[g.id] = (c.inventory[g.id] ?? 0) + 1;
  }
  if (got.length) addLog(c, `Salvage recovered: ${got.map((g) => g.label).join(', ')}.`, '#f0c850', c.day + (c.deployDays ?? 0));
  c.pendingSalvage = undefined;
  return got;
}
