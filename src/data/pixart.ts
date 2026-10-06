// Pixel-art 'Mech portraits for the Mech Bay, in the same half-block style as the title screen.
// Each text cell shows two pixels stacked (▀ with foreground over background), so pixels come out square.
// Front view: the 'Mech's right side is on the viewer's left.
//
// Pixels:
//   '.' empty           '=' lit edge          '#' armour            '%' shadow
//   '@' gaps, joints    'o' glowing eyes      'c' cockpit glass     'b' gun barrel
//   'm' missile tubes   'l' laser lens        'p' PPC / Gauss coil
//
// Zones (pixel coordinates) let each location be tinted by its damage and hovered:
//   arms: [a, b]  columns < a are the right arm, columns >= b the left arm
//   legs: first pixel row of the legs; legs split at column `mid` (default: half the width)
//   head: pixel rows above this (between the arm columns) are the head
// Rows are checked legs first, then arms, then head; the torso splits RT | CT | LT in thirds between the arms,
// unless `torso: [c0, c1]` gives the CT's first column and the LT's first column.

import { G1 } from './pixart/g1';
import { G2 } from './pixart/g2';
import { G3 } from './pixart/g3';
import { G4 } from './pixart/g4';
import { G5 } from './pixart/g5';

export interface PixArt { px: string[]; head: number; legs: number; arms: [number, number]; mid?: number; torso?: [number, number] }

export { mirror } from './pixart/util';

export const PIX: Record<string, PixArt> = { ...G1, ...G2, ...G3, ...G4, ...G5 };
export function pixFor(chassisName: string): PixArt | null { return PIX[chassisName] ?? null; }

export function pixWidth(a: PixArt): number { return Math.max(...a.px.map((r) => r.length)); }

/** Which body location a pixel shows. */
export function pixZone(a: PixArt, x: number, y: number): string {
  const w = pixWidth(a);
  if (y >= a.legs) return x < (a.mid ?? w / 2) ? 'RL' : 'LL';
  if (x < a.arms[0]) return 'RA';
  if (x >= a.arms[1]) return 'LA';
  if (y < a.head) return 'HD';
  const [c0, c1] = a.torso ?? [a.arms[0] + (a.arms[1] - a.arms[0]) / 3, a.arms[1] - (a.arms[1] - a.arms[0]) / 3];
  return x < c0 ? 'RT' : x >= c1 ? 'LT' : 'CT';
}

const BASE: Record<string, string> = {
  '=': '#c4d0da', '#': '#7e8e9c', '%': '#46545f', '@': '#20282f',
  o: '#ff5a2a', c: '#5fd8f0', b: '#a8b4bc', m: '#d8a848', l: '#ff4a4a', p: '#6ab0ff',
};
/** Base colour of a pixel, a little brighter towards the top as if lit from above; null for empty. */
export function pixColor(c: string | undefined, y: number, h: number): string | null {
  if (!c || c === '.' || c === ' ') return null;
  const base = BASE[c] ?? BASE['#'];
  if ('oclmp'.includes(c)) return base;
  const lift = 0.85 + 0.25 * (1 - y / h);
  const n = parseInt(base.slice(1), 16), k = (v: number) => Math.min(255, Math.round(v * lift));
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => k(v).toString(16).padStart(2, '0')).join('');
}
