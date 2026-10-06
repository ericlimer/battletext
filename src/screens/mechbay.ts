import { portraitOf, portraitSize, drawPortrait, locTip } from './portrait';
// Mech Bay: roster, repair, storage, assembly from parts, sale.

import { UI } from '../engine/ui';
import { C, healthColor } from '../engine/color';
import { COLS } from '../engine/display';
import type { ArgoScreen } from './argo';
import { app } from './app';
import { company, saveGame } from '../game/save';
import { bays, mechBusy, queueRepair, assembleMech, assembleFee, partSellPrice, PARTS_NEEDED, workQueueDays, techHours, addLog } from '../game/company';
import { Frame, frameName, frameStats, repairEstimate, frameValue, isFrameDamaged, weaponSummary, frameSellPrice } from '../game/frame';
import { chassis, CLASS_NAMES } from '../data/mechs';
import { item, MECH_LOCS, LOC_NAMES, HARD_COLORS } from '../data/items';
import { cb, cbk } from '../engine/util';
import { drawDoll, statsSummary, simpleBar, hardpointStr } from './widgets';
import { MechLabScreen } from './mechlab';

type Row = { kind: 'hdr'; text: string } | { kind: 'mech'; m: Frame; stored: boolean } | { kind: 'part'; id: string; n: number };

export function drawMechBayTab(ui: UI, argo: ArgoScreen, x: number, y: number, w: number, h: number): void {
  const d = ui.d, c = company!;
  const st = (argo.st.bay ??= { sel: c.mechs[0]?.uid ?? '', list: { scroll: 0 }, confirmSell: false });
  const rows: Row[] = [{ kind: 'hdr', text: `ACTIVE BAYS ${c.mechs.length}/${bays(c)}` }];
  for (const m of c.mechs) rows.push({ kind: 'mech', m, stored: false });
  rows.push({ kind: 'hdr', text: `STORAGE ${c.storage.length}` });
  for (const m of c.storage) rows.push({ kind: 'mech', m, stored: true });
  const parts = Object.entries(c.parts).filter(([, n]) => n > 0);
  rows.push({ kind: 'hdr', text: `SALVAGED PARTS` });
  for (const [id, n] of parts) rows.push({ kind: 'part', id, n });
  ui.panel(x + 1, y, 50, h, '\'MECH BAY');
  const qRows = c.work.length ? Math.min(8, c.work.length) + 2 : 0;
  const cl = ui.list(x + 2, y + 1, 48, h - 2 - qRows, rows, st.list, (r, _i, lx, ly, lw, hov) => {
    if (r.kind === 'hdr') { d.text(lx + 1, ly, r.text, C.accent, undefined, lw, true); return; }
    if (r.kind === 'part') {
      const ch = chassis(r.id);
      const ready = r.n >= PARTS_NEEDED;
      const bg = hov ? '#16222c' : C.panel;
      d.fill(lx, ly, lw, 1, ' ', C.text, bg);
      d.text(lx + 1, ly, `⚙ ${ch.name} ${ch.id}`, ready ? C.cyan : C.text, bg);
      d.text(lx + 30, ly, `${r.n}/${PARTS_NEEDED}`, ready ? C.green : C.dim, bg);
      const fee = assembleFee(r.id);
      if (ready && ui.button(lx + 37, ly, 'Assemble', { style: 'plain', fg: c.funds >= fee ? C.green : C.faint, disabled: c.funds < fee, tip: [`Build a ${ch.name} from ${PARTS_NEEDED} parts for ${cb(fee)} in fittings. Some weapons will be missing.`, `Or sell the parts for ${cb(partSellPrice(r.id))} each in the Store.`] })) {
        const err = assembleMech(c, r.id); saveGame(c); argo.notify(err ?? `Assembling ${ch.name} (${cb(fee)})`, err ? C.red : C.green);
      }
      return;
    }
    const m = r.m;
    const sel = st.sel === m.uid;
    const bg = sel ? '#16242e' : hov ? '#121c24' : C.panel;
    d.fill(lx, ly, lw, 1, ' ', C.text, bg);
    if (sel) d.set(lx, ly, '▌', C.accent, bg);
    const ch = chassis(m.defId);
    d.text(lx + 2, ly, `${ch.name} ${ch.id}`.slice(0, 20), r.stored ? C.dim : C.bright, bg);
    d.text(lx + 22, ly, `${ch.tons}t`, C.faint, bg);
    const wo = mechBusy(c, m.uid);
    let status = 'Ready', col = C.green;
    if (r.stored) { status = 'Stored'; col = C.faint; }
    if (wo) { status = `${wo.kind === 'repair' ? 'Repair' : wo.kind === 'refit' ? 'Refit' : wo.kind === 'assemble' ? 'Build' : 'Ready'} ${workQueueDays(c, m.uid)}d`; col = C.warn; }
    else if (isFrameDamaged(m) && !r.stored) { status = 'Damaged'; col = C.orange; }
    const s = frameStats(m);
    if (!wo && !r.stored && !s.weapons.length) { status = 'Unarmed'; col = C.red; }
    d.text(lx + 27, ly, status, col, bg);
    const af = s.armorTotal / Math.max(1, s.armorMax), bw = lw - 39;
    for (let i = 0; i < bw; i++) d.set(lx + 38 + i, ly, '▄', (i + 0.5) / bw <= af ? healthColor(af) : '#1e262e', bg);
    if (hov) ui.setTip([`${ch.name} ${ch.id}`, `Armor ${s.armorTotal}/${s.armorMax} (${Math.round(af * 100)}%)`]);
  }, 1);
  if (cl >= 0) { const r = rows[cl]; if (r.kind === 'mech') { st.sel = r.m.uid; st.confirmSell = false; } }
  // Work queue: reorder or cancel (repairs refund the unspent share)
  if (c.work.length) {
    const qy = y + h - 2 - Math.min(8, c.work.length) - 1;
    d.hline(x + 2, qy, 48, C.border);
    d.text(x + 3, qy, ' WORK QUEUE ', C.accent, C.panel, 99, true);
    c.work.slice(0, 8).forEach((wo, i) => {
      const yy = qy + 1 + i;
      d.fill(x + 2, yy, 48, 1, ' ', C.text, C.panel);
      d.text(x + 3, yy, wo.desc.slice(0, 26), C.text);
      d.text(x + 30, yy, `${workQueueDays(c, wo.mechUid)}d`, C.dim);
      if (i > 0 && ui.button(x + 35, yy, '▲', { style: 'plain', w: 2, tip: 'Move up' })) { [c.work[i - 1], c.work[i]] = [c.work[i], c.work[i - 1]]; saveGame(c); }
      if (i < c.work.length - 1 && ui.button(x + 38, yy, '▼', { style: 'plain', w: 2, tip: 'Move down' })) { [c.work[i + 1], c.work[i]] = [c.work[i], c.work[i + 1]]; saveGame(c); }
      if (wo.kind === 'repair' && ui.button(x + 42, yy, 'cancel', { style: 'plain', fg: C.dim, tip: 'Cancel and refund the unspent part of the repair cost.' })) {
        const refund = Math.round((wo.cost ?? 0) * (wo.hours / Math.max(1, wo.total)));
        // Keep the work already done: armor is patched first, then internal structure
        const done = 1 - wo.hours / Math.max(1, wo.total);
        const mm = [...c.mechs, ...c.storage].find((q) => q.uid === wo.mechUid);
        if (mm) {
          const fa = Math.min(1, done * 2), fs = Math.max(0, done * 2 - 1);
          for (const k in mm.maxArmor) mm.armor[k] = Math.round((mm.armor[k] ?? 0) + (mm.maxArmor[k] - (mm.armor[k] ?? 0)) * fa);
          for (const k in mm.maxStruct) mm.struct[k] = Math.round(mm.struct[k] + (mm.maxStruct[k] - mm.struct[k]) * fs);
        }
        c.funds += refund; c.work.splice(i, 1); saveGame(c); argo.notify(`Repair stopped (${Math.round(done * 100)}% done), refunded ${cbk(refund)}`, C.cbill);
      }
    });
  }
  const all = [...c.mechs, ...c.storage];
  const m = all.find((q) => q.uid === st.sel) ?? all[0];
  if (!m) { d.text(x + 55, y + 3, 'No \'Mechs. Buy one in the Store, or assemble salvaged parts.', C.dim); return; }
  st.sel = m.uid;
  const stored = c.storage.includes(m);
  // Detail
  const dx = x + 52, dw = w - 53;
  const ch = chassis(m.defId);
  ui.panel(dx, y, dw, h, `${ch.name.toUpperCase()} ${ch.id}`);
  d.ctext(dx + 2, y + 1, `${CLASS_NAMES[ch.cls]} · ${ch.tons} tons · hardpoints ${hardpointStr(m)} · value {#f0c850}${cbk(frameValue(m))}{/} · resale {#f0c850}${cbk(frameSellPrice(m))}{/}${m.usedPrice ? ' {#6d7f8a}(bought used: resale capped below its price){/}' : ''}`, C.dim, undefined, dw - 4);
  d.text(dx + 2, y + 2, ch.desc, C.faint, undefined, dw - 4);
  drawDoll(ui, dx + 2, y + 4, m, {});
  // Stats bars
  const ss = statsSummary(m);
  ss.forEach((s, i) => {
    d.text(dx + 34, y + 4 + i * 2, s.label, C.dim);
    d.text(dx + 46, y + 4 + i * 2, s.val, C.bright);
    simpleBar(d, dx + 34, y + 5 + i * 2, 24, s.frac, '#4a8ee8');
    if (ui.hover(dx + 34, y + 4 + i * 2, 24, 2)) ui.setTip(s.tip);
  });
  // Loadout, or the 'Mech's portrait ([P] toggles; the choice sticks)
  let ly = y + 15;
  const art = portraitOf(m);
  const showArt = !!art && (st as any).portrait !== false;
  d.text(dx + 2, ly, showArt ? 'PORTRAIT' : 'LOADOUT', C.accent, undefined, 99, true);
  if (art && ui.button(dx + 13, ly, showArt ? 'Loadout' : 'Portrait', { key: 'p', style: 'plain', tip: 'Toggle between the hardpoint loadout and the \'Mech\'s portrait. Damaged parts are tinted.' })) (st as any).portrait = !showArt;
  ly++;
  const colW = Math.floor((dw - 4) / 4);
  if (showArt && art) {
    const [aw, ah] = portraitSize(art);
    const avail = y + h - 8 - (ly + 1); // stand on the line above the action bar
    let hov: string | null = null;
    drawPortrait(d, art, dx + Math.max(2, (dw - aw) >> 1), ly + 1 + Math.max(0, avail - ah), { frame: m, ui, onHover: (l) => { hov = l; } });
    if (hov) ui.setTip(locTip(m, hov));
  } else MECH_LOCS.forEach((l, i) => {
    const cx = dx + 2 + (i % 4) * colW, cy = ly + Math.floor(i / 4) * 9;
    const hp = ch.hardpoints[l] ?? [];
    d.ctext(cx, cy, `{#f2f6f8}${LOC_NAMES[l]}{/} ${hp.map((hh) => `{${HARD_COLORS[hh]}}${hh}{/}`).join('')}`, C.text, undefined, colW - 1);
    m.items.filter((it) => it.loc === l).slice(0, 7).forEach((it, k) => {
      const dd = item(it.id);
      d.text(cx + 1, cy + 1 + k, `${dd.name}`.slice(0, colW - 3), it.dead ? '#6a3030' : dd.kind === 'weapon' ? C.text : C.dim);
    });
  });
  // Actions
  const e = repairEstimate(m);
  let by = y + h - 7;
  d.hline(dx + 1, by - 1, dw - 2, C.border);
  if (e.armorPts || e.structPts || e.deadItems.length) {
    d.ctext(dx + 2, by, `Damage: {#f2f6f8}${e.armorPts}{/} armor, {#f2f6f8}${e.structPts}{/} structure, {#f2f6f8}${e.deadItems.length}{/} destroyed components. Repair {#f0c850}${cb(e.cost)}{/}, ~${Math.ceil(e.hours / techHours(c))} day${Math.ceil(e.hours / techHours(c)) === 1 ? '' : 's'}`, C.dim, undefined, dw - 4);
  }
  const wo = mechBusy(c, m.uid);
  if (!(e.armorPts || e.structPts || e.deadItems.length)) {
    if (wo && wo.kind === 'assemble') d.text(dx + 2, by, `UNDER CONSTRUCTION — ready in ~${workQueueDays(c, m.uid)} day${workQueueDays(c, m.uid) === 1 ? '' : 's'}.`, C.warn);
    else if (wo && wo.kind === 'ready') d.text(dx + 2, by, 'Being readied from storage.', C.warn);
    else d.text(dx + 2, by, 'Fully operational.', C.green);
  }
  by += 2;
  let bx = dx + 2;
  if (ui.button(bx, by, 'MECH LAB', { key: 'l', style: 'block', w: 14, center: true, disabled: !!wo && wo.kind !== 'repair' && wo.kind !== 'refit', tip: wo && wo.kind !== 'repair' && wo.kind !== 'refit' ? 'Busy with a work order.' : 'Customize weapons, armor and equipment.' })) app.push(new MechLabScreen(m, argo));
  bx += 16;
  if (ui.button(bx, by, `REPAIR ${cbk(e.cost)}`, { key: 'r', style: 'block', w: 18, center: true, disabled: !!wo || !isFrameDamaged(m) || c.funds < e.cost, tip: 'Queue a repair work order.' })) {
    const q = queueRepair(c, m); if (q) { saveGame(c); argo.notify(`Repair queued: ${cb(q.cost)}`, C.green); }
  }
  bx += 20;
  if (!stored) {
    if (ui.button(bx, by, 'TO STORAGE', { style: 'block', w: 14, center: true, disabled: !!wo, tip: 'Move to cold storage. Stored \'Mechs cost no maintenance but take a day to ready.' })) {
      c.mechs = c.mechs.filter((q) => q !== m); c.storage.push(m); c.lance = c.lance.map((u) => (u === m.uid ? null : u)); saveGame(c);
    }
  } else if (ui.button(bx, by, 'ACTIVATE', { style: 'block', w: 14, center: true, disabled: c.mechs.length >= bays(c), tip: c.mechs.length >= bays(c) ? 'No free \'Mech bays.' : 'Move to an active bay (24 tech-hours).' })) {
    c.storage = c.storage.filter((q) => q !== m); c.mechs.push(m);
    c.work.push({ id: 'w' + Math.random().toString(36).slice(2), mechUid: m.uid, kind: 'ready', hours: 24, total: 24, desc: `Ready ${frameName(m)}` });
    saveGame(c);
  }
  bx += 16;
  const price = frameSellPrice(m);
  if (!st.confirmSell) {
    if (ui.button(bx, by, `SELL ${cbk(price)}`, { style: 'block', w: 16, center: true, disabled: !!wo || !!c.travel, tip: wo ? 'Busy with a work order.' : c.travel ? 'Must be docked.' : 'Sell this \'Mech and everything installed in it.' })) st.confirmSell = true;
  } else if (ui.button(bx, by, 'CONFIRM SELL', { style: 'block', w: 16, center: true, fg: C.red })) {
    c.mechs = c.mechs.filter((q) => q !== m); c.storage = c.storage.filter((q) => q !== m);
    c.lance = c.lance.map((u) => (u === m.uid ? null : u));
    c.funds += price; addLog(c, `Sold ${frameName(m)} for ${cb(price)}.`, '#f0c850'); saveGame(c); st.confirmSell = false;
  }
  void COLS;
}
