// Salvage selection: priority picks, the employer's cut, then the remaining shares.
// State lives in company.pendingSalvage so an interrupted session can resume it.

import { Screen, app } from './app';
import { UI } from '../engine/ui';
import { C } from '../engine/color';
import { COLS, ROWS } from '../engine/display';
import type { ArgoScreen } from './argo';
import { company, saveGame } from '../game/save';
import { PARTS_NEEDED, partSellPrice, sellPrice } from '../game/company';
import { claimSalvage, employerCut, SalvageEntry } from '../game/aftermath';
import { chassis } from '../data/mechs';
import { cbk } from '../engine/util';
import { weaponTip } from './widgets';

export class SalvageScreen implements Screen {
  stage: 'priority' | 'rest' | 'done' = 'priority';
  picks: number[] = [];
  rest: number[] = [];
  cut: number[] = [];
  got: SalvageEntry[] = [];
  listState = { scroll: 0 };
  name: string;
  constructor(public argo: ArgoScreen) { this.name = company!.pendingSalvage?.name ?? ''; }

  render(ui: UI): void {
    const d = ui.d, c = company!;
    d.fill(0, 0, COLS, ROWS, ' ', C.text, C.bg);
    const ps = c.pendingSalvage;
    ui.header(0, 0, COLS, `SALVAGE · ${this.name.toUpperCase()}`, C.bg, C.accent);
    if (this.stage === 'done' || !ps) {
      d.text(3, 2, 'SALVAGE RECOVERED', C.accent, undefined, 99, true);
      this.got.forEach((g, i) => d.text(5, 4 + i, `${g.kind === 'part' ? '⚙' : '▪'} ${g.label}`, g.kind === 'part' ? C.cyan : C.text));
      const parts = new Set(this.got.filter((g) => g.kind === 'part').map((g) => g.id));
      let y = 6 + this.got.length;
      for (const p of parts) d.ctext(5, y++, `${chassis(p).name} ${p}: {#f2f6f8}${c.parts[p] ?? 0}/${PARTS_NEEDED}{/} parts${(c.parts[p] ?? 0) >= PARTS_NEEDED ? ' — {#6ad46a}ready to assemble in the Mech Bay!{/}' : ''}`, C.dim);
      if (ui.button(COLS - 22, ROWS - 3, 'RETURN TO ARGO', { key: 'Enter', style: 'block', w: 18, center: true })) { saveGame(c); app.pop(); }
      return;
    }
    const pool = ps.pool;
    const need = this.stage === 'priority'
      ? Math.min(ps.priority, pool.length)
      : Math.max(0, Math.min(ps.shares - this.picks.length, pool.length - this.picks.length - this.cut.length));
    const mine = this.stage === 'priority' ? this.picks : this.rest;
    if (this.stage === 'priority') d.ctext(3, 2, `PRIORITY SALVAGE: choose {#f0a830}${need}{/} item${need === 1 ? '' : 's'} before the employer takes its cut. You have ${ps.shares} share${ps.shares === 1 ? '' : 's'} in total.`, C.text);
    else d.ctext(3, 2, `The employer claimed {#e8503a}${this.cut.length}{/} items. Choose your remaining {#f0a830}${need}{/} share${need === 1 ? '' : 's'}.`, C.text);
    ui.panel(2, 4, 90, ROWS - 8, `SALVAGE POOL (${pool.length})`);
    const cl = ui.list(3, 5, 88, ROWS - 10, pool, this.listState, (e, i, lx, ly, lw, hov) => {
      const pri = this.picks.includes(i), cut = this.cut.includes(i), sel = mine.includes(i);
      const locked = cut || (this.stage === 'rest' && pri);
      const bg = sel ? '#2a2210' : hov && !locked ? '#16222c' : C.panel;
      d.fill(lx, ly, lw, 1, ' ', C.text, bg);
      d.text(lx + 1, ly, pri ? '★' : cut ? '✕' : sel ? '■' : '□', pri ? C.accent : cut ? '#8a3030' : sel ? C.accent : C.faint, bg);
      d.text(lx + 3, ly, e.kind === 'part' ? '⚙' : '▪', e.kind === 'part' ? C.cyan : C.dim, bg);
      d.text(lx + 5, ly, e.label + (cut ? '  (employer)' : ''), cut ? '#5a4a4a' : sel || pri ? C.bright : C.text, bg, 50);
      if (e.kind === 'part') d.text(lx + 58, ly, `have ${c.parts[e.id] ?? 0}/${PARTS_NEEDED}`, C.dim, bg);
      const sell = e.kind === 'part' ? partSellPrice(e.id) : sellPrice(c, e.id);
      d.text(lx + lw - 10, ly, cbk(sell).padStart(9), cut ? '#5a4a30' : C.cbill, bg);
      if (hov && e.kind === 'item') ui.setTip([...weaponTip(e.id), `Sells for ${cbk(sell)} · market price ${cbk(e.value)}`]);
      else if (hov) ui.setTip([e.label, `Sells for ${cbk(sell)}. ${PARTS_NEEDED} parts assemble a 'Mech worth ${cbk(chassis(e.id).cost)}.`]);
    });
    if (cl >= 0 && !this.cut.includes(cl) && !(this.stage === 'rest' && this.picks.includes(cl))) {
      const k = mine.indexOf(cl);
      if (k >= 0) mine.splice(k, 1); else if (mine.length < need) mine.push(cl);
    }
    d.text(95, 6, `Picks ${mine.length}/${need}`, C.accent, undefined, 99, true);
    mine.forEach((p, i) => d.text(95, 8 + i, `▪ ${pool[p].label}`, C.text, undefined, 50));
    if (ui.button(COLS - 22, ROWS - 3, 'CONFIRM', { key: 'Enter', style: 'block', w: 18, center: true, disabled: mine.length < need })) {
      if (this.stage === 'priority') {
        this.cut = employerCut({ pool, salvageShares: ps.shares }, this.picks, ps.seed);
        this.stage = 'rest';
        if (ps.shares - this.picks.length <= 0 || pool.length - this.picks.length - this.cut.length <= 0) this.finishPicks();
      } else this.finishPicks();
    }
  }

  finishPicks(): void {
    const c = company!;
    this.got = claimSalvage(c, c.pendingSalvage!.pool, [...this.picks, ...this.rest]);
    saveGame(c);
    this.stage = 'done';
  }
}
