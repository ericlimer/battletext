// Skirmish mode: build two lances under a C-Bill budget and fight on any biome/mission.

import { Screen, app } from './app';
import { UI } from '../engine/ui';
import { C, lerp } from '../engine/color';
import { RNG } from '../engine/rng';
import { CHASSIS, chassis, CLASS_NAMES } from '../data/mechs';
import { newMechFrame, frameStats, weaponSummary } from '../game/frame';
import { makePilot, Pilot } from '../game/pilot';
import { setupMission, MissionType, MISSION_INFO, Combatant, pilotTier } from '../combat/missions';
import { BIOMES, BIOME_INFO, Biome } from '../combat/terrain';
import { CombatScreen } from './combat';
import { cbk } from '../engine/util';
import { hardpointStr } from './widgets';

const TIERS = ['Green', 'Regular', 'Veteran', 'Elite'];
const BUDGETS = [0, 12e6, 20e6, 30e6, 45e6];
const MTYPES: MissionType[] = ['battle', 'assassinate', 'destroybase', 'defendbase', 'ambush', 'escort'];

interface Slot { chassis: string | null; tier: number; }

export class SkirmishScreen implements Screen {
  player: Slot[] = [{ chassis: 'HBK-4G', tier: 1 }, { chassis: 'CN9-A', tier: 1 }, { chassis: 'JR7-D', tier: 1 }, { chassis: 'CPLT-C1', tier: 1 }];
  enemy: Slot[] = [{ chassis: null, tier: 1 }, { chassis: null, tier: 1 }, { chassis: null, tier: 1 }, { chassis: null, tier: 1 }];
  randomEnemy = true;
  budget = 2;
  mtype = 0;
  biome = 0;
  night = false;
  picking: { side: 'p' | 'e'; i: number } | null = null;
  listState = { scroll: 0 };
  filter: 'all' | 'L' | 'M' | 'H' | 'A' = 'all';
  seed = (Math.random() * 1e9) | 0;

  lanceCost(s: Slot[]): number {
    return s.reduce((a, x) => a + (x.chassis ? chassis(x.chassis).cost : 0), 0);
  }

  render(ui: UI): void {
    const d = ui.d;
    d.fill(0, 0, 150, 48, ' ', C.text, C.bg);
    ui.header(0, 0, 150, 'SKIRMISH  ·  LANCE CONFIGURATION', C.bg, C.accent);
    // Settings row
    let y = 2;
    d.text(2, y, 'MISSION', C.dim);
    MTYPES.forEach((t, i) => { if (ui.button(12 + i * 18, y, `${MISSION_INFO[t].glyph} ${MISSION_INFO[t].name}`, { active: this.mtype === i, w: 17, tip: MISSION_INFO[t].desc })) this.mtype = i; });
    y += 2;
    d.text(2, y, 'BIOME', C.dim);
    BIOMES.forEach((b, i) => { if (ui.button(12 + i * 13, y, BIOME_INFO[b].name, { active: this.biome === i, w: 12, tip: BIOME_INFO[b].desc })) this.biome = i; });
    if (ui.button(12 + 8 * 13, y, this.night ? 'Night' : 'Day', { active: this.night, w: 8, tip: 'Night: visual range reduced to 12 tiles.' })) this.night = !this.night;
    y += 2;
    d.text(2, y, 'BUDGET', C.dim);
    BUDGETS.forEach((bv, i) => { if (ui.button(12 + i * 13, y, bv ? cbk(bv) : 'Unlimited', { active: this.budget === i, w: 12 })) this.budget = i; });
    const budget = BUDGETS[this.budget];
    y += 2;
    // Lances
    this.drawLance(ui, 2, y + 1, 'YOUR LANCE', this.player, 'p', budget, C.player);
    this.drawLance(ui, 2, y + 15, 'OPFOR', this.enemy, 'e', budget, C.enemy);
    if (ui.button(40, y + 15, this.randomEnemy ? 'Random OPFOR ■' : 'Random OPFOR □', { tip: 'Generate the opposing lance to match your budget.' })) this.randomEnemy = !this.randomEnemy;
    // Picker
    this.drawPicker(ui, 76, 8);
    // Launch
    const pc = this.lanceCost(this.player);
    const valid = this.player.some((s) => s.chassis) && (!budget || pc <= budget);
    if (ui.button(2, 45, 'BACK', { key: 'Escape', style: 'block', w: 12, center: true })) app.pop();
    if (ui.button(52, 45, 'LAUNCH SKIRMISH', { key: 'Enter', style: 'block', w: 22, center: true, disabled: !valid, tip: valid ? '' : 'Your lance is over budget or empty.' })) this.launch();
  }

  drawLance(ui: UI, x: number, y: number, title: string, slots: Slot[], side: 'p' | 'e', budget: number, col: string): void {
    const d = ui.d;
    const cost = this.lanceCost(slots);
    const over = budget && cost > budget;
    d.text(x, y, title, col, undefined, 99, true);
    if (!(side === 'e' && this.randomEnemy)) d.text(x + 24, y, `${cbk(cost)}${budget ? ' / ' + cbk(budget) : ''}`, over ? C.red : C.cbill);
    y++;
    slots.forEach((s, i) => {
      const yy = y + i * 3;
      const sel = this.picking?.side === side && this.picking.i === i;
      const random = side === 'e' && this.randomEnemy;
      d.box(x, yy, 72, 3, sel ? C.accent : C.border, sel ? '#141c22' : C.panel);
      if (random) { d.text(x + 2, yy + 1, 'Random (matched to your lance)', C.faint); return; }
      if (ui.click(x, yy, 58, 3)) { this.picking = { side, i }; }
      if (ui.hover(x, yy, 58, 3)) ui.cursor = 'pointer';
      if (s.chassis) {
        const c = chassis(s.chassis);
        const f = newMechFrame(c.id);
        const st = frameStats(f);
        d.text(x + 2, yy + 1, `${c.name} ${c.id}`.padEnd(22), C.bright);
        d.text(x + 24, yy + 1, `${c.tons}t`, C.dim);
        d.text(x + 30, yy + 1, weaponSummary(f).slice(0, 26), C.text);
        void st;
        d.text(x + 2, yy, ` ${CLASS_NAMES[c.cls]} `, C.faint, sel ? '#141c22' : C.panel);
        d.text(x + 44, yy + 2, cbk(c.cost), C.cbill, sel ? '#141c22' : C.panel);
      } else d.text(x + 2, yy + 1, '— empty slot — click to choose', C.faint);
      if (ui.button(x + 58, yy + 1, TIERS[s.tier], { w: 10, style: 'plain', tip: 'Pilot skill level. Click to cycle.' })) s.tier = (s.tier + 1) % TIERS.length;
      if (s.chassis && ui.button(x + 68, yy + 1, '✕', { style: 'plain', fg: C.red })) s.chassis = null;
    });
  }

  drawPicker(ui: UI, x: number, y: number): void {
    const d = ui.d;
    const w = 72, h = 36;
    ui.panel(x, y, w, h, this.picking ? `SELECT 'MECH — ${this.picking.side === 'p' ? 'YOUR LANCE' : 'OPFOR'} SLOT ${this.picking.i + 1}` : 'MECH ROSTER', { fg: C.border });
    const filters: ('all' | 'L' | 'M' | 'H' | 'A')[] = ['all', 'L', 'M', 'H', 'A'];
    filters.forEach((f, i) => { if (ui.button(x + 2 + i * 11, y + 1, f === 'all' ? 'All' : CLASS_NAMES[f], { active: this.filter === f, w: 10 })) { this.filter = f; this.listState.scroll = 0; } });
    const list = CHASSIS.filter((c) => this.filter === 'all' || c.cls === this.filter);
    const clicked = ui.list(x + 1, y + 3, w - 2, h - 4, list, this.listState, (c, _i, lx, ly, lw, hov) => {
      const bg = hov ? '#1a2630' : C.panel;
      d.fill(lx, ly, lw, 2, ' ', C.text, bg);
      d.text(lx + 1, ly, `${c.name} ${c.id}`, hov ? C.bright : C.text, bg);
      d.text(lx + 24, ly, `${c.tons}t`, C.dim, bg);
      d.ctext(lx + 30, ly, hardpointStr(newMechFrame(c.id)), C.text, bg);
      d.text(lx + lw - 8, ly, cbk(c.cost).padStart(7), C.cbill, bg);
      const f = newMechFrame(c.id);
      d.text(lx + 1, ly + 1, weaponSummary(f).slice(0, 44), C.dim, bg);
      const st = frameStats(f);
      d.text(lx + 47, ly + 1, `mv ${st.walk}/${st.sprint}${st.jump ? ' j' + st.jump : ''}`, C.faint, bg);
      if (hov) ui.setTip([`{#f2f6f8}${c.name} ${c.id}{/} · ${c.tons}t`, c.desc]);
    }, 2);
    if (clicked >= 0 && this.picking) {
      const slots = this.picking.side === 'p' ? this.player : this.enemy;
      slots[this.picking.i].chassis = list[clicked].id;
      const nextEmpty = slots.findIndex((s) => !s.chassis);
      this.picking = nextEmpty >= 0 ? { side: this.picking.side, i: nextEmpty } : null;
    }
    if (!this.picking) d.text(x + 2, y + h - 1, ' click a lance slot to change it ', C.faint, C.panel);
  }

  launch(): void {
    const r = new RNG(this.seed++);
    const mk = (s: Slot): Combatant | null => {
      if (!s.chassis) return null;
      const p: Pilot = makePilot(r, [0, 1, 3, 4][s.tier]);
      return { frame: newMechFrame(s.chassis), pilot: p };
    };
    const player = this.player.map(mk).filter(Boolean) as Combatant[];
    let enemies: Combatant[];
    if (this.randomEnemy) {
      // Match the budget of the player's lance
      const target = this.lanceCost(this.player) / Math.max(1, player.length);
      const avgTier = Math.round(this.player.reduce((a, s) => a + s.tier, 0) / Math.max(1, player.length));
      enemies = player.map(() => {
        const pool = CHASSIS.filter((c) => Math.abs(c.cost - target) < target * 0.3);
        const c = r.pick(pool.length ? pool : CHASSIS);
        return { frame: newMechFrame(c.id), pilot: makePilot(r, [0, 1, 3, 4][avgTier]) };
      });
    } else enemies = this.enemy.map(mk).filter(Boolean) as Combatant[];
    if (!enemies.length) return;
    const type = MTYPES[this.mtype];
    const avgTons = player.reduce((a, c) => a + (c.frame.kind === 'mech' ? chassis(c.frame.defId).tons : 40), 0) / player.length;
    const diff = Math.max(1, Math.min(10, Math.round((avgTons - 22) / 7.2)));
    const rt = setupMission({ type, difficulty: diff, biome: BIOMES[this.biome] as Biome, seed: r.seed(), night: this.night, employer: 'davion', target: 'liao', player, enemies: type === 'battle' || type === 'assassinate' ? enemies : undefined, basePay: 0 });
    void pilotTier;
    app.push(new CombatScreen(rt, () => { app.pop(); }, `SKIRMISH: ${MISSION_INFO[type].name.toUpperCase()}`));
  }
}

export function quickSkirmish(type: string, seed: number): void {
  const r = new RNG(seed);
  const player: Combatant[] = ['HBK-4G', 'CN9-A', 'JR7-D', 'CPLT-C1'].map((id) => ({ frame: newMechFrame(id), pilot: makePilot(r, 2) }));
  const rt = setupMission({ type: type as MissionType, difficulty: 4, biome: BIOMES[seed % BIOMES.length], seed, night: false, employer: 'davion', target: 'liao', player, basePay: 400000 });
  const cs = new CombatScreen(rt, () => app.pop(), 'QUICK SKIRMISH');
  const q = new URLSearchParams(location.search);
  if (q.has('auto')) { cs.autoplay = true; cs.briefingOpen = false; cs.speed = +(q.get('speed') ?? 1); }
  app.push(cs);
  void lerp;
}
