// Contracts: board, negotiation, lance deployment, after-action report and salvage.

import { Screen, app } from './app';
import { UI } from '../engine/ui';
import { C, lerp, healthColor } from '../engine/color';
import { COLS, ROWS } from '../engine/display';
import type { ArgoScreen } from './argo';
import { skulls } from './argo';
import { company, saveGame } from '../game/save';
import { Company, Contract, Negotiation, negotiate, maxContractDiff, sys, mechReady, mrbLevel, PARTS_NEEDED } from '../game/company';
import { MISSION_INFO } from '../combat/missions';
import { BIOME_INFO } from '../combat/terrain';
import { faction, repLevel } from '../data/factions';
import { cb, cbk, wrap } from '../engine/util';
import { Frame, frameName, frameTons, weaponSummary, frameStats, repairEstimate } from '../game/frame';
import { Pilot, isAvailable, health } from '../game/pilot';
import { launchContract, resolveContract, claimSalvage, MissionResult, SalvageEntry } from '../game/aftermath';
import { CombatScreen } from './combat';
import { skillLine, simpleBar, healthPips, weaponTip } from './widgets';
import { item } from '../data/items';
import { chassis } from '../data/mechs';

export function drawContractsTab(ui: UI, argo: ArgoScreen, x: number, y: number, w: number, h: number): void {
  const d = ui.d, c = company!;
  const st = (argo.st.contracts ??= { sel: 0, list: { scroll: 0 } });
  if (c.travel) {
    ui.panel(x + 1, y, w - 2, h, 'CONTRACTS');
    d.text(x + 4, y + 3, `The Argo is in transit to ${sys(c, c.travel.dest).name}. Contracts will be available on arrival.`, C.cyan);
    return;
  }
  const list = c.contracts[c.location] ?? [];
  ui.panel(x + 1, y, 62, h, `CONTRACTS · ${sys(c).name.toUpperCase()}`);
  if (!list.length) d.text(x + 3, y + 2, 'No contracts on offer. Pass time or travel to another system.', C.dim);
  const maxD = maxContractDiff(c);
  const clicked = ui.list(x + 2, y + 1, 60, h - 2, list, st.list, (k, i, lx, ly, lw, hov) => {
    const sel = st.sel === i;
    const bg = sel ? '#16242e' : hov ? '#121c24' : C.panel;
    d.fill(lx, ly, lw, 4, ' ', C.text, bg);
    if (sel) d.vline(lx, ly, 4, C.accent, '▌', bg);
    const mi = MISSION_INFO[k.type];
    const emp = faction(k.employer), tgt = faction(k.target);
    const locked = k.diff > maxD;
    d.text(lx + 2, ly, `${mi.glyph} ${k.name.toUpperCase()}`, locked ? C.faint : C.bright, bg, 30, true);
    d.text(lx + 34, ly, skulls(k.diff).padEnd(6), '#e8503a', bg);
    d.text(lx + 44, ly, cbk(k.pay).padStart(8), C.cbill, bg);
    d.ctext(lx + 2, ly + 1, `${mi.name} · {${emp.color}}${emp.short}{/} vs {${tgt.color}}${tgt.short}{/}`, C.dim, bg, lw - 4);
    d.ctext(lx + 2, ly + 2, `${BIOME_INFO[k.biome].name}${k.night ? ' · night' : ''} · expires in ${k.expires - c.day}d${locked ? ' · {#e8503a}MRB TOO LOW{/}' : ''}`, C.faint, bg, lw - 4);
  }, 4);
  if (clicked >= 0) st.sel = clicked;
  const k = list[Math.min(st.sel, list.length - 1)];
  if (!k) return;
  // Details
  const dx = x + 64, dw = w - 65;
  ui.panel(dx, y, dw, h, 'CONTRACT DETAILS');
  const mi = MISSION_INFO[k.type];
  const emp = faction(k.employer), tgt = faction(k.target);
  let yy = y + 2;
  d.text(dx + 3, yy, `${mi.glyph}  ${k.name.toUpperCase()}`, C.bright, undefined, 99, true);
  d.text(dx + dw - 14, yy, skulls(k.diff), '#e8503a', undefined, 99, true);
  yy += 2;
  d.ctext(dx + 3, yy++, `Employer  {${emp.color}}${emp.name}{/}  {#6d7f8a}(${repLevel(c.rep[k.employer] ?? 0).name}){/}`, C.dim);
  d.ctext(dx + 3, yy++, `Target    {${tgt.color}}${tgt.name}{/}  {#6d7f8a}(${repLevel(c.rep[k.target] ?? 0).name}){/}`, C.dim);
  d.ctext(dx + 3, yy++, `Mission   {#f2f6f8}${mi.name}{/} — ${mi.desc}`, C.dim, undefined, dw - 6);
  d.ctext(dx + 3, yy++, `Terrain   {#f2f6f8}${BIOME_INFO[k.biome].name}{/} — ${BIOME_INFO[k.biome].desc}${k.night ? ' {#b27ae8}Night.{/}' : ''}`, C.dim, undefined, dw - 6);
  yy++;
  for (const l of wrap(k.flavor, dw - 8)) d.text(dx + 3, yy++, l, C.text);
  yy++;
  d.ctext(dx + 3, yy++, `Maximum payment {#f0c850}${cb(k.pay)}{/}   Salvage up to {#f2f6f8}${k.salvageMax}{/} shares`, C.dim);
  d.ctext(dx + 3, yy++, `Enemy forces: ${threatText(k.diff)}`, C.dim);
  yy += 1;
  const locked = k.diff > maxD;
  if (locked) {
    d.text(dx + 3, yy, `The Mercenary Review Board will not bond you for a ${skulls(k.diff)} contract. MRB rating ${mrbLevel(c)} allows up to ${skulls(Math.floor(maxD))}.`, C.red, undefined, dw - 6);
  } else if (ui.button(dx + 3, yy, 'NEGOTIATE', { key: 'Enter', style: 'block', w: 18, center: true })) {
    app.push(new NegotiateScreen(k, argo));
  }
}

function threatText(d: number): string {
  if (d <= 2) return '{#6ad46a}light scouts and vehicles{/}';
  if (d <= 4) return '{#b8d86a}light and medium lances{/}';
  if (d <= 6) return '{#f0c040}medium and heavy lances{/}';
  if (d <= 8) return '{#f08a30}heavy lances with veteran pilots{/}';
  return '{#e8503a}assault lances with elite pilots{/}';
}

// ---- Negotiation --------------------------------------------------------------------------
export class NegotiateScreen implements Screen {
  modal = true;
  slider = 3;
  constructor(public k: Contract, public argo: ArgoScreen) {}
  render(ui: UI): void {
    const d = ui.d, k = this.k;
    const w = 76, h = 20, x = (COLS - w) >> 1, y = 10;
    ui.panel(x, y, w, h, 'NEGOTIATION', { style: 'double', fg: C.borderHi, bg: '#0a1016' });
    const emp = faction(k.employer);
    d.ctext(x + 3, y + 2, `{${emp.color}}${emp.name}{/} representative is on the line.`, C.dim);
    d.text(x + 3, y + 3, '"We can discuss the payment structure. Cash or a share of the salvage — your choice."', C.text, undefined, w - 6);
    const n: Negotiation = negotiate(k, this.slider);
    d.text(x + 3, y + 6, 'C-BILLS', C.cbill, undefined, 99, true);
    d.text(x + w - 11, y + 6, 'SALVAGE', C.bright, undefined, 99, true);
    this.slider = ui.slider(x + 12, y + 6, w - 25, this.slider, 0, 10);
    if (ui.key('ArrowLeft')) this.slider = Math.max(0, this.slider - 1);
    if (ui.key('ArrowRight')) this.slider = Math.min(10, this.slider + 1);
    d.ctext(x + 3, y + 9, `Payment on completion   {#f0c850}${cb(n.cash)}{/}`, C.dim);
    d.ctext(x + 3, y + 10, `Salvage shares         {#f2f6f8}${n.salvage}{/}  (priority picks: {#f0a830}${n.priority}{/}, the rest assigned randomly)`, C.dim);
    d.ctext(x + 3, y + 12, `Optional objectives pay a bonus of ~{#f0c850}${cb(k.pay * 0.25)}{/} each.`, C.faint);
    d.ctext(x + 3, y + 13, `Failure pays nothing and damages your standing with ${emp.short}.`, C.faint);
    if (ui.button(x + 3, y + h - 3, 'Back', { key: 'Escape' })) app.pop();
    if (ui.button(x + w - 28, y + h - 3, 'ACCEPT CONTRACT', { key: 'Enter', style: 'block', w: 24, center: true })) {
      app.pop();
      app.push(new DropScreen(k, n, this.argo));
    }
  }
}

// ---- Lance deployment ---------------------------------------------------------------------
export class DropScreen implements Screen {
  slots: { mech: string | null; pilot: string | null }[];
  pick: { i: number; what: 'mech' | 'pilot' } | null = null;
  listState = { scroll: 0 };
  constructor(public k: Contract, public n: Negotiation, public argo: ArgoScreen) {
    const c = company!;
    const readyM = c.mechs.filter((m) => mechReady(c, m));
    const readyP = c.pilots.filter(isAvailable);
    this.slots = [0, 1, 2, 3].map((i) => {
      let m = c.lance[i] && readyM.find((x) => x.uid === c.lance[i]) ? c.lance[i] : null;
      let p = c.lancePilots[i] && readyP.find((x) => x.id === c.lancePilots[i]) ? c.lancePilots[i] : null;
      return { mech: m, pilot: p };
    });
    // Fill blanks
    for (const s of this.slots) {
      if (!s.mech) { const m = readyM.find((x) => !this.slots.some((o) => o.mech === x.uid)); if (m) s.mech = m.uid; }
      if (!s.pilot) { const p = readyP.find((x) => !this.slots.some((o) => o.pilot === x.id)); if (p) s.pilot = p.id; }
    }
  }
  render(ui: UI): void {
    const d = ui.d, c = company!, k = this.k;
    d.fill(0, 0, COLS, ROWS, ' ', C.text, C.bg);
    ui.header(0, 0, COLS, `LANCE CONFIGURATION · ${k.name.toUpperCase()} · ${MISSION_INFO[k.type].name.toUpperCase()} ${skulls(k.diff)}`, C.bg, C.accent);
    d.text(2, 2, 'Assign up to four \'Mechs and MechWarriors. Damaged \'Mechs under repair and injured pilots cannot deploy.', C.dim);
    let tons = 0;
    this.slots.forEach((s, i) => {
      const y = 4 + i * 9;
      const m = s.mech ? c.mechs.find((x) => x.uid === s.mech) ?? null : null;
      const p = s.pilot ? c.pilots.find((x) => x.id === s.pilot) ?? null : null;
      if (m) tons += frameTons(m);
      d.box(2, y, 86, 8, this.pick?.i === i ? C.accent : C.border, C.panel);
      d.text(4, y, ` SLOT ${i + 1} `, C.accent, C.panel, 99, true);
      // Mech
      if (ui.click(3, y + 1, 50, 6)) this.pick = { i, what: 'mech' };
      if (m) {
        const st = frameStats(m);
        d.text(4, y + 1, frameName(m), C.bright, undefined, 40, true);
        d.text(4, y + 2, `${frameTons(m)}t · mv ${st.walk}/${st.sprint}${st.jump ? ' j' + st.jump : ''} · armor ${st.armorTotal}`, C.dim);
        d.text(4, y + 3, weaponSummary(m).slice(0, 48), C.text);
        const e = repairEstimate(m);
        if (e.armorPts || e.structPts) d.text(4, y + 5, `Damaged: ${e.armorPts} armor, ${e.structPts} structure missing`, C.warn);
      } else d.text(4, y + 2, '— click to assign a \'Mech —', C.faint);
      // Pilot
      if (ui.click(55, y + 1, 32, 6)) this.pick = { i, what: 'pilot' };
      d.vline(54, y + 1, 6, C.border);
      if (p) {
        d.text(56, y + 1, `${p.callsign}`, C.bright, undefined, 30, true);
        d.text(56, y + 2, p.name, C.dim, undefined, 30);
        d.ctext(56, y + 3, skillLine(p), C.text);
        d.ctext(56, y + 4, healthPips(p), C.text);
      } else d.text(56, y + 2, '— click to assign —', C.faint);
      if ((m || p) && ui.button(80, y + 6, 'Clear', { style: 'plain', fg: C.dim })) { s.mech = null; s.pilot = null; }
    });
    // Picker
    const px = 90, pw = COLS - px - 1;
    if (this.pick) {
      const i = this.pick.i;
      if (this.pick.what === 'mech') {
        ui.panel(px, 4, pw, 36, `SELECT 'MECH · SLOT ${i + 1}`);
        const cands = c.mechs;
        const cl = ui.list(px + 1, 5, pw - 2, 34, cands, this.listState, (m, _j, lx, ly, lw, hov) => {
          const ready = mechReady(c, m);
          const used = this.slots.some((s, si) => si !== i && s.mech === m.uid);
          const bg = hov ? '#16222c' : C.panel;
          d.fill(lx, ly, lw, 2, ' ', C.text, bg);
          d.text(lx + 1, ly, frameName(m), ready && !used ? C.bright : C.faint, bg);
          d.text(lx + lw - 6, ly, `${frameTons(m)}t`, C.dim, bg);
          d.text(lx + 1, ly + 1, !ready ? 'In the \'Mech bay (work order)' : used ? 'Assigned to another slot' : weaponSummary(m).slice(0, lw - 3), !ready ? C.warn : C.dim, bg);
        }, 2);
        if (cl >= 0) { const m = cands[cl]; if (mechReady(c, m)) { for (const s of this.slots) if (s.mech === m.uid) s.mech = null; this.slots[i].mech = m.uid; this.pick = { i, what: 'pilot' }; } }
      } else {
        ui.panel(px, 4, pw, 36, `SELECT MECHWARRIOR · SLOT ${i + 1}`);
        const cands = c.pilots.filter((p) => !p.dead);
        const cl = ui.list(px + 1, 5, pw - 2, 34, cands, this.listState, (p, _j, lx, ly, lw, hov) => {
          const ok = isAvailable(p);
          const used = this.slots.some((s, si) => si !== i && s.pilot === p.id);
          const bg = hov ? '#16222c' : C.panel;
          d.fill(lx, ly, lw, 2, ' ', C.text, bg);
          d.text(lx + 1, ly, `${p.callsign}`, ok && !used ? C.bright : C.faint, bg);
          d.ctext(lx + 16, ly, skillLine(p), C.text, bg);
          d.text(lx + 1, ly + 1, !ok ? `Injured (${p.healDays} days)` : used ? 'Assigned' : p.name, !ok ? C.warn : C.dim, bg);
        }, 2);
        if (cl >= 0) { const p = cands[cl]; if (isAvailable(p)) { for (const s of this.slots) if (s.pilot === p.id) s.pilot = null; this.slots[i].pilot = p.id; this.pick = null; } }
      }
    } else {
      ui.panel(px, 4, pw, 36, 'INTEL');
      const lanceDiff = Math.max(0, (tons / 4 - 22) / 7.2);
      d.text(px + 2, 6, 'Contract difficulty', C.dim);
      d.text(px + 24, 6, skulls(k.diff), '#e8503a');
      d.text(px + 2, 7, 'Your lance (tonnage)', C.dim);
      d.text(px + 24, 7, `${tons}t  ${skulls(Math.round(lanceDiff))}`, lanceDiff >= k.diff - 1 ? C.green : C.warn);
      wrap(`Expected opposition: ${threatText(k.diff).replace(/\{[^}]*\}/g, '')}. Enemy 'Mechs average ~${Math.round(22 + k.diff * 7.2)} tons.`, pw - 4).forEach((l, j) => d.text(px + 2, 9 + j, l, C.text));
      d.text(px + 2, 13, 'Negotiated terms', C.dim);
      d.ctext(px + 2, 14, `{#f0c850}${cb(this.n.cash)}{/} · ${this.n.salvage} salvage (${this.n.priority} priority)`, C.text);
    }
    const ready = this.slots.filter((s) => s.mech && s.pilot);
    if (ui.button(2, ROWS - 3, 'Cancel contract', { key: 'Escape' })) app.pop();
    if (ui.button(COLS - 24, ROWS - 3, 'LAUNCH', { key: 'Enter', style: 'block', w: 20, center: true, disabled: !ready.length, tip: ready.length ? 'Drop into combat.' : 'Assign at least one \'Mech and MechWarrior.' })) this.launch();
  }

  launch(): void {
    const c = company!;
    const lance = this.slots.filter((s) => s.mech && s.pilot).map((s) => ({ mech: c.mechs.find((m) => m.uid === s.mech)!, pilot: c.pilots.find((p) => p.id === s.pilot)! }));
    c.lance = this.slots.map((s) => s.mech);
    c.lancePilots = this.slots.map((s) => s.pilot);
    const rt = launchContract(c, this.k, lance);
    saveGame(c);
    const k = this.k, n = this.n, argo = this.argo;
    app.replace(new CombatScreen(rt, (done) => {
      const res = resolveContract(company!, k, n, done);
      saveGame(company!);
      app.replace(new AftermathScreen(res, argo));
    }, `${k.name.toUpperCase()}`));
  }
}

// ---- After action -----------------------------------------------------------------------------
export class AftermathScreen implements Screen {
  stage: 'report' | 'salvage' | 'done' = 'report';
  picks: number[] = [];
  got: SalvageEntry[] = [];
  listState = { scroll: 0 };
  constructor(public res: MissionResult, public argo: ArgoScreen) {}

  render(ui: UI): void {
    const d = ui.d, c = company!, r = this.res;
    d.fill(0, 0, COLS, ROWS, ' ', C.text, C.bg);
    const win = r.outcome === 'win';
    ui.header(0, 0, COLS, `AFTER ACTION REPORT · ${r.contract.name.toUpperCase()}`, C.bg, win ? '#4aa46a' : '#c04a3a');
    if (this.stage === 'report') this.report(ui, c, r);
    else this.salvage(ui, c, r);
  }

  report(ui: UI, c: Company, r: MissionResult): void {
    const d = ui.d;
    const win = r.outcome === 'win';
    d.text(3, 2, win ? 'CONTRACT COMPLETE' : r.outcome === 'withdraw' ? 'WITHDRAWN FROM CONTRACT' : 'CONTRACT FAILED', win ? C.green : C.red, undefined, 99, true);
    ui.panel(2, 4, 70, 16, 'PAYMENT & STANDING');
    let y = 6;
    d.ctext(4, y++, `Contract payment    {#f0c850}${cb(r.pay)}{/}`, C.dim);
    d.ctext(4, y++, `Objective bonuses   {#f0c850}${cb(r.bonus)}{/}`, C.dim);
    d.ctext(4, y++, `Repairs queued      {#e8503a}${cb(-r.repairCost)}{/}`, C.dim);
    y++;
    for (const [f, v] of r.repChanges) { const fa = faction(f); d.ctext(4, y++, `{${fa.color}}${fa.name}{/} standing ${v >= 0 ? '{#6ad46a}+' : '{#e8503a}'}${v}{/}  → ${repLevel(c.rep[f]).name}`, C.dim); }
    d.ctext(4, y++, `MRB rating {#f0a830}+${r.mrbGain}{/}`, C.dim);
    for (const l of r.lines) d.text(4, y++, l, C.accent, undefined, 66);
    ui.panel(74, 4, COLS - 76, 16, 'MECHWARRIORS');
    y = 6;
    for (const [p, xp] of r.xp) {
      d.text(76, y, p.callsign.padEnd(14), p.dead ? C.red : C.bright);
      d.ctext(91, y, p.dead ? '{#e8503a}KILLED IN ACTION{/}' : `+${xp} XP  ${healthPips(p)}`, C.text);
      y++;
    }
    y++;
    for (const l of [...r.casualties, ...r.mechsLost]) { for (const w of wrap(l, COLS - 82)) d.text(76, y++, w, C.orange); }
    // Mech condition
    ui.panel(2, 21, COLS - 4, 18, '\'MECH CONDITION');
    y = 23;
    for (const m of c.mechs.filter((mm) => c.lance.includes(mm.uid))) {
      const e = repairEstimate(m);
      const st = frameStats(m);
      d.text(4, y, frameName(m).padEnd(24), C.bright);
      simpleBar(d, 30, y, 20, st.armorTotal / Math.max(1, st.armorMax), healthColor(st.armorTotal / Math.max(1, st.armorMax)));
      d.text(52, y, e.armorPts || e.structPts || e.deadItems.length ? `${e.armorPts} armor · ${e.structPts} structure · ${e.deadItems.length} components` : 'Undamaged', e.armorPts ? C.warn : C.green);
      const wo = c.work.find((w) => w.mechUid === m.uid);
      if (wo) d.text(110, y, `Repair ${Math.ceil(wo.hours / 40)}d · ${cb(e.cost)}`, C.dim);
      y++;
    }
    const next = r.pool.length ? 'SALVAGE' : 'CONTINUE';
    if (ui.button(COLS - 22, ROWS - 3, next, { key: 'Enter', style: 'block', w: 18, center: true })) {
      if (r.pool.length) this.stage = 'salvage';
      else this.finish();
    }
  }

  salvage(ui: UI, c: Company, r: MissionResult): void {
    const d = ui.d;
    if (this.stage === 'done') {
      d.text(3, 2, 'SALVAGE RECOVERED', C.accent, undefined, 99, true);
      this.got.forEach((g, i) => d.text(5, 4 + i, `${g.kind === 'part' ? '⚙' : '▪'} ${g.label}`, g.kind === 'part' ? C.cyan : C.text));
      const parts = new Set(this.got.filter((g) => g.kind === 'part').map((g) => g.id));
      let y = 6 + this.got.length;
      for (const p of parts) { d.ctext(5, y++, `${chassis(p).name} ${p}: {#f2f6f8}${c.parts[p] ?? 0}/${PARTS_NEEDED}{/} parts${(c.parts[p] ?? 0) >= PARTS_NEEDED ? ' — {#6ad46a}ready to assemble in the Mech Bay!{/}' : ''}`, C.dim); }
      if (ui.button(COLS - 22, ROWS - 3, 'RETURN TO ARGO', { key: 'Enter', style: 'block', w: 18, center: true })) this.finish();
      return;
    }
    d.ctext(3, 2, `Choose {#f0a830}${r.priority}{/} priority salvage item${r.priority === 1 ? '' : 's'}. The remaining {#f2f6f8}${Math.max(0, r.salvageShares - r.priority)}{/} shares will be assigned at random.`, C.text);
    ui.panel(2, 4, 90, ROWS - 8, `SALVAGE POOL (${r.pool.length})`);
    const cl = ui.list(3, 5, 88, ROWS - 10, r.pool, this.listState, (e, i, lx, ly, lw, hov) => {
      const sel = this.picks.includes(i);
      const bg = sel ? '#2a2210' : hov ? '#16222c' : C.panel;
      d.fill(lx, ly, lw, 1, ' ', C.text, bg);
      d.text(lx + 1, ly, sel ? '■' : '□', sel ? C.accent : C.faint, bg);
      d.text(lx + 3, ly, e.kind === 'part' ? '⚙' : '▪', e.kind === 'part' ? C.cyan : C.dim, bg);
      d.text(lx + 5, ly, e.label, sel ? C.bright : C.text, bg, 50);
      if (e.kind === 'part') d.text(lx + 58, ly, `have ${c.parts[e.id] ?? 0}/${PARTS_NEEDED}`, C.dim, bg);
      d.text(lx + lw - 10, ly, cbk(e.value).padStart(9), C.cbill, bg);
      if (hov && e.kind === 'item') ui.setTip(weaponTip(e.id));
    });
    if (cl >= 0) {
      const k = this.picks.indexOf(cl);
      if (k >= 0) this.picks.splice(k, 1); else if (this.picks.length < r.priority) this.picks.push(cl);
    }
    d.text(95, 6, `Picks ${this.picks.length}/${r.priority}`, C.accent, undefined, 99, true);
    this.picks.forEach((p, i) => d.text(95, 8 + i, `▪ ${r.pool[p].label}`, C.text, undefined, 50));
    if (ui.button(COLS - 22, ROWS - 3, 'CONFIRM', { key: 'Enter', style: 'block', w: 18, center: true, disabled: this.picks.length < Math.min(r.priority, r.pool.length) })) {
      this.got = claimSalvage(c, r, this.picks);
      saveGame(c);
      this.stage = 'done';
    }
    void lerp; void health;
  }

  finish(): void {
    const c = company!;
    saveGame(c);
    this.argo.tab = 'COMMAND';
    app.pop();
  }
}
export type { Frame, Pilot };
