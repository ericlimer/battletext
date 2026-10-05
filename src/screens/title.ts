// Title screen with animated starfield and 'Mech silhouette.

import { telemetry, build } from '../game/telemetry';
import { Screen, app } from './app';
import { UI } from '../engine/ui';
import { C, lerp, scale } from '../engine/color';
import { COLS, ROWS } from '../engine/display';
import { SkirmishScreen } from './skirmish';
import { hasSave, loadGame, importSave } from '../game/save';
import { NewCareerScreen } from './newcareer';
import { ArgoScreen } from './argo';
import { HelpScreen } from './help';
import { TITLE_ART } from '../data/titleart';

const LOGO = [
  '██████╗  █████╗ ████████╗████████╗██╗     ███████╗████████╗███████╗██╗  ██╗████████╗',
  '██╔══██╗██╔══██╗╚══██╔══╝╚══██╔══╝██║     ██╔════╝╚══██╔══╝██╔════╝╚██╗██╔╝╚══██╔══╝',
  '██████╔╝███████║   ██║      ██║   ██║     █████╗     ██║   █████╗   ╚███╔╝    ██║   ',
  '██╔══██╗██╔══██║   ██║      ██║   ██║     ██╔══╝     ██║   ██╔══╝   ██╔██╗    ██║   ',
  '██████╔╝██║  ██║   ██║      ██║   ███████╗███████╗   ██║   ███████╗██╔╝ ██╗   ██║   ',
  '╚═════╝ ╚═╝  ╚═╝   ╚═╝      ╚═╝   ╚══════╝╚══════╝   ╚═╝   ╚══════╝╚═╝  ╚═╝   ╚═╝   ',
];


interface Star { x: number; y: number; z: number; }

export class TitleScreen implements Screen {
  stars: Star[] = [];
  t = 0;
  msg = '';
  art: string[];
  constructor() {
    const forced = +(new URLSearchParams(location.search).get('titlemech') ?? 0);
    this.art = (TITLE_ART[forced - 1] ?? TITLE_ART[Math.floor(Math.random() * TITLE_ART.length)]).px;
    for (let i = 0; i < 160; i++) this.stars.push({ x: Math.random() * COLS, y: Math.random() * ROWS, z: Math.random() });
  }

  render(ui: UI, dt: number): void {
    const d = ui.d;
    this.t += dt;
    d.fill(0, 0, COLS, ROWS, ' ', C.text, '#030508');
    for (const s of this.stars) {
      s.x -= dt * (0.5 + s.z * 3);
      if (s.x < 0) { s.x = COLS; s.y = Math.random() * ROWS; }
      const c = lerp('#101820', '#a0b8d0', s.z);
      d.set(Math.floor(s.x), Math.floor(s.y), s.z > 0.85 ? '*' : s.z > 0.5 ? '·' : '.', c, '#030508');
    }
    // Planet horizon glow
    for (let x = 0; x < COLS; x++) {
      const h = 2 + Math.sin(x * 0.03) * 0.8;
      for (let k = 0; k < h; k++) d.set(x, ROWS - 1 - k, k === Math.floor(h) - 1 ? '▄' : '█', lerp('#1a1008', '#3a200c', k / h), '#030508');
    }
    // A 'Mech from the game's roster, picked afresh each time the menu comes up
    this.drawArt(d, this.art);
    // Logo
    const lx = 6, ly = 6;
    LOGO.forEach((row, j) => {
      [...row].forEach((c, i) => {
        if (c === ' ') return;
        const glint = Math.max(0, 1 - Math.abs(i - ((this.t * 40) % 220 - 60)) / 10);
        const base = c === '█' ? lerp('#d88a20', '#f0c050', j / LOGO.length) : '#5a3a14';
        d.set(lx + i, ly + j, c, lerp(base, '#fff8e0', glint * 0.7), '#030508');
      });
    });
    d.text(lx + 1, ly + 7, 'A  R O G U E L I K E   D E M A K E   O F   M E R C E N A R Y   L I F E   I N   T H E   P E R I P H E R Y', C.dim, '#030508');
    d.text(lx + 1, ly + 8, '3025 · The Aurigan Reach', C.faint, '#030508');
    // Menu
    let y = 22;
    const save = hasSave();
    const item = (label: string, key: string, tip: string, fn: () => void, disabled = false) => {
      if (ui.button(lx + 2, y, label, { key, w: 30, style: 'block', tip, disabled })) fn();
      y += 2;
    };
    item('Continue Career', 'C', 'Resume your saved mercenary company.', () => {
      const g = loadGame();
      if (g) app.reset(new ArgoScreen()); else this.msg = 'Save could not be loaded.';
    }, !save);
    item('New Career', 'N', 'Found a mercenary company and make a name for yourself in 1,200 days.', () => app.push(new NewCareerScreen()));
    item('Skirmish', 'S', 'Build two lances and fight a single battle.', () => app.push(new SkirmishScreen()));
    item('Import Save', 'I', 'Load a career from an exported save file.', () => this.importFile());
    item('Field Manual', 'H', 'How to play.', () => app.push(new HelpScreen()));
    if (this.msg) d.text(lx + 2, y + 1, this.msg, C.warn, '#030508');
    // Footer stays left of the 'Mech
    d.text(lx + 2, ROWS - 8, 'Inspired by BATTLETECH (2018) by Harebrained Schemes.', C.faint);
    d.text(lx + 2, ROWS - 7, 'BattleTech is a trademark of its owners; this is a fan tribute.', C.faint);
    d.text(lx + 2, ROWS - 6, 'Mouse + keyboard. Highlighted letters are hotkeys. Best at 1280×768 or larger.', C.faint);
    d.ctext(lx + 2, ROWS - 5, `{#f0a830}\`{/} bookmarks whatever is under the mouse, on any screen.`, C.dim, undefined, 90);
    d.ctext(lx + 2, ROWS - 4, `{#6d7f8a}Telemetry ${telemetry.status()} · build ${build()}{/}`, C.dim, undefined, 90);
  }

  /** Pixel art, two pixels per cell, standing on the horizon to the right of the menu. */
  drawArt(d: UI['d'], px: string[]): void {
    const BG = '#030508', w = px[0].length, rows = Math.ceil(px.length / 2);
    const x0 = 124 - (w >> 1), y0 = ROWS - 3 - rows;
    const colour = (c: string, y: number): string | null => {
      if (c === '.' || c === undefined) return null;
      const lift = 0.85 + 0.25 * (1 - y / px.length);
      if (c === 'o') return lerp('#ff3a1a', '#ffb040', 0.5 + 0.5 * Math.sin(this.t * 3));
      const base = c === '=' ? '#c4d0da' : c === '#' ? '#7e8e9c' : c === '%' ? '#46545f' : '#20282f';
      return scale(base, lift);
    };
    for (let r = 0; r < rows; r++) for (let i = 0; i < w; i++) {
      const top = colour(px[r * 2]?.[i], r * 2), bot = colour(px[r * 2 + 1]?.[i], r * 2 + 1);
      if (!top && !bot) continue;
      if (top && bot && top === bot) d.set(x0 + i, y0 + r, '█', top, BG);
      else if (top) d.set(x0 + i, y0 + r, '▀', top, bot ?? BG);
      else d.set(x0 + i, y0 + r, '▄', bot!, BG);
    }
  }

  importFile(): void {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      const txt = await f.text();
      if (importSave(txt)) app.reset(new ArgoScreen());
      else this.msg = 'That file is not a valid BattleText save.';
    };
    inp.click();
  }
}
