// Height renderings shared by the combat map and the terrain lab: tile heights with what stands on them,
// flat map colours, grid-locked block faces, topographic contours and the layered 3D painter.
import type { Display } from '../engine/display';
import { lerp, scale } from '../engine/color';
import { BIOME_INFO, BattleMap } from './terrain';

export const VBLOCK = ' ▁▂▃▄▅▆▇█';
const N4: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];

const inb = (m: BattleMap, x: number, y: number) => x >= 0 && y >= 0 && x < m.w && y < m.h;
export const elevAt = (m: BattleMap, x: number, y: number) => (inb(m, x, y) ? m.elev[y * m.w + x] : 0);

/** Height of the tile's top surface in levels, counting what stands on it. */
export function heightAt(m: BattleMap, x: number, y: number, terr = m.terr[y * m.w + x]): number {
  if (!inb(m, x, y)) return 0;
  const e = m.elev[y * m.w + x];
  switch (terr) {
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
export function topColor(m: BattleMap, x: number, y: number): string {
  const B = BIOME_INFO[m.biome];
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

/** Glyph standing on a tile top, if any. */
export function detailAt(m: BattleMap, x: number, y: number): [string, string] | null {
  const B = BIOME_INFO[m.biome];
  switch (m.terr[y * m.w + x]) {
    case 'lforest': return ['♣', lerp(B.forest[1], '#000', 0.1)];
    case 'hforest': return ['♣', B.forest[1]];
    case 'water': case 'deep': return ['≈', scale(B.water[0], 0.9)];
    case 'rock': return (x + y) % 2 === 0 ? ['▲', lerp(topColor(m, x, y), '#ffffff', 0.32)] : null; // sparse, so a crag reads as one mass
    case 'rubble': return ['%', '#7a6e5e'];
    default: return null;
  }
}

/** Grid-locked blocks: the tile stays on its square; a drop to the south shows as a dark face on its lower part. */
export function blockCell(m: BattleMap, x: number, y: number): { ch: string; fg: string; bg: string } {
  const h = heightAt(m, x, y), hs = inb(m, x, y + 1) ? heightAt(m, x, y + 1) : h;
  let top = topColor(m, x, y);
  // The back edge catches the light when the ground behind is lower
  if (inb(m, x, y - 1) && heightAt(m, x, y - 1) < h - 0.2) top = lerp(top, '#ffffff', 0.12);
  const drop = h - hs;
  if (drop > 0.2) return { ch: VBLOCK[Math.max(2, Math.min(6, Math.round(drop * 2.5)))], fg: scale(top, 0.38), bg: top };
  const det = detailAt(m, x, y);
  const plainDot = m.terr[y * m.w + x] === 'plain' && (x * 7 + y * 13) % 5 === 0;
  return { ch: det ? det[0] : plainDot ? '·' : ' ', fg: det ? det[1] : lerp(top, '#ffffff', 0.2), bg: top };
}

const BOX_S: Record<string, string> = { '0000': ' ', '1100': '│', '0011': '─', '0101': '┌', '0110': '┐', '1001': '└', '1010': '┘', '1101': '├', '1110': '┤', '0111': '┬', '1011': '┴', '1111': '┼', '1000': '│', '0100': '│', '0010': '─', '0001': '─' };
const BOX_D: Record<string, string> = { '0000': '■', '1100': '║', '0011': '═', '0101': '╔', '0110': '╗', '1001': '╚', '1010': '╝', '1101': '╠', '1110': '╣', '0111': '╦', '1011': '╩', '1111': '╬', '1000': '║', '0100': '║', '0010': '═', '0001': '═' };

/** Topographic: one flat shade per height band (lighter = higher) and ruled contour lines on band edges; cliffs doubled. */
export function topoCell(m: BattleMap, x: number, y: number): { ch: string; fg: string; bg: string } {
  const B = BIOME_INFO[m.biome];
  const i = y * m.w + x, e = m.elev[i], t = m.terr[i];
  const band = (k: number) => lerp(scale(lerp(B.ground[1], '#4a5a6a', 0.3), [0.5, 0.9, 1.4, 2.0][k]), ['#102030', '#1a3020', '#3a3418', '#4a2a18'][k], 0.25);
  let bg = band(e);
  const isC = (xx: number, yy: number) => inb(m, xx, yy) && N4.some(([dx, dy]) => inb(m, xx + dx, yy + dy) && elevAt(m, xx + dx, yy + dy) < elevAt(m, xx, yy));
  const contour = isC(x, y);
  const cliff = N4.some(([dx, dy]) => inb(m, x + dx, y + dy) && e - elevAt(m, x + dx, y + dy) >= 2);
  let ch = x % 2 === 0 && y % 2 === 0 ? '·' : ' ', fg = lerp(bg, '#ffffff', 0.25);
  if (contour) {
    const same = (dx: number, dy: number) => isC(x + dx, y + dy) && elevAt(m, x + dx, y + dy) === e;
    const key = `${same(0, -1) ? 1 : 0}${same(0, 1) ? 1 : 0}${same(-1, 0) ? 1 : 0}${same(1, 0) ? 1 : 0}`;
    ch = (cliff ? BOX_D : BOX_S)[key]; fg = cliff ? '#ffc060' : scale(bg, 0.35);
  }
  if (t === 'water' || t === 'deep') { bg = scale(B.water[1], 1.4); ch = '~'; fg = B.water[0]; }
  if (t === 'lforest' || t === 'hforest') { fg = B.forest[1]; if (!contour) ch = t === 'hforest' ? '♣' : '♧'; }
  if (t === 'rock') { ch = '▲'; fg = '#d0c8c0'; bg = scale(bg, 0.6); }
  if (t === 'chasm') { ch = ' '; bg = '#050507'; }
  if (t === 'rubble') { ch = '%'; fg = '#7a6e5e'; }
  if (t === 'road') fg = B.road;
  return { ch, fg, bg };
}

export interface View3D { mx: number; my: number; vw: number; vh: number; camX: number; camY: number }
export interface Billboard { x: number; y: number; glyph: string; fg: string; bg: string }
export type Project = (x: number, y: number, z: number) => [number, number, number];

/** Layered 3D painter: stacks height slices into a sub-cell buffer (2 across, 8 down per tile), then folds each
 *  cell into two colours with block glyphs. `project` maps view-relative tile coords and height to screen tiles. */
export function paint3d(d: Display, m: BattleMap, v: View3D, project: Project, step: number, units: Billboard[], shade?: (x: number, y: number, c: string) => string): void {
  const W = v.vw * 2, H = v.vh * 8;
  const col = new Array<string>(W * H).fill('#05070a');
  const top = new Int32Array(W * H).fill(-1);
  const pad = 6;
  const tiles: { x: number; y: number; h: number; c: string }[] = [];
  for (let y = v.camY - pad; y < v.camY + v.vh + pad; y++) for (let x = v.camX - pad; x < v.camX + v.vw + pad; x++) {
    if (!inb(m, x, y)) continue;
    const c = topColor(m, x, y);
    tiles.push({ x, y, h: heightAt(m, x, y), c: shade ? shade(x, y, c) : c });
  }
  const floor = -1.5;
  const fill = (x: number, y: number, z: number, c: string, t: number) => {
    const [x0, y0, s] = project(x - v.camX, y - v.camY, z);
    const ax = Math.round(x0 * 2), bx = Math.round((x0 + s) * 2), ay = Math.round(y0 * 8), by = Math.round((y0 + s) * 8);
    // A top whose northern neighbour is lower catches the light along its back edge
    const lip = t >= 0 && heightAt(m, x, y - 1) < z - 0.2 ? lerp(c, '#ffffff', 0.3) : c;
    for (let py = Math.max(0, ay); py < Math.min(H, by); py++) for (let px = Math.max(0, ax); px < Math.min(W, bx); px++) { col[py * W + px] = py === ay ? lip : c; top[py * W + px] = t; }
  };
  // Ascending height, north to south within a height, so nearer and taller things cover what is behind them
  for (let z = floor; z <= 4.51; z += step) {
    for (const t of tiles) {
      if (t.h < z - 1e-6) continue;
      if (t.h - z < step - 1e-6) fill(t.x, t.y, t.h, t.c, t.y * m.w + t.x);
      else fill(t.x, t.y, z, scale(t.c, 0.35 + 0.35 * Math.max(0, Math.min(1, (z - floor) / (t.h - floor + 0.001)))), -1);
    }
  }
  for (let vy = 0; vy < v.vh; vy++) for (let cx = 0; cx < W; cx++) {
    const a = col[(vy * 8) * W + cx], bb = col[(vy * 8 + 7) * W + cx];
    let s = 8;
    for (let k = 0; k < 8; k++) if (col[(vy * 8 + k) * W + cx] !== a) { s = k; break; }
    // A cell mostly covered by one tile top shows that tile's detail glyph
    const t0 = top[(vy * 8 + 4) * W + cx];
    let cover = 0;
    if (t0 >= 0) for (let k = 0; k < 8; k++) if (top[(vy * 8 + k) * W + cx] === t0) cover++;
    const det = cover >= 6 && cx % 2 === 0 ? detailAt(m, t0 % m.w, (t0 / m.w) | 0) : null;
    if (det) d.set(v.mx + cx, v.my + vy, det[0], det[1], col[(vy * 8 + 4) * W + cx]);
    else if (s === 8) d.set(v.mx + cx, v.my + vy, ' ', a, a);
    else d.set(v.mx + cx, v.my + vy, VBLOCK[8 - s], bb, a);
  }
  // Units stand on their projected tile tops
  for (const u of units) {
    const [px, py, s] = project(u.x - v.camX, u.y - v.camY, heightAt(m, u.x, u.y));
    const cx = Math.round(px * 2 + s - 1), cy = Math.floor(py + s / 2);
    if (cx < 0 || cx > W - 2 || cy < 0 || cy >= v.vh) continue;
    d.wide(v.mx + cx, v.my + cy, u.glyph, u.fg, u.bg);
  }
}

/** Perspective about a vanishing point (vx, vy in view tiles): each level scales out by `s`. */
export const perspective = (vx: number, vy: number, s: number): Project => (x, y, z) => {
  const k = 1 / (1 - Math.max(-1.5, z) * s);
  return [vx + (x - vx) * k, vy + (y - vy) * k, k];
};
