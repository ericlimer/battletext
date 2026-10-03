// Contracts: board, negotiation, lance deployment, after-action report and salvage.

import { Screen, app } from './app';
import { UI } from '../engine/ui';
import { C, lerp, healthColor } from '../engine/color';
import { COLS, ROWS } from '../engine/display';
import type { ArgoScreen } from './argo';
import { skulls } from './argo';
import { company, saveGame, saveBackup } from '../game/save';
import { Company, Contract, Negotiation, negotiate, negotiateShares, maxShares, maxContractDiff, sys, mechReady, mrbLevel, PARTS_NEEDED, maxSlider, contractDays, workQueueDays, startTravel, travelMult } from '../game/company';
import { route } from '../game/world';
import { MISSION_INFO } from '../combat/missions';
import { BIOME_INFO } from '../combat/terrain';
import { faction, repLevel } from '../data/factions';
import { cb, cbk, wrap } from '../engine/util';
import { Frame, frameName, frameTons, weaponSummary, frameStats, repairEstimate } from '../game/frame';
import { Pilot, isAvailable, health, skillTotal } from '../game/pilot';
import { launchContract, resolveContract, MissionResult, SalvageEntry } from '../game/aftermath';
import { SalvageScreen } from './salvage';
import { CombatScreen } from './combat';
import { surveyOf, drawSurvey, oppositionEstimate, likelyLance, defaultSlots, daysToContract, fightOdds, oddsText, MISSION_RISK } from './survey';
import { skillLine, simpleBar, healthPips, weaponTip } from './widgets';
import { item } from '../data/items';
import { chassis } from '../data/mechs';

export function drawContractsTab(ui: UI, argo: ArgoScreen, x: number, y: number, w: number, h: number): void {
  const d = ui.d, c = company!;
  const st = (argo.st.contracts ??= { sel: 0, list: { scroll: 0 }, travel: false });
  if (c.travel) {
    ui.panel(x + 1, y, w - 2, h, 'CONTRACTS');
    d.text(x + 4, y + 3, `The Argo is in transit to ${sys(c, c.travel.dest).name}. Contracts will be available on arrival.`, C.cyan);
    return;
  }
  const local = c.contracts[c.location] ?? [];
  const offers = (c.travelOffers ?? []).filter((t) => t.expires > c.day);
  const list = st.travel ? offers : local;
  ui.panel(x + 1, y, 62, h, st.travel ? 'TRAVEL CONTRACTS' : `CONTRACTS · ${sys(c).name.toUpperCase().slice(0, 12)}`);
  if (ui.button(x + 30, y, `Local ${local.length}`, { style: 'plain', active: !st.travel, tip: 'Contracts in this system.' })) { st.travel = false; st.sel = 0; st.list.scroll = 0; }
  if (ui.button(x + 42, y, `Travel ${offers.length}`, { style: 'plain', active: st.travel, key: 't', tip: 'Contracts in neighbouring systems (+20% pay). Accepting sets course; the terms are held for you.' })) { st.travel = true; st.sel = 0; st.list.scroll = 0; }
  if (!list.length) d.text(x + 3, y + 2, st.travel ? 'No travel contracts posted.' : 'No contracts on offer. Pass time, check Travel, or move on.', C.dim);
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
    const where = k.sysId ? `{#5fd0e8}${sys(c, k.sysId).name} (${route(c.systems, c.location, k.sysId, travelMult(c))?.days ?? '?'}d){/} · ` : '';
    d.ctext(lx + 2, ly + 2, `${where}${BIOME_INFO[k.biome].name}${k.night ? ' · night' : ''} · ${k.booked ? '{#6ad46a}BOOKED{/}' : `expires in ${k.expires - c.day}d`}${locked ? ' · {#e8503a}MRB TOO LOW{/}' : ''}`, C.faint, bg, lw - 4);
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
  wrap(`${mi.name} — ${mi.desc}`, dw - 16).forEach((l, i) => d.ctext(dx + 3, yy++, i ? `          ${l}` : `Mission   {#f2f6f8}${l.replace(mi.name, `${mi.name}{/}`)}`, C.dim));
  d.ctext(dx + 3, yy++, `Terrain   {#f2f6f8}${BIOME_INFO[k.biome].name}{/} — ${BIOME_INFO[k.biome].desc}${k.night ? ' {#b27ae8}Night.{/}' : ''}`, C.dim, undefined, dw - 6);
  for (const l of wrap(k.flavor, dw - 8)) d.text(dx + 3, yy++, l, C.text);
  yy++;
  d.ctext(dx + 3, yy++, `Maximum payment {#f0c850}${cb(k.pay)}{/}   Salvage up to {#f2f6f8}${k.salvageMax}{/} shares`, C.dim);
  const rt = surveyOf(c, k);
  const est = oppositionEstimate(rt);
  const lanceT = likelyLance(c, daysToContract(c, k)).reduce((a, m) => a + frameTons(m), 0);
  d.ctext(dx + 3, yy++, `Enemy forces: ${threatText(k.diff)}  {#6d7f8a}· intel: ~${est.units} units, ~${est.tons}t{/}`, C.dim, undefined, dw - 6);
  const odds = fightOdds(c, k), [ot, oc] = oddsText(odds.ratio);
  d.ctext(dx + 3, yy++, `Your lance: {#f2f6f8}${lanceT}t{/}  {${oc}}${ot}{/} {#6d7f8a}(firepower × armor, pilots counted · ${odds.ratio.toFixed(2)}×){/}${c.storage.length ? ` {#f0c040}· ${c.storage.length} in storage{/}` : ''}`, C.dim, undefined, dw - 6);
  if (MISSION_RISK[k.type]) d.ctext(dx + 3, yy++, `{#6d7f8a}Risk:{/} ${MISSION_RISK[k.type]}`, C.dim, undefined, dw - 6);
  yy += 1;
  for (const o of rt.objectives) {
    d.ctext(dx + 3, yy++, `${o.primary ? '{#f0a830}■ PRIMARY{/} ' : '{#6d7f8a}◇ OPTIONAL{/}'} ${o.text}${o.bonus ? ` {#f0c850}(+${cbk(o.bonus)}){/}` : ''}`, C.text, undefined, dw - 6);
  }
  yy += 1;
  const locked = k.diff > maxD;
  if (locked) {
    d.text(dx + 3, yy, `The Mercenary Review Board will not bond you for a ${skulls(k.diff)} contract. MRB rating ${mrbLevel(c)} allows up to ${skulls(Math.floor(maxD))}.`, C.red, undefined, dw - 6);
  } else if (k.booked) {
    d.ctext(dx + 24, yy, `Terms agreed: {#f0c850}${cb(k.booked.cash)}{/} · ${k.booked.salvage} salvage (${k.booked.priority} priority)`, C.dim);
    if (ui.button(dx + 3, yy, 'DEPLOY', { key: 'Enter', style: 'block', w: 18, center: true })) app.push(new DropScreen(k, k.booked, argo));
  } else if (ui.button(dx + 3, yy, k.sysId ? 'NEGOTIATE & TRAVEL' : 'NEGOTIATE', { key: 'Enter', style: 'block', w: 24, center: true })) {
    app.push(new NegotiateScreen(k, argo));
  }
  // Battlefield survey
  const sm = rt.battle.map, sy = Math.max(yy + 3, y + h - sm.h / 2 - 1), sx = dx + 3;
  if (sy + sm.h / 2 <= y + h - 1) {
    d.text(sx, sy - 1, 'BATTLEFIELD SURVEY', C.accent, undefined, 99, true);
    drawSurvey(d, rt, sx, sy);
    const lx = sx + sm.w + 3;
    const legend = ['{#5fd0e8}▲{/} drop zone'];
    if (k.type === 'escort' || k.type === 'ambush' || k.type === 'assassinate') legend.push('{#f0c040}×{/} exit');
    if (k.type === 'escort') legend.push('{#6ad46a}■{/} convoy');
    if (k.type === 'capture') legend.push('{#f0c040}◎{/} beacon');
    if (k.type === 'destroybase') legend.push('{#e8603a}■{/} target');
    if (k.type === 'defendbase') legend.push('{#3aa8d8}■{/} protect');
    if (k.type === 'escort' || k.type === 'ambush') legend.push('{#d8d0b8}─{/} road');
    legend.forEach((l, i) => d.ctext(lx, sy + 1 + i, l, C.dim, undefined, dw - (lx - dx) - 2));
    d.text(lx, sy + 6, `${sm.w}×${sm.h} tiles`, C.faint, undefined, dw - (lx - dx) - 2);
    if (k.night) d.text(lx, sy + 7, 'Night: sight 10', '#b27ae8');
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
  slider: number;
  /** Salvage shares asked for: the slider steps one share at a time. */
  constructor(public k: Contract, public argo: ArgoScreen) { this.slider = Math.min(Math.round(k.salvageMax * 0.3), maxShares(company!, k)); }
  render(ui: UI): void {
    const d = ui.d, k = this.k, c = company!;
    const w = 86, h = 23, x = (COLS - w) >> 1, y = 9;
    ui.panel(x, y, w, h, 'NEGOTIATION', { style: 'double', fg: C.borderHi, bg: '#0a1016' });
    const emp = faction(k.employer), tgt = faction(k.target);
    const cap = maxShares(c, k), full = k.salvageMax;
    d.ctext(x + 3, y + 2, `{${emp.color}}${emp.name}{/} representative is on the line.`, C.dim);
    d.text(x + 3, y + 3, '"Cash, or a share of the salvage. Within reason."', C.text, undefined, w - 6);
    const n: Negotiation = negotiateShares(k, this.slider);
    d.text(x + 3, y + 6, 'C-BILLS', C.cbill, undefined, 99, true);
    d.text(x + w - 11, y + 6, 'SALVAGE', C.bright, undefined, 99, true);
    const sw = w - 25;
    this.slider = Math.min(cap, Math.round(ui.slider(x + 12, y + 6, sw, this.slider, 0, full)));
    const capX = Math.round((cap / Math.max(1, full)) * (sw - 1));
    for (let i = capX + 1; i < sw; i++) d.set(x + 12 + i, y + 6, '╌', '#8a3030');
    if (cap < full) { d.set(x + 12 + capX + 1, y + 5, '▼', C.red); if (ui.hover(x + 12 + capX + 1, y + 5, 1, 1)) ui.setTip(['Negotiation cap', 'Better standing with the employer and a higher MRB rating let you ask for more salvage.']); }
    if (ui.key('ArrowLeft')) this.slider = Math.max(0, this.slider - 1);
    if (ui.key('ArrowRight')) this.slider = Math.min(cap, this.slider + 1);
    const lv = repLevel(c.rep[k.employer] ?? 0);
    if (cap < full) d.ctext(x + 12, y + 7, `{#e8503a}▼{/} {#6d7f8a}Your standing ({${lv.color}}${lv.name}{/}{#6d7f8a}) and MRB cap salvage.{/}`, C.dim, undefined, sw);
    d.ctext(x + 3, y + 9, `Payment on completion  {#f0c850}${cb(n.cash)}{/}`, C.dim);
    d.ctext(x + 3, y + 10, `Salvage shares        {#f2f6f8}${n.salvage}{/} {#6d7f8a}(${n.priority} priority, the rest chosen after the employer's cut){/}`, C.dim, undefined, w - 6);
    const opts = surveyOf(c, k).objectives.filter((o) => !o.primary);
    d.ctext(x + 3, y + 11, opts.length ? `Optional objectives   ${opts.map((o) => `${o.text} {#f0c850}+${cbk(o.bonus)}{/}`).join(' · ')}` : 'Optional objectives   none', C.dim, undefined, w - 6);
    d.ctext(x + 3, y + 12, `Deployment            {#f2f6f8}${contractDays(k)}{/} days`, C.dim);
    const eRep = Math.round(3 + k.diff * 0.9), tRep = Math.round(2 + k.diff * 0.5), fRep = Math.round(3 + k.diff * 0.5);
    d.ctext(x + 3, y + 14, `Success: {${emp.color}}${emp.short}{/} {#6ad46a}+${eRep}{/}, {${tgt.color}}${tgt.short}{/} {#e8503a}-${tRep}{/}   Failure: {${emp.color}}${emp.short}{/} {#e8503a}-${fRep}{/}`, C.dim, undefined, w - 6);
    const tl = repLevel(c.rep[k.target] ?? 0);
    if (tl.idx >= 4) d.ctext(x + 3, y + 15, `{#f0a830}Warning:{/} you are {${tl.color}}${tl.name}{/} with ${tgt.name}. This contract will sour that.`, C.dim, undefined, w - 6);
    if (ui.button(x + 3, y + h - 3, 'Back', { key: 'Escape' })) app.pop();
    if (ui.button(x + w - 28, y + h - 3, k.sysId ? 'ACCEPT & SET COURSE' : 'ACCEPT CONTRACT', { key: 'Enter', style: 'block', w: 24, center: true })) {
      app.pop();
      if (k.sysId) {
        const dest = k.sysId;
        const days = route(c.systems, c.location, dest, travelMult(c))?.days ?? 10;
        k.booked = n;
        k.expires = c.day + days + 12;
        c.travelOffers = (c.travelOffers ?? []).filter((t) => t !== k);
        k.sysId = undefined;
        (c.contracts[dest] ??= []).unshift(k);
        const err = startTravel(c, dest);
        if (err) this.argo.notify(err, C.red); else { this.argo.notify(`Contract booked: course set for ${sys(c, dest).name}`, C.cyan); this.argo.advancing = true; this.argo.watchKey = this.argo.stopWatch(); }
        saveGame(c);
      } else app.push(new DropScreen(k, n, this.argo));
    }
  }
}

// ---- Lance deployment ---------------------------------------------------------------------
export class DropScreen implements Screen {
  slots: { mech: string | null; pilot: string | null }[];
  pick: { i: number; what: 'mech' | 'pilot' } | null = null;
  listState = { scroll: 0 };
  constructor(public k: Contract, public n: Negotiation, public argo: ArgoScreen) {
    this.slots = defaultSlots(company!);
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
      if (m && p) tons += frameTons(m);
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
        const hp = Object.values(chassis(m.defId).hardpoints).flat().filter((h) => h !== 'S').length;
        if (!st.weapons.length) d.text(4, y + 6, '⚠ NO WEAPONS MOUNTED — refit in the Mech Lab', C.red);
        else if (hp - st.weapons.length >= 2) d.text(4, y + 6, `⚠ ${hp - st.weapons.length} empty hardpoints — under-armed`, C.warn);
      } else d.text(4, y + 2, '— click to assign a \'Mech —', C.faint);
      // Pilot
      if (ui.click(55, y + 1, 32, 6)) this.pick = { i, what: 'pilot' };
      d.vline(54, y + 1, 6, C.border);
      if (p) {
        d.text(56, y + 1, p.sigil, p.color, undefined, 99, true);
        d.text(58, y + 1, `${p.callsign}`, C.bright, undefined, 28, true);
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
          d.text(lx + 1, ly, p.sigil, ok && !used ? p.color : C.faint, bg);
          d.text(lx + 3, ly, `${p.callsign}`, ok && !used ? C.bright : C.faint, bg);
          d.ctext(lx + 16, ly, skillLine(p), C.text, bg);
          d.text(lx + 1, ly + 1, !ok ? `Injured (${p.healDays} day${p.healDays === 1 ? '' : 's'})` : used ? 'Assigned' : p.name, !ok ? C.warn : C.dim, bg);
        }, 2);
        if (cl >= 0) { const p = cands[cl]; if (isAvailable(p)) { for (const s of this.slots) if (s.pilot === p.id) s.pilot = null; this.slots[i].pilot = p.id; this.pick = null; } }
      }
    } else {
      ui.panel(px, 4, pw, 36, 'INTEL');
      // Same intel and verdict as the contract board, for the lance as currently assigned
      const est = oppositionEstimate(surveyOf(c, k));
      const odds = fightOdds(c, k, this.slots), [ot, oc] = oddsText(odds.ratio);
      d.text(px + 2, 6, 'Contract difficulty', C.dim);
      d.text(px + 24, 6, skulls(k.diff), '#e8503a');
      d.text(px + 2, 7, 'Enemy (intel)', C.dim);
      d.text(px + 24, 7, `~${est.units} units, ~${est.tons}t`, C.text);
      d.text(px + 2, 8, 'Your lance', C.dim);
      d.ctext(px + 24, 8, `${tons}t  {${oc}}${ot}{/}`, C.text);
      wrap(`Expected opposition: ${threatText(k.diff).replace(/\{[^}]*\}/g, '')}. ${MISSION_RISK[k.type] ?? ''}`, pw - 4).slice(0, 3).forEach((l, j) => d.text(px + 2, 10 + j, l, C.text));
      d.text(px + 2, 14, 'Negotiated terms', C.dim);
      d.ctext(px + 2, 15, `{#f0c850}${cb(this.n.cash)}{/} · ${this.n.salvage} salvage (${this.n.priority} priority)`, C.text);
    }
    const ready = this.slots.filter((s) => s.mech && s.pilot);
    if (ui.button(2, ROWS - 3, 'Cancel contract', { key: 'Escape' })) app.pop();
    if (ui.button(32, ROWS - 3, 'Auto-fill best', { key: 'a', tip: 'Heaviest ready \'Mechs, best available MechWarriors.' })) { this.slots = defaultSlots(c); this.pick = null; }
    if (ui.button(COLS - 24, ROWS - 3, 'LAUNCH', { key: 'Enter', style: 'block', w: 20, center: true, disabled: !ready.length, tip: ready.length ? 'Drop into combat.' : 'Assign at least one \'Mech and MechWarrior.' })) this.launch();
  }

  launch(): void {
    const c = company!;
    const lance = this.slots.filter((s) => s.mech && s.pilot).map((s) => ({ mech: c.mechs.find((m) => m.uid === s.mech)!, pilot: c.pilots.find((p) => p.id === s.pilot)! }));
    c.lance = this.slots.map((s) => s.mech);
    c.lancePilots = this.slots.map((s) => s.pilot);
    saveBackup(c);
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
    if (r.failed?.length) d.text(30, 2, r.failed.join(' '), C.orange, undefined, COLS - 32);
    // Lay out the text first so the panels grow to fit it
    const left: [string, string][] = [];
    left.push([`Contract payment    {#f0c850}${cb(r.pay)}{/}`, C.dim], [`Objective bonuses   {#f0c850}${cb(r.bonus)}{/}`, C.dim], [`Repairs queued      {#e8503a}${cb(-r.repairCost)}{/}`, C.dim], ['', C.dim]);
    for (const [f, v] of r.repChanges) { const fa = faction(f); left.push([`{${fa.color}}${fa.name}{/} standing ${v >= 0 ? '{#6ad46a}+' : '{#e8503a}'}${v}{/}  → ${repLevel(c.rep[f]).name}`, C.dim]); }
    left.push([`MRB rating {#f0a830}+${r.mrbGain}{/}${r.outcome === 'loss' && r.mrbGain ? ' {#6d7f8a}(the review board credits any completed drop){/}' : ''}`, C.dim]);
    for (const l of r.lines) for (const w of wrap(l, 66)) left.push([w, C.accent]);
    const right: [string, string][] = [];
    for (const l of [...r.casualties, ...r.mechsLost]) for (const w of wrap(l, COLS - 82)) right.push([w, C.orange]);
    const topH = Math.max(12, left.length + 4, r.xp.length + right.length + 5);
    ui.panel(2, 4, 70, topH, 'PAYMENT & STANDING');
    let y = 6;
    for (const [t, col] of left) d.ctext(4, y++, t, col, undefined, 66);
    ui.panel(74, 4, COLS - 76, topH, 'MECHWARRIORS');
    y = 6;
    for (const [p, xp] of r.xp) {
      d.text(76, y, p.sigil, p.dead ? C.faint : p.color);
      d.text(78, y, p.callsign.padEnd(12).slice(0, 12), p.dead ? C.red : C.bright);
      d.ctext(91, y, p.dead ? '{#e8503a}KILLED IN ACTION{/}' : `+${xp} XP  ${healthPips(p)}`, C.text);
      y++;
    }
    y++;
    for (const [t, col] of right) d.text(76, y++, t, col);
    // Mech condition
    const deployed = c.mechs.filter((mm) => (r.deployed ?? c.lance).includes(mm.uid));
    const cy = 4 + topH + 1;
    ui.panel(2, cy, COLS - 4, Math.min(ROWS - 4 - cy, deployed.length + (r.writtenOff?.length ?? 0) + 4), '\'MECH CONDITION');
    y = cy + 2;
    for (const m of deployed) {
      const e = repairEstimate(m);
      const st = frameStats(m);
      d.text(4, y, frameName(m).padEnd(24), C.bright);
      simpleBar(d, 30, y, 20, st.armorTotal / Math.max(1, st.armorMax), healthColor(st.armorTotal / Math.max(1, st.armorMax)));
      d.text(52, y, e.armorPts || e.structPts || e.deadItems.length ? `${e.armorPts} armor · ${e.structPts} structure · ${e.deadItems.length} components` : 'Undamaged', e.armorPts ? C.warn : C.green);
      const wo = c.work.find((w) => w.mechUid === m.uid);
      if (wo) d.text(110, y, `Repair ~${workQueueDays(c, m.uid)}d · ${cb(e.cost)}`, C.dim);
      y++;
    }
    for (const [n, why] of r.writtenOff ?? []) {
      d.text(4, y, n.padEnd(24).slice(0, 24), C.faint);
      d.text(30, y, 'WRITTEN OFF', C.red);
      d.text(52, y, why, C.dim, undefined, COLS - 58);
      y++;
    }
    const next = r.pool.length ? 'SALVAGE' : 'CONTINUE';
    d.ctext(3, ROWS - 3, `Deployment took {#f2f6f8}${r.days}{/} days; they pass as you return to the Argo.`, C.faint);
    if (ui.button(COLS - 22, ROWS - 3, next, { key: 'Enter', style: 'block', w: 18, center: true })) {
      this.finish();
    }
  }

  salvage(ui: UI, c: Company, r: MissionResult): void { void ui; void c; void r; }

  finish(): void {
    const c = company!;
    saveGame(c);
    this.argo.tab = 'COMMAND';
    if (c.pendingSalvage) app.replace(new SalvageScreen(this.argo));
    else app.pop();
  }
}
export type { Frame, Pilot };
