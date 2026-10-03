// Star map: territories, jump routes, travel.

import { UI } from '../engine/ui';
import { C, lerp, scale } from '../engine/color';
import { COLS } from '../engine/display';
import type { ArgoScreen } from './argo';
import { skulls } from './argo';
import { company, saveGame } from '../game/save';
import { sys, startTravel, travelMult, maxContractDiff, hasBlackMarket } from '../game/company';
import { route, tagDesc, StarSystem } from '../game/world';
import { FACTIONS, faction, repLevel } from '../data/factions';
import { wrap } from '../engine/util';
import { Noise, RNG } from '../engine/rng';

let terrCache: { key: string; bg: string[] } | null = null;

export function drawStarmapTab(ui: UI, argo: ArgoScreen, x: number, y: number, w: number, h: number): void {
  const d = ui.d, c = company!;
  const st = (argo.st.map ??= { sel: c.location });
  const MW = 102, MH = h - 1;
  const ox = x + 1, oy = y;
  const toS = (s: StarSystem): [number, number] => [ox + Math.round(s.x) + 0, oy + Math.round(s.y) + 1];
  // Territory background (cached)
  const key = c.seed + ':' + c.systems.map((s) => s.owner).join(',');
  if (!terrCache || terrCache.key !== key) {
    const nz = new Noise(new RNG(c.seed));
    const bg: string[] = [];
    for (let yy = 0; yy < MH; yy++) for (let xx = 0; xx < MW; xx++) {
      let best: StarSystem | null = null, bd = Infinity, second = Infinity;
      for (const s of c.systems) {
        const dd = Math.hypot(s.x - xx, (s.y - (yy - 1)) * 1.6);
        if (dd < bd) { second = bd; bd = dd; best = s; } else if (dd < second) second = dd;
      }
      const neb = nz.fbm(xx * 0.05, yy * 0.1, 3);
      let col = lerp('#04060a', '#0c0a18', Math.max(0, neb - 0.4) * 2);
      if (best && bd < 14) {
        const fc = faction(best.owner).color;
        const edge = second - bd < 1.2;
        col = lerp(col, fc, edge ? 0.12 : 0.05 * (1 - bd / 14) + 0.02);
      }
      bg.push(col);
    }
    terrCache = { key, bg };
  }
  for (let yy = 0; yy < MH; yy++) for (let xx = 0; xx < MW; xx++) {
    const b = terrCache.bg[yy * MW + xx];
    const star = ((xx * 7919 + yy * 104729) % 97) === 0;
    d.set(ox + xx, oy + yy, star ? '·' : ' ', '#2a3440', b);
  }
  // Links
  const plan = st.sel !== c.location && !c.travel ? route(c.systems, c.location, st.sel, travelMult(c)) : null;
  const travelPath = c.travel ? c.travel.path : plan?.path ?? [];
  const onPath = (a: string, b: string) => { for (let i = 0; i < travelPath.length - 1; i++) if ((travelPath[i] === a && travelPath[i + 1] === b) || (travelPath[i] === b && travelPath[i + 1] === a)) return true; return false; };
  for (const s of c.systems) for (const l of s.links) {
    if (l < s.id) continue;
    const o = sys(c, l);
    const [x0, y0] = toS(s), [x1, y1] = toS(o);
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    const hot = onPath(s.id, o.id);
    for (let k = 1; k < n; k++) {
      const xx = Math.round(x0 + ((x1 - x0) * k) / n), yy = Math.round(y0 + ((y1 - y0) * k) / n);
      const pulse = hot ? 0.5 + 0.5 * Math.sin(ui.time * 6 - k * 0.6) : 0;
      d.set(xx, yy, hot ? '•' : '·', hot ? lerp('#2a8ab0', '#bff0ff', pulse) : '#4a5e70');
    }
  }
  // Systems: glyphs first, then labels that avoid every glyph and each other
  let hovered: StarSystem | null = null;
  const occupied = new Set<string>();
  const offers = new Set((c.travelOffers ?? []).filter((k) => k.expires > c.day && k.sysId).map((k) => k.sysId!));
  for (const s of c.systems) {
    const [sx, sy] = toS(s);
    const f = faction(s.owner);
    const cur = s.id === c.location;
    const sel = s.id === st.sel;
    const hov = ui.hover(sx - 1, sy, 3, 1);
    if (hov) { hovered = s; ui.cursor = 'pointer'; }
    if (ui.click(sx - 1, sy, 3, 1)) st.sel = s.id;
    const glyph = cur ? '◉' : s.visited ? '●' : '○';
    const col = cur ? lerp(C.accent, '#ffffff', 0.5 + 0.5 * Math.sin(ui.time * 4)) : f.color;
    d.set(sx, sy, glyph, col, sel || hov ? '#26323c' : undefined);
    if (sel) { d.set(sx - 1, sy, '[', C.accent); d.set(sx + 1, sy, ']', C.accent); }
    if (offers.has(s.id) && !sel) d.set(sx + 1, sy, '◆', lerp(C.cbill, '#ffffff', 0.25 + 0.25 * Math.sin(ui.time * 3)));
    for (let k = -1; k <= 1; k++) occupied.add(`${sx + k},${sy}`);
    if (s.diff > maxContractDiff(c) && (sel || hov)) d.text(sx - 1, sy + 1, '!', C.red);
  }
  const order = [...c.systems].sort((p, q) => rank(q) - rank(p));
  function rank(s: StarSystem): number { return s.id === c.location ? 3 : s.id === st.sel ? 2 : s === hovered ? 1 : s.tags.includes('capital') ? 0.5 : 0; }
  for (const s of order) {
    const [sx, sy] = toS(s);
    const f = faction(s.owner);
    const cur = s.id === c.location, sel = s.id === st.sel, hov = s === hovered;
    const label = s.name;
    // Labels flip to the left near the right edge of the map, or when the right side is taken
    const right = sx + 2, left = sx - 1 - label.length;
    const fits = (lx: number) => { for (let k = -1; k < label.length + 1; k++) if (occupied.has(`${lx + k},${sy}`) && !(k === -1 && lx + k === sx + 1)) return false; return true; };
    const okR = right + label.length < ox + MW, okL = left >= ox;
    let lx = okR ? right : left;
    if (!fits(lx) && okR && okL && fits(lx === right ? left : right)) lx = lx === right ? left : right;
    if (fits(lx) || rank(s) > 0) {
      d.text(lx, sy, label, cur ? C.accent : sel || hov ? C.bright : scale(f.color, s.visited ? 0.8 : 0.55));
      for (let k = 0; k < label.length; k++) occupied.add(`${lx + k},${sy}`);
    } else {
      // Crowded: fall back to a three-letter abbreviation rather than leaving the system unnamed
      const ab = label.slice(0, 3);
      for (const ax of [right, sx - 4]) {
        let ok = ax >= ox && ax + 3 < ox + MW;
        for (let k = 0; k < 3 && ok; k++) if (occupied.has(`${ax + k},${sy}`)) ok = false;
        if (ok) { d.text(ax, sy, ab, scale(f.color, s.visited ? 0.8 : 0.55)); for (let k = 0; k < 3; k++) occupied.add(`${ax + k},${sy}`); break; }
      }
    }
  }
  // Travelling ship marker
  if (c.travel) {
    const a = sys(c, c.travel.path[0]), b = sys(c, c.travel.path[1]);
    const legT = route(c.systems, a.id, b.id, travelMult(c))?.days ?? 1;
    const f = 1 - c.travel.legLeft / legT;
    const [x0, y0] = toS(a), [x1, y1] = toS(b);
    d.set(Math.round(x0 + (x1 - x0) * f), Math.round(y0 + (y1 - y0) * f), '▲', '#ffffff');
  }
  // Right panel
  const px = ox + MW + 1, pw = COLS - px - 1;
  const s = hovered ?? sys(c, st.sel);
  ui.panel(px, y, pw, 30, s.name.toUpperCase());
  const f = faction(s.owner);
  let yy = y + 1;
  d.ctext(px + 2, yy++, `{${f.color}}${f.name}{/}`, C.text);
  d.ctext(px + 2, yy++, `Standing: {${repLevel(c.rep[s.owner] ?? 0).color}}${repLevel(c.rep[s.owner] ?? 0).name}{/}`, C.dim);
  d.ctext(px + 2, yy++, `Threat {#e8503a}${skulls(s.diff)}{/}${s.diff > maxContractDiff(c) ? '  {#e8503a}(above MRB limit){/}' : ''}`, C.dim);
  yy++;
  for (const l of wrap(s.desc, pw - 4)) d.text(px + 2, yy++, l, C.text);
  yy++;
  for (const t of s.tags) for (const l of wrap(`▪ ${tagDesc(t)}`, pw - 4)) d.text(px + 2, yy++, l, C.dim);
  yy++;
  d.text(px + 2, yy++, `Biomes: ${s.biomes.join(', ')}`, C.faint, undefined, pw - 4);
  if (hasBlackMarket(s)) d.ctext(px + 2, yy++, `{#b27ae8}Black market{/}${c.blackMarket ? ' (member)' : ' (members only)'}`, C.faint);
  if (s.visited && c.contracts[s.id]) d.text(px + 2, yy++, `Known contracts: ${c.contracts[s.id].filter((k) => k.expires > c.day).length}`, C.faint);
  for (const k of (c.travelOffers ?? []).filter((k) => k.sysId === s.id && k.expires > c.day).slice(0, 3)) {
    d.ctext(px + 2, yy++, `{#f0c850}◆{/} ${k.name} {#e8503a}${skulls(k.diff)}{/} {#f0c850}${Math.round(k.pay / 1000)}K{/}`, C.text, undefined, pw - 4);
  }
  yy++;
  if (s.id === c.location) d.text(px + 2, yy, c.travel ? 'Departing…' : 'You are here.', C.accent);
  else {
    const rt = route(c.systems, c.location, s.id, travelMult(c));
    if (rt) {
      d.ctext(px + 2, yy++, `Route: {#f2f6f8}${rt.path.length - 1}{/} jump${rt.path.length > 2 ? 's' : ''}, {#f2f6f8}${rt.days}{/} days`, C.dim);
      wrap(rt.path.map((id) => sys(c, id).name).join(' → '), pw - 4).forEach((l) => d.text(px + 2, yy++, l, C.faint));
      if (!hovered || hovered.id === st.sel) {
        if (c.travel) d.text(px + 2, yy + 1, 'Already in transit.', C.cyan);
        else if (ui.button(px + 2, yy + 1, 'SET COURSE', { key: 'Enter', style: 'block', w: 18, center: true, tip: 'Travel takes time; monthly expenses keep accruing.' })) {
          const err = startTravel(c, s.id);
          if (err) argo.notify(err, C.red); else { saveGame(c); argo.notify(`Course set for ${s.name}`, C.cyan); argo.advancing = true; argo.watchKey = argo.stopWatch(); }
        }
      }
    }
  }
  // Legend
  ui.panel(px, y + 31, pw, h - 31, 'LEGEND');
  FACTIONS.forEach((fa, i) => d.ctext(px + 2 + (i % 2) * 22, y + 32 + Math.floor(i / 2), `{${fa.color}}●{/} ${fa.short}`, C.dim));
  d.ctext(px + 2, y + 37, `{#f0a830}◉{/} Argo  ● visited  ○ unexplored`, C.faint);
  d.ctext(px + 2, y + 38, `{#f0c850}◆{/} travel contract on offer`, C.faint);
}
