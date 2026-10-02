// Mech Lab: hardpoint-constrained loadout editor with tonnage, slots and armor allocation.

import { Screen, app } from './app';
import { UI } from '../engine/ui';
import { C, lerp } from '../engine/color';
import { COLS, ROWS } from '../engine/display';
import type { ArgoScreen } from './argo';
import { company, saveGame } from '../game/save';
import { Frame, cloneFrame, canMount, validate, frameStats, maxArmorPer, slotsUsedIn, frameName } from '../game/frame';
import { item, Loc, MECH_LOCS, SLOTS, HARD_COLORS, HardType, LOC_NAMES, ARMOR_PER_TON, ARMOR_COST_PER_PT, jumpJetFor } from '../data/items';
import { chassis, CLASS_NAMES } from '../data/mechs';
import { cb, pad } from '../engine/util';
import { weaponTip, statsSummary, simpleBar, hardpointStr } from './widgets';
import { addLog, techHours, has } from '../game/company';

type Filter = 'all' | HardType | 'equip' | 'ammo';
const FILTERS: [Filter, string][] = [['all', 'All'], ['B', 'Bal'], ['E', 'Ene'], ['M', 'Mis'], ['S', 'Sup'], ['equip', 'Eqp'], ['ammo', 'Ammo']];

const BOX_W = 16;
const LAYOUT: Record<Loc, [number, number]> = { HD: [68, 2], LA: [36, 8], LT: [52, 8], CT: [68, 8], RT: [84, 8], RA: [100, 8], LL: [52, 24], RL: [84, 24] };

export class MechLabScreen implements Screen {
  work: Frame;
  inv: Record<string, number>;
  held: string | null = null;
  filter: Filter = 'all';
  listState = { scroll: 0 };
  msg = '';
  constructor(public orig: Frame, public argo: ArgoScreen) {
    this.work = cloneFrame(orig);
    this.inv = { ...company!.inventory };
  }

  boxH(l: Loc): number {
    const rear = l === 'CT' || l === 'LT' || l === 'RT';
    return 2 + 1 + (rear ? 1 : 0) + 1 + SLOTS[l];
  }

  render(ui: UI): void {
    const d = ui.d, c = company!;
    const f = this.work;
    const ch = chassis(f.defId);
    d.fill(0, 0, COLS, ROWS, ' ', C.text, C.bg);
    ui.header(0, 0, COLS, `MECH LAB · ${ch.name.toUpperCase()} ${ch.id} · ${CLASS_NAMES[ch.cls].toUpperCase()} ${ch.tons}t`, C.bg, C.accent);
    d.fill(COLS - 30, 0, 30, 1, ' ', C.text, '#1a1206');
    d.ctext(COLS - 28, 0, `hardpoints ${hardpointStr(f)}`, C.dim, '#1a1206');
    if (ui.inp.rclicked || ui.key('Escape')) {
      ui.inp.rclicked = false;
      if (this.held) this.held = null; else { app.pop(); return; }
    }
    this.drawInventory(ui);
    for (const l of MECH_LOCS) this.drawLoc(ui, l);
    this.drawStats(ui);
    this.drawSummary(ui);
    // Held item follows the cursor
    if (this.held) {
      const dd = item(this.held);
      const t = ` ${dd.name} `;
      d.text(Math.min(COLS - t.length, ui.inp.cx + 2), Math.min(ROWS - 1, ui.inp.cy + 1), t, C.bg, C.accent);
    }
    if (this.msg) d.text(37, 33, this.msg, C.warn, undefined, 78);
  }

  /** Weapon table, alpha strike, ammo endurance and a damage-by-range profile. */
  drawSummary(ui: UI): void {
    const d = ui.d, f = this.work;
    const x = 36, y = 35, w = 80;
    d.hline(x, y - 1, w, C.border);
    d.text(x + 1, y - 1, ' WEAPONS ', C.accent, C.bg, 99, true);
    const groups = new Map<string, number>();
    for (const it of f.items) if (!it.dead && item(it.id).kind === 'weapon') groups.set(it.id, (groups.get(it.id) ?? 0) + 1);
    d.text(x + 1, y, 'WEAPON            DMG  HEAT STAB  RANGE      AMMO', C.faint);
    let yy = y + 1;
    const ammoShots: Record<string, number> = {};
    for (const it of f.items) { const a = item(it.id); if (a.kind === 'ammo' && !it.dead) ammoShots[a.id] = (ammoShots[a.id] ?? 0) + (a.ammoShots ?? 0); }
    const users: Record<string, number> = {};
    for (const [id, n] of groups) { const a = item(id).ammo; if (a) users[a] = (users[a] ?? 0) + n; }
    let alpha = 0, heat = 0, stab = 0;
    for (const [id, n] of [...groups].slice(0, 7)) {
      const w2 = item(id);
      const dmg = (w2.dmg ?? 0) * (w2.shots ?? 1);
      alpha += dmg * n; heat += (w2.heat ?? 0) * n; stab += (w2.stab ?? 0) * (w2.shots ?? 1) * n;
      d.text(x + 1, yy, `${n > 1 ? n + '× ' : ''}${w2.name}`, HARD_COLORS[w2.hard!], undefined, 17);
      d.text(x + 19, yy, String(dmg * n).padStart(4), C.bright);
      d.text(x + 24, yy, String((w2.heat ?? 0) * n).padStart(4), C.orange);
      d.text(x + 29, yy, String((w2.stab ?? 0) * (w2.shots ?? 1) * n).padStart(4), C.dim);
      d.text(x + 35, yy, `${w2.min ? w2.min + '/' : ''}${w2.sr}/${w2.mr}/${w2.lr}`, C.dim);
      if (w2.ammo) {
        const turns = Math.floor((ammoShots[w2.ammo] ?? 0) / Math.max(1, users[w2.ammo] ?? 1));
        d.text(x + 46, yy, turns ? `${turns} turns` : 'NO AMMO', turns ? (turns < 4 ? C.warn : C.dim) : C.red);
      } else d.text(x + 46, yy, '∞', C.faint);
      yy++;
    }
    if (!groups.size) d.text(x + 1, yy++, 'No weapons mounted.', C.faint);
    // Alpha strike vs heat
    const s = frameStats(f);
    const net = heat - s.dissip;
    d.ctext(x + 1, y + 9, `Alpha {#f2f6f8}${alpha}{/} dmg · {#f0a030}${heat}{/} heat · {#9ab}${stab}{/} stab`, C.dim);
    d.ctext(x + 1, y + 10, net <= 0 ? `{#6ad46a}Heat neutral{/}: can alpha every turn (+${s.dissip} sink)` : net * 10 < s.heatCap * 0.75 ? `{#b8d86a}Nearly heat neutral{/}: alpha nets +${net}/turn` : `Alpha nets {#f0a030}+${net}{/}/turn: ~{#f2f6f8}${Math.max(1, Math.floor((s.heatCap * 0.75) / net) + 1)}{/} alphas before overheating`, C.dim, undefined, 56);
    // Range profile: raw damage in range at each distance
    const px = x + 58, ph = 7, maxR = 22;
    d.text(px, y, 'DAMAGE BY RANGE', C.faint);
    const prof: number[] = [];
    for (let r = 1; r <= maxR; r++) {
      let v = 0;
      for (const [id, n] of groups) { const w2 = item(id); if (r <= (w2.lr ?? 0) && r >= (w2.min ?? 0)) v += (w2.dmg ?? 0) * (w2.shots ?? 1) * n; }
      prof.push(v);
    }
    const top = Math.max(1, ...prof);
    prof.forEach((v, i) => {
      const h8 = Math.round((v / top) * ph * 8);
      for (let row = 0; row < ph; row++) {
        const fill = Math.max(0, Math.min(8, h8 - (ph - 1 - row) * 8));
        d.set(px + i, y + 1 + row, fill ? ' ▁▂▃▄▅▆▇█'[fill] : row === ph - 1 ? '·' : ' ', i < 6 ? '#e8a03a' : i < 12 ? '#c8b050' : '#7a8a6a');
      }
    });
    d.text(px, y + 1 + ph, '1    6     12     22', C.faint);
    if (ui.hover(px, y + 1, maxR, ph)) { const r = ui.inp.cx - px + 1; if (r >= 1 && r <= maxR) ui.setTip([`Range ${r}: ${prof[r - 1]} damage in range`]); }
  }

  drawInventory(ui: UI): void {
    const d = ui.d;
    ui.panel(0, 1, 35, ROWS - 1, 'INVENTORY');
    FILTERS.forEach(([k, n], i) => { if (ui.button(1 + i * 5, 2, n, { style: 'plain', active: this.filter === k, w: 5 })) { this.filter = k; this.listState.scroll = 0; } });
    const ids = Object.keys(this.inv).filter((id) => this.inv[id] > 0).filter((id) => {
      const dd = item(id);
      if (this.filter === 'all') return true;
      if (this.filter === 'ammo') return dd.kind === 'ammo';
      if (this.filter === 'equip') return dd.kind !== 'weapon' && dd.kind !== 'ammo';
      return dd.kind === 'weapon' && dd.hard === this.filter;
    }).sort((a, b) => {
      const A = item(a), B = item(b);
      const ka = A.kind === 'weapon' ? 0 : A.kind === 'ammo' ? 2 : 1, kb = B.kind === 'weapon' ? 0 : B.kind === 'ammo' ? 2 : 1;
      return ka - kb || (A.hard ?? '').localeCompare(B.hard ?? '') || A.name.localeCompare(B.name);
    });
    // Armor as a pseudo-item hint
    d.text(1, 4, 'ITEM', C.faint); d.text(21, 4, 'TON SL  #', C.faint);
    const cl = ui.list(1, 5, 33, ROWS - 7, ids, this.listState, (id, _i, lx, ly, lw, hov) => {
      const dd = item(id);
      const held = this.held === id;
      const bg = held ? '#3a2a10' : hov ? '#16222c' : C.panel;
      d.fill(lx, ly, lw, 1, ' ', C.text, bg);
      const col = dd.kind === 'weapon' ? HARD_COLORS[dd.hard!] : dd.kind === 'ammo' ? '#c8b070' : '#a8b8c0';
      d.set(lx, ly, dd.kind === 'weapon' ? dd.hard! : dd.kind === 'ammo' ? '•' : '◦', col, bg);
      d.text(lx + 2, ly, dd.name.slice(0, 18), dd.tier ? C.accent : C.text, bg);
      d.text(lx + 20, ly, String(dd.tons).padStart(3), C.dim, bg);
      d.text(lx + 24, ly, String(dd.slots).padStart(2), C.dim, bg);
      d.text(lx + 27, ly, `x${this.inv[id]}`.padStart(4), C.bright, bg);
      if (hov) ui.setTip(weaponTip(id));
    });
    if (cl >= 0) this.held = this.held === ids[cl] ? null : ids[cl];
    if (!ids.length) d.text(2, 7, 'Nothing in storage.', C.faint);
    d.text(1, ROWS - 2, 'Click item, then a location.', C.faint);
  }

  drawLoc(ui: UI, l: Loc): void {
    const d = ui.d, f = this.work;
    const [x, y] = LAYOUT[l];
    const h = this.boxH(l);
    const ch = chassis(f.defId);
    let border = C.border;
    let reason: string | null = null;
    if (this.held) {
      reason = canMount(f, this.held, l);
      border = reason ? '#4a2020' : '#3aa060';
    }
    const hovBox = ui.hover(x, y, BOX_W, h);
    if (hovBox && this.held) { ui.setTip(reason ? [`{#e8503a}${reason}{/}`] : [`Install ${item(this.held).name} in the ${LOC_NAMES[l]}`]); ui.cursor = reason ? 'default' : 'pointer'; }
    d.box(x, y, BOX_W, h, hovBox && this.held && !reason ? '#6ae090' : border, C.panel);
    d.text(x + 1, y, ` ${l} `, C.accent, C.panel, 99, true);
    const used = slotsUsedIn(f, l);
    d.text(x + BOX_W - 6, y, `${used}/${SLOTS[l]}`, used > SLOTS[l] ? C.red : C.dim, C.panel);
    // Armor rows
    const mx = maxArmorPer(f)[l];
    const armorRow = (key: string, yy: number, label: string) => {
      const v = f.maxArmor[key] ?? 0;
      d.text(x + 1, yy, label, C.dim);
      d.text(x + 3, yy, String(v).padStart(3), C.bright);
      if (key === l) d.text(x + 6, yy, `/${mx}`, C.faint);
      const tot = (f.maxArmor[l] ?? 0) + (f.maxArmor[l + 'R'] ?? 0);
      const step = ui.inp.held.has('Shift') ? 25 : 5;
      if (ui.button(x + BOX_W - 5, yy, '−', { style: 'plain', fg: C.text, w: 2, tip: 'Remove armor (Shift: 25)' })) f.maxArmor[key] = Math.max(0, v - step);
      if (ui.button(x + BOX_W - 3, yy, '+', { style: 'plain', fg: C.text, w: 2, tip: 'Add armor (Shift: 25)' })) f.maxArmor[key] = v + Math.max(0, Math.min(step, mx - tot));
    };
    armorRow(l, y + 1, 'A');
    let yy = y + 2;
    if (l === 'CT' || l === 'LT' || l === 'RT') { armorRow(l + 'R', yy, 'R'); yy++; }
    // Hardpoints
    const hp = ch.hardpoints[l] ?? [];
    const usedHp: Record<string, number> = {};
    for (const it of f.items) if (it.loc === l && item(it.id).kind === 'weapon') { const hh = item(it.id).hard!; usedHp[hh] = (usedHp[hh] ?? 0) + 1; }
    const cnt: Record<string, number> = {};
    let hx = x + 1;
    for (const hh of hp) {
      cnt[hh] = (cnt[hh] ?? 0) + 1;
      const filled = cnt[hh] <= (usedHp[hh] ?? 0);
      d.text(hx, yy, filled ? hh : hh.toLowerCase(), filled ? HARD_COLORS[hh] : lerp(HARD_COLORS[hh], C.panel, 0.55), C.panel, 99, filled);
      hx++;
    }
    if (!hp.length) d.text(x + 1, yy, 'none', C.faint);
    if (l === 'LL' || l === 'RL' || l === 'LT' || l === 'RT' || l === 'CT') { if (ch.jump) d.text(x + BOX_W - 4, yy, `J${ch.jump}`, C.faint); }
    yy++;
    // Slots
    let row = 0;
    const items = f.items.map((it, i) => ({ it, i })).filter((o) => o.it.loc === l);
    for (const { it, i } of items) {
      const dd = item(it.id);
      const col = it.dead ? '#8a3a3a' : dd.kind === 'weapon' ? HARD_COLORS[dd.hard!] : dd.kind === 'ammo' ? '#c8b070' : '#a8b8c0';
      for (let s = 0; s < dd.slots; s++) {
        if (row >= SLOTS[l]) break;
        const ry = yy + row;
        const hov = ui.hover(x + 1, ry, BOX_W - 2, 1) && !this.held;
        const bg = hov ? '#2a1a1a' : '#121820';
        d.fill(x + 1, ry, BOX_W - 2, 1, ' ', C.text, bg);
        if (s === 0) d.text(x + 1, ry, (it.dead ? '✕' : '') + dd.name, col, bg, BOX_W - 2);
        else d.text(x + 1, ry, '  ┊', lerp(col, bg, 0.5), bg);
        if (hov) { ui.setTip([...weaponTip(it.id), it.dead ? '{#e8503a}Destroyed — removing discards it.{/}' : '{#6d7f8a}Click to remove.{/}']); ui.cursor = 'pointer'; }
        if (hov && ui.click(x + 1, ry, BOX_W - 2, 1)) {
          f.items.splice(i, 1);
          if (!it.dead) this.inv[it.id] = (this.inv[it.id] ?? 0) + 1;
          this.msg = '';
          return;
        }
        row++;
      }
    }
    for (; row < SLOTS[l]; row++) d.text(x + 1, yy + row, '·'.padEnd(BOX_W - 2), C.faint, C.panel);
    // Install
    if (this.held && hovBox && ui.click(x, y, BOX_W, h)) {
      if (reason) { this.msg = reason; return; }
      f.items.push({ id: this.held, loc: l });
      this.inv[this.held]--;
      if (item(this.held).kind === 'ammo') f.items[f.items.length - 1].ammo = item(this.held).ammoShots;
      if (this.inv[this.held] <= 0) this.held = null;
      this.msg = '';
    }
  }

  changes(): { added: string[]; removed: string[]; armorDelta: number; hours: number; cost: number } {
    const o = this.orig, f = this.work;
    const count = (fr: Frame) => { const m = new Map<string, number>(); for (const it of fr.items) { const k = `${it.id}@${it.loc}`; m.set(k, (m.get(k) ?? 0) + 1); } return m; };
    const a = count(o), b = count(f);
    const added: string[] = [], removed: string[] = [];
    for (const [k, n] of b) for (let i = 0; i < n - (a.get(k) ?? 0); i++) added.push(k.split('@')[0]);
    for (const [k, n] of a) for (let i = 0; i < n - (b.get(k) ?? 0); i++) removed.push(k.split('@')[0]);
    let armorDelta = 0, armorAdd = 0;
    for (const k in f.maxArmor) { const dlt = f.maxArmor[k] - (o.maxArmor[k] ?? 0); armorDelta += Math.abs(dlt); if (dlt > 0) armorAdd += dlt; }
    let hours = armorDelta / 20;
    for (const id of [...added, ...removed]) hours += 2 + item(id).tons * 0.6;
    const cost = (added.length + removed.length) * 1500 + armorAdd * ARMOR_COST_PER_PT;
    if (has(company!, 'armory')) hours *= 0.6;
    return { added, removed, armorDelta, hours: Math.ceil(hours), cost };
  }

  drawStats(ui: UI): void {
    const d = ui.d, c = company!, f = this.work;
    const x = 117, w = COLS - x;
    ui.panel(x, 1, w, ROWS - 1, 'SPECIFICATIONS');
    const s = frameStats(f, false);
    const over = s.tonsUsed > s.tonsMax + 1e-6;
    d.text(x + 2, 3, 'TONNAGE', C.dim);
    d.text(x + 12, 3, `${s.tonsUsed.toFixed(1)} / ${s.tonsMax}`, over ? C.red : C.bright, undefined, 99, true);
    simpleBar(d, x + 2, 4, w - 4, s.tonsUsed / s.tonsMax, over ? C.red : '#4a8ee8');
    d.text(x + 2, 5, `Free ${(s.tonsMax - s.tonsUsed).toFixed(1)}t · armor ${(s.armorMax / ARMOR_PER_TON).toFixed(1)}t`, C.faint, undefined, w - 3);
    statsSummary(f).forEach((ss, i) => {
      const yy = 7 + i * 2;
      d.text(x + 2, yy, ss.label, C.dim);
      d.text(x + 14, yy, ss.val, C.bright);
      simpleBar(d, x + 2, yy + 1, w - 4, ss.frac, '#4a8ee8');
      if (ui.hover(x + 2, yy, w - 4, 2)) ui.setTip(ss.tip);
    });
    let yy = 18;
    d.ctext(x + 2, yy++, `Dissipation {#f2f6f8}${s.dissip}{/}/turn  Cap {#f2f6f8}${s.heatCap}{/}`, C.dim);
    d.ctext(x + 2, yy++, `Jump jets {#f2f6f8}${f.items.filter((i) => item(i.id).kind === 'jumpjet').length}{/}/${chassis(f.defId).jump} (${jumpJetFor(s.tonsMax)})`, C.dim);
    if (ui.button(x + 2, yy + 1, 'Max armor', { style: 'plain', tip: 'Set every location to maximum armor.' })) {
      const mx = maxArmorPer(f);
      for (const l of MECH_LOCS) {
        if (l === 'CT' || l === 'LT' || l === 'RT') { const rear = Math.round((mx[l] * 0.26) / 5) * 5; f.maxArmor[l] = mx[l] - rear; f.maxArmor[l + 'R'] = rear; }
        else f.maxArmor[l] = mx[l];
      }
    }
    if (ui.button(x + 14, yy + 1, 'Strip armor', { style: 'plain' })) for (const k in f.maxArmor) f.maxArmor[k] = 0;
    yy += 3;
    const probs = validate(f);
    for (const p of probs.slice(0, 6)) { d.text(x + 2, yy, (p.severity === 'error' ? '✕ ' : '! ') + p.text, p.severity === 'error' ? C.red : C.warn, undefined, w - 3); yy++; }
    if (!probs.length) d.text(x + 2, yy++, '✓ Configuration valid', C.green);
    // Changes
    const ch = this.changes();
    yy = ROWS - 12;
    d.hline(x + 1, yy - 1, w - 2, C.border);
    d.text(x + 2, yy, 'REFIT ORDER', C.accent, undefined, 99, true);
    d.ctext(x + 2, yy + 1, `+${ch.added.length} / -${ch.removed.length} components`, C.dim);
    d.ctext(x + 2, yy + 2, `Cost {#f0c850}${cb(ch.cost)}{/}`, C.dim);
    d.ctext(x + 2, yy + 3, `Time {#f2f6f8}${ch.hours}{/} tech-hrs (~${Math.ceil(ch.hours / techHours(c))}d)`, C.dim);
    const errors = probs.some((p) => p.severity === 'error');
    const nothing = ch.added.length + ch.removed.length === 0 && ch.armorDelta === 0;
    if (ui.button(x + 2, ROWS - 6, 'CONFIRM REFIT', { key: 'Enter', style: 'block', w: w - 4, center: true, disabled: errors || nothing || c.funds < ch.cost, tip: errors ? 'Fix the errors first.' : nothing ? 'No changes.' : c.funds < ch.cost ? 'Not enough funds.' : 'Apply changes as a work order.' })) this.confirm();
    if (ui.button(x + 2, ROWS - 4, 'Revert', { w: 12, center: true })) { this.work = cloneFrame(this.orig); this.inv = { ...c.inventory }; this.held = null; }
    if (ui.button(x + 16, ROWS - 4, 'Cancel', { w: 12, center: true })) app.pop();
    void pad; void frameName;
  }

  confirm(): void {
    const c = company!, o = this.orig, f = this.work;
    const ch = this.changes();
    o.items = f.items.map((it) => ({ ...it }));
    for (const k of Object.keys(f.maxArmor)) {
      const prev = o.maxArmor[k] ?? 0;
      const inc = f.maxArmor[k] > prev;
      o.maxArmor[k] = f.maxArmor[k];
      // New plating is added on top of current armor; it does not repair damage
      o.armor[k] = inc ? Math.min(f.maxArmor[k], (o.armor[k] ?? 0) + (f.maxArmor[k] - prev)) : Math.min(o.armor[k] ?? 0, f.maxArmor[k]);
    }
    c.inventory = { ...this.inv };
    c.funds -= ch.cost;
    c.stats.spent += ch.cost;
    if (ch.hours > 0) c.work.push({ id: 'w' + Math.random().toString(36).slice(2), mechUid: o.uid, kind: 'refit', hours: ch.hours, total: ch.hours, desc: `Refit ${chassis(o.defId).name} ${o.defId}` });
    addLog(c, `Refit ordered for ${chassis(o.defId).name} ${o.defId}: ${ch.hours} tech-hours, ${cb(ch.cost)}.`, '#6ad46a');
    saveGame(c);
    this.argo.notify('Refit queued', C.green);
    app.pop();
  }
}
