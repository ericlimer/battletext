// The Argo: career hub with tabs, time control and company overview.

import { Screen, app } from './app';
import { UI } from '../engine/ui';
import { C, lerp, scale, healthColor } from '../engine/color';
import { COLS, ROWS } from '../engine/display';
import { company, saveGame, exportSave } from '../game/save';
import {
  Company, addLog, dateStr, monthlyExpenses, morale, moraleName, moraleBreakdown, maxContractDiff, mrbLevel, MRB_LEVELS, EXPENSE_LEVELS, UPGRADES, sys, advanceDay,
  bays, pilotCap, techHours, CAREER_DAYS, careerScore, companyValue, travelDaysLeft, rngOf, saveRng, mechReady, has,
} from '../game/company';
import { FACTIONS, repLevel, faction } from '../data/factions';
import { cb, cbk, wrap } from '../engine/util';
import { drawContractsTab } from './contracts';
import { drawStarmapTab } from './starmap';
import { drawMechBayTab } from './mechbay';
import { drawBarracksTab } from './barracks';
import { drawStoreTab } from './store';
import { EventScreen } from './eventscreen';
import { MonthReportScreen } from './monthreport';
import { GameOverScreen } from './gameover';
import { pickEvent } from '../game/events';
import { TitleScreen } from './title';
import { simpleBar } from './widgets';
import { SalvageScreen } from './salvage';
import { isMuted, setMuted } from '../engine/sound';
import { tagDesc } from '../game/world';

export const TABS = ['COMMAND', 'CONTRACTS', 'STAR MAP', 'MECH BAY', 'BARRACKS', 'STORE', 'FINANCE', 'ARGO'] as const;
export type Tab = typeof TABS[number];

export class ArgoScreen implements Screen {
  tab: Tab = 'COMMAND';
  advancing = false;
  advT = 0;
  toast: { text: string; t: number; color: string } | null = null;
  menuOpen = false;
  // per-tab state
  st: Record<string, any> = {};
  logState = { scroll: 1e9 };
  logLen = -1;
  confirmBuy = '';

  get c(): Company { return company!; }

  onEnter(): void {
    const c = this.c;
    if (!c) return;
    if (c.gameOver) { app.push(new GameOverScreen()); return; }
    if (c.pendingSalvage && app.top() === this) app.push(new SalvageScreen(this));
  }

  notify(text: string, color: string = C.accent): void { this.toast = { text, t: 3, color }; }

  passDay(): boolean {
    const c = this.c;
    const rep = advanceDay(c);
    saveGame(c);
    if (rep.gameOver) { this.advancing = false; app.push(new GameOverScreen()); return false; }
    if (rep.event) {
      const r = rngOf(c);
      const e = pickEvent(c, r, rep.event === 'travel' ? 'travel' : 'docked');
      saveRng(c, r);
      if (e) { this.advancing = false; app.push(new EventScreen(e.ev, e.ctx)); return false; }
    }
    if (rep.arrived) { this.advancing = false; this.notify(`Arrived at ${sys(c).name}`, C.cyan); this.tab = 'CONTRACTS'; return false; }
    if (rep.monthEnd) { this.advancing = false; this.notify(`Month end: paid ${cb(c.lastExpenses)}`, C.cbill); if (c.ledger?.length) app.push(new MonthReportScreen()); return false; }
    return true;
  }

  /** Stop condition for continuous time: something the player cares about finished. */
  stopWatch(): string {
    const c = this.c;
    // While travelling only arrival stops the clock
    if (c.travel) return `T${c.travel.dest}`;
    return `${c.work.length}|${c.pilots.filter((p) => p.injuries > 0).length}|${c.location}`;
  }
  watchKey = '';

  render(ui: UI, dt: number): void {
    const c = this.c;
    if (!c) { app.reset(new TitleScreen()); return; }
    const d = ui.d;
    d.fill(0, 0, COLS, ROWS, ' ', C.text, C.bg);
    // Days spent on deployment pass once we're back aboard
    if ((c.deployDays ?? 0) > 0 && app.top() === this && !this.menuOpen) {
      this.advT += dt;
      // Deployment days are owed by the company: interruptions (events, month end) only pause them
      if (this.advT > 0.08) { this.advT = 0; c.deployDays = (c.deployDays ?? 1) - 1; this.passDay(); }
      d.text(1, ROWS - 1, ` Returning from deployment… ${c.deployDays} day${c.deployDays === 1 ? '' : 's'} `, C.bg, C.cyan);
    }
    // Continuous time advance
    if (this.advancing && !this.menuOpen) {
      this.advT += dt;
      if (this.advT > 0.14) {
        this.advT = 0;
        const cont = this.passDay();
        if (cont && this.stopWatch() !== this.watchKey) { this.advancing = false; this.notify('Time paused: task complete', C.green); }
      }
    }
    if (this.menuOpen) ui.enabled = false;
    this.drawHeader(ui);
    this.drawTabs(ui);
    const x = 0, y = 3, w = COLS, h = ROWS - 3;
    switch (this.tab) {
      case 'COMMAND': this.drawCommand(ui, x, y, w, h); break;
      case 'CONTRACTS': drawContractsTab(ui, this, x, y, w, h); break;
      case 'STAR MAP': drawStarmapTab(ui, this, x, y, w, h); break;
      case 'MECH BAY': drawMechBayTab(ui, this, x, y, w, h); break;
      case 'BARRACKS': drawBarracksTab(ui, this, x, y, w, h); break;
      case 'STORE': drawStoreTab(ui, this, x, y, w, h); break;
      case 'FINANCE': this.drawFinance(ui, x, y, w, h); break;
      case 'ARGO': this.drawUpgrades(ui, x, y, w, h); break;
    }
    if (this.toast) {
      this.toast.t -= dt;
      const t = this.toast;
      const len = t.text.length + 4;
      const a = Math.min(1, t.t * 2);
      d.fill(COLS - len - 2, ROWS - 1, len + 2, 1, ' ', C.text, lerp(C.bg, '#14202a', a));
      d.text(COLS - len - 1, ROWS - 1, t.text, lerp(C.bg, t.color, a));
      if (t.t <= 0) this.toast = null;
    }
    if (this.menuOpen) { ui.enabled = true; this.drawMenu(ui); }
  }

  drawHeader(ui: UI): void {
    const d = ui.d, c = this.c;
    d.fill(0, 0, COLS, 1, ' ', C.text, '#0e151c');
    let x = 1;
    x += d.text(x, 0, `◆ ${c.name.toUpperCase()}`, C.accent, undefined, 30, true) + 3;
    x += d.text(x, 0, dateStr(c.day), C.bright) + 1;
    x += d.text(x, 0, `(day ${c.day}/${CAREER_DAYS})`, C.faint) + 3;
    d.text(x, 0, cb(c.funds), c.funds < 0 ? C.red : C.cbill, undefined, 99, true);
    const ex = monthlyExpenses(c);
    const runway = ex.total > 0 ? Math.floor(c.funds / ex.total) : 99;
    if (ui.hover(x, 0, 14, 1)) ui.setTip([`Funds ${cb(c.funds)}`, `Monthly expenses ${cb(ex.total)} (next payment in ${30 - (c.day % 30)} days).`, `Runway: ~${Math.max(0, runway)} months.`]);
    x += 16;
    x += d.text(x, 0, `-${cbk(ex.total)}/mo`, runway < 2 ? C.red : C.dim) + 3;
    const m = morale(c);
    const mw = d.ctext(x, 0, `MORALE {${m >= 30 ? '#6ad46a' : m >= 15 ? '#f0c040' : '#e8503a'}}${m} ${moraleName(m)}{/}`, C.dim);
    if (ui.hover(x, 0, mw, 1)) ui.setTip([`Morale ${m}/50 · ${moraleName(m)}`, ...moraleBreakdown(c).map(([l, v]) => `  ${v >= 0 ? '+' : ''}${v}  ${l}`), m >= 40 ? 'Inspired: +15% mission XP.' : m < 12 ? 'Below 12 at month end, MechWarriors may desert!' : 'Sets starting and maximum Resolve in combat.']);
    x += mw + 3;
    x += d.ctext(x, 0, `MRB {#f2f6f8}${mrbLevel(c)}{/}{#6d7f8a}·${c.mrb}{/}`, C.dim) + 2;
    const s = sys(c);
    const loc = c.travel ? `→ ${sys(c, c.travel.dest).name} ${travelDaysLeft(c)}d` : `${s.name}`;
    const room = Math.max(0, COLS - 39 - x);
    d.text(x, 0, loc.length > room ? loc.slice(0, Math.max(0, room - 1)) + '…' : loc, c.travel ? C.cyan : C.text, undefined, room);
    if (loc.length > room && ui.hover(x, 0, room, 1)) ui.setTip([loc]);
    // time controls
    const bx = COLS - 36;
    if (ui.button(bx, 0, this.advancing ? '❚❚ Pause' : '▸ Advance', { key: ' ', keyLabel: '␣', tip: 'Pass time continuously until something completes (repairs, healing, arrival) or an event happens.' , style: 'plain', fg: this.advancing ? C.accent : C.text })) {
      this.advancing = !this.advancing;
      this.watchKey = this.stopWatch();
    }
    if (ui.button(bx + 14, 0, '+1 Day', { key: '.', style: 'plain', tip: 'Pass a single day.' })) { this.advancing = false; this.passDay(); }
    if (ui.button(bx + 25, 0, 'Menu', { key: 'Escape', style: 'plain' })) this.menuOpen = !this.menuOpen;
    if (this.menuOpen && ui.enabled === false) { /* menu handles its own input */ }
  }

  drawTabs(ui: UI): void {
    const d = ui.d;
    d.fill(0, 1, COLS, 1, ' ', C.text, C.bg);
    let x = 1;
    TABS.forEach((t, i) => {
      const w = t.length + 6;
      if (ui.button(x, 1, t, { key: String(i + 1), active: this.tab === t, w, style: 'tab', center: true })) this.tab = t;
      x += w + 1;
    });
    d.hline(0, 2, COLS, C.border, '─');
  }

  drawMenu(ui: UI): void {
    const d = ui.d;
    ui.dimAll(0.4);
    const w = 34, h = 14, x = (COLS - w) >> 1, y = 12;
    ui.panel(x, y, w, h, 'MENU', { style: 'double', fg: C.borderHi, bg: '#0a1016' });
    let yy = y + 2;
    const btn = (label: string, fn: () => void, key?: string) => { if (ui.button(x + 3, yy, label, { w: w - 6, style: 'block', key })) fn(); yy += 2; };
    btn('Resume', () => { this.menuOpen = false; }, 'Escape');
    btn(isMuted() ? 'Sound: off' : 'Sound: on', () => setMuted(!isMuted()), 'm');
    btn('Save game', () => { saveGame(this.c); this.notify('Game saved'); this.menuOpen = false; }, 's');
    btn('Export save file', () => { exportSave(this.c); this.menuOpen = false; }, 'x');
    btn('Save & quit to title', () => { saveGame(this.c); app.reset(new TitleScreen()); }, 'q');
    void d;
  }

  // ---- COMMAND ------------------------------------------------------------------------------
  drawCommand(ui: UI, x: number, y: number, w: number, h: number): void {
    const d = ui.d, c = this.c;
    const s = sys(c);
    // Left: system + readiness
    ui.panel(x + 1, y, 58, 14, `SYSTEM · ${s.name.toUpperCase()}`);
    const own = faction(s.owner);
    d.ctext(x + 3, y + 1, `Controlled by {${own.color}}${own.name}{/}`, C.dim);
    d.ctext(x + 3, y + 2, `Threat {#e8503a}${skulls(s.diff)}{/}`, C.dim);
    wrap(s.desc, 54).forEach((l, i) => d.text(x + 3, y + 4 + i, l, C.text));
    s.tags.forEach((t, i) => d.ctext(x + 3, y + 7 + i, `{#f0a830}▪{/} ${tagDesc(t)}`, C.dim, undefined, 54));
    const kN = (c.contracts[s.id] ?? []).length;
    if (!c.travel) { if (ui.button(x + 3, y + 12, `${kN} contracts available`, { tip: 'View contracts' })) this.tab = 'CONTRACTS'; }
    else d.text(x + 3, y + 12, 'In transit: no contracts until arrival.', C.cyan);
    // Readiness
    ui.panel(x + 1, y + 15, 58, h - 15, 'READINESS');
    let yy = y + 16;
    const ready = c.mechs.filter((m) => mechReady(c, m)).length;
    const pReady = c.pilots.filter((p) => !p.dead && p.injuries === 0).length;
    d.ctext(x + 3, yy++, `'Mechs ready: {#f2f6f8}${ready}{/}/${c.mechs.length} (bays ${c.mechs.length}/${bays(c)})   MechWarriors fit: {#f2f6f8}${pReady}{/}/${c.pilots.filter((p) => !p.dead).length}`, C.dim);
    d.ctext(x + 3, yy++, `Tech capacity {#f2f6f8}${techHours(c)}{/} hrs/day · Work orders {#f2f6f8}${c.work.length}{/}`, C.dim);
    yy++;
    for (const wo of c.work.slice(0, 6)) {
      const f = 1 - wo.hours / Math.max(1, wo.total);
      d.text(x + 3, yy, wo.desc.slice(0, 30), C.text);
      simpleBar(d, x + 35, yy, 14, f, '#4a8ee8');
      d.text(x + 50, yy, `${workQueueDays(c, wo.mechUid)}d`, C.dim);
      yy++;
    }
    if (!c.work.length) d.text(x + 3, yy++, 'No work orders pending.', C.faint);
    yy++;
    for (const p of c.pilots.filter((q) => q.injuries > 0 && !q.dead).slice(0, 5)) d.ctext(x + 3, yy++, `{#f08a30}✚{/} ${p.callsign} recovering: ${p.healDays} day${p.healDays === 1 ? "" : "s"}`, C.text);
    yy++;
    d.text(x + 3, yy++, "'MECHS", C.accent, undefined, 99, true);
    for (const m of c.mechs) {
      if (yy >= y + h - 1) break;
      const ch = chassis(m.defId);
      const wo = c.work.find((w) => w.mechUid === m.uid);
      const st = frameStats(m);
      const pi = c.lance.indexOf(m.uid);
      const pl = pi >= 0 ? c.pilots.find((p) => p.id === c.lancePilots[pi]) : undefined;
      d.text(x + 3, yy, `${ch.name} ${ch.id}`.slice(0, 20), C.text);
      d.text(x + 24, yy, `${ch.tons}t`, C.faint);
      const af = st.armorTotal / Math.max(1, st.armorMax);
      d.text(x + 29, yy, `${Math.round(af * 100)}%`.padStart(4) + ' armor', healthColor(af));
      d.text(x + 41, yy, wo ? `${wo.kind} ${workQueueDays(c, m.uid)}d` : pl ? pl.callsign.slice(0, 14) : 'ready', wo ? C.warn : pl ? C.cyan : C.green, undefined, 16);
      yy++;
    }
    // Middle: reputation
    ui.panel(x + 60, y, 44, 22, 'STANDING');
    const lvl = mrbLevel(c);
    d.ctext(x + 62, y + 1, `Mercenary Review Board rating {#f0a830}${lvl}{/}/5`, C.text);
    const nxt = MRB_LEVELS[Math.min(5, lvl + 1)];
    simpleBar(d, x + 62, y + 2, 38, lvl >= 5 ? 1 : (c.mrb - MRB_LEVELS[lvl]) / (nxt - MRB_LEVELS[lvl]), '#d89a30');
    d.text(x + 62, y + 3, lvl >= 5 ? 'Maximum rating' : `${c.mrb}/${nxt} to next rating`, C.faint, undefined, 40);
    d.ctext(x + 62, y + 4, `Bonded for contracts up to {#e8503a}${skulls(Math.floor(maxContractDiff(c)))}{/}`, C.faint, undefined, 40);
    let ry = y + 5;
    for (const f of FACTIONS) {
      const v = c.rep[f.id] ?? 0;
      const lv = repLevel(v);
      d.text(x + 62, ry, f.short.slice(0, 11), f.color);
      // centered bar -100..100
      const bw = 16, bx = x + 74;
      for (let i = 0; i < bw; i++) {
        const a = (i + 0.5) / bw * 200 - 100;
        const on = v >= 0 ? a >= 0 && a <= v : a <= 0 && a >= v;
        d.set(bx + i, ry, i === bw / 2 ? '│' : ' ', C.faint, on ? lv.color : '#161c22');
      }
      d.text(x + 91, ry, lv.name, lv.color);
      if (ui.hover(x + 62, ry, 40, 1)) ui.setTip([`{${f.color}}${f.name}{/}: ${v} (${lv.name})`, f.desc, 'Higher standing improves pay, salvage offers and store prices.']);
      ry += 2;
    }
    // Company summary
    ui.panel(x + 60, y + 23, 44, h - 23, 'COMPANY');
    const e = monthlyExpenses(c);
    const lines = [
      `Funds {#f0c850}${cb(c.funds)}{/}`,
      `Monthly burn {#f2f6f8}${cb(e.total)}{/} (${EXPENSE_LEVELS[c.expense].name})`,
      `Company value {#f2f6f8}${cb(companyValue(c))}{/}`,
      `Contracts {#f2f6f8}${c.stats.wins}{/}/${c.stats.missions} won · kills {#f2f6f8}${c.stats.kills}{/}`,
      `Lost: {#e8503a}${c.stats.mechsLost}{/} 'Mechs, {#e8503a}${c.stats.pilotsLost}{/} MechWarriors`,
      `Days remaining {#f2f6f8}${CAREER_DAYS - c.day}{/}`,
      `Career score {#f0a830}${careerScore(c)}{/}`,
    ];
    lines.forEach((l, i) => d.ctext(x + 62, y + 24 + i, l, C.dim));
    // Right: log
    ui.panel(x + 105, y, w - 106, h, 'COMPANY LOG');
    const lw = w - 110;
    if (this.logLen !== c.log.length) { this.logLen = c.log.length; this.logState.scroll = 1e9; }
    const all: { t: string; c?: string }[] = [];
    for (const l of c.log) { const ws = wrap(`{#3b4a54}${dateStr(l.day).slice(0, 6)}{/} ${l.text}`, lw); ws.forEach((t) => all.push({ t, c: l.color })); }
    ui.list(x + 106, y + 1, w - 108, h - 2, all, this.logState, (l, _i, lx, ly) => d.ctext(lx + 1, ly, l.t, l.c ?? C.text, undefined, lw));
  }

  // ---- FINANCE ------------------------------------------------------------------------------
  drawFinance(ui: UI, x: number, y: number, w: number, h: number): void {
    const d = ui.d, c = this.c;
    ui.panel(x + 1, y, 70, 22, 'EXPENSE LEVEL');
    d.text(x + 3, y + 1, 'How well you treat your crew. Affects monthly costs and morale.', C.dim);
    EXPENSE_LEVELS.forEach((lv, i) => {
      const yy = y + 3 + i * 2;
      if (ui.button(x + 3, yy, lv.name, { active: c.expense === i, w: 16 })) { c.expense = i; saveGame(c); }
      d.ctext(x + 21, yy, `Salaries x${lv.mult.toFixed(2)}   Morale {${lv.morale >= 0 ? '#6ad46a' : '#e8503a'}}${lv.morale >= 0 ? '+' : ''}${lv.morale}{/}`, C.dim);
    });
    const m = morale(c);
    d.ctext(x + 3, y + 14, `Current morale: {#f2f6f8}${m}{/} (${moraleName(m)})`, C.text);
    d.text(x + 3, y + 15, 'Morale sets starting/max Resolve and how fast it builds.', C.faint, undefined, 66);
    d.text(x + 3, y + 16, 'Below 12 at month end, MechWarriors may desert. 40+: +15% XP.', C.faint, undefined, 66);
    d.ctext(x + 56, y + 14, moraleBreakdown(c).filter(([l]) => l.startsWith('Recent')).map(([, v]) => `{${v >= 0 ? '#6ad46a' : '#e8503a'}}events ${v >= 0 ? '+' : ''}${v}{/}`).join(''), C.dim);
    simpleBar(d, x + 3, y + 17, 50, m / 50, healthColor(m / 50));
    // Breakdown
    const e = monthlyExpenses(c);
    ui.panel(x + 1, y + 23, 70, h - 23, 'MONTHLY EXPENSES');
    const rows: [string, number][] = [['Argo operations', e.argo], ['\'Mech maintenance', e.mechs], ['MechWarrior salaries', e.pilots], ['Upgrade upkeep', e.upgrades]];
    rows.forEach(([l, v], i) => { d.text(x + 3, y + 25 + i, l, C.text); d.text(x + 40, y + 25 + i, cb(v).padStart(14), C.cbill); });
    d.hline(x + 3, y + 30, 51, C.border);
    d.text(x + 3, y + 31, 'TOTAL', C.bright, undefined, 99, true);
    d.text(x + 40, y + 31, cb(e.total).padStart(14), C.cbill, undefined, 99, true);
    const days = 30 - (c.day % 30);
    d.ctext(x + 3, y + 33, `Next payment in {#f2f6f8}${days}{/} days. ${c.funds >= e.total ? `Runway ~{#f2f6f8}${Math.floor(c.funds / Math.max(1, e.total))}{/} months.` : '{#e8503a}Insufficient funds for next payment!{/}'}`, C.dim);
    // Bank credit: a lump sum now against a bigger repayment later, one loan at a time
    const loanAmt = 750000 + mrbLevel(c) * 250000, loanDue = Math.round(loanAmt * 1.25);
    const hasBank = (c.debts ?? []).some((db) => db.who === 'Aurigan Merchant Bank');
    if (!hasBank && (c.funds < 0 || c.negativeMonths)) d.text(x + 3, y + 34, 'Bank credit: refused while the company is in debt.', C.faint);
    else if (!hasBank) {
      d.ctext(x + 3, y + 34, `Bank credit: {#f0c850}${cbk(loanAmt)}{/} now, repay {#f0c850}${cbk(loanDue)}{/} in 90 days.`, C.dim);
      const armed = this.confirmBuy === 'loan';
      if (ui.button(x + 56, y + 34, armed ? 'CONFIRM?' : 'Borrow', { w: 11, fg: armed ? C.accent : undefined, tip: 'Click twice. The bank collects automatically on the due date, even if it puts you in the red.' })) {
        if (!armed) this.confirmBuy = 'loan';
        else {
          this.confirmBuy = '';
          c.funds += loanAmt; c.borrowed = (c.borrowed ?? 0) + loanAmt; (c.debts ??= []).push({ day: c.day + 90, amount: loanDue, who: 'Aurigan Merchant Bank' });
          addLog(c, `Borrowed ${cb(loanAmt)} from the Aurigan Merchant Bank; ${cb(loanDue)} due ${dateStr(c.day + 90)}.`, '#f0c850');
          saveGame(c); this.notify(`Borrowed ${cbk(loanAmt)}`, C.cbill);
        }
      }
    }
    (c.debts ?? []).forEach((db, i) => d.ctext(x + 3, y + 35 + (hasBank ? 0 : 1) + i, `Loan: {#f0c850}${cb(db.amount)}{/} due to the ${db.who} in {#f2f6f8}${db.day - c.day}{/} days.`, C.warn));
    if (c.negativeMonths) d.text(x + 3, y + 35 + (hasBank ? 0 : 1) + (c.debts ?? []).length, 'The company is in debt. Another negative month means bankruptcy.', C.red);
    // Recent months
    const led = (c.ledger ?? []).slice(-Math.max(0, Math.min(5, h - 41)));
    if (led.length) {
      const ly0 = y + h - 3 - led.length;
      d.text(x + 3, ly0 - 1, 'MONTH       CONTRACTS     SALES     SPENDING        NET', C.faint);
      led.forEach((L, i) => {
        const net = L.end - L.start;
        d.text(x + 3, ly0 + i, dateStr(L.day).slice(3), C.dim);
        d.text(x + 13, ly0 + i, cbk(L.contracts).padStart(10), C.cbill);
        d.text(x + 25, ly0 + i, cbk(L.sales).padStart(8), C.cbill);
        if (L.loans) d.text(x + 60, ly0 + i, "+loan", C.warn);
        d.text(x + 35, ly0 + i, cbk(-(L.other + L.operating)).padStart(11), C.dim);
        d.text(x + 48, ly0 + i, `${net >= 0 ? '+' : ''}${cbk(net)}`.padStart(10), net >= 0 ? C.green : C.red);
      });
    }
    // Mech upkeep detail
    ui.panel(x + 73, y, w - 74, h, 'MAINTENANCE DETAIL');
    let yy = y + 1;
    for (const mm of c.mechs) { if (yy >= y + h - 24) break; d.text(x + 75, yy, mm.nickname ?? mm.defId, C.text); d.text(x + 110, yy, cb(12000 + (chassisTons(mm)) * 450).padStart(10), C.dim); yy++; }
    yy++;
    // Funds history chart and career ledger at the bottom of the panel
    const ch = 10, cy = y + h - ch - 9, cx = x + 77, cw = w - 74 - 14;
    const hist = [...(c.fundsHistory ?? []), c.funds].slice(-cw);
    const hi = Math.max(1, ...hist), lo = Math.min(0, ...hist);
    d.text(x + 75, cy - 2, hist.length < 3 ? 'FUNDS' : 'FUNDS · LAST ' + (hist.length - 1) * 3 + ' DAYS', C.accent, undefined, 99, true);
    d.text(x + 75, cy - 1, cbk(hi), C.faint);
    d.text(x + 75, cy + ch - 1, cbk(lo), C.faint);
    // Stretch whatever history exists across the full chart width
    if (hist.length < 3) d.text(cx + 6, cy + (ch >> 1), 'The chart fills in as the days pass.', C.faint);
    else for (let col = 0; col < cw; col++) {
      const i = Math.min(hist.length - 1, Math.floor((col * hist.length) / cw));
      const v = hist[i], top = ((v - lo) / (hi - lo || 1)) * ch * 8;
      for (let r = 0; r < ch; r++) {
        const fill = Math.max(0, Math.min(8, Math.round(top - (ch - 1 - r) * 8)));
        if (fill > 0) d.set(cx + 6 + col, cy + r, ' ▁▂▃▄▅▆▇█'[fill], v < 0 ? C.red : i === hist.length - 1 ? C.accent : '#8a7a3a');
        else d.set(cx + 6 + col, cy + r, r === ch - 1 ? '·' : ' ', '#23303a');
      }
    }
    // Month ticks under the chart
    const span = Math.max(1, (hist.length - 1) * 3), startDay = c.day - span;
    // Ticks sit on the first day of each calendar month
    let lastCol = -99;
    for (let day = Math.max(0, startDay); day <= c.day; day++) {
      if (!dateStr(day).startsWith('01')) continue;
      const col = Math.round(((day - startDay) / span) * (cw - 1));
      if (col >= 0 && col < cw - 4 && col - lastCol >= 5) { d.text(cx + 6 + col, cy + ch, `┴${dateStr(day).slice(3, 6)}`, C.faint); lastCol = col; }
    }
    const st = c.stats;
    const ly = cy + ch + 2;
    d.ctext(x + 75, ly, `Earned {#f0c850}${cb(st.earned)}{/}   Spent {#f0c850}${cb(st.spent)}{/}   Contracts {#f2f6f8}${st.wins}/${st.missions}{/} won`, C.dim, undefined, w - 78);
    d.ctext(x + 75, ly + 1, `Kills {#f2f6f8}${st.kills}{/}   'Mechs lost {#f2f6f8}${st.mechsLost}{/}   MechWarriors lost {#f2f6f8}${st.pilotsLost}{/}`, C.dim, undefined, w - 78);
    for (const p of c.pilots.filter((q) => !q.dead)) {
      if (yy >= cy - 3) break;
      d.text(x + 75, yy, `${p.callsign}`, C.text);
      d.text(x + 110, yy, (p.commander ? 'owner' : cb(Math.round(salaryOf(p) * e.mult))).padStart(10), C.dim);
      yy++;
    }
  }

  // ---- ARGO UPGRADES ---------------------------------------------------------------------------
  drawUpgrades(ui: UI, x: number, y: number, w: number, h: number): void {
    const d = ui.d, c = this.c;
    ui.panel(x + 1, y, w - 2, h, 'ARGO UPGRADES');
    d.text(x + 3, y + 1, 'Refit the Argo. Each module adds monthly upkeep and takes days to install.', C.dim);
    const TRACKS: [string, string, string[]][] = [
      ['ENGINEERING', 'Repairs, refits and the drive', ['tech1', 'tech2', 'bay2', 'armory', 'drive']],
      ['CREW', 'Health, training and comfort', ['med1', 'med2', 'train1', 'train2', 'hydro', 'rec']],
      ['COMMAND', 'Intelligence and personnel', ['comms', 'toc', 'barracks']],
    ];
    const cw = Math.floor((w - 6) / 3);
    TRACKS.forEach(([title, sub, ids], col) => {
      const tx = x + 3 + col * cw;
      d.text(tx, y + 3, title, C.accent, undefined, 99, true);
      d.text(tx + title.length + 2, y + 3, sub, C.faint, undefined, cw - title.length - 4);
      ids.forEach((id, row) => {
        const u = UPGRADES.find((q) => q.id === id);
        if (!u) return;
        const bx = tx, by = y + 4 + row * 6, bw = cw - 2;
        const owned = has(c, u.id);
        const inst = (c.installing ?? []).find((q) => q.id === u.id);
        const locked = !!u.requires && !has(c, u.requires);
        d.box(bx, by, bw, 6, owned ? '#2a6a4a' : locked ? '#2a2a2a' : C.border, owned ? '#0c1a14' : C.panel);
        // Tier connector from the module this one requires
        if (u.requires && ids.includes(u.requires) && ids.indexOf(u.requires) === row - 1) d.set(bx + 4, by, '┴', owned ? '#2a6a4a' : '#3a4a58');
        d.text(bx + 2, by + 1, u.name, owned ? C.green : locked ? C.faint : C.bright, undefined, bw - 14, true);
        if (owned) d.text(bx + bw - 11, by + 1, 'INSTALLED', C.green);
        else if (inst) d.text(bx + bw - 16, by + 1, `INSTALLING ${Math.max(0, inst.doneDay - c.day)}d`, C.warn);
        wrap(u.desc, bw - 4).slice(0, 2).forEach((l, k) => d.text(bx + 2, by + 2 + k, l, C.dim));
        const days = Math.max(3, Math.round(u.cost / 180000));
        // Refit crews work one module at a time: a new purchase queues behind the last
        const queueEnd = Math.max(c.day, ...(c.installing ?? []).map((q) => q.doneDay));
        const total = queueEnd - c.day + days;
        if (locked) d.ctext(bx + 2, by + 4, `{#e8503a}requires ${UPGRADES.find((q) => q.id === u.requires)!.name}{/}`, C.dim, undefined, bw - 4);
        else d.ctext(bx + 2, by + 4, `{#f0c850}${cbk(u.cost)}{/} · ${cbk(u.upkeep)}/mo${!owned && !inst ? ` · ${days}d` : ''}`, C.dim, undefined, bw - 15);
        if (!owned && !locked && !inst && ui.button(bx + bw - 12, by + 4, this.confirmBuy === u.id ? 'CONFIRM?' : 'Purchase', { w: 10, disabled: c.funds < u.cost || !!c.travel, fg: this.confirmBuy === u.id ? C.accent : undefined, tip: c.travel ? 'Must be docked to refit.' : c.funds < u.cost ? 'Not enough funds.' : `Click twice to purchase. Upkeep ${cb(u.upkeep)}/month; ${days} days to install${total > days ? ` after the current refit (ready in ${total} days)` : ''}.` })) {
          if (this.confirmBuy !== u.id) this.confirmBuy = u.id;
          else {
            c.funds -= u.cost; c.stats.spent += u.cost; (c.installing ??= []).push({ id: u.id, doneDay: c.day + total });
            saveGame(c); this.notify(total > days ? `${u.name}: queued behind the current refit, ready in ${total} days` : `${u.name}: refit crews need ${days} days`, C.cyan); this.confirmBuy = '';
          }
        }
      });
    });
    const upk = monthlyExpenses(c).upgrades;
    d.ctext(x + 3, y + h - 2, `Installed modules {#f2f6f8}${c.upgrades.length}/${UPGRADES.length}{/} · upkeep {#f0c850}${cb(upk)}{/}/mo${(c.installing ?? []).length ? ` · {#f0c040}${c.installing!.length} installing{/}` : ''}`, C.dim);
    void scale; void pilotCap;
  }
}

import { chassis } from '../data/mechs';
import { frameStats } from '../game/frame';
import { workQueueDays } from '../game/company';
import { salary } from '../game/pilot';
import { Frame } from '../game/frame';
function chassisTons(m: Frame): number { return chassis(m.defId).tons; }
function salaryOf(p: Parameters<typeof salary>[0]): number { return salary(p); }

/** Difficulty as five pips: ■ full skull, ◧ half skull, □ empty. */
export function skulls(diff: number): string {
  const full = Math.floor(diff / 2), half = diff % 2;
  return '■'.repeat(full) + (half ? '◧' : '') + '□'.repeat(Math.max(0, 5 - full - half));
}
