// Bookmarks: press ` anywhere to pin what's under the mouse, with an optional note and a screenshot,
// for the developer to ask about later.

import { Screen, App } from './app';
import { UI } from '../engine/ui';
import { C } from '../engine/color';
import { COLS } from '../engine/display';
import { BookmarkCtx, saveBookmark, telemetry, currentScreen } from '../game/telemetry';

const strip = (s: string) => s.replace(/\{[^}]*\}/g, '');

/** Copies the canvas with the bookmarked spot circled. */
function screenshot(app: App, cx: number, cy: number): Promise<Blob | null> {
  const src = app.d.canvas;
  try {
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    const g = c.getContext('2d')!;
    g.drawImage(src, 0, 0);
    const px = (cx + 0.5) * app.d.cw, py = (cy + 0.5) * app.d.chh;
    g.strokeStyle = '#ff3a3a'; g.lineWidth = Math.max(2, app.d.cw / 3);
    g.beginPath(); g.arc(px, py, app.d.chh * 1.4, 0, Math.PI * 2); g.stroke();
    return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
  } catch { return Promise.resolve(null); }
}

export function openBookmark(app: App, top: Screen | undefined): void {
  const ui = app.ui, d = app.d;
  const cx = Math.max(0, Math.min(COLS - 1, Math.floor(ui.inp.mx))), cy = Math.max(0, Math.floor(ui.inp.my));
  let line = '';
  for (let x = 0; x < COLS; x++) line += d.ch[cy * COLS + x] ?? ' ';
  // State from the screen being looked at (and the one under it, for modals)
  const state: Record<string, unknown> = {};
  for (const s of app.stack.slice(-2)) Object.assign(state, s.describe?.() ?? {});
  const ctx: BookmarkCtx = {
    screen: currentScreen(), cell: [cx, cy],
    tip: ui.lastTip ? ui.lastTip.map(strip) : null,
    line: line.replace(/\s+$/, ''), state,
  };
  const shot = screenshot(app, cx, cy);
  app.push(new BookmarkScreen(ctx, shot));
  void top;
}

export class BookmarkScreen implements Screen {
  modal = true;
  note = '';
  saved = 0;
  saving = false;
  constructor(public ctx: BookmarkCtx, public shot: Promise<Blob | null>) {}

  render(ui: UI, dt: number): void {
    const d = ui.d;
    const w = 84, h = 13, x = (COLS - w) >> 1, y = 12;
    ui.panel(x, y, w, h, 'BOOKMARK', { style: 'double', fg: '#f0a830', bg: '#0c0a06', titleFg: '#f0a830' });
    if (this.saved) {
      d.text(x + 3, y + 5, `Saved. ${telemetry.marks()} bookmark${telemetry.marks() === 1 ? '' : 's'} this session — I'll ask you about them.`, C.green);
      this.saved -= dt;
      if (this.saved <= 0) (window as any).__app.pop();
      return;
    }
    const ht = this.ctx.state.hoverTile as { x: number; y: number; terrain: string; elev: number; unit: string | null } | null | undefined;
    const what = this.ctx.tip?.[0] ?? (ht ? `map tile ${ht.x},${ht.y} · ${ht.terrain}, elevation ${ht.elev}${ht.unit ? ` · ${ht.unit}` : ''}` : this.ctx.line.slice(Math.max(0, this.ctx.cell[0] - 30), this.ctx.cell[0] + 30).trim());
    d.text(x + 3, y + 2, `Pinned on ${this.ctx.screen.replace(/Screen$/, '')}:`, C.dim);
    d.text(x + 3, y + 3, what || '(empty space)', C.bright, undefined, w - 6);
    d.text(x + 3, y + 5, 'Note (optional) — what\'s wrong, confusing, or great here?', C.dim);
    d.fill(x + 3, y + 6, w - 6, 2, ' ', C.text, '#16242e');
    const shown = this.note.length > (w - 8) * 2 ? '…' + this.note.slice(-(w - 8) * 2 + 1) : this.note;
    d.text(x + 4, y + 6, shown.slice(0, w - 8), C.bright);
    d.text(x + 4, y + 7, shown.slice(w - 8), C.bright);
    const caretLen = shown.length;
    if (Math.floor(Date.now() / 500) % 2 === 0) d.set(x + 4 + (caretLen % (w - 8)), y + 6 + Math.min(1, Math.floor(caretLen / (w - 8))), '▏', C.accent);
    d.text(x + 3, y + 10, this.saving ? 'Saving…' : '[Enter] save   [Esc] cancel   (a screenshot is attached automatically)', C.faint);
    if (this.saving) return;
    for (const e of ui.inp.keys) {
      if (e.used) continue;
      e.used = true;
      if (e.key === 'Escape') { (window as any).__app.pop(); return; }
      if (e.key === 'Enter') { void this.save(); return; }
      if (e.key === 'Backspace') this.note = this.note.slice(0, -1);
      else if (e.key.length === 1 && !e.ctrl && this.note.length < 500) this.note += e.key;
    }
  }

  async save(): Promise<void> {
    this.saving = true;
    const blob = await this.shot;
    await saveBookmark(this.ctx, this.note.trim(), blob);
    this.saving = false;
    this.saved = 1.2;
  }
}
