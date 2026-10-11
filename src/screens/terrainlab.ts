// Terrain lab: experimental ways of drawing the battle map's height, rendered from a live battle so they can be
// compared side by side. Debug only: ?skirmish=…&lab[=N], or press [Y] in combat with ?lab in the URL.
import type { Screen } from './app';
import { app } from './app';
import type { UI } from '../engine/ui';
import { COLS, ROWS } from '../engine/display';
import { C, lerp, scale, lum } from '../engine/color';
import { BIOME_INFO, TERRAIN, dist } from '../combat/terrain';
import type { Battle, Unit } from '../combat/battle';
import { SIDE } from '../combat/battle';
import { heightAt, topColor, detailAt, blockCell, topoCell, paint3d, perspective, Project, VBLOCK } from '../combat/heightview';

const MX = 0, MY = 1, VW = 50, VH = 36, PX = 100;

interface LabMode { name: string; blurb: string[]; draw(L: TerrainLab, ui: UI): void }

export class TerrainLab implements Screen {
  mode = 0;
  camX = 0; camY = 0;
  focus: Unit | null;
  constructor(public b: Battle, public glyphOf: (u: Unit) => string, focus: Unit | null, mode = 0) {
    this.focus = focus ?? b.units.find((u) => u.alive && u.deployed && SIDE(u.team) === 0) ?? null;
    this.mode = Math.max(0, Math.min(MODES.length - 1, mode));
    this.center();
  }
  center(): void {
    const f = this.focus, m = this.b.map;
    const cx = f ? f.x : m.w / 2, cy = f ? f.y : m.h / 2;
    this.camX = Math.max(0, Math.min(m.w - VW, Math.round(cx - VW / 2)));
    this.camY = Math.max(0, Math.min(m.h - VH, Math.round(cy - VH / 2)));
  }
  get target(): Unit | null {
    const f = this.focus;
    if (!f) return null;
    let best: Unit | null = null, bd = 1e9;
    for (const u of this.b.units) if (u.alive && u.deployed && SIDE(u.team) !== SIDE(f.team)) { const dd = dist(f.x, f.y, u.x, u.y); if (dd < bd) { bd = dd; best = u; } }
    return best;
  }

  // ---- shared terrain facts ----
  inb(x: number, y: number): boolean { const m = this.b.map; return x >= 0 && y >= 0 && x < m.w && y < m.h; }
  elev(x: number, y: number): number { const m = this.b.map; return this.inb(x, y) ? m.elev[y * m.w + x] : 0; }
  height(x: number, y: number): number { return heightAt(this.b.map, x, y); }
  topColor(x: number, y: number): string { return topColor(this.b.map, x, y); }
  detail(x: number, y: number): [string, string] | null { return detailAt(this.b.map, x, y); }
  unitAt(x: number, y: number): Unit | null {
    return this.b.units.find((u) => u.alive && u.deployed && !u.fled && u.x === x && u.y === y) ?? null;
  }
  unitColors(u: Unit): [string, string] {
    if (u === this.focus) return ['#05070a', '#f0d060'];
    return SIDE(u.team) === 0 ? ['#e8f6ff', '#1a5a8a'] : ['#fff0e8', '#8a2a1a'];
  }

  paint3d(ui: UI, project: Project, step: number): void {
    const units = this.b.units.filter((u) => u.alive && u.deployed && !u.fled).map((u) => { const [fg, bg] = this.unitColors(u); return { x: u.x, y: u.y, glyph: this.glyphOf(u), fg, bg }; });
    paint3d(ui.d, this.b.map, { mx: MX, my: MY, vw: VW, vh: VH, camX: this.camX, camY: this.camY }, project, step, units);
  }

  /** Wide-cell renderer: one glyph per tile. */
  paintFlat(ui: UI, cell: (x: number, y: number) => { ch: string; fg: string; bg: string }): void {
    const d = ui.d;
    for (let vy = 0; vy < VH; vy++) for (let vx = 0; vx < VW; vx++) {
      const x = vx + this.camX, y = vy + this.camY;
      if (!this.inb(x, y)) { d.wide(MX + vx * 2, MY + vy, ' ', '#000', '#000'); continue; }
      const u = this.unitAt(x, y);
      if (u) { const [fg, bg] = this.unitColors(u); d.wide(MX + vx * 2, MY + vy, this.glyphOf(u), fg, bg); continue; }
      const c = cell(x, y);
      d.wide(MX + vx * 2, MY + vy, c.ch, c.fg, c.bg);
    }
  }

  /** Side-on cross-section from the focus 'Mech to the nearest enemy, with the line of fire. */
  drawProfile(ui: UI, x0: number, y0: number, w: number, h: number): void {
    const d = ui.d, f = this.focus, t = this.target;
    d.text(x0, y0, 'CROSS-SECTION  you → nearest enemy', C.accent);
    if (!f || !t) { d.text(x0, y0 + 1, 'no target', C.dim); return; }
    const rows = h - 2, perLvl = rows / 5.5; // levels -1..4.5 fit
    const n = w;
    const hAt: number[] = [], cAt: string[] = [];
    for (let k = 0; k < n; k++) {
      const fx = f.x + (t.x - f.x) * k / (n - 1), fy = f.y + (t.y - f.y) * k / (n - 1);
      const tx = Math.round(fx), ty = Math.round(fy);
      hAt.push(this.height(tx, ty)); cAt.push(this.topColor(tx, ty));
    }
    const base = y0 + 1 + rows; // screen row just below the strip
    const toRow = (z: number) => (z + 1) * perLvl; // eighths above the floor, in rows
    for (let k = 0; k < n; k++) {
      const fillRows = toRow(hAt[k]);
      for (let r = 0; r < rows; r++) {
        const amt = Math.max(0, Math.min(1, fillRows - r));
        const ch = amt >= 1 ? '█' : VBLOCK[Math.round(amt * 8)];
        d.set(x0 + k, base - 1 - r, ch, cAt[k], '#0a0d10');
      }
    }
    // Line of fire from cockpit (+1 level) to target torso (+0.8)
    const za = hAt[0] + 1, zb = hAt[n - 1] + 0.8;
    let blocked = false;
    for (let k = 1; k < n - 1; k++) {
      const z = za + (zb - za) * k / (n - 1);
      if (hAt[k] > z) blocked = true;
      const r = toRow(z);
      const ri = Math.floor(r);
      if (ri >= 0 && ri < rows) { const solid = hAt[k] >= z - 0.05; d.set(x0 + k, base - 1 - ri, solid ? '×' : '·', blocked ? '#ff5a3a' : '#f0f0a0', solid ? cAt[k] : '#0a0d10'); }
    }
    const ra = Math.min(rows - 1, Math.floor(toRow(hAt[0] + 0.5))), rb = Math.min(rows - 1, Math.floor(toRow(hAt[n - 1] + 0.5)));
    d.text(x0, base - 1 - ra, this.glyphOf(f), '#05070a', '#f0d060');
    d.text(x0 + n - 2, base - 1 - rb, this.glyphOf(t), '#fff0e8', '#8a2a1a');
    d.text(x0, base, `${blocked ? 'line of fire blocked' : 'clear line of fire'}  ·  ${dist(f.x, f.y, t.x, t.y).toFixed(0)} tiles`, blocked ? '#ff5a3a' : '#f0f0a0');
  }

  render(ui: UI): void {
    const d = ui.d;
    d.fill(0, 0, COLS, ROWS, ' ', C.text, C.bg);
    const M = MODES[this.mode];
    d.text(1, 0, `TERRAIN LAB  ${this.mode + 1}/${MODES.length}  ${M.name.toUpperCase()}`, C.accent);
    d.text(PX - 40, 0, '←/→ mode · Tab focus · Esc back', C.faint);
    M.draw(this, ui);
    // Right panel: what the mode is, and the cross-section that works alongside any of them
    d.fillBg(PX, 1, COLS - PX, ROWS - 1, C.panel);
    d.text(PX + 1, 1, M.name.toUpperCase(), C.bright, C.panel);
    let y = 3;
    for (const line of M.blurb) { const words = line.split(' '); let cur = ''; for (const w of words) { if ((cur + ' ' + w).trim().length > COLS - PX - 3) { d.text(PX + 1, y++, cur, C.text, C.panel); cur = w; } else cur = (cur + ' ' + w).trim(); } if (cur) d.text(PX + 1, y++, cur, C.text, C.panel); y++; }
    this.drawProfile(ui, PX + 1, Math.max(y + 1, 30), COLS - PX - 3, 15);
    const f = this.focus;
    d.text(1, MY + VH + 1, f ? `Focus: ${this.glyphOf(f)} (gold) on level ${this.elev(f.x, f.y)}` : '', C.dim);
    if (ui.key('ArrowRight')) this.mode = (this.mode + 1) % MODES.length;
    if (ui.key('ArrowLeft')) this.mode = (this.mode + MODES.length - 1) % MODES.length;
    if (ui.key('Tab')) {
      const mine = this.b.units.filter((u) => u.alive && u.deployed && SIDE(u.team) === 0);
      if (mine.length) { this.focus = mine[(mine.indexOf(this.focus!) + 1) % mine.length]; this.center(); }
    }
    if (ui.key('Escape') || ui.key('y')) app.pop();
  }
}

const N4: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];

export const MODES: LabMode[] = [
  {
    name: 'Topographic',
    blurb: ['Like a survey map: each height band is one flat shade, lighter = higher, and every band edge is a ruled contour line. Double lines are cliffs (a drop of two or more, jump only).',
      'Reads the whole layout at a glance; contour lines also show where you will step up.'],
    draw(L, ui) {
      const m = L.b.map;
      L.paintFlat(ui, (x, y) => (m.terr[y * m.w + x] === 'building' || m.terr[y * m.w + x] === 'wall' ? { ch: '■', fg: '#c0c0b8', bg: '#2a2c30' } : topoCell(m, x, y)));
    },
  },
  {
    name: 'Relative to you',
    blurb: ['Heights are drawn relative to the focus \'Mech, so there are only three readings: HIGHER (warm, lit), LEVEL (neutral) and LOWER (cool, sunk). Hatching marks ground too high to walk up to (2+ levels: jump only).',
      'The question you usually ask, "is that above me?", is answered directly. Changes every time you select a different \'Mech, which may be disorienting.'],
    draw(L, ui) {
      const m = L.b.map, B = BIOME_INFO[m.biome];
      const f = L.focus, fe = f ? L.elev(f.x, f.y) : 1;
      L.paintFlat(ui, (x, y) => {
        const i = y * m.w + x, e = m.elev[i], t = m.terr[i], dh = e - fe;
        let bg = dh > 0 ? lerp('#7a5a2a', '#d0a050', (dh - 1) / 2) : dh === 0 ? '#3a4044' : lerp('#1a2a3a', '#0a1018', (-dh - 1) / 2);
        let ch = ' ', fg = lerp(bg, '#ffffff', 0.3);
        if (dh >= 2) { ch = (x + y) % 2 ? '╱' : ' '; fg = lerp(bg, '#000', 0.4); }
        else if (dh === 1) { ch = (x + y) % 4 === 0 ? '˄' : ' '; }
        else if (dh < 0) { ch = (x * 3 + y) % 5 === 0 ? '˅' : ' '; fg = lerp(bg, '#8ab4ff', 0.3); }
        // A lip wherever ground drops toward us
        if (N4.some(([dx, dy]) => L.inb(x + dx, y + dy) && L.elev(x + dx, y + dy) < e) && dh >= 0) bg = lerp(bg, '#ffffff', 0.12);
        if (t === 'water' || t === 'deep') { ch = '~'; fg = lerp(B.water[0], bg, 0.3); bg = lerp(bg, B.water[1], 0.5); }
        if (t === 'lforest' || t === 'hforest') { ch = '♣'; fg = lerp(B.forest[1], bg, 0.25); }
        if (t === 'rock') { ch = '▲'; fg = '#e0d8d0'; bg = scale(bg, 0.55); }
        if (t === 'building' || t === 'wall') { ch = '■'; fg = '#c0c0b8'; bg = '#2a2c30'; }
        if (t === 'chasm') { ch = ' '; bg = '#030304'; }
        return { ch, fg, bg };
      });
      ui.d.text(30, MY + VH + 1, ' HIGHER ', '#1a1208', '#c09040'); ui.d.text(39, MY + VH + 1, ' LEVEL ', C.text, '#3a4044'); ui.d.text(47, MY + VH + 1, ' LOWER ', '#8ab4ff', '#14202c'); ui.d.text(55, MY + VH + 1, ' ╱ jump only ', '#2a1a08', '#d0a050');
    },
  },
  {
    name: 'Oblique 3/4 view',
    blurb: ['Every tile is raised by its height and seen from slightly south, so plateaus become blocks with lit tops and dark south faces, crags are pillars and chasms are pits. Like an old isometric game, but on the same grid.',
      'Height reads instantly as shape. Cost: tall things hide what is just north of them, and tiles no longer sit on a clean grid, so clicking needs care.'],
    draw(L, ui) {
      const K = 0.6; // rows per level
      L.paint3d(ui, (x, y, z) => [x, y - z * K, 1], 1 / 16);
    },
  },
  {
    name: 'Perspective layers',
    blurb: ['Squidi\'s trick: each height level is the same map scaled a little about a vanishing point (the focus \'Mech), so higher ground leans out toward the edges of the screen as if seen from a camera hovering above you.',
      'Strong sense of depth, centred on whoever is selected; walls show on the side facing you. Distorts distances near the screen edges.'],
    draw(L, ui) {
      const f = L.focus;
      const vx = f ? f.x - L.camX + 0.5 : VW / 2, vy = f ? f.y - L.camY + 0.5 : VH / 2;
      L.paint3d(ui, perspective(vx, vy, 0.035), 0.1);
    },
  },
  {
    name: 'Grid-locked blocks',
    blurb: ['The oblique look without moving anything: each tile stays on its square, but wherever the ground steps down to the south, the lower part of the higher tile is drawn as a dark face. Crags become solid blocks with a lit top and a face; plateaus get a ledge you can see.',
      'Keeps clicking exact and nothing hides behind anything. Faces only show on south-facing drops, so north edges rely on the lighter top colour.'],
    draw(L, ui) { L.paintFlat(ui, (x, y) => blockCell(L.b.map, x, y)); },
  },
  {
    name: 'Relief shadows',
    blurb: ['A shaded-relief map: low sun from the north-west, every rise casts a shadow down-slope as long as its height. Flat colours otherwise.',
      'Instantly reads as landscape and keeps every tile flat and clickable. Shadows show which side of a ridge is high but not by how much.'],
    draw(L, ui) {
      const m = L.b.map, B = BIOME_INFO[m.biome];
      L.paintFlat(ui, (x, y) => {
        const i = y * m.w + x, t = m.terr[i], h = L.height(x, y);
        let bg = L.topColor(x, y);
        // Shadow: something to the NW higher than the sun line
        let shade = 0;
        for (let k = 1; k <= 4; k++) { const hh = L.height(x - k, y - k); if (hh - h > k * 0.75) { shade = Math.max(shade, Math.min(1, (hh - h - k * 0.75) + 0.5)); } }
        // Lit faces: higher than the tile to the south-east
        const lit = h - L.height(x + 1, y + 1) > 0.4;
        if (shade) bg = lerp(bg, '#05060a', 0.55 * shade);
        else if (lit) bg = lerp(bg, '#fff4d8', 0.18);
        const det = L.detail(x, y);
        let ch = det ? det[0] : ' ', fg = det ? lerp(det[1], bg, shade * 0.4) : bg;
        if (!det && t === 'plain' && (x * 7 + y * 13) % 6 === 0) { ch = '·'; fg = lerp(bg, '#ffffff', 0.2); }
        if (t === 'chasm') { bg = '#030304'; ch = ' '; }
        void B;
        return { ch, fg, bg };
      });
    },
  },
  {
    name: 'Night chart',
    blurb: ['After the dark tactical-map reference: near-black ground, terrain as sparse marks, and every height step drawn as a thin line, dashed where walkable, solid orange where it is a cliff.',
      'Very calm, and lines read cleanly over any overlay colour (move range, fire arcs). Needs the lines to carry everything, so tile height inside a region is not shown.'],
    draw(L, ui) {
      const m = L.b.map, B = BIOME_INFO[m.biome];
      L.paintFlat(ui, (x, y) => {
        const i = y * m.w + x, e = m.elev[i], t = m.terr[i];
        let bg = scale('#101416', 1 + e * 0.22);
        let ch = (x * 5 + y * 3) % 4 === 0 ? '\'' : ' ', fg = lerp(bg, scale(B.groundFg, 1.2), 0.35);
        const lowN = (dx: number, dy: number) => L.inb(x + dx, y + dy) && L.elev(x + dx, y + dy) < e;
        const dropBig = N4.some(([dx, dy]) => L.inb(x + dx, y + dy) && e - L.elev(x + dx, y + dy) >= 2);
        const n = lowN(0, -1), s = lowN(0, 1), w = lowN(-1, 0), ea = lowN(1, 0);
        if (n || s || w || ea) {
          ch = (n && w) || (s && ea) ? '╲' : (n && ea) || (s && w) ? '╱' : (n || s) ? (dropBig ? '━' : '╌') : (dropBig ? '┃' : '╎');
          fg = dropBig ? '#e08a3a' : lerp(scale(B.groundFg, 1.5), '#c0b0d0', 0.4);
        }
        if (t === 'water' || t === 'deep') { ch = '~'; fg = scale(B.water[0], 0.8); bg = scale(B.water[1], 0.5); }
        if (t === 'lforest' || t === 'hforest') { ch = '♠'; fg = t === 'hforest' ? '#3a8a5a' : '#2a6a48'; }
        if (t === 'rock') { ch = '▲'; fg = '#8a8a90'; bg = '#16181c'; }
        if (t === 'building' || t === 'wall') { ch = '□'; fg = '#a0a0a8'; }
        if (t === 'chasm') { ch = ' '; bg = '#000000'; }
        if (t === 'road') { ch = '='; fg = scale(B.road, 0.8); }
        void lum;
        return { ch, fg, bg };
      });
    },
  },
];
