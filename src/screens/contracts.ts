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
import { Pilot, isAvailable, health, skillTotal, roleOf } from '../game/pilot';
import { launchContract, resolveContract, MissionResult, SalvageEntry } from '../game/aftermath';
import { SalvageScreen } from './salvage';
import { CombatScreen } from './combat';
import { surveyOf, drawSurvey, oppositionEstimate, likelyLance, defaultSlots, daysToContract, fightOdds, oddsText, MISSION_RISK, surveySize } from './survey';
import { skillLine, simpleBar, healthPips, weaponTip, roleTag } from './widgets';
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
  const sm = rt.battle.map, room = y + h - 1 - (yy + 3);
  const [sw, sh] = surveySize(rt, room);
  const sy = Math.max(yy + 3, y + h - sh - 1), sx = dx + 3;
  if (sh >= 12) {
    d.text(sx, sy - 1, 'BATTLEFIELD SURVEY', C.accent, undefined, 99, true);
    drawSurvey(d, rt, sx, sy, room);
    const lx = sx + sw + 3;
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
  /** Slot chosen for click-to-assign (a bank click fills it). */
  sel: number | null = null;
  drag: { kind: 'mech' | 'pilot'; id: string; from: number | null; x0: number; y0: number; moved: boolean } | null = null;
  wasDown = false;
  mechList = { scroll: 0 };
  pilotList = { scroll: 0 };
  constructor(public k: Contract, public n: Negotiation, public argo: ArgoScreen) {
    this.slots = defaultSlots(company!);
  }

  /** Last deployment's lance, leaving a hole wherever a 'Mech or MechWarrior can't go now. */
  previousLance(): void {
    const c = company!;
    this.slots = [0, 1, 2, 3].map((i) => {
      const mu = c.lance[i] ?? null, pi = c.lancePilots[i] ?? null;
      const m = mu ? c.mechs.find((x) => x.uid === mu) : undefined, p = pi ? c.pilots.find((x) => x.id === pi) : undefined;
      return { mech: m && mechReady(c, m) ? mu : null, pilot: p && !p.dead && isAvailable(p) ? pi : null };
    });
    this.sel = null;
  }

  place(kind: 'mech' | 'pilot', id: string, slot: number | null, from: number | null): void {
    const c = company!;
    if (kind === 'mech') { const m = c.mechs.find((x) => x.uid === id); if (!m || !mechReady(c, m)) return; }
    else { const p = c.pilots.find((x) => x.id === id); if (!p || p.dead || !isAvailable(p)) return; }
    if (slot === null) { if (from !== null) this.slots[from][kind] = null; return; } // dropped back on a bank
    const prev = this.slots[slot][kind];
    for (const s of this.slots) if (s[kind] === id) s[kind] = null;
    this.slots[slot][kind] = id;
    if (from !== null && from !== slot) this.slots[from][kind] = prev; // swap
  }

  render(ui: UI): void {
    const d = ui.d, c = company!, k = this.k, inp = ui.inp;
    d.fill(0, 0, COLS, ROWS, ' ', C.text, C.bg);
    ui.header(0, 0, COLS, `LANCE CONFIGURATION · ${k.name.toUpperCase()} · ${MISSION_INFO[k.type].name.toUpperCase()} ${skulls(k.diff)}`, C.bg, C.accent);
    d.text(2, 2, 'Drag \'Mechs and MechWarriors into the slots (or click a slot, then a name). Drag out to clear.', C.dim);
    const rt = surveyOf(c, k);
    const split = rt.layout === 'split';
    const mx = Math.floor(inp.mx), my = Math.floor(inp.my);
    const pressed = inp.down && !this.wasDown;
    this.wasDown = inp.down;
    const SX = 2, SW = 68, SH = 9, MBX = 72, MBW = 38, PBX = 111, PBW = COLS - 111 - 1, TOP = 4, BH = 36;
    const slotAt = (x: number, y: number): number | null => { for (let i = 0; i < 4; i++) { const yy = TOP + i * SH + (split && i >= 2 ? 0 : 0); if (x >= SX && x < SX + SW && y >= yy && y < yy + SH - 1) return i; } return null; };
    const overBank = (x: number, y: number) => y >= TOP && y < TOP + BH && x >= MBX;
    let tons = 0;
    // ---- Slots
    this.slots.forEach((s, i) => {
      const y = TOP + i * SH;
      const m = s.mech ? c.mechs.find((x) => x.uid === s.mech) ?? null : null;
      const p = s.pilot ? c.pilots.find((x) => x.id === s.pilot) ?? null : null;
      if (m && p) tons += frameTons(m);
      const dropHere = this.drag?.moved && slotAt(mx, my) === i;
      const border = dropHere ? '#6ae090' : this.sel === i ? C.accent : C.border;
      d.box(SX, y, SW, SH - 1, border, C.panel);
      const pair = split ? (i < 2 ? ' · PAIR A' : ' · PAIR B') : '';
      d.text(SX + 2, y, ` SLOT ${i + 1}${pair} `, C.accent, C.panel, 99, true);
      // 'Mech half
      if (m) {
        const st = frameStats(m);
        d.text(SX + 2, y + 1, frameName(m), C.bright, undefined, 34, true);
        d.text(SX + 2, y + 2, `${frameTons(m)}t · mv ${st.walk}/${st.sprint}${st.jump ? ' j' + st.jump : ''} · armor ${st.armorTotal}`, C.dim, undefined, 36);
        d.text(SX + 2, y + 3, weaponSummary(m), C.text, undefined, 36);
        const e = repairEstimate(m);
        if (e.armorPts || e.structPts) d.text(SX + 2, y + 5, `Damaged: ${e.armorPts} armor, ${e.structPts} structure`, C.warn, undefined, 36);
        const hp = Object.values(chassis(m.defId).hardpoints).flat().filter((h) => h !== 'S').length;
        if (!st.weapons.length) d.text(SX + 2, y + 6, '⚠ NO WEAPONS MOUNTED', C.red);
        else if (hp - st.weapons.length >= 2) d.text(SX + 2, y + 6, `⚠ ${hp - st.weapons.length} empty hardpoints`, C.warn);
      } else d.text(SX + 2, y + 3, '— drop a \'Mech here —', C.faint);
      d.vline(SX + 39, y + 1, SH - 3, C.border);
      // Pilot half
      if (p) {
        d.text(SX + 41, y + 1, p.sigil, p.color, undefined, 99, true);
        d.text(SX + 43, y + 1, p.callsign, C.bright, undefined, 22, true);
        d.ctext(SX + 41, y + 2, roleOf(p) ? `${roleTag(p)} {#6d7f8a}· ${p.name}{/}` : p.name, C.dim, undefined, 26);
        d.ctext(SX + 41, y + 3, skillLine(p), C.text);
        d.ctext(SX + 41, y + 4, healthPips(p), C.text);
      } else d.text(SX + 41, y + 3, '— drop a pilot —', C.faint);
      if ((m || p) && ui.button(SX + SW - 9, y + SH - 3, 'Clear', { style: 'plain', fg: C.dim })) { s.mech = null; s.pilot = null; }
      // Start dragging out of a slot
      if (pressed && !this.drag && mx >= SX + 1 && mx < SX + SW - 1 && my > y && my < y + SH - 3) {
        if (mx < SX + 39 && m) this.drag = { kind: 'mech', id: m.uid, from: i, x0: mx, y0: my, moved: false };
        else if (mx > SX + 39 && p) this.drag = { kind: 'pilot', id: p.id, from: i, x0: mx, y0: my, moved: false };
        else this.sel = this.sel === i ? null : i;
      }
    });
    if (split) d.text(SX, TOP + 4 * SH - 1, 'Split drop: PAIR A (slots 1–2) and PAIR B (3–4) land on opposite sides of the enemy.', C.cyan, undefined, SW);
    // ---- Banks
    const used = (kind: 'mech' | 'pilot', id: string) => this.slots.findIndex((s) => s[kind] === id);
    ui.panel(MBX, TOP, MBW, BH, '\'MECHS');
    const mechs = c.mechs;
    const mcl = ui.list(MBX + 1, TOP + 1, MBW - 2, BH - 2, mechs, this.mechList, (m, _j, lx, ly, lw, hov) => {
      const ready = mechReady(c, m), at = used('mech', m.uid);
      const bg = hov ? '#16222c' : C.panel;
      d.fill(lx, ly, lw, 2, ' ', C.text, bg);
      d.text(lx + 1, ly, frameName(m), ready && at < 0 ? C.bright : C.faint, bg, lw - 8);
      d.text(lx + lw - 5, ly, at >= 0 ? `#${at + 1}` : `${frameTons(m)}t`, at >= 0 ? C.accent : C.dim, bg);
      d.text(lx + 1, ly + 1, !ready ? 'In the \'Mech bay (work order)' : weaponSummary(m), !ready ? C.warn : C.dim, bg, lw - 2);
      if (hov && pressed && ready && !this.drag) this.drag = { kind: 'mech', id: m.uid, from: at >= 0 ? at : null, x0: mx, y0: my, moved: false };
    }, 2);
    ui.panel(PBX, TOP, PBW, BH, 'MECHWARRIORS');
    const pilots = c.pilots.filter((p) => !p.dead);
    const pcl = ui.list(PBX + 1, TOP + 1, PBW - 2, BH - 2, pilots, this.pilotList, (p, _j, lx, ly, lw, hov) => {
      const ok = isAvailable(p), at = used('pilot', p.id);
      const bg = hov ? '#16222c' : C.panel;
      d.fill(lx, ly, lw, 2, ' ', C.text, bg);
      d.text(lx + 1, ly, p.sigil, ok && at < 0 ? p.color : C.faint, bg);
      d.text(lx + 3, ly, p.callsign, ok && at < 0 ? C.bright : C.faint, bg, 12);
      d.ctext(lx + 16, ly, skillLine(p), C.text, bg);
      if (at >= 0) d.text(lx + lw - 3, ly, `#${at + 1}`, C.accent, bg);
      d.ctext(lx + 1, ly + 1, !ok ? `{#e8a03a}Injured (${p.healDays} day${p.healDays === 1 ? '' : 's'}){/}` : `${healthPips(p)} ${roleOf(p) ? roleTag(p) : `{#6d7f8a}${p.name}{/}`}`, C.dim, bg, lw - 2);
      if (hov && pressed && ok && !this.drag) this.drag = { kind: 'pilot', id: p.id, from: at >= 0 ? at : null, x0: mx, y0: my, moved: false };
    }, 2);
    // ---- Drag and drop (a press and release without moving counts as a click)
    if (this.drag) {
      const g = this.drag;
      if (Math.abs(mx - g.x0) + Math.abs(my - g.y0) >= 2) g.moved = true;
      if (g.moved) {
        const label = g.kind === 'mech' ? frameName(c.mechs.find((x) => x.uid === g.id)!) : c.pilots.find((x) => x.id === g.id)!.callsign;
        d.text(Math.min(COLS - label.length - 3, mx + 1), my, ` ${label} `, C.bg, C.accent, 99, true);
        ui.cursor = 'pointer';
      }
      if (!inp.down) {
        if (g.moved) { const to = slotAt(mx, my); if (to !== null) this.place(g.kind, g.id, to, g.from); else if (overBank(mx, my)) this.place(g.kind, g.id, null, g.from); }
        else if (g.from === null) {
          // Click on a bank entry: fill the chosen slot, or the first slot missing one
          const to = this.sel ?? this.slots.findIndex((s) => !s[g.kind]);
          if (to >= 0) this.place(g.kind, g.id, to, null);
          if (this.sel !== null && this.slots[this.sel].mech && this.slots[this.sel].pilot) this.sel = null;
        } else this.sel = this.sel === g.from ? null : g.from;
        this.drag = null;
        inp.clicked = false;
      }
    }
    void mcl; void pcl;
    // ---- Intel strip
    const iy = TOP + BH + 1;
    const est = oppositionEstimate(rt);
    const odds = fightOdds(c, k, this.slots), [ot, oc] = oddsText(odds.ratio);
    d.ctext(MBX, iy, `{#6d7f8a}Enemy (intel){/} ~${est.units} units, ~${est.tons}t   {#6d7f8a}Your lance{/} ${tons}t {${oc}}${ot}{/}`, C.text, undefined, COLS - MBX - 1);
    d.ctext(MBX, iy + 1, `{#6d7f8a}Terms{/} {#f0c850}${cb(this.n.cash)}{/} · ${this.n.salvage} salvage (${this.n.priority} priority)`, C.text, undefined, COLS - MBX - 1);
    wrap(`${threatText(k.diff).replace(/\{[^}]*\}/g, '')}. ${MISSION_RISK[k.type] ?? ''}`, COLS - MBX - 1).slice(0, 3).forEach((l, j) => d.text(MBX, iy + 2 + j, l, C.dim));
    const ready = this.slots.filter((s) => s.mech && s.pilot);
    if (ui.button(2, ROWS - 3, 'Cancel contract', { key: 'Escape' })) app.pop();
    if (ui.button(30, ROWS - 3, 'Auto-fill best', { key: 'a', tip: 'Strongest ready \'Mechs, best available MechWarriors.' })) { this.slots = defaultSlots(c); this.sel = null; }
    if (ui.button(52, ROWS - 3, 'Previous lance', { key: 'p', tip: 'The lance you last deployed, slot for slot. Anyone not available leaves a gap.' })) this.previousLance();
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
    if (r.failed?.length) wrap(r.failed.join(' '), COLS - 32).slice(0, 2).forEach((l, i) => d.text(30, 2 + i, l, C.orange, undefined, COLS - 32));
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
