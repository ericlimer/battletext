// Star map generation for the career: systems, ownership, difficulty, jump links.

import { RNG } from '../engine/rng';
import { Biome, BIOMES } from '../combat/terrain';

export interface StarSystem {
  id: string;
  name: string;
  x: number; // map coords (0..100, 0..44)
  y: number;
  owner: string;
  diff: number; // 1..10 half-skulls
  tags: string[];
  desc: string;
  links: string[];
  biomes: Biome[];
  visited: boolean;
  contractsDay: number;
  storeDay: number;
  hiresDay: number;
}

const NAMES = ['Coromodir', 'Panzyr', 'Smithon', 'Artru', 'Tyrlon', 'Weldry', 'Itrom', 'Mechdur', 'Guldra', 'Rubigen', 'Tiverton', 'Hounslow',
  'Mangaweka', 'Detroit', 'Illiushin', 'Bellerophon', 'Cygnus', 'Techne', 'Qalzi', 'Ruchbah', 'Gambilon', 'Nopah', 'Vakarel', 'Ishtar',
  'Alrakis', 'Espinosa', 'Kaumberg', 'Nizina', 'Ledo', 'Muchoroba', 'Cadmus', 'Obrenovac', 'Mercenary\'s Star', 'Gurnet', 'Jalastar',
  'Mandalay', 'Asta', 'Fuentes', 'Tamsin', 'Hurik', 'Gaucelmo', 'Lindsay', 'Oriente', 'Brixtana', 'Sierpinski', 'Cantral', 'Raballa', 'Oltion'];
const TAGS: Record<string, string> = {
  industrial: 'Industrial world: well-stocked markets, \'Mech parts for sale.',
  agricultural: 'Agricultural world: cheap supplies, little tech.',
  mining: 'Mining colony: rough terrain, frequent labor unrest.',
  capital: 'Regional capital: rich employers, heavy garrisons.',
  frontier: 'Frontier world: pirates are common.',
  starport: 'Major starport: hiring hall with more MechWarriors.',
  ruins: 'Star League ruins: rumors of LosTech caches.',
  research: 'Research station: rare equipment in the market.',
};
const TAG_KEYS = Object.keys(TAGS);
export function tagDesc(t: string): string { return TAGS[t] ?? t; }

const FLAVOR = ['A dusty world of dwindling mines and proud, stubborn people.', 'Terraformed centuries ago; the atmosphere is slowly failing.',
  'A garrison world whose militia has seen better days.', 'Its capital city is built into the caldera of a dead volcano.',
  'Famous for its vineyards, and for the feuds they start.', 'Rich in germanium, poor in everything else.',
  'Ice sheets cover most of the surface; the equator is habitable.', 'A crossroads of trade lanes and smugglers\' routes.',
  'The locals still speak of the Star League in reverent tones.', 'Contested for decades; every hill has a name and a grave.',
  'Its moons host abandoned SLDF depots, mostly looted.', 'A red desert world with sprawling hydroponic domes.',
  'Tidally locked: one face burns, the other freezes, and everyone lives on the line between.', 'Its orbital elevator collapsed a century ago; the wreckage is still a landmark.',
  'Mostly ocean, with a handful of crowded volcanic archipelagos.', 'Home to a once-famous \'Mech factory, now a scrapyard with a gift shop.'];
const FLAVOR2 = ['The militia is underpaid and knows it.', 'Off-worlders are tolerated, barely.', 'Water is rationed and fights over it are common.',
  'A noble house claims it, but nobody has seen the duke in years.', 'The spaceport bars are full of out-of-work MechWarriors.', 'Local legends speak of a buried Star League cache.',
  'Bandits raid the outer settlements every harvest.', 'Its people are fiercely proud of their single surviving \'Mech.', 'The planetary council changes hands every few months.',
  'Smuggling is the only industry that never closes.'];

export function generateStarMap(r: RNG): { systems: StarSystem[]; start: string } {
  const W = 100, H = 40;
  const pts: [number, number][] = [];
  let tries = 0;
  while (pts.length < 38 && tries++ < 5000) {
    const x = r.range(4, W - 4), y = r.range(3, H - 3);
    if (pts.every(([px, py]) => Math.hypot(px - x, (py - y) * 1.6) > 9)) pts.push([x, y]);
  }
  // Faction capitals around the edges, Aurigan Reach in the middle
  const caps: [string, number, number][] = [
    ['aurigan', W * 0.5, H * 0.5], ['davion', W * 0.08, H * 0.2], ['liao', W * 0.12, H * 0.85], ['taurian', W * 0.92, H * 0.15],
    ['canopus', W * 0.9, H * 0.85], ['marik', W * 0.45, H * 0.05], ['locals', W * 0.3, H * 0.55], ['locals', W * 0.7, H * 0.45],
  ];
  const names = r.shuffle([...NAMES]);
  const descs = r.shuffle(FLAVOR.flatMap((a) => FLAVOR2.map((b) => `${a} ${b}`)));
  const firsts = new Set<string>();
  const systems: StarSystem[] = pts.map(([x, y], i) => {
    let best = caps[0], bd = Infinity;
    for (const c of caps) { const d = Math.hypot(c[1] - x, (c[2] - y) * 1.6) * r.range(0.85, 1.15); if (d < bd) { bd = d; best = c; } }
    let tags = r.shuffle([...TAG_KEYS]).slice(0, r.int(1, 2));
    if (tags.includes('industrial') && tags.includes('agricultural')) tags = tags.filter((t) => t !== 'agricultural');
    const biomes = r.shuffle([...BIOMES]).slice(0, r.int(2, 3));
    return { id: 's' + i, name: names[i % names.length], x, y, owner: best[0], diff: 1, tags, desc: (() => { const d0 = descs.find((d) => !firsts.has(d.split('. ')[0])) ?? descs[i % descs.length]; firsts.add(d0.split('. ')[0]); return d0; })(), links: [], biomes, visited: false, contractsDay: -999, storeDay: -999, hiresDay: -999 };
  });
  const havens = ['A lawless haven where the only government is whoever has the most guns.', 'A pirate port: every dock is for hire and every captain has a price on their head.', 'Smugglers run this rock. Nobody asks where cargo came from.'];
  const pirate = (sy: StarSystem) => { sy.owner = 'pirates'; sy.desc = r.pick(havens); sy.tags = sy.tags.filter((t) => t !== 'capital' && t !== 'agricultural'); if (!sy.tags.includes('frontier')) sy.tags.push('frontier'); };
  if (r.chance(0.5)) pirate(systems[r.int(0, systems.length - 1)]);
  pirate(systems[r.int(0, systems.length - 1)]);
  // Links: connect k nearest within range, then ensure connectivity
  const d = (a: StarSystem, b: StarSystem) => Math.hypot(a.x - b.x, (a.y - b.y) * 1.6);
  for (const s of systems) {
    const near = systems.filter((o) => o !== s).sort((a, b) => d(s, a) - d(s, b)).slice(0, 3);
    for (const o of near) if (d(s, o) < 22 && !s.links.includes(o.id)) { s.links.push(o.id); o.links.push(s.id); }
  }
  // connectivity via union-find on closest pairs
  const comp = new Map(systems.map((s, i) => [s.id, i]));
  const find = (id: string): number => { let c = comp.get(id)!; while (systems[c].id !== id && comp.get(systems[c].id) !== c) c = comp.get(systems[c].id)!; return c; };
  const groups = () => {
    const seen = new Map<string, number>();
    let g = 0;
    for (const s of systems) {
      if (seen.has(s.id)) continue;
      const stack = [s.id];
      while (stack.length) { const id = stack.pop()!; if (seen.has(id)) continue; seen.set(id, g); for (const l of systems.find((x) => x.id === id)!.links) stack.push(l); }
      g++;
    }
    return seen;
  };
  void find;
  for (let guard = 0; guard < 40; guard++) {
    const g = groups();
    const n = new Set(g.values()).size;
    if (n <= 1) break;
    let best: [StarSystem, StarSystem] | null = null, bd = Infinity;
    for (const a of systems) for (const b of systems) if (g.get(a.id) === 0 && g.get(b.id) !== 0 && d(a, b) < bd) { bd = d(a, b); best = [a, b]; }
    if (best) { best[0].links.push(best[1].id); best[1].links.push(best[0].id); }
  }
  // Start: an Aurigan-adjacent system near the center-west; difficulty radiates outwards
  const start = systems.reduce((a, s) => (Math.hypot(s.x - W * 0.38, s.y - H * 0.5) < Math.hypot(a.x - W * 0.38, a.y - H * 0.5) ? s : a), systems[0]);
  // BFS jump distance
  const jd = new Map<string, number>([[start.id, 0]]);
  const q = [start.id];
  while (q.length) {
    const id = q.shift()!;
    for (const l of systems.find((s) => s.id === id)!.links) if (!jd.has(l)) { jd.set(l, jd.get(id)! + 1); q.push(l); }
  }
  for (const s of systems) {
    const j = jd.get(s.id) ?? 6;
    let diff = 1 + j * 1.25 + r.range(-0.8, 0.8);
    if (s.tags.includes('capital')) diff += 1.5;
    if (s.owner === 'pirates') diff += 0.5;
    s.diff = Math.max(1, Math.min(10, Math.round(diff)));
  }
  start.diff = 1;
  start.visited = true;
  start.tags = start.tags.filter((t) => t !== 'capital');
  if (!start.tags.includes('starport')) start.tags.push('starport');
  return { systems, start: start.id };
}

export function jumpDays(a: StarSystem, b: StarSystem): number {
  return Math.max(3, Math.round(Math.hypot(a.x - b.x, (a.y - b.y) * 1.6) / 3.2) + 2);
}

/** Dijkstra over jump links by days. */
export function route(systems: StarSystem[], from: string, to: string, speed = 1): { path: string[]; days: number } | null {
  const by = new Map(systems.map((s) => [s.id, s]));
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const open = new Set([from]);
  while (open.size) {
    let cur = '', cd = Infinity;
    for (const id of open) if (dist.get(id)! < cd) { cd = dist.get(id)!; cur = id; }
    open.delete(cur);
    if (cur === to) break;
    const s = by.get(cur)!;
    for (const l of s.links) {
      const nd = cd + Math.round(jumpDays(s, by.get(l)!) * speed);
      if (nd < (dist.get(l) ?? Infinity)) { dist.set(l, nd); prev.set(l, cur); open.add(l); }
    }
  }
  if (!dist.has(to)) return null;
  const path = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0])!);
  return { path, days: dist.get(to)! };
}
