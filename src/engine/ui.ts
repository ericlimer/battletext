// Immediate-mode UI over the character grid. Widgets are drawn and hit-tested in the same call.

import { Display, COLS, ROWS } from './display';
import { Input } from './input';
import { C, lerp } from './color';
import { vlen, wrap } from './util';
import { sfx } from './sound';
import { count, currentScreen } from '../game/telemetry';

export interface ButtonOpts {
  w?: number;
  key?: string; // hotkey (single char or key name)
  keyLabel?: string;
  disabled?: boolean;
  active?: boolean;
  tip?: string | string[];
  fg?: string;
  bg?: string;
  hoverBg?: string;
  style?: 'bracket' | 'plain' | 'tab' | 'block';
  center?: boolean;
}

export class UI {
  enabled = true;
  tip: string[] | null = null;
  tipW = 44;
  focus: string | null = null;
  time = 0;
  cursor: 'default' | 'pointer' | 'crosshair' = 'default';
  private caretT = 0;

  constructor(public d: Display, public inp: Input) {}

  beginFrame(dt: number): void {
    this.time += dt;
    this.caretT += dt;
    this.tip = null;
    this.cursor = 'default';
  }

  /** The tooltip shown last frame (bookmarks record it). */
  lastTip: string[] | null = null;
  endFrame(): void {
    if (this.tip && this.tip.length) {
      this.drawTooltip(this.tip);
      // Count each tooltip once per appearance, keyed by its first line
      const first = this.tip[0].replace(/\{[^}]*\}/g, '').slice(0, 50);
      if (!this.lastTip || this.lastTip[0] !== this.tip[0]) count('tip', `${currentScreen()}:${first}`);
    }
    this.lastTip = this.tip && this.tip.length ? this.tip : null;
    this.d.canvas.style.cursor = this.cursor;
  }

  // ---- Hit-testing ------------------------------------------------------------------------
  hover(x: number, y: number, w: number, h = 1): boolean {
    if (!this.enabled) return false;
    const mx = this.inp.mx, my = this.inp.my;
    return mx >= x && mx < x + w && my >= y && my < y + h;
  }
  click(x: number, y: number, w: number, h = 1): boolean {
    if (!this.enabled || !this.inp.clicked) return false;
    if (this.hover(x, y, w, h)) {
      this.inp.clicked = false;
      return true;
    }
    return false;
  }
  rclick(x: number, y: number, w: number, h = 1): boolean {
    if (!this.enabled || !this.inp.rclicked) return false;
    if (this.hover(x, y, w, h)) {
      this.inp.rclicked = false;
      return true;
    }
    return false;
  }
  wheel(x: number, y: number, w: number, h: number): number {
    if (!this.enabled || !this.inp.wheel) return 0;
    if (this.hover(x, y, w, h)) {
      const v = this.inp.wheel;
      this.inp.wheel = 0;
      return v;
    }
    return 0;
  }

  /** Consume a key press. Letters are case-insensitive unless shift is required. */
  key(k: string, opts: { shift?: boolean; ctrl?: boolean } = {}): boolean {
    if (!this.enabled) return false;
    for (const e of this.inp.keys) {
      if (e.used) continue;
      const match = e.key.length === 1 && k.length === 1 ? e.key.toLowerCase() === k.toLowerCase() : e.key === k;
      if (!match) continue;
      if (opts.shift !== undefined && e.shift !== opts.shift) continue;
      if (opts.ctrl !== undefined && e.ctrl !== opts.ctrl) continue;
      e.used = true;
      return true;
    }
    return false;
  }
  anyKey(): boolean {
    if (!this.enabled) return false;
    for (const e of this.inp.keys) if (!e.used) { e.used = true; return true; }
    return false;
  }

  setTip(t: string | string[] | undefined): void {
    if (!t) return;
    this.tip = Array.isArray(t) ? t : [t];
  }

  // ---- Widgets ------------------------------------------------------------------------------
  button(x: number, y: number, label: string, o: ButtonOpts = {}): boolean {
    const d = this.d;
    const style = o.style ?? 'bracket';
    const keyLabel = o.keyLabel ?? (o.key ? (o.key.length === 1 ? o.key.toUpperCase() : o.key) : '');
    let inner = label;
    const natural = vlen(inner) + (keyLabel ? keyLabel.length + 1 : 0) + 2;
    let w = Math.max(o.w ?? 0, natural);
    if (o.w && style === 'bracket' && o.center === undefined) o = { ...o, center: true };
    const hov = !o.disabled && this.hover(x, y, w, 1);
    if (hov) this.cursor = 'pointer';
    let fg = o.disabled ? C.faint : o.fg ?? C.text;
    let bg = o.bg ?? (style === 'block' ? C.panelHi : undefined);
    if (o.active) { fg = C.bg; bg = C.accent; }
    else if (hov) { fg = C.bright; bg = o.hoverBg ?? '#22323e'; }
    if (bg) d.fillBg(x, y, w, 1, bg);
    let cx = x;
    if (style === 'bracket') { d.set(cx, y, '[', o.active ? C.bg : hov ? C.accent : C.faint, bg); cx++; }
    else if (style === 'block' || style === 'tab') { d.set(cx, y, ' ', fg, bg); cx++; }
    const contentW = vlen(inner) + (keyLabel ? keyLabel.length + 1 : 0);
    const avail = w - 2;
    if (o.center && contentW < avail) cx += Math.floor((avail - contentW) / 2);
    if (keyLabel) {
      d.text(cx, y, keyLabel, o.disabled ? C.faint : o.active ? C.bg : C.accent, bg, 99, true);
      cx += keyLabel.length + 1;
    }
    d.ctext(cx, y, inner, fg, bg, Math.max(0, x + w - 1 - cx));
    if (style === 'bracket') d.set(x + w - 1, y, ']', o.active ? C.bg : hov ? C.accent : C.faint, bg);
    if (hov && o.tip) this.setTip(o.tip);
    if (o.disabled) {
      if (o.key) this.key(o.key); // swallow
      return false;
    }
    if (this.click(x, y, w, 1) || (o.key && this.key(o.key))) { sfx('click'); count('click', `${currentScreen()}:${label.replace(/\{[^}]*\}/g, '').trim().slice(0, 40)}`); return true; }
    return false;
  }

  /** Panel with a title bar. */
  panel(x: number, y: number, w: number, h: number, title = '', o: { fg?: string; bg?: string; titleFg?: string; style?: 'single' | 'double' | 'heavy' | 'round' } = {}): void {
    const d = this.d;
    const fg = o.fg ?? C.border;
    d.box(x, y, w, h, fg, o.bg ?? C.panel, o.style ?? 'single');
    if (title) {
      const t = ` ${title} `;
      d.text(x + 2, y, t, o.titleFg ?? C.accent, o.bg ?? C.panel, w - 4, true);
    }
  }

  /** Header strip: filled bar with title text. */
  header(x: number, y: number, w: number, title: string, fg = C.bg, bg = C.accent): void {
    this.d.fill(x, y, w, 1, ' ', fg, bg);
    this.d.text(x + 1, y, title, fg, bg, w - 2, true);
  }

  /** Scrollable list. Returns index clicked (or -1). Scroll state lives in `state.scroll`. */
  list<T>(
    x: number, y: number, w: number, h: number, items: T[], state: { scroll: number; sel?: number },
    render: (it: T, i: number, x: number, y: number, w: number, hover: boolean, sel: boolean) => void,
    rowH = 1,
  ): number {
    const d = this.d;
    const vis = Math.floor(h / rowH);
    const maxScroll = Math.max(0, items.length - vis);
    const wh = this.wheel(x, y, w, h);
    if (wh) state.scroll += wh;
    state.scroll = Math.max(0, Math.min(maxScroll, state.scroll));
    let clicked = -1;
    for (let r = 0; r < vis; r++) {
      const i = state.scroll + r;
      if (i >= items.length) break;
      const yy = y + r * rowH;
      const hov = this.hover(x, yy, w - (maxScroll > 0 ? 1 : 0), rowH);
      if (hov) this.cursor = 'pointer';
      render(items[i], i, x, yy, w - (maxScroll > 0 ? 1 : 0), hov, state.sel === i);
      if (this.click(x, yy, w - (maxScroll > 0 ? 1 : 0), rowH)) clicked = i;
    }
    if (maxScroll > 0) {
      // scrollbar
      for (let r = 0; r < h; r++) d.set(x + w - 1, y + r, '│', C.faint);
      const th = Math.max(1, Math.round((vis / items.length) * h));
      const ty = y + Math.round((state.scroll / maxScroll) * (h - th));
      for (let r = 0; r < th; r++) d.set(x + w - 1, ty + r, '█', C.borderHi);
      if (this.inp.down && this.hover(x + w - 1, y, 1, h)) {
        state.scroll = Math.round(((this.inp.my - y) / h) * maxScroll);
      }
    }
    return clicked;
  }

  /** Horizontal slider with discrete steps. Returns new value. */
  slider(x: number, y: number, w: number, value: number, min: number, max: number, fg = C.accent): number {
    const d = this.d;
    const steps = max - min;
    for (let i = 0; i < w; i++) d.set(x + i, y, '─', C.faint);
    const pos = steps > 0 ? Math.round(((value - min) / steps) * (w - 1)) : 0;
    for (let i = 0; i <= pos; i++) d.set(x + i, y, '━', fg);
    d.set(x + pos, y, '◆', C.bright);
    const hov = this.hover(x, y - 1, w, 3);
    if (hov) this.cursor = 'pointer';
    if (hov && (this.inp.down || this.inp.clicked)) {
      const f = Math.max(0, Math.min(1, (this.inp.mx - x) / (w - 1)));
      value = Math.round(min + f * steps);
      if (this.inp.clicked) this.inp.clicked = false;
    }
    return value;
  }

  textField(id: string, x: number, y: number, w: number, value: string, maxLen = 24): string {
    const d = this.d;
    const focused = this.focus === id;
    d.fill(x, y, w, 1, ' ', C.text, focused ? '#16242e' : C.panel2);
    d.text(x + 1, y, value, C.bright, undefined, w - 2);
    if (focused && Math.floor(this.caretT * 2) % 2 === 0) d.set(x + 1 + Math.min(value.length, w - 3), y, '▏', C.accent);
    if (this.click(x, y, w, 1)) { this.focus = id; this.caretT = 0; }
    if (this.hover(x, y, w, 1)) this.cursor = 'pointer';
    if (focused && this.enabled) {
      for (const e of this.inp.keys) {
        if (e.used) continue;
        if (e.key === 'Backspace') { value = value.slice(0, -1); e.used = true; }
        else if (e.key === 'Enter' || e.key === 'Tab') { this.focus = null; e.used = true; }
        else if (e.key.length === 1 && !e.ctrl && value.length < maxLen && /[\w\s'\-.!]/.test(e.key)) { value += e.key; e.used = true; }
      }
    }
    return value;
  }

  // ---- Tooltip ------------------------------------------------------------------------------
  private drawTooltip(src: string[]): void {
    const d = this.d;
    const lines: string[] = [];
    for (const l of src) for (const w of wrap(l, this.tipW)) lines.push(w);
    const w = Math.min(this.tipW, Math.max(...lines.map(vlen))) + 4;
    const h = lines.length + 2;
    let x = Math.floor(this.inp.mx) + 2;
    let y = Math.floor(this.inp.my) + 1;
    if (x + w > COLS) x = Math.floor(this.inp.mx) - w - 1;
    if (y + h > ROWS) y = ROWS - h;
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    d.box(x, y, w, h, C.borderHi, '#0c141a', 'single');
    lines.forEach((l, i) => d.ctext(x + 2, y + 1 + i, l, C.text, '#0c141a'));
  }

  /** Dim everything already drawn (used behind modals). */
  dimAll(f = 0.35): void {
    const d = this.d;
    for (let i = 0; i < d.fg.length; i++) {
      d.fg[i] = lerp(d.fg[i], '#000000', 1 - f);
      d.bg[i] = lerp(d.bg[i], '#000000', 1 - f);
      d.mkc[i] = d.mkc[i] ? lerp(d.mkc[i], '#000000', 1 - f) : '';
    }
  }
}
