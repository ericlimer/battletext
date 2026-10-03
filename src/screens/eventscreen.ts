// Modal random event with choices.

import { Screen, app } from './app';
import { UI } from '../engine/ui';
import { C } from '../engine/color';
import { COLS } from '../engine/display';
import { company, saveGame } from '../game/save';
import { GameEvent, EventCtx, resolveChoice } from '../game/events';
import { rngOf, saveRng } from '../game/company';
import { wrap } from '../engine/util';

export class EventScreen implements Screen {
  modal = true;
  result: string | null = null;
  /** Captured on first draw so the choice's effects can't rewrite the situation that prompted it. */
  bodyText: string | null = null;
  constructor(public ev: GameEvent, public ctx: EventCtx) {}
  render(ui: UI): void {
    const d = ui.d, c = company!;
    const w = 80;
    const body = wrap((this.bodyText ??= this.ev.text(c, this.ctx)), w - 8);
    const res = this.result ? wrap(this.result, w - 8) : [];
    const h = 8 + body.length + (this.result ? res.length + 2 : this.ev.choices.length * 2);
    const x = (COLS - w) >> 1, y = Math.max(2, 20 - (h >> 1));
    ui.panel(x, y, w, h, 'EVENT', { style: 'double', fg: '#8a6ab8', bg: '#0c0a14', titleFg: '#b27ae8' });
    d.text(x + 4, y + 2, this.ev.title.toUpperCase(), C.bright, undefined, 99, true);
    body.forEach((l, i) => d.text(x + 4, y + 4 + i, l, C.text));
    let yy = y + 5 + body.length;
    if (!this.result) {
      this.ev.choices.forEach((ch, i) => {
        const why = ch.req?.(c, this.ctx) ?? null;
        if (ui.button(x + 4, yy, ch.text, { key: String(i + 1), w: w - 8, disabled: !!why, tip: why ?? undefined })) {
          const r = rngOf(c);
          this.result = resolveChoice(c, this.ev, this.ctx, i, r);
          saveRng(c, r);
          saveGame(c);
        }
        yy += 2;
      });
    } else {
      res.forEach((l, i) => d.text(x + 4, yy + i, l, '#c8b0f0'));
      if (ui.button(x + w - 16, y + h - 2, 'Continue', { key: 'Enter' })) app.pop();
    }
  }
}
