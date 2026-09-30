// Company founding.

import { Screen, app } from './app';
import { UI } from '../engine/ui';
import { C } from '../engine/color';
import { COLS, ROWS } from '../engine/display';
import { BACKGROUNDS, newCompany } from '../game/company';
import { setCompany, saveGame, hasSave, deleteSave } from '../game/save';
import { ArgoScreen } from './argo';
import { cb, wrap } from '../engine/util';
import { FACTIONS } from '../data/factions';

const NAMES = ['Iron Jackals', 'Crimson Lances', 'Grey Wardens', 'Black Thorns', 'Ashen Wolves', 'Silver Hawks', 'Rust Devils', 'Night Heralds'];

export class NewCareerScreen implements Screen {
  name = NAMES[Math.floor(Math.random() * NAMES.length)];
  cmd = 'Kamea Arano';
  call = 'Kestrel';
  bg = 0;
  hard = false;
  ironman = false;
  seed = (Math.random() * 1e9) >>> 0;
  confirmOverwrite = false;

  render(ui: UI): void {
    const d = ui.d;
    d.fill(0, 0, COLS, ROWS, ' ', C.text, C.bg);
    ui.header(0, 0, COLS, 'FOUND A MERCENARY COMPANY', C.bg, C.accent);
    d.text(4, 2, 'The year is 3025. The Aurigan Reach is a powder keg, and a mercenary with a dropship and four \'Mechs can make a fortune — or a grave.', C.dim, undefined, 140);
    ui.panel(3, 4, 60, 12, 'IDENTITY');
    d.text(5, 6, 'Company name', C.dim); this.name = ui.textField('name', 22, 6, 36, this.name);
    d.text(5, 8, 'Commander', C.dim); this.cmd = ui.textField('cmd', 22, 8, 36, this.cmd);
    d.text(5, 10, 'Callsign', C.dim); this.call = ui.textField('call', 22, 10, 36, this.call, 14);
    d.text(5, 13, 'Seed', C.dim); d.text(22, 13, String(this.seed), C.faint);
    if (ui.button(40, 13, 'Reroll', { style: 'plain' })) this.seed = (Math.random() * 1e9) >>> 0;
    ui.panel(3, 17, 60, 12, 'SETTINGS');
    if (ui.button(5, 19, 'Normal', { active: !this.hard, w: 12, center: true })) this.hard = false;
    if (ui.button(18, 19, 'Hard', { active: this.hard, w: 12, center: true })) this.hard = true;
    d.text(5, 21, this.hard ? `Start with ${cb(900000)}. Every C-Bill counts.` : `Start with ${cb(1600000)}. A little breathing room.`, C.dim);
    if (ui.button(5, 23, this.ironman ? 'Ironman ■' : 'Ironman □', { tip: 'One save, no rewinds. The save is deleted when the career ends.' })) this.ironman = !this.ironman;
    d.text(5, 24, this.ironman ? 'No second chances.' : 'You may rewind to the last pre-deployment save.', C.faint, undefined, 56);
    d.text(5, 26, 'Career: 1,200 days. Scored on company value, MRB rating,', C.faint, undefined, 56);
    d.text(5, 27, 'reputation and contracts completed.', C.faint, undefined, 56);
    ui.panel(65, 4, COLS - 68, 39, 'BACKGROUND');
    BACKGROUNDS.forEach((b, i) => {
      const y = 6 + i * 7;
      const sel = this.bg === i;
      d.box(67, y, COLS - 72, 6, sel ? C.accent : C.border, sel ? '#161c10' : C.panel);
      if (ui.click(67, y, COLS - 72, 6)) this.bg = i;
      if (ui.hover(67, y, COLS - 72, 6)) ui.cursor = 'pointer';
      d.text(69, y + 1, b.name, sel ? C.accent : C.bright, undefined, 99, true);
      wrap(b.desc, COLS - 78).forEach((l, k) => d.text(69, y + 2 + k, l, C.dim));
      const mods = [
        ...Object.entries(b.skills).map(([k, v]) => `${{ gun: 'Gunnery', pil: 'Piloting', gut: 'Guts', tac: 'Tactics' }[k]} ${v! > 0 ? '+' : ''}${v}`),
        ...Object.entries(b.rep).map(([f, v]) => `${FACTIONS.find((x) => x.id === f)?.short} ${v > 0 ? '+' : ''}${v}`),
        b.funds ? `+${cb(b.funds)}` : '',
      ].filter(Boolean).join(' · ');
      d.text(69, y + 4, mods, C.cyan, undefined, COLS - 78);
    });
    if (ui.button(3, ROWS - 3, 'Back', { key: 'Escape' })) app.pop();
    const ok = this.name.trim().length > 1 && this.cmd.trim().length > 1 && this.call.trim().length > 1;
    const existing = hasSave();
    if (this.confirmOverwrite) d.text(COLS - 70, ROWS - 3, 'This will overwrite your saved career. Launch again to confirm.', C.warn);
    if (ui.button(COLS - 26, ROWS - 3, this.confirmOverwrite ? 'OVERWRITE & LAUNCH' : 'LAUNCH CAREER', { key: 'Enter', style: 'block', w: 22, center: true, disabled: !ok })) {
      if (existing && !this.confirmOverwrite) { this.confirmOverwrite = true; return; }
      const c = newCompany({ name: this.name.trim(), commander: this.cmd.trim(), callsign: this.call.trim(), background: BACKGROUNDS[this.bg].id, seed: this.seed, hard: this.hard, ironman: this.ironman });
      deleteSave();
      setCompany(c);
      saveGame(c);
      app.reset(new ArgoScreen());
    }
  }
}
