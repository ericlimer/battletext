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

const MX = 0, MY = 1, VW = 50, VH = 36, PX = 100;
const VBLOCK = ' ▁▂▃▄▅▆▇█';

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
  /** Height of the tile's top surface in levels, counting what stands on it. */
  height(x: number, y: number): number {
    const m = this.b.map;
    if (!this.inb(x, y)) return 0;
    const i = y * m.w + x, e = m.elev[i];
    switch (m.terr[i]) {
      case 'rock': return e + 1.5;
      case 'building': return e + 1.25;
      case 'wall': return e + 0.75;
      case 'hforest': return e + 0.5;
      case 'lforest': return e + 0.25;
      case 'chasm': return e - 1.25;
      case 'water': return e - 0.12;
      case 'deep': return e - 0.25;
      default: return e;
    }
  }
  /** Flat map colour of a tile's top, by terrain, brightened with height. */
  topColor(x: number, y: number): string {
    const m = this.b.map, B = BIOME_INFO[m.biome];
    const i = y * m.w + x, e = m.elev[i];
    const lvl = [0.75, 1.05, 1.4, 1.8][e];
    switch (m.terr[i]) {
      case 'lforest': return scale(lerp(B.forest[0], B.ground[1], 0.5), 0.8 * lvl);
      case 'hforest': return scale(lerp(B.forest[0], '#000000', 0.25), 0.75 * lvl);
      case 'water': return scale(B.water[1], 1.5);
      case 'deep': return scale(B.water[1], 1.1);
      case 'rock': return scale(lerp(B.rock, '#808080', 0.3), 0.75 * lvl);
      case 'building': return '#6a6e74';
      case 'wall': return '#8a8a84';
      case 'chasm': return '#08080a';
      case 'road': return scale(B.road, 0.8 * lvl);
      case 'rubble': return '#4a4038';
      default: return scale(B.ground[1], 1.25 * lvl);
    }
  }
  detail(x: number, y: number): [string, string] | null {
    const m = this.b.map, B = BIOME_INFO[m.biome];
    switch (m.terr[y * m.w + x]) {
      case 'lforest': return ['♣', lerp(B.forest[1], '#000', 0.1)];
      case 'hforest': return ['♣', B.forest[1]];
      case 'water': case 'deep': return ['≈', scale(B.water[0], 0.9)];
      case 'rock': return ['▲', '#c8c0b8'];
      default: return null;
    }
  }
  unitAt(x: number, y: number): Unit | null {
    return this.b.units.find((u) => u.alive && u.deployed && !u.fled && u.x === x && u.y === y) ?? null;
  }
  unitColors(u: Unit): [string, string] {
    if (u === this.focus) return ['#05070a', '#f0d060'];
    return SIDE(u.team) === 0 ? ['#e8f6ff', '#1a5a8a'] : ['#fff0e8', '#8a2a1a'];
  }

  // ---- 3D painter: draws stacked slices into a sub-cell buffer, then folds each cell into two colours ----
  paint3d(ui: UI, project: (x: number, y: number, z: number) => [number, number, number], step: number): void {
    const d = ui.d, m = this.b.map;
    const W = VW * 2, H = VH * 8; // sub-pixels: 2 per tile across, 8 per row down
    const col = new Array<string>(W * H).fill('#05070a');
    const top = new Int32Array(W * H).fill(-1);
    // Draw a little beyond the view so things leaning in from outside still appear
    const pad = 6;
    const tiles: { x: number; y: number; h: number; c: string }[] = [];
    for (let y = this.camY - pad; y < this.camY + VH + pad; y++) for (let x = this.camX - pad; x < this.camX + VW + pad; x++) {
      if (!this.inb(x, y)) continue;
      tiles.push({ x, y, h: this.height(x, y), c: this.topColor(x, y) });
    }
    const floor = -1.5;
    const fill = (x: number, y: number, z: number, c: string, t: number) => {
      const [x0, y0, s] = project(x - this.camX, y - this.camY, z);
      const [x1, y1] = [x0 + s, y0 + s];
      const ax = Math.round(x0 * 2), bx = Math.round(x1 * 2), ay = Math.round(y0 * 8), by = Math.round(y1 * 8);
      // A top whose northern neighbour is lower catches the light along its back edge
      const lip = t >= 0 && this.height(x, y - 1) < z - 0.2 ? lerp(c, '#ffffff', 0.3) : c;
      for (let py = Math.max(0, ay); py < Math.min(H, by); py++) for (let px = Math.max(0, ax); px < Math.min(W, bx); px++) { col[py * W + px] = py === ay ? lip : c; top[py * W + px] = t; }
    };
    // Ascending height, north to south within a height, so nearer and taller things cover what is behind them
    for (let z = floor; z <= 3.01 + 1.5; z += step) {
      for (const t of tiles) {
        if (t.h < z - 1e-6) continue;
        const atTop = t.h - z < step - 1e-6;
        const zz = atTop ? t.h : z;
        if (atTop) fill(t.x, t.y, zz, t.c, t.y * m.w + t.x);
        else {
          // Side walls darken toward their foot
          const k = 0.35 + 0.35 * Math.max(0, Math.min(1, (z - floor) / (t.h - floor + 0.001)));
          fill(t.x, t.y, zz, scale(t.c, k), -1);
        }
      }
    }
    // Fold into cells
    for (let vy = 0; vy < VH; vy++) for (let cx = 0; cx < W; cx++) {
      const a = col[(vy * 8) * W + cx], bb = col[(vy * 8 + 7) * W + cx];
      let s = 8;
      for (let k = 0; k < 8; k++) if (col[(vy * 8 + k) * W + cx] !== a) { s = k; break; }
      // A cell mostly covered by one tile top shows that tile's detail glyph (trees, crags, water)
      const t0 = top[(vy * 8 + 4) * W + cx];
      let cover = 0;
      if (t0 >= 0) for (let k = 0; k < 8; k++) if (top[(vy * 8 + k) * W + cx] === t0) cover++;
      const det = cover >= 6 && cx % 2 === 0 ? this.detail(t0 % m.w, (t0 / m.w) | 0) : null;
      if (det) d.set(MX + cx, MY + vy, det[0], det[1], col[(vy * 8 + 4) * W + cx]);
      else if (s === 8) d.set(MX + cx, MY + vy, ' ', a, a);
      else d.set(MX + cx, MY + vy, VBLOCK[8 - s], bb, a);
    }
    // Units stand on their projected tile tops
    for (const u of this.b.units) {
      if (!u.alive || !u.deployed || u.fled) continue;
      const [px, py, s] = project(u.x - this.camX, u.y - this.camY, this.height(u.x, u.y));
      const cx = Math.round(px * 2 + s - 1), cy = Math.floor(py + s / 2);
      if (cx < 0 || cx > W - 2 || cy < 0 || cy >= VH) continue;
      const [fg, bg] = this.unitColors(u);
      d.wide(MX + cx, MY + cy, this.glyphOf(u), fg, bg);
    }
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
      const m = L.b.map, B = BIOME_INFO[m.biome];
      const band = (e: number) => lerp(scale(lerp(B.ground[1], '#4a5a6a', 0.3), [0.5, 0.9, 1.4, 2.0][e]), ['#102030', '#1a3020', '#3a3418', '#4a2a18'][e], 0.25);
      L.paintFlat(ui, (x, y) => {
        const i = y * m.w + x, e = m.elev[i], t = m.terr[i];
        let bg = band(e);
        const isC = (xx: number, yy: number) => L.inb(xx, yy) && N4.some(([dx, dy]) => L.inb(xx + dx, yy + dy) && L.elev(xx + dx, yy + dy) < L.elev(xx, yy));
        const cliff = N4.some(([dx, dy]) => L.inb(x + dx, y + dy) && e - L.elev(x + dx, y + dy) >= 2);
        let ch = (x % 2 === 0 && y % 2 === 0) ? '·' : ' ', fg = lerp(bg, '#ffffff', 0.25);
        if (isC(x, y)) {
          const same = (dx: number, dy: number) => isC(x + dx, y + dy) && L.elev(x + dx, y + dy) === e;
          const key = `${same(0, -1) ? 1 : 0}${same(0, 1) ? 1 : 0}${same(-1, 0) ? 1 : 0}${same(1, 0) ? 1 : 0}`;
          const S: Record<string, string> = { '0000': ' ', '1100': '│', '0011': '─', '0101': '┌', '0110': '┐', '1001': '└', '1010': '┘', '1101': '├', '1110': '┤', '0111': '┬', '1011': '┴', '1111': '┼', '1000': '│', '0100': '│', '0010': '─', '0001': '─' };
          const D: Record<string, string> = { '0000': '■', '1100': '║', '0011': '═', '0101': '╔', '0110': '╗', '1001': '╚', '1010': '╝', '1101': '╠', '1110': '╣', '0111': '╦', '1011': '╩', '1111': '╬', '1000': '║', '0100': '║', '0010': '═', '0001': '═' };
          ch = (cliff ? D : S)[key]; fg = cliff ? '#ffc060' : scale(bg, 0.35);
        }
        if (t === 'water' || t === 'deep') { bg = scale(B.water[1], 1.4); ch = '~'; fg = B.water[0]; }
        if (t === 'lforest' || t === 'hforest') { fg = B.forest[1]; if (!isC(x, y)) ch = t === 'hforest' ? '♣' : '♧'; }
        if (t === 'rock') { ch = '▲'; fg = '#d0c8c0'; bg = scale(bg, 0.6); }
        if (t === 'building' || t === 'wall') { ch = '■'; fg = '#c0c0b8'; bg = '#2a2c30'; }
        if (t === 'chasm') { ch = ' '; bg = '#050507'; }
        if (t === 'road') fg = B.road;
        return { ch, fg, bg };
      });
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
      const s = 0.035;
      L.paint3d(ui, (x, y, z) => { const k = 1 / (1 - Math.max(-1.5, z) * s); return [vx + (x - vx) * k, vy + (y - vy) * k, k]; }, 0.1);
    },
  },
  {
    name: 'Grid-locked blocks',
    blurb: ['The oblique look without moving anything: each tile stays on its square, but wherever the ground steps down to the south, the lower part of the higher tile is drawn as a dark face. Crags become solid blocks with a lit top and a face; plateaus get a ledge you can see.',
      'Keeps clicking exact and nothing hides behind anything. Faces only show on south-facing drops, so north edges rely on the lighter top colour.'],
    draw(L, ui) {
      const d = ui.d, m = L.b.map;
      for (let vy = 0; vy < VH; vy++) for (let vx = 0; vx < VW; vx++) {
        const x = vx + L.camX, y = vy + L.camY;
        if (!L.inb(x, y)) { d.wide(MX + vx * 2, MY + vy, ' ', '#000', '#000'); continue; }
        const u = L.unitAt(x, y);
        if (u) { const [fg, bg] = L.unitColors(u); d.wide(MX + vx * 2, MY + vy, L.glyphOf(u), fg, bg); continue; }
        const h = L.height(x, y), hs = L.inb(x, y + 1) ? L.height(x, y + 1) : h;
        let top = L.topColor(x, y);
        // The back edge catches the light when the ground behind is lower
        if (L.inb(x, y - 1) && L.height(x, y - 1) < h - 0.2) top = lerp(top, '#ffffff', 0.12);
        const drop = h - hs;
        if (drop > 0.2) {
          const face = scale(top, 0.38);
          const eighths = Math.max(2, Math.min(6, Math.round(drop * 2.5)));
          d.wide(MX + vx * 2, MY + vy, VBLOCK[eighths], face, top);
        } else {
          const det = L.detail(x, y);
          const t = m.terr[y * m.w + x];
          d.wide(MX + vx * 2, MY + vy, det ? det[0] : t === 'plain' && (x * 7 + y * 13) % 5 === 0 ? '·' : ' ', det ? det[1] : lerp(top, '#ffffff', 0.2), top);
        }
      }
    },
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
