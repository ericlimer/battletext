// End of career: bankruptcy or retirement.

import { Screen, app } from './app';
import { UI } from '../engine/ui';
import { C } from '../engine/color';
import { COLS, ROWS } from '../engine/display';
import { company, deleteSave, saveGame, hasBackup, restoreBackup } from '../game/save';
import { ArgoScreen } from './argo';
import { careerScore, companyValue, mrbLevel, dateStr } from '../game/company';
import { TitleScreen } from './title';
import { cb } from '../engine/util';
import { FACTIONS, repLevel } from '../data/factions';

export class GameOverScreen implements Screen {
  render(ui: UI): void {
    const d = ui.d, c = company!;
    d.fill(0, 0, COLS, ROWS, ' ', C.text, '#050608');
    const bankrupt = c.gameOver === 'bankrupt';
    const title = bankrupt ? 'THE COMPANY IS BANKRUPT' : c.gameOver === 'destroyed' ? 'THE COMPANY IS DESTROYED' : 'CAREER COMPLETE';
    d.text((COLS - title.length) >> 1, 6, title, bankrupt ? C.red : C.accent, undefined, 99, true);
    const sub = bankrupt ? `Creditors seized the Argo on ${dateStr(c.day)}. ${c.name} is no more.` : `After ${c.day} days, ${c.name} retires from active service.`;
    d.text((COLS - sub.length) >> 1, 8, sub, C.text);
    const lines = [
      `Final funds            ${cb(c.funds)}`,
      `Company value          ${cb(companyValue(c))}`,
      `MRB rating             ${mrbLevel(c)}`,
      `Contracts won          ${c.stats.wins} / ${c.stats.missions}`,
      `Enemy units destroyed  ${c.stats.kills}`,
      `'Mechs lost            ${c.stats.mechsLost}`,
      `MechWarriors lost      ${c.stats.pilotsLost}`,
      `C-Bills earned         ${cb(c.stats.earned)}`,
    ];
    lines.forEach((l, i) => d.text(50, 12 + i, l, C.dim));
    FACTIONS.forEach((f, i) => d.ctext(50, 22 + i, `{${f.color}}${f.name.padEnd(24)}{/} ${repLevel(c.rep[f.id] ?? 0).name}`, C.dim));
    const score = `CAREER SCORE: ${careerScore(c)}`;
    d.text((COLS - score.length) >> 1, 32, score, C.accent, undefined, 99, true);
    if (!c.ironman && c.gameOver !== 'retired' && hasBackup() && ui.button((COLS - 34) >> 1, 39, 'Reload last pre-contract save', { key: 'r', style: 'block', w: 34, center: true, tip: 'Non-ironman careers can rewind to just before the last deployment.' })) {
      if (restoreBackup()) { app.reset(new ArgoScreen()); return; }
    }
    if (ui.button((COLS - 20) >> 1, 36, 'MAIN MENU', { key: 'Enter', style: 'block', w: 20, center: true })) {
      if (c.ironman) deleteSave(); else saveGame(c);
      app.reset(new TitleScreen());
    }
  }
}
