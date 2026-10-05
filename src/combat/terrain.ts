// Battlefield generation, terrain rules, line of sight.

import { RNG, Noise } from '../engine/rng';

export type Terrain = 'plain' | 'rough' | 'lforest' | 'hforest' | 'water' | 'deep' | 'rock' | 'road' | 'building' | 'rubble' | 'wall';

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
};

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
  // Hard cover: mesas, stray buildings, a downed DropShip
  if (o.features !== false) addFeatures(m, r, o);
  // Roads
  if (o.road) carveRoad(m, r, o.road);
  // Base compound
  if (o.base) buildBase(m, r, o.base);
  // Clear deployment zones
  for (const c of o.clear ?? []) {
    for (let y = c.y - c.r; y <= c.y + c.r; y++) for (let x = c.x - c.r; x <= c.x + c.r; x++) {
      if (!inb(m, x, y)) continue;
      const i = y * w + x;
      if (m.struct[i] >= 0) continue;
      if (m.terr[i] === 'rock' || m.terr[i] === 'deep') m.terr[i] = 'rough';
    }
  }
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
