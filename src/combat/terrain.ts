// Battlefield generation, terrain rules, line of sight.

import { RNG, Noise } from '../engine/rng';

export type Terrain = 'plain' | 'rough' | 'lforest' | 'hforest' | 'water' | 'deep' | 'rock' | 'road' | 'building' | 'rubble' | 'wall' | 'chasm';

export interface TerrainInfo {
  name: string;
  cost: number; // movement cost (Infinity = impassable)
  cover: number; // incoming ranged damage reduction for a unit standing here
  obstruct: number; // to-hit penalty for LOS passing through
  blocks: boolean; // blocks LOS
  height: number; // added obstruction height for LOS
  cool: number; // extra dissipation when standing here
  desc: string;
}

export const TERRAIN: Record<Terrain, TerrainInfo> = {
  plain: { name: 'Open Ground', cost: 1, cover: 0, obstruct: 0, blocks: false, height: 0, cool: 0, desc: 'No cover.' },
  rough: { name: 'Rough Ground', cost: 1.3, cover: 0, obstruct: 0, blocks: false, height: 0, cool: 0, desc: 'Broken ground. Slows movement.' },
  lforest: { name: 'Light Forest', cost: 1.3, cover: 0.2, obstruct: 3, blocks: false, height: 0, cool: 0, desc: 'Cover: -20% ranged damage taken.' },
  hforest: { name: 'Heavy Forest', cost: 1.8, cover: 0.35, obstruct: 7, blocks: false, height: 0, cool: 0, desc: 'Cover: -35% ranged damage taken. Obstructs fire passing through.' },
  water: { name: 'Shallow Water', cost: 1.6, cover: 0, obstruct: 0, blocks: false, height: 0, cool: 15, desc: '+15 heat dissipation. Slows movement.' },
  deep: { name: 'Deep Water', cost: 2.5, cover: 0.1, obstruct: 0, blocks: false, height: 0, cool: 30, desc: '+30 heat dissipation. Very slow. Partial cover.' },
  rock: { name: 'Crags', cost: Infinity, cover: 0, obstruct: 0, blocks: true, height: 1.6, cool: 0, desc: 'Impassable rock formations. Blocks line of sight.' },
  road: { name: 'Road', cost: 0.75, cover: 0, obstruct: 0, blocks: false, height: 0, cool: 0, desc: 'Paved. Faster movement.' },
  building: { name: 'Structure', cost: Infinity, cover: 0, obstruct: 0, blocks: true, height: 2, cool: 0, desc: 'Blocks movement and line of sight. Destructible.' },
  wall: { name: 'Wall', cost: Infinity, cover: 0, obstruct: 0, blocks: true, height: 1, cool: 0, desc: 'Fortified wall. Destructible.' },
  rubble: { name: 'Rubble', cost: 1.5, cover: 0.1, obstruct: 0, blocks: false, height: 0, cool: 0, desc: 'Wreckage. Slow going; slight cover.' },
  chasm: { name: 'Chasm', cost: Infinity, cover: 0, obstruct: 0, blocks: false, height: 0, cool: 0, desc: 'A sheer drop. Impassable on foot, but open to fire and jump jets can clear it.' },
};

/** Battlefield layouts: the classic open field, or one of the broken, close-quarters archetypes. */
export type MapStyle = 'open' | 'canyons' | 'ridges' | 'mesas' | 'craters' | 'crevasses' | 'ruins';
export const MAP_STYLES: MapStyle[] = ['open', 'canyons', 'ridges', 'mesas', 'craters', 'crevasses', 'ruins'];
export const MAP_STYLE_INFO: Record<MapStyle, { name: string; short: string; desc: string; hint: string }> = {
  open: { name: 'Open Ground', short: 'Open', desc: 'Rolling country with scattered cover.', hint: 'long sight lines; use woods and hills for cover.' },
  canyons: { name: 'Canyon Network', short: 'Canyons', desc: 'Winding gorges between sheer rock walls; plateaus above them for whoever can jump.', hint: 'narrow gorges and choke points; jump jets cut corners and reach the high plateaus.' },
  ridges: { name: 'Ridgelines', short: 'Ridges', desc: 'Rock ridges cut across the area, crossed by a few narrow passes.', hint: 'ridges block fire and movement; fight for the passes or jump over.' },
  mesas: { name: 'Mesa Field', short: 'Mesas', desc: 'Buttes and flat-topped mesas; most tops are reached by a single ramp, or by jump jets.', hint: 'mesa tops give high ground over the flats; find the ramp or jump up.' },
  craters: { name: 'Crater Field', short: 'Craters', desc: 'Walled impact craters breached in a few places, cut by rilles.', hint: 'crater rims are cover and high ground; breaches are choke points.' },
  crevasses: { name: 'Crevasse Field', short: 'Crevasses', desc: 'Open cracks that only jump jets can clear, crossed by a few bridges.', hint: 'cracks cannot be walked; bridges are choke points, jump jets go anywhere.' },
  ruins: { name: 'Ruined Town', short: 'Ruins', desc: 'Gutted blocks and rubble-choked streets. Buildings can be blasted open.', hint: 'short sight lines and close fights; blast walls open for a shortcut.' },
};
/** How often each dense archetype turns up on a world (the classic open map takes the rest). */
const STYLE_WEIGHTS: Record<Biome, Partial<Record<MapStyle, number>>> = {
  lowlands: { ridges: 1, ruins: 1.2, mesas: 0.3 },
  highlands: { ridges: 1.5, canyons: 0.7, mesas: 0.5 },
  desert: { mesas: 1, canyons: 0.8, ruins: 0.7, ridges: 0.3 },
  badlands: { canyons: 1.4, mesas: 1.1 },
  lunar: { craters: 1.4, crevasses: 0.6, mesas: 0.4 },
  martian: { craters: 0.9, canyons: 1, mesas: 0.6 },
  polar: { crevasses: 1.4, ridges: 0.8 },
  tundra: { ridges: 1, crevasses: 0.6, ruins: 0.5 },
};
const OPEN_SHARE = 0.45;

let styleOverride: MapStyle | null = null;
/** Forces every generated map to one archetype (tests, debug); null restores random picks. */
export function setMapStyleOverride(s: MapStyle | null): void { styleOverride = s; }

function pickStyle(r: RNG, o: MapGenOpts): MapStyle {
  if (o.style) return o.style;
  if (styleOverride) return styleOverride;
  if (o.features === false) return 'open';
  try {
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('map') : null;
    if (q && (MAP_STYLES as string[]).includes(q)) return q as MapStyle;
  } catch { /* no URL */ }
  // A side stream so the classic map draws the same numbers it always did
  const g = new RNG((r.state ^ 0x5bd1e995) >>> 0);
  if (g.next() < OPEN_SHARE) return 'open';
  const W = STYLE_WEIGHTS[o.biome];
  return g.weighted(Object.keys(W) as MapStyle[], (k) => W[k] ?? 0);
}

export type Biome = 'lowlands' | 'highlands' | 'desert' | 'badlands' | 'lunar' | 'martian' | 'polar' | 'tundra';
export const BIOMES: Biome[] = ['lowlands', 'highlands', 'desert', 'badlands', 'lunar', 'martian', 'polar', 'tundra'];

export interface BiomeInfo {
  name: string;
  heatMult: number; // dissipation multiplier
  desc: string;
  ground: string[]; // bg colors by elevation
  groundFg: string;
  groundGlyphs: string[];
  forest: [string, string];
  forestBg: string;
  water: [string, string];
  rock: string;
  road: string;
  forestDensity: number;
  waterLevel: number; // 0..1 fraction for water threshold
  rockDensity: number;
  roughDensity: number;
  relief: number;
  treeGlyphs: [string, string];
}

export const BIOME_INFO: Record<Biome, BiomeInfo> = {
  lowlands: { name: 'Lowlands', heatMult: 1.0, desc: 'Temperate river plains. Normal heat dissipation.',
    ground: ['#0d1a10', '#132416', '#1a2f1c', '#223a22'], groundFg: '#3f6a3a', groundGlyphs: ['.', '.', '.', ',', '.', '\''],
    forest: ['#5fb04a', '#2f8a3a'], forestBg: '#0b1f0e', water: ['#3a7ad0', '#0a1f3a'], rock: '#8a9088', road: '#8a7a5a',
    forestDensity: 0.55, waterLevel: 0.2, rockDensity: 0.04, roughDensity: 0.1, relief: 0.8, treeGlyphs: ['♣', '♠'] },
  highlands: { name: 'Highlands', heatMult: 1.05, desc: 'Rolling hills and pine forests. Slightly improved cooling.',
    ground: ['#101812', '#172218', '#202d1f', '#2b3a28'], groundFg: '#4d6a44', groundGlyphs: ['.', '.', '\'', '.'],
    forest: ['#4a9a5a', '#246a3a'], forestBg: '#0a1a10', water: ['#4a8ad8', '#0c2038'], rock: '#9a9a90', road: '#8a7a5a',
    forestDensity: 0.5, waterLevel: 0.1, rockDensity: 0.07, roughDensity: 0.12, relief: 1.3, treeGlyphs: ['♠', '♠'] },
  desert: { name: 'Desert', heatMult: 0.8, desc: 'Scorching dunes. -20% heat dissipation.',
    ground: ['#2a1f10', '#33260f', '#3d2e13', '#4a3818'], groundFg: '#8a6a3a', groundGlyphs: ['.', '.', '~', '.'],
    forest: ['#8aa04a', '#5a7a2a'], forestBg: '#2a2410', water: ['#4a9ad0', '#123040'], rock: '#b08a5a', road: '#a8905a',
    forestDensity: 0.08, waterLevel: 0.02, rockDensity: 0.07, roughDensity: 0.16, relief: 0.9, treeGlyphs: ['¥', '♣'] },
  badlands: { name: 'Badlands', heatMult: 0.85, desc: 'Parched mesas and canyons. -15% heat dissipation.',
    ground: ['#241410', '#2e1a13', '#3a2116', '#48291b'], groundFg: '#8a4a32', groundGlyphs: ['.', '.', '.', ','],
    forest: ['#9a8a4a', '#6a6a2a'], forestBg: '#241a10', water: ['#4a8ac0', '#102838'], rock: '#b0684a', road: '#9a7a5a',
    forestDensity: 0.12, waterLevel: 0.03, rockDensity: 0.12, roughDensity: 0.2, relief: 1.6, treeGlyphs: ['♣', '♣'] },
  lunar: { name: 'Lunar', heatMult: 0.75, desc: 'Airless moon. No convection: -25% heat dissipation.',
    ground: ['#1a1c20', '#23262b', '#2d3036', '#393c43'], groundFg: '#6a6e78', groundGlyphs: ['.', '.', '.', '.'],
    forest: ['#7a8a9a', '#4a5a6a'], forestBg: '#101318', water: ['#6a7a9a', '#141820'], rock: '#9aa0aa', road: '#6a6e78',
    forestDensity: 0.0, waterLevel: 0.0, rockDensity: 0.08, roughDensity: 0.16, relief: 1.1, treeGlyphs: ['¤', '¤'] },
  martian: { name: 'Martian', heatMult: 0.9, desc: 'Thin, dusty atmosphere. -10% heat dissipation.',
    ground: ['#36180f', '#422013', '#4e2617', '#5e2e1b'], groundFg: '#a04a2a', groundGlyphs: ['.', '.', '.', '°'],
    forest: ['#b06a3a', '#804a2a'], forestBg: '#2a120c', water: ['#8a6a6a', '#2a1616'], rock: '#c0704a', road: '#a0684a',
    forestDensity: 0.0, waterLevel: 0.0, rockDensity: 0.1, roughDensity: 0.22, relief: 1.3, treeGlyphs: ['¤', '¤'] },
  polar: { name: 'Polar', heatMult: 1.3, desc: 'Frozen wastes. +30% heat dissipation.',
    ground: ['#1a2230', '#222c3a', '#2c3848', '#384658'], groundFg: '#7a8aa8', groundGlyphs: ['.', '.', '·', '.'],
    forest: ['#8ab0b0', '#5a8a8a'], forestBg: '#16202a', water: ['#8ac8f0', '#1a3450'], rock: '#c8d8e8', road: '#7a8290',
    forestDensity: 0.18, waterLevel: 0.14, rockDensity: 0.06, roughDensity: 0.12, relief: 1.0, treeGlyphs: ['♠', '♠'] },
  tundra: { name: 'Tundra', heatMult: 1.15, desc: 'Cold scrubland. +15% heat dissipation.',
    ground: ['#161a16', '#1c221c', '#242b23', '#2e362c'], groundFg: '#5a6a58', groundGlyphs: ['.', '.', ',', '"'],
    forest: ['#6a9a6a', '#3a6a4a'], forestBg: '#101a12', water: ['#5a8ac0', '#0e2032'], rock: '#8a9290', road: '#7a7462',
    forestDensity: 0.3, waterLevel: 0.12, rockDensity: 0.06, roughDensity: 0.2, relief: 0.9, treeGlyphs: ['♣', '♠'] },
};

export interface Structure {
  id: number;
  hp: number;
  maxHp: number;
  tiles: number[];
  objective: boolean;
  name: string;
  team: number; // owner (for defend/destroy)
  destroyed: boolean;
}

export interface BattleMap {
  w: number;
  h: number;
  biome: Biome;
  night: boolean;
  terr: Terrain[];
  elev: Uint8Array;
  shade: Float32Array; // per-tile visual variation
  glyph: string[];
  struct: Int16Array; // structure id per tile, -1 none
  structures: Structure[];
  wrecks: Map<number, string>; // tile -> wreck glyph
  scorch: Float32Array;
  hill: Float32Array; // hillshade -1..1 (light from the north-west)
  beacons?: { x: number; y: number; owner: number }[]; // Target Acquisition objectives
  extract?: { x: number; y: number; r: number }; // extraction zone once a mission's objective is met
  style?: MapStyle; // layout archetype the map was generated with
}

export function idx(m: BattleMap, x: number, y: number): number { return y * m.w + x; }
export function inb(m: BattleMap, x: number, y: number): boolean { return x >= 0 && y >= 0 && x < m.w && y < m.h; }
export function terrAt(m: BattleMap, x: number, y: number): TerrainInfo { return TERRAIN[m.terr[y * m.w + x]]; }

export interface MapGenOpts {
  w: number;
  h: number;
  biome: Biome;
  night?: boolean;
  road?: 'h' | 'v' | null;
  base?: { x: number; y: number; w: number; h: number; buildings: number; walls: boolean; team: number; objectiveCount: number } | null;
  clear?: { x: number; y: number; r: number }[];
  /** Mesas, stray buildings and wreckage that break up open ground (default on). */
  features?: boolean;
  /** Force a layout archetype (default: picked at random by biome; `?map=<style>` in the URL also forces it). */
  style?: MapStyle;
}

export function generateMap(r: RNG, o: MapGenOpts): BattleMap {
  const { w, h, biome } = o;
  const B = BIOME_INFO[biome];
  const n = w * h;
  const m: BattleMap = {
    w, h, biome, night: !!o.night,
    terr: new Array(n).fill('plain'),
    elev: new Uint8Array(n),
    shade: new Float32Array(n),
    glyph: new Array(n).fill('.'),
    struct: new Int16Array(n).fill(-1),
    structures: [],
    wrecks: new Map(),
    scorch: new Float32Array(n),
    hill: new Float32Array(n),
  };
  const style = pickStyle(r, o);
  m.style = style;
  const dense = style !== 'open';
  const nElev = new Noise(r), nForest = new Noise(r), nMisc = new Noise(r), nShade = new Noise(r);
  const sc = 0.06;
  // Elevation: 0..3
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    let e = nElev.fbm(x * sc * 0.9, y * sc * 0.9, 4);
    e = (e - 0.5) * B.relief + 0.5;
    // Badlands: terraced mesas
    if (biome === 'badlands') e = Math.pow(e, 1.3) + 0.08;
    const lvl = e < 0.36 ? 0 : e < 0.52 ? 1 : e < 0.66 ? 2 : 3;
    m.elev[i] = lvl;
    m.shade[i] = nShade.value(x * 0.35, y * 0.35);
    // Water in low basins
    if (B.waterLevel > 0 && e < 0.12 + B.waterLevel * 0.9) {
      m.terr[i] = e < 0.08 + B.waterLevel * 0.45 ? 'deep' : 'water';
      m.elev[i] = 0;
    }
  }
  // Forests, rough, rocks
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (m.terr[i] !== 'plain') continue;
    const f = nForest.fbm(x * 0.09, y * 0.09, 3);
    const mi = nMisc.fbm(x * 0.2, y * 0.2, 2);
    const fr = 1 - B.forestDensity * 0.55;
    if (B.forestDensity > 0 && f > fr) m.terr[i] = f > fr + 0.1 ? 'hforest' : 'lforest';
    else if (mi > 1 - B.rockDensity * 1.6 && r.chance(0.7)) m.terr[i] = 'rock';
    else if (mi < B.roughDensity * 1.4) m.terr[i] = 'rough';
  }
  // Scatter single trees
  if (B.forestDensity > 0) for (let k = 0; k < n * B.forestDensity * 0.03; k++) {
    const i = r.int(0, n - 1);
    if (m.terr[i] === 'plain') m.terr[i] = 'lforest';
  }
  // Remove isolated elevation spikes of 2+ between neighbours to keep terrain walkable-ish
  smoothElevation(m);
  // Airless and dusty worlds are pocked with impact craters: a rough rim around a sunken bowl
  if (biome === 'lunar' || biome === 'martian') {
    const nC = r.int(4, 8);
    for (let k = 0; k < nC; k++) {
      const cx = r.int(6, w - 7), cy = r.int(4, h - 5), rad = r.range(2, 4.5);
      for (let y = Math.floor(cy - rad - 1); y <= cy + rad + 1; y++) for (let x = Math.floor(cx - rad - 1); x <= cx + rad + 1; x++) {
        if (!inb(m, x, y)) continue;
        const i = y * w + x;
        const d = Math.hypot(x - cx, y - cy);
        if (m.terr[i] === 'rock') continue;
        if (Math.abs(d - rad) < 0.7) { m.terr[i] = 'rough'; (m as any).rim = (m as any).rim ?? new Set<number>(); (m as any).rim.add(i); }
        else if (d < rad - 0.7) { m.terr[i] = 'plain'; m.elev[i] = Math.max(0, m.elev[Math.round(cy) * w + Math.round(cx)] - 1); }
      }
    }
  }
  if (dense) {
    // Close country: the road goes in first so the rock is laid around it
    if (o.road) carveRoad(m, r, o.road);
    buildDense(m, new RNG(r.seed()), o, style);
  } else {
    // Hard cover: mesas, stray buildings, a downed DropShip
    if (o.features !== false) addFeatures(m, r, o);
    // Roads
    if (o.road) carveRoad(m, r, o.road);
  }
  // Base compound
  if (o.base) buildBase(m, r, o.base);
  // Clear deployment zones
  for (const c of o.clear ?? []) {
    for (let y = c.y - c.r; y <= c.y + c.r; y++) for (let x = c.x - c.r; x <= c.x + c.r; x++) {
      if (!inb(m, x, y)) continue;
      const i = y * w + x;
      if (m.struct[i] >= 0) continue;
      if (m.terr[i] === 'rock' || m.terr[i] === 'deep' || m.terr[i] === 'chasm') m.terr[i] = 'rough';
    }
  }
  if (o.road) smoothRoad(m);
  // Every walkable tile must be reachable on foot from the deployment zones by a 'Mech without jump jets
  ensureConnected(m, o);
  // Glyph selection
  for (let i = 0; i < n; i++) {
    const t = m.terr[i];
    const s = m.shade[i];
    switch (t) {
      case 'plain': m.glyph[i] = B.groundGlyphs[Math.floor(s * 997) % B.groundGlyphs.length]; break;
      case 'rough': m.glyph[i] = (m as any).rim?.has(i) ? '◦' : biome === 'lunar' ? '∙' : ['∙', ',', '∴', '\'', '∙'][Math.floor(s * 4999) % 5]; break;
      case 'lforest': m.glyph[i] = B.treeGlyphs[0]; break;
      case 'hforest': m.glyph[i] = B.treeGlyphs[1]; break;
      case 'water': m.glyph[i] = '~'; break;
      case 'deep': m.glyph[i] = '≈'; break;
      case 'rock': m.glyph[i] = s > 0.55 ? '▲' : '^'; break;
      case 'road': m.glyph[i] = '·'; break;
      case 'building': m.glyph[i] = '▓'; break;
      case 'wall': m.glyph[i] = '#'; break;
      case 'rubble': m.glyph[i] = '%'; break;
      case 'chasm': m.glyph[i] = ' '; break;
    }
  }
  computeHillshade(m);
  return m;
}

export function computeHillshade(m: BattleMap): void {
  const { w, h } = m;
  const sm = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, c = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (!inb(m, xx, yy)) continue;
      s += m.elev[yy * w + xx]; c++;
    }
    sm[y * w + x] = s / c;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = sm[Math.max(0, y - 1) * w + Math.max(0, x - 1)], b = sm[Math.min(h - 1, y + 1) * w + Math.min(w - 1, x + 1)];
    m.hill[y * w + x] = Math.max(-1, Math.min(1, (a - b) * 0.9));
  }
}

function smoothElevation(m: BattleMap): void {
  const { w, h } = m;
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let lower = 0, cnt = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx, yy = y + dy;
        if (!inb(m, xx, yy)) continue;
        cnt++;
        if (m.elev[yy * w + xx] < m.elev[i]) lower++;
      }
      if (lower >= cnt - 1 && m.elev[i] > 0) m.elev[i]--;
    }
  }
}

function carveRoad(m: BattleMap, r: RNG, dir: 'h' | 'v'): void {
  const { w, h } = m;
  if (dir === 'h') {
    let y = r.int(Math.floor(h * 0.3), Math.floor(h * 0.7));
    for (let x = 0; x < w; x++) {
      if (r.chance(0.18)) y += r.chance(0.5) ? 1 : -1;
      y = Math.max(3, Math.min(h - 4, y));
      for (const yy of [y, y + 1]) { const i = yy * w + x; m.terr[i] = 'road'; }
      m.elev[y * w + x] = m.elev[(y + 1) * w + x] = Math.min(m.elev[y * w + x], m.elev[(y + 1) * w + x]);
    }
  } else {
    let x = r.int(Math.floor(w * 0.3), Math.floor(w * 0.7));
    for (let y = 0; y < h; y++) {
      if (r.chance(0.18)) x += r.chance(0.5) ? 1 : -1;
      x = Math.max(3, Math.min(w - 4, x));
      for (const xx of [x, x + 1]) m.terr[y * w + xx] = 'road';
    }
  }
}

// ---- Dense archetypes ------------------------------------------------------------------------
// Close country built over the noise terrain. Valley floors sit at heights 0-1, rock at 2 and plateau
// tops ("shelves") at 3, so every shelf edge is a cliff: too steep to walk, easy to jump. Each shelf
// gets one ramp; ensureConnected() afterwards guarantees everything walkable is reachable on foot.

interface DenseCtx {
  m: BattleMap;
  g: RNG;
  o: MapGenOpts;
  prot: Uint8Array; // 1 = keep open (deployment zones, base, road), 2 = margin around them
  fixed: Uint8Array; // shelf tops and ramps: later rock and chasms leave them alone
}

const SHELF = 3;

function buildDense(m: BattleMap, g: RNG, o: MapGenOpts, style: MapStyle): void {
  const { w, h } = m;
  // Flatten the floor into two gentle levels so shelves stand out as cliffs
  for (let i = 0; i < w * h; i++) m.elev[i] = m.elev[i] >= 2 ? 1 : 0;
  // Thin the woods: in close country the rock is the cover
  for (let i = 0; i < w * h; i++) if ((m.terr[i] === 'hforest' || m.terr[i] === 'lforest') && g.chance(0.35)) m.terr[i] = m.terr[i] === 'hforest' ? 'lforest' : 'plain';
  const prot = new Uint8Array(w * h);
  const mark = (x: number, y: number, v: number) => { if (inb(m, x, y)) { const i = y * w + x; prot[i] = Math.max(prot[i], v); } };
  for (const c of o.clear ?? []) for (let y = c.y - c.r - 2; y <= c.y + c.r + 2; y++) for (let x = c.x - c.r - 2; x <= c.x + c.r + 2; x++) {
    const d = Math.max(Math.abs(x - c.x), Math.abs(y - c.y));
    // Round the corners of the square zone a little so the rock hugs it naturally
    mark(x, y, d <= c.r && Math.hypot(x - c.x, y - c.y) <= c.r + 1 ? 1 : 2);
  }
  if (o.base) { const b = o.base; for (let y = b.y - 5; y <= b.y + b.h + 4; y++) for (let x = b.x - 5; x <= b.x + b.w + 4; x++) mark(x, y, x >= b.x - 3 && x <= b.x + b.w + 2 && y >= b.y - 3 && y <= b.y + b.h + 2 ? 1 : 2); }
  for (let i = 0; i < w * h; i++) if (m.terr[i] === 'road') { const x = i % w, y = (i / w) | 0; for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) mark(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) <= 1 ? 1 : 2); }
  const C: DenseCtx = { m, g, o, prot, fixed: new Uint8Array(w * h) };
  switch (style) {
    case 'canyons': genCanyons(C); break;
    case 'ridges': genRidges(C); break;
    case 'mesas': genMesas(C); break;
    case 'craters': genCraters(C); break;
    case 'crevasses': genCrevasses(C); break;
    case 'ruins': genRuins(C); break;
  }
  // Water can't sit up on a shelf or in the rock
  for (let i = 0; i < w * h; i++) if ((m.terr[i] === 'water' || m.terr[i] === 'deep') && m.elev[i] > 1) m.terr[i] = 'rough';
}

function setRock(C: DenseCtx, i: number, strict = false): void {
  const { m } = C;
  if (C.prot[i] === 1 || (strict && C.prot[i]) || C.fixed[i] || m.struct[i] >= 0 || m.terr[i] === 'road') return;
  m.terr[i] = 'rock';
  m.elev[i] = 2;
}
function setChasm(C: DenseCtx, i: number): void {
  const { m } = C;
  if (C.prot[i] || C.fixed[i] || m.struct[i] >= 0 || m.terr[i] === 'road') return;
  m.terr[i] = 'chasm';
  m.elev[i] = 0;
}
function setFloor(C: DenseCtx, i: number, t: Terrain = 'plain'): void {
  const { m } = C;
  if (m.struct[i] >= 0 || m.terr[i] === 'road') return;
  if (m.terr[i] === 'rock' || m.terr[i] === 'chasm') { m.terr[i] = t; m.elev[i] = Math.min(1, m.elev[i]); }
}

/** Turns a blob of tiles into a plateau top with cliff edges, broken crags on the rim and one ramp down. */
function makeShelf(C: DenseCtx, tiles: number[]): boolean {
  const { m, g } = C;
  const { w } = m;
  const set = new Set(tiles);
  if (tiles.some((i) => C.prot[i] === 1)) return false;
  for (const i of tiles) {
    m.terr[i] = g.chance(0.18) ? 'rough' : g.chance(0.08) ? 'lforest' : 'plain';
    m.elev[i] = SHELF;
    C.fixed[i] = 1;
  }
  // Rim crags give cover up top
  for (const i of tiles) {
    const x = i % w, y = (i / w) | 0;
    const edge = DIRS.some(([dx, dy]) => inb(m, x + dx, y + dy) && !set.has((y + dy) * w + x + dx));
    if (edge && g.chance(0.16)) m.terr[i] = 'rock', m.elev[i] = SHELF;
  }
  // Ramp: two steps (heights 2 then 1) out from an edge tile onto open floor
  const cands: [number, number, number][] = [];
  for (const i of tiles) {
    if (m.terr[i] === 'rock') continue;
    const x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = (y + dy) * w + x + dx, b = (y + 2 * dy) * w + x + 2 * dx, c = (y + 3 * dy) * w + x + 3 * dx;
      if (!inb(m, x + 3 * dx, y + 3 * dy) || set.has(a) || set.has(b)) continue;
      if ([a, b].some((k) => m.struct[k] >= 0 || m.terr[k] === 'road' || m.elev[k] === SHELF)) continue;
      if (!isFinite(TERRAIN[m.terr[c]].cost) || m.elev[c] > 1) continue;
      cands.push([i, dx, dy]);
    }
  }
  if (!cands.length) return true; // left for the connectivity pass to sort out
  const [i, dx, dy] = g.pick(cands);
  const x = i % w, y = (i / w) | 0;
  // Two tiles wide where the ground allows
  for (const side of [0, 1]) {
    const ox = dy ? side : 0, oy = dx ? side : 0;
    for (const [k, e] of [[1, 2], [2, 1]] as [number, number][]) {
      const xx = x + dx * k + ox, yy = y + dy * k + oy;
      if (!inb(m, xx, yy)) continue;
      const j = yy * w + xx;
      if (m.struct[j] >= 0 || m.terr[j] === 'road' || set.has(j) || m.elev[j] === SHELF) continue;
      m.terr[j] = 'rough';
      m.elev[j] = e;
      C.fixed[j] = 1;
    }
    if (side === 1) { const j = (y + oy) * w + x + ox; if (set.has(j) && m.terr[j] === 'rock') m.terr[j] = 'plain'; }
  }
  return true;
}

/** 4-connected components of rock, for turning some of them into shelves. */
function rockBlobs(m: BattleMap): number[][] {
  const { w, h } = m;
  const seen = new Uint8Array(w * h);
  const out: number[][] = [];
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || m.terr[s] !== 'rock') continue;
    const blob: number[] = [];
    const st = [s];
    seen[s] = 1;
    while (st.length) {
      const i = st.pop()!;
      blob.push(i);
      const x = i % w, y = (i / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (!inb(m, xx, yy)) continue;
        const j = yy * w + xx;
        if (!seen[j] && m.terr[j] === 'rock') { seen[j] = 1; st.push(j); }
      }
    }
    out.push(blob);
  }
  return out;
}

/** Rock tiles at least `k` steps (Chebyshev) from any non-rock tile. */
function rockCore(m: BattleMap, blob: number[], k: number): number[] {
  const { w } = m;
  return blob.filter((i) => {
    const x = i % w, y = (i / w) | 0;
    for (let dy = -k; dy <= k; dy++) for (let dx = -k; dx <= k; dx++) {
      const xx = x + dx, yy = y + dy;
      if (!inb(m, xx, yy)) continue;
      if (m.terr[yy * w + xx] !== 'rock') return false;
    }
    return true;
  });
}

/** Shelves carved out of the interior of big rock masses. */
function shelvesFromRock(C: DenseCtx, frac: number, minCore: number): void {
  const { m, g } = C;
  for (const blob of rockBlobs(m)) {
    if (blob.length < 18 || !g.chance(frac)) continue;
    // Keep a one-tile rock lip where the mass is thick; small masses become a shelf outright
    const core = blob.length > 60 ? rockCore(m, blob, 1) : blob;
    if (core.length < minCore) continue;
    makeShelf(C, core);
  }
}

function genCanyons(C: DenseCtx): void {
  const { m, g } = C;
  const { w, h } = m;
  const n1 = new Noise(g), n2 = new Noise(g), nw = new Noise(g);
  const open = new Uint8Array(w * h);
  // Gorges follow the "valleys" of two ridged noise fields
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = Math.abs(n1.fbm(x * 0.045, y * 0.06, 3) - 0.5), b = Math.abs(n2.fbm(x * 0.06 + 31, y * 0.045 + 17, 3) - 0.5);
    const wid = 0.022 + nw.fbm(x * 0.08, y * 0.08, 2) * 0.026;
    if (Math.min(a, b) < wid) open[y * w + x] = 1;
  }
  // Two or three through-routes so the gorges always lead somewhere
  const nRoutes = g.int(2, 3);
  for (let k = 0; k < nRoutes; k++) {
    let y = (h * (k + 0.5 + g.range(-0.3, 0.3))) / nRoutes, vy = 0;
    for (let x = 0; x < w; x++) {
      vy = Math.max(-0.9, Math.min(0.9, vy + g.range(-0.35, 0.35)));
      y = Math.max(3, Math.min(h - 4, y + vy));
      const rad = Math.sin(x * 0.3 + k * 2) > 0.2 ? 1 : 0.6;
      for (let dy = -1; dy <= 1; dy++) { if (Math.abs(dy) > rad) continue; const yy = Math.round(y) + dy; if (yy >= 0 && yy < h) open[yy * w + x] = 1; }
    }
  }
  // Basins where gorges meet
  for (let k = g.int(2, 3); k > 0; k--) {
    const cx = g.int(10, w - 11), cy = g.int(6, h - 7), rad = g.range(2.5, 4);
    for (let y = Math.floor(cy - rad); y <= cy + rad; y++) for (let x = Math.floor(cx - rad); x <= cx + rad; x++) if (inb(m, x, y) && Math.hypot(x - cx, (y - cy) * 1.2) < rad) open[y * w + x] = 1;
  }
  for (let i = 0; i < w * h; i++) if (!open[i]) setRock(C, i);
  // Gorge floors: dry washes, scree
  for (let i = 0; i < w * h; i++) if (open[i] && m.terr[i] === 'plain' && g.chance(0.12)) m.terr[i] = 'rough';
  shelvesFromRock(C, 0.55, 6);
}

function genRidges(C: DenseCtx): void {
  const { m, g } = C;
  const { w, h } = m;
  const nW = new Noise(g), nB = new Noise(g);
  const nR = g.int(3, 4);
  for (let k = 0; k < nR; k++) {
    const x0 = 12 + ((w - 24) * (k + 0.5)) / nR + g.range(-2, 2);
    const slant = g.range(-0.25, 0.25), thick = g.range(3, 5);
    // Passes: 2-3 gaps, 3-5 tiles wide, spread down the ridge
    const np = g.int(2, 3);
    const passes: [number, number][] = [];
    for (let p = 0; p < np; p++) passes.push([(h * (p + 0.5 + g.range(-0.25, 0.25))) / np, g.int(1, 2)]);
    const benchAt = g.chance(0.85) ? g.pick(passes)[0] : -99, benchSide = g.chance(0.5) ? 1 : -1;
    const benchTiles: number[] = [];
    for (let y = 0; y < h; y++) {
      const cx = x0 + (nW.fbm(y * 0.09, k * 7.3, 3) - 0.5) * 12 + slant * (y - h / 2);
      const t = thick * (0.75 + nB.fbm(y * 0.15, k * 3.1, 2) * 0.6);
      const inPass = passes.some(([py, pw]) => Math.abs(y - py) <= pw);
      for (let x = Math.floor(cx - t); x <= cx + t; x++) {
        if (!inb(m, x, y)) continue;
        const i = y * w + x;
        if (inPass) { if (m.terr[i] === 'plain' && g.chance(0.3)) m.terr[i] = 'rough'; continue; }
        setRock(C, i);
      }
      // A high bench along one face of the ridge, overlooking a pass
      const by = Math.abs(y - benchAt);
      if (by >= 2 && by <= 6) for (let s = 1; s <= 3; s++) {
        const x = Math.round(benchSide > 0 ? cx + t + s : cx - t - s);
        if (inb(m, x, y)) benchTiles.push(y * w + x);
      }
    }
    if (benchTiles.length >= 8 && !benchTiles.some((i) => C.prot[i])) makeShelf(C, benchTiles.filter((i) => m.terr[i] !== 'rock'));
    // Spurs off the ridge make pockets and flanking lanes
    for (let s = g.int(1, 3); s > 0; s--) {
      let y = g.int(3, h - 4);
      if (passes.some(([py, pw]) => Math.abs(y - py) <= pw + 2)) continue;
      const cx = x0 + (nW.fbm(y * 0.09, k * 7.3, 3) - 0.5) * 12 + slant * (y - h / 2);
      const dir = g.chance(0.5) ? 1 : -1, len = g.int(4, 8);
      let x = cx;
      for (let j = 0; j < len; j++) {
        x += dir; y += g.int(-1, 1);
        for (const yy of [y, y + 1]) if (inb(m, Math.round(x), yy)) setRock(C, yy * w + Math.round(x), true);
      }
    }
  }
  // Outcrops between the ridges
  const nO = new Noise(g);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (nO.fbm(x * 0.12, y * 0.12, 3) > 0.6) setRock(C, y * w + x, true);
  shelvesFromRock(C, 0.25, 8);
}

/** Ragged ellipse blob around (cx, cy). */
function blob(m: BattleMap, g: RNG, cx: number, cy: number, rad: number): number[] {
  const out: number[] = [];
  const stretch = g.range(0.75, 1.5), rot = g.range(0, Math.PI);
  const ns = new Noise(g);
  for (let y = Math.floor(cy - rad * 2); y <= cy + rad * 2; y++) for (let x = Math.floor(cx - rad * 2); x <= cx + rad * 2; x++) {
    if (!inb(m, x, y)) continue;
    const dx = x - cx, dy = y - cy;
    const u = dx * Math.cos(rot) + dy * Math.sin(rot), v = -dx * Math.sin(rot) + dy * Math.cos(rot);
    const dd = Math.hypot(u / stretch, v * stretch);
    if (dd < rad * (0.8 + ns.fbm(x * 0.3, y * 0.3, 2) * 0.4)) out.push(y * w0(m) + x);
  }
  return out;
}
const w0 = (m: BattleMap) => m.w;

function genMesas(C: DenseCtx): void {
  const { m, g } = C;
  const { w, h } = m;
  const placed: [number, number, number][] = [];
  const nearProt = (cx: number, cy: number, rad: number) => {
    for (let y = Math.floor(cy - rad); y <= cy + rad; y++) for (let x = Math.floor(cx - rad); x <= cx + rad; x++) if (inb(m, x, y) && C.prot[y * w + x] === 1) return true;
    return false;
  };
  let solidTiles = 0;
  for (let tries = 0; tries < 1500 && solidTiles < w * h * 0.6; tries++) {
    const rad = tries < 300 ? g.range(4, 7) : g.range(2, 5), cx = g.range(1, w - 2), cy = g.range(1, h - 2);
    if (placed.some(([px, py, pr]) => Math.hypot(px - cx, py - cy) < (pr + rad) * 0.85 + g.range(1.5, 3))) continue;
    if (nearProt(cx, cy, rad * 0.6)) continue;
    placed.push([cx, cy, rad]);
    const tiles = blob(m, g, cx, cy, rad).filter((i) => C.prot[i] !== 1 && m.struct[i] < 0 && m.terr[i] !== 'road');
    solidTiles += tiles.length;
    if (rad > 3.6 && g.chance(0.5) && tiles.length >= 14) { makeShelf(C, tiles); continue; }
    for (const i of tiles) setRock(C, i);
  }
  // Boulder fields and lone pillars in the lanes
  for (let k = g.int(10, 18); k > 0; k--) { const i = g.int(0, w * h - 1); if (m.terr[i] === 'plain' || m.terr[i] === 'rough') setRock(C, i, true); }
}

function genCraters(C: DenseCtx): void {
  const { m, g } = C;
  const { w, h } = m;
  const big: [number, number, number][] = [];
  for (let tries = 0; tries < 120 && big.length < 7; tries++) {
    const rad = g.range(4.5, 10), cx = g.range(2, w - 3), cy = g.range(2, h - 3);
    if (big.some(([x, y, r]) => Math.hypot(x - cx, y - cy) < r + rad - 2)) continue;
    big.push([cx, cy, rad]);
  }
  for (const [cx, cy, rad] of big) {
    // 2-3 breaches in the rim
    const gaps = Array.from({ length: g.int(2, 3) }, () => [g.range(0, Math.PI * 2), 2.4 / rad] as [number, number]);
    const thick = g.range(1.4, 2.4);
    for (let y = Math.floor(cy - rad - 4); y <= cy + rad + 4; y++) for (let x = Math.floor(cx - rad - 4); x <= cx + rad + 4; x++) {
      if (!inb(m, x, y)) continue;
      const i = y * w + x;
      const d = Math.hypot(x - cx, y - cy);
      const a = Math.atan2(y - cy, x - cx);
      const gap = gaps.some(([ga, gw]) => Math.abs(((a - ga + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < gw);
      if (Math.abs(d - rad) < thick) { if (!gap) setRock(C, i); else if (C.prot[i] !== 1 && m.struct[i] < 0 && m.terr[i] !== 'road') { m.terr[i] = 'rough'; } }
      else if (d < rad - thick && m.struct[i] < 0 && m.terr[i] !== 'road') {
        if (m.terr[i] === 'rock') m.terr[i] = 'plain';
        m.elev[i] = 0;
        if (d < 1.6 && rad > 7) setRock(C, i); // central peak
      } else if (d < rad + thick + 2.5 && m.terr[i] === 'plain' && g.chance(0.35)) m.terr[i] = 'rough';
    }
  }
  // Rilles: winding chasms with a few places to cross
  for (let k = g.int(1, 2); k > 0; k--) rille(C, g.chance(0.7));
  // Ejecta boulders
  const nO = new Noise(g);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (nO.fbm(x * 0.14, y * 0.14, 3) > 0.57) setRock(C, y * w + x, true);
  shelvesFromRock(C, 0.2, 8);
}

/** A crack across the map (vertical before the map is rotated) with 2-3 bridges. */
function rille(C: DenseCtx, vertical: boolean, minX = 12, maxX = -1, wide = 0.3): void {
  const { m, g } = C;
  const { w, h } = m;
  const len = vertical ? h : w, span = vertical ? w : h;
  if (maxX < 0) maxX = span - minX;
  let p = g.range(Math.min(minX, span - 4), Math.max(minX, maxX)), vp = 0;
  const nb = g.int(2, 3);
  const bridges = Array.from({ length: nb }, (_, k) => (len * (k + 0.5 + g.range(-0.25, 0.25))) / nb);
  for (let s = 0; s < len; s++) {
    vp = Math.max(-0.8, Math.min(0.8, vp + g.range(-0.4, 0.4)));
    p = Math.max(2, Math.min(span - 3, p + vp));
    if (bridges.some((b) => Math.abs(s - b) <= 1.2)) continue;
    const wd = g.chance(wide) ? (g.chance(wide * 0.4) ? 3 : 2) : 1;
    for (let k = 0; k < wd; k++) {
      const a = Math.round(p) + k;
      const x = vertical ? a : s, y = vertical ? s : a;
      if (inb(m, x, y)) setChasm(C, y * w + x);
    }
  }
}

function genCrevasses(C: DenseCtx): void {
  const { m, g } = C;
  const { w, h } = m;
  // Cracks run across the line of advance, so every crossing is a choice: bridge or jump
  const nc = g.int(3, 4);
  for (let k = 0; k < nc; k++) rille(C, true, 10 + ((w - 20) * k) / nc, 10 + ((w - 20) * (k + 1)) / nc, 0.7);
  // A side crack or two along the line of advance
  for (let k = g.int(0, 2); k > 0; k--) rille(C, false, 8, -1, 0.5);
  // Pressure ridges and seracs
  const nO = new Noise(g), nP = new Noise(g);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (m.terr[i] === 'chasm') continue;
    const ridge = Math.abs(nP.fbm(x * 0.05, y * 0.11, 3) - 0.5) < 0.045;
    if (ridge || nO.fbm(x * 0.13, y * 0.13, 3) > 0.57) setRock(C, i, true);
  }
  // Ice shelves
  for (let k = g.int(1, 3); k > 0; k--) {
    const cx = g.range(8, w - 9), cy = g.range(5, h - 6);
    const tiles = blob(m, g, cx, cy, g.range(2.5, 4)).filter((i) => !C.prot[i] && m.terr[i] !== 'chasm' && m.struct[i] < 0 && m.terr[i] !== 'road');
    if (tiles.length >= 10) makeShelf(C, tiles);
  }
}

const RUIN_NAMES = ['Gutted Tower', 'Burnt-out Habitat', 'Collapsed Arcade', 'Derelict Warehouse', 'Shattered Spire', 'Ruined Factory', 'Abandoned Tenement', 'Shell-torn Chapel', 'Wrecked Depot', 'Fire-gutted Mill'];

function genRuins(C: DenseCtx): void {
  const { m, g } = C;
  const { w, h } = m;
  // Street grid: blocks 4-7 tiles across, streets 2-3 wide
  const cuts = (len: number) => { const out: [number, number][] = []; let p = g.int(0, 2); while (p < len) { const b = g.int(4, 8); out.push([p, Math.min(len, p + b)]); p += b + (g.chance(0.7) ? 2 : 3); } return out; };
  const cols = cuts(w), rows = cuts(h);
  const names = g.shuffle([...RUIN_NAMES]);
  let nb = 0;
  for (const [x0, x1] of cols) for (const [y0, y1] of rows) {
    const tiles: number[] = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) tiles.push(y * w + x);
    const roll = g.next();
    if (roll < 0.5 && !tiles.some((i) => C.prot[i] || m.struct[i] >= 0 || m.terr[i] === 'road' || m.terr[i] === 'water' || m.terr[i] === 'deep')) {
      // A standing building filling most of the block, which a lance can blast a way through
      const ix0 = x0 + (g.chance(0.3) ? 1 : 0), iy0 = y0 + (g.chance(0.3) ? 1 : 0), ix1 = x1 - (g.chance(0.3) ? 1 : 0), iy1 = y1 - (g.chance(0.3) ? 1 : 0);
      const bt: number[] = [];
      const e = m.elev[iy0 * w + ix0];
      for (let y = iy0; y < iy1; y++) for (let x = ix0; x < ix1; x++) { bt.push(y * w + x); m.elev[y * w + x] = e; }
      for (const i of tiles) if (!bt.includes(i)) { m.elev[i] = e; if (g.chance(0.3)) m.terr[i] = 'rubble'; }
      addStructure(m, bt, names[nb++ % names.length], 100 + bt.length * 22, false, 2, 'building');
    } else if (roll < 0.85) {
      // Collapsed: a heap of wreckage too steep and jagged to cross, with a rubble skirt
      for (const i of tiles) {
        const x = i % w, y = (i / w) | 0;
        const edge = x === x0 || y === y0 || x === x1 - 1 || y === y1 - 1;
        if (edge && g.chance(0.25)) { if (m.terr[i] !== 'road' && m.struct[i] < 0) m.terr[i] = 'rubble'; } else setRock(C, i);
      }
    } else if (roll < 0.9 && x1 - x0 >= 4 && y1 - y0 >= 4 && !tiles.some((i) => C.prot[i] === 1)) {
      // A roof-top: intact upper floors reached by one ramp of debris
      makeShelf(C, tiles.filter((i) => m.struct[i] < 0 && m.terr[i] !== 'road'));
    } else {
      // Park or plaza
      for (const i of tiles) if (m.terr[i] === 'plain' && g.chance(0.25)) m.terr[i] = g.chance(0.5) ? 'rubble' : 'lforest';
    }
  }
  // Rubble in the streets
  for (let i = 0; i < w * h; i++) if (m.terr[i] === 'plain' && g.chance(0.08)) m.terr[i] = 'rubble';
}

/** Keeps road tiles drivable end to end: no step of more than one level along the road. */
function smoothRoad(m: BattleMap): void {
  const { w, h } = m;
  const seen = new Uint8Array(w * h);
  const q: number[] = [];
  for (let i = 0; i < w * h; i++) {
    const x = i % w, y = (i / w) | 0;
    if (m.terr[i] === 'road' && (x === 0 || y === 0) && !seen[i]) { seen[i] = 1; q.push(i); }
  }
  while (q.length) {
    const i = q.shift()!;
    const x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy;
      if (!inb(m, xx, yy)) continue;
      const j = yy * w + xx;
      if (seen[j] || m.terr[j] !== 'road') continue;
      seen[j] = 1;
      m.elev[j] = Math.max(m.elev[i] - 1, Math.min(m.elev[i] + 1, m.elev[j]));
      q.push(j);
    }
  }
}

// ---- Connectivity ------------------------------------------------------------------------
const passable = (m: BattleMap, i: number) => isFinite(TERRAIN[m.terr[i]].cost);

/** Walking components for a 'Mech without jump jets: same step and corner rules as Battle.moveCost/reachable. */
export function walkComponents(m: BattleMap): { comp: Int32Array; sizes: number[] } {
  const { w, h } = m;
  const comp = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (comp[s] >= 0 || !passable(m, s)) continue;
    const id = sizes.length;
    let n = 0;
    const st = [s];
    comp[s] = id;
    while (st.length) {
      const i = st.pop()!;
      n++;
      const x = i % w, y = (i / w) | 0;
      for (const [dx, dy] of DIRS) {
        const xx = x + dx, yy = y + dy;
        if (!inb(m, xx, yy)) continue;
        const j = yy * w + xx;
        if (comp[j] >= 0 || !passable(m, j)) continue;
        if (Math.abs(m.elev[j] - m.elev[i]) > 1) continue;
        if (dx && dy && !passable(m, y * w + xx) && !passable(m, yy * w + x)) continue;
        comp[j] = id;
        st.push(j);
      }
    }
    sizes.push(n);
  }
  return { comp, sizes };
}

/** Tiles that must end up connected: deployment zones, objectives, the road and the base. */
function importantTiles(m: BattleMap, o: MapGenOpts): Uint8Array {
  const { w } = m;
  const imp = new Uint8Array(m.w * m.h);
  for (const c of o.clear ?? []) for (let y = c.y - c.r; y <= c.y + c.r; y++) for (let x = c.x - c.r; x <= c.x + c.r; x++) if (inb(m, x, y)) imp[y * w + x] = 1;
  if (o.base) { const b = o.base; for (let y = b.y - 1; y <= b.y + b.h; y++) for (let x = b.x - 1; x <= b.x + b.w; x++) if (inb(m, x, y)) imp[y * w + x] = 1; }
  for (let i = 0; i < m.w * m.h; i++) if (m.terr[i] === 'road') imp[i] = 1;
  return imp;
}

/**
 * Joins every pocket of walkable ground to the main area: deployment zones and big pockets get a
 * corridor cut to them (ramped, or flattened if a ramp won't do), small stray pockets are filled in.
 */
export function ensureConnected(m: BattleMap, o: MapGenOpts): void {
  const { w, h } = m;
  const imp = importantTiles(m, o);
  for (let iter = 0; iter < 40; iter++) {
    const { comp, sizes } = walkComponents(m);
    if (sizes.length <= 1) return;
    const impN = new Array(sizes.length).fill(0);
    for (let i = 0; i < w * h; i++) if (imp[i] && comp[i] >= 0) impN[comp[i]]++;
    let main = 0;
    for (let c = 1; c < sizes.length; c++) if (impN[c] > impN[main] || (impN[c] === impN[main] && sizes[c] > sizes[main])) main = c;
    // Worst first: the pocket that matters most gets its corridor this pass
    let target = -1;
    for (let c = 0; c < sizes.length; c++) {
      if (c === main) continue;
      if (impN[c] === 0 && sizes[c] < 30) {
        for (let i = 0; i < w * h; i++) if (comp[i] === c && m.struct[i] < 0) { m.terr[i] = 'rock'; m.elev[i] = Math.max(m.elev[i], 1); }
        continue;
      }
      if (target < 0 || impN[c] > impN[target] || (impN[c] === impN[target] && sizes[c] > sizes[target])) target = c;
    }
    if (target < 0) continue;
    connect(m, comp, target, main, iter >= 12 || impN[target] > 0 && iter >= 6);
  }
}

function connect(m: BattleMap, comp: Int32Array, from: number, to: number, flatten: boolean): void {
  const { w, h } = m;
  const cost = new Float32Array(w * h).fill(Infinity);
  const prev = new Int32Array(w * h).fill(-1);
  const open: number[] = [];
  for (let i = 0; i < w * h; i++) if (comp[i] === from) { cost[i] = 0; open.push(i); }
  let end = -1;
  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (cost[open[k]] < cost[open[bi]]) bi = k;
    const i = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    if (comp[i] === to) { end = i; break; }
    const x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy;
      if (!inb(m, xx, yy)) continue;
      const j = yy * w + xx;
      if (m.struct[j] >= 0) continue;
      const c = cost[i] + 1 + (passable(m, j) ? 0 : m.terr[j] === 'chasm' ? 3 : 2) + Math.abs(m.elev[j] - m.elev[i]) * 0.7;
      if (c < cost[j]) { cost[j] = c; prev[j] = i; open.push(j); }
    }
  }
  if (end < 0) return;
  // Path from the main area back to the pocket
  const path: number[] = [];
  for (let i = prev[end]; i >= 0 && comp[i] !== from; i = prev[i]) path.push(i);
  let start = end;
  { let i = end; while (prev[i] >= 0) i = prev[i]; start = i; }
  const e0 = m.elev[end], e1 = m.elev[start];
  let last = e0;
  path.forEach((i, k) => {
    if (!passable(m, i)) m.terr[i] = 'rough';
    let e = flatten ? e0 : Math.round(e0 + ((e1 - e0) * (k + 1)) / (path.length + 1));
    e = Math.max(last - 1, Math.min(last + 1, e));
    m.elev[i] = e;
    last = e;
    // Widen the cut through solid rock to two tiles where it doesn't disturb walkable ground
    const x = i % w, y = (i / w) | 0;
    const nx = path[k + 1] ?? start;
    const vertical = (nx % w) === x;
    const sx = vertical ? x + 1 : x, sy = vertical ? y : y + 1;
    if (inb(m, sx, sy)) { const j = sy * w + sx; if (m.terr[j] === 'rock' && m.struct[j] < 0) { m.terr[j] = 'rough'; m.elev[j] = e; } }
  });
  if (flatten) for (let i = 0; i < w * h; i++) if (comp[i] === from) m.elev[i] = last;
  // Flattening may need the pocket's own height levelled, which the next pass checks again
  if (!flatten && Math.abs(last - m.elev[start]) > 1) m.elev[start] = last + Math.sign(m.elev[start] - last);
}

const STRAY_NAMES = ['Farmstead', 'Relay Tower', 'Water Tower', 'Grain Silo', 'Pump Station', 'Ruined Chapel', 'Abandoned Barracks', 'Comms Shack', 'Mining Office', 'Weather Station'];

/** Impassable features that block movement and line of sight, kept clear of deployment zones and objectives. */
function addFeatures(m: BattleMap, r: RNG, o: MapGenOpts): void {
  const { w, h, biome } = m;
  // The convoy road wanders through the middle band of the map: keep cliffs and hulks out of its way
  const roadBand = (x: number, y: number, pad: number) => (o.road === 'h' ? y + pad > h * 0.24 && y - pad < h * 0.76 : o.road === 'v' ? x + pad > w * 0.24 && x - pad < w * 0.76 : false);
  const keepClear = (x: number, y: number, pad: number) =>
    roadBand(x, y, Math.min(pad, 3)) ||
    (o.clear ?? []).some((c) => Math.hypot(x - c.x, y - c.y) < c.r + pad) ||
    (o.base ? x > o.base.x - 4 - pad && x < o.base.x + o.base.w + 4 + pad && y > o.base.y - 4 - pad && y < o.base.y + o.base.h + 4 + pad : false);
  // Mesas: ragged plateaus of sheer rock, more of them in broken country
  const nMesa = biome === 'badlands' ? r.int(3, 5) : biome === 'desert' || biome === 'highlands' || biome === 'martian' || biome === 'lunar' ? r.int(2, 4) : r.int(1, 3);
  for (let k = 0, tries = 0; k < nMesa && tries < 40; tries++) {
    const cx = r.int(8, w - 9), cy = r.int(5, h - 6), rad = r.range(1.8, 3.6);
    if (keepClear(cx, cy, rad + 3)) continue;
    const stretch = r.range(0.7, 1.6), rot = r.range(0, Math.PI);
    for (let y = Math.floor(cy - rad * 2); y <= cy + rad * 2; y++) for (let x = Math.floor(cx - rad * 2); x <= cx + rad * 2; x++) {
      if (!inb(m, x, y)) continue;
      const dx = x - cx, dy = y - cy;
      const u = dx * Math.cos(rot) + dy * Math.sin(rot), v = -dx * Math.sin(rot) + dy * Math.cos(rot);
      const dd = Math.hypot(u / stretch, v * stretch * 0.9) + r.range(-0.45, 0.45);
      const i = y * w + x;
      if (m.terr[i] === 'water' || m.terr[i] === 'deep') continue;
      if (dd < rad) { m.terr[i] = 'rock'; m.elev[i] = 3; }
      else if (dd < rad + 1 && m.terr[i] === 'plain' && r.chance(0.5)) m.terr[i] = 'rough';
    }
    k++;
  }
  // Stray buildings: farmsteads, towers and ruins dotted across the field
  const nB = r.int(1, 4);
  const names = r.shuffle([...STRAY_NAMES]);
  for (let k = 0, tries = 0; k < nB && tries < 60; tries++) {
    const bw = r.int(1, 3), bh = r.int(1, 2);
    const x = r.int(4, w - 5 - bw), y = r.int(3, h - 4 - bh);
    if (keepClear(x, y, 4)) continue;
    let ok = true;
    for (let yy = y - 1; yy <= y + bh && ok; yy++) for (let xx = x - 1; xx <= x + bw; xx++) {
      const i = yy * w + xx;
      if (!inb(m, xx, yy) || m.struct[i] >= 0 || m.terr[i] === 'water' || m.terr[i] === 'deep' || m.terr[i] === 'rock') { ok = false; break; }
    }
    if (!ok) continue;
    const tiles: number[] = [];
    const e = m.elev[y * w + x];
    for (let yy = y; yy < y + bh; yy++) for (let xx = x; xx < x + bw; xx++) { tiles.push(yy * w + xx); m.elev[yy * w + xx] = e; }
    addStructure(m, tiles, names[k % names.length], 120 + bw * bh * 40, false, 2, 'building');
    k++;
  }
  // A downed DropShip: a long, near-indestructible hulk in a field of debris
  if (r.chance(0.4)) {
    for (let tries = 0; tries < 30; tries++) {
      const horiz = r.chance(0.5), len = r.int(7, 10);
      const x0 = r.int(6, w - 7 - (horiz ? len : 3)), y0 = r.int(4, h - 5 - (horiz ? 3 : len));
      const cx = x0 + (horiz ? len / 2 : 1), cy = y0 + (horiz ? 1 : len / 2);
      if (keepClear(cx, cy, len / 2 + 3)) continue;
      const tiles: number[] = [];
      for (let k = 0; k < len; k++) for (let j = 0; j < 3; j++) {
        // Tapered nose and tail
        if ((k === 0 || k === len - 1) && j !== 1) continue;
        const x = horiz ? x0 + k : x0 + j, y = horiz ? y0 + j : y0 + k;
        if (!inb(m, x, y)) continue;
        tiles.push(y * w + x);
      }
      if (tiles.some((i) => m.struct[i] >= 0)) continue;
      for (const i of tiles) m.elev[i] = m.elev[tiles[0]];
      addStructure(m, tiles, 'Wrecked DropShip', 2500, false, 2, 'wall');
      // Debris and scorching around the hulk
      for (let y = Math.floor(cy - len); y <= cy + len; y++) for (let x = Math.floor(cx - len); x <= cx + len; x++) {
        if (!inb(m, x, y)) continue;
        const i = y * w + x, dd = Math.hypot(x - cx, y - cy);
        if (m.struct[i] >= 0) continue;
        if (dd < len * 0.75) m.scorch[i] = Math.max(m.scorch[i], 0.6 * (1 - dd / (len * 0.75)));
        if (dd < len * 0.7 && (m.terr[i] === 'plain' || m.terr[i] === 'rough') && r.chance(0.22)) m.terr[i] = 'rubble';
      }
      break;
    }
  }
}

const BUILDING_NAMES = ['Command Center', 'Barracks', 'Fuel Depot', 'Comms Array', 'Vehicle Bay', 'Power Plant', 'Supply Depot', 'Sensor Tower', 'Munitions Store', 'Repair Gantry'];

function buildBase(m: BattleMap, r: RNG, b: NonNullable<MapGenOpts['base']>): void {
  const { w } = m;
  // Flatten and clear the compound
  const baseElev = m.elev[b.y * w + b.x];
  for (let y = b.y - 1; y <= b.y + b.h; y++) for (let x = b.x - 1; x <= b.x + b.w; x++) {
    if (!inb(m, x, y)) continue;
    const i = y * w + x;
    m.terr[i] = r.chance(0.08) ? 'rough' : 'plain';
    m.elev[i] = baseElev;
  }
  if (b.walls) {
    for (let x = b.x - 1; x <= b.x + b.w; x++) for (const y of [b.y - 1, b.y + b.h]) {
      if (!inb(m, x, y)) continue;
      // gates
      if (Math.abs(x - (b.x + b.w / 2)) < 2) { m.terr[y * w + x] = 'road'; continue; }
      if (r.chance(0.85)) addStructure(m, [y * w + x], 'Wall', 80, false, b.team, 'wall');
    }
    for (let y = b.y; y < b.y + b.h; y++) for (const x of [b.x - 1, b.x + b.w]) {
      if (!inb(m, x, y)) continue;
      if (Math.abs(y - (b.y + b.h / 2)) < 2) { m.terr[y * w + x] = 'road'; continue; }
      if (r.chance(0.85)) addStructure(m, [y * w + x], 'Wall', 80, false, b.team, 'wall');
    }
  }
  // Buildings: rectangles 2x2..3x3 placed without overlap
  let placed = 0, tries = 0;
  const names = r.shuffle([...BUILDING_NAMES]);
  while (placed < b.buildings && tries++ < 200) {
    const bw = r.int(2, 3), bh = r.int(2, 3);
    const x = r.int(b.x + 1, b.x + b.w - bw - 1), y = r.int(b.y + 1, b.y + b.h - bh - 1);
    let ok = true;
    for (let yy = y - 1; yy <= y + bh && ok; yy++) for (let xx = x - 1; xx <= x + bw; xx++) {
      if (!inb(m, xx, yy) || m.struct[yy * w + xx] >= 0) { ok = false; break; }
    }
    if (!ok) continue;
    const tiles: number[] = [];
    for (let yy = y; yy < y + bh; yy++) for (let xx = x; xx < x + bw; xx++) tiles.push(yy * w + xx);
    const obj = placed < b.objectiveCount;
    addStructure(m, tiles, names[placed % names.length], obj ? 260 + bw * bh * 30 : 150 + bw * bh * 20, obj, b.team, 'building');
    placed++;
  }
}

export function addStructure(m: BattleMap, tiles: number[], name: string, hp: number, objective: boolean, team: number, t: Terrain): Structure {
  const s: Structure = { id: m.structures.length, hp, maxHp: hp, tiles, objective, name, team, destroyed: false };
  m.structures.push(s);
  for (const i of tiles) { m.struct[i] = s.id; m.terr[i] = t; m.glyph[i] = t === 'wall' ? '#' : '▓'; }
  return s;
}

export function destroyStructure(m: BattleMap, s: Structure): void {
  s.destroyed = true;
  s.hp = 0;
  for (const i of s.tiles) { m.struct[i] = -1; m.terr[i] = 'rubble'; m.glyph[i] = '%'; m.scorch[i] = 1; }
}

// ---- Line of sight -----------------------------------------------------------------------
export interface LOSResult {
  clear: boolean;
  obstruct: number; // accumulated to-hit penalty
}

/** Supercover-ish line between tile centers. Eye height = elevation + 1.2. */
export function los(m: BattleMap, x0: number, y0: number, x1: number, y1: number, blockers?: (i: number) => number): LOSResult {
  const { w } = m;
  const h0 = m.elev[y0 * w + x0] + 1.2;
  const h1 = m.elev[y1 * w + x1] + 1.0;
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy)) * 2;
  let obstruct = 0;
  let last = -1;
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const x = Math.round(x0 + dx * t), y = Math.round(y0 + dy * t);
    const i = y * w + x;
    if (i === last) continue;
    last = i;
    if ((x === x0 && y === y0) || (x === x1 && y === y1)) continue;
    const lineH = h0 + (h1 - h0) * t;
    const T = TERRAIN[m.terr[i]];
    const top = m.elev[i] + T.height + (blockers ? blockers(i) : 0);
    if ((T.blocks || m.elev[i] > 0 || top > 0) && top > lineH) return { clear: false, obstruct };
    obstruct += T.obstruct;
    if (obstruct >= 21) return { clear: false, obstruct };
  }
  return { clear: true, obstruct };
}

export function dist(x0: number, y0: number, x1: number, y1: number): number {
  // Octile distance feels natural on an 8-way grid and approximates Euclidean ranges
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  return Math.max(dx, dy) + 0.41 * Math.min(dx, dy);
}

export const DIRS: [number, number][] = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

export function dirTo(x0: number, y0: number, x1: number, y1: number): number {
  const a = Math.atan2(y1 - y0, x1 - x0); // 0 = east
  const d = Math.round(a / (Math.PI / 4)); // -4..4, 0 east
  return (((d + 2) % 8) + 8) % 8; // 0 north
}
