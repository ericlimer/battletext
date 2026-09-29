// Canvas-backed character grid. Text cells are 1:2 (w:h); map tiles are "wide" cells spanning two
// columns, which makes them square. Box-drawing and block glyphs are rendered as vector shapes so
// panels join seamlessly regardless of the font.

export const COLS = 150;
export const ROWS = 48;

const F_WIDE = 1, F_CONT = 2, F_BOLD = 4;

// Box drawing: [up, down, left, right]; 1 single, 2 double, 3 heavy
const BOX: Record<string, [number, number, number, number]> = {
  '─': [0, 0, 1, 1], '│': [1, 1, 0, 0], '┌': [0, 1, 0, 1], '┐': [0, 1, 1, 0], '└': [1, 0, 0, 1], '┘': [1, 0, 1, 0],
  '├': [1, 1, 0, 1], '┤': [1, 1, 1, 0], '┬': [0, 1, 1, 1], '┴': [1, 0, 1, 1], '┼': [1, 1, 1, 1],
  '╭': [0, 1, 0, 1], '╮': [0, 1, 1, 0], '╰': [1, 0, 0, 1], '╯': [1, 0, 1, 0],
  '╴': [0, 0, 1, 0], '╶': [0, 0, 0, 1], '╵': [1, 0, 0, 0], '╷': [0, 1, 0, 0],
  '━': [0, 0, 3, 3], '┃': [3, 3, 0, 0], '┏': [0, 3, 0, 3], '┓': [0, 3, 3, 0], '┗': [3, 0, 0, 3], '┛': [3, 0, 3, 0],
  '┣': [3, 3, 0, 3], '┫': [3, 3, 3, 0], '┳': [0, 3, 3, 3], '┻': [3, 0, 3, 3], '╋': [3, 3, 3, 3],
  '═': [0, 0, 2, 2], '║': [2, 2, 0, 0], '╔': [0, 2, 0, 2], '╗': [0, 2, 2, 0], '╚': [2, 0, 0, 2], '╝': [2, 0, 2, 0],
  '╠': [2, 2, 0, 2], '╣': [2, 2, 2, 0], '╦': [0, 2, 2, 2], '╩': [2, 0, 2, 2], '╬': [2, 2, 2, 2],
  '╞': [1, 1, 0, 2], '╡': [1, 1, 2, 0], '╤': [0, 1, 2, 2], '╧': [1, 0, 2, 2],
};
const VBLOCK = ' ▁▂▃▄▅▆▇█';
const HBLOCK = ' ▏▎▍▌▋▊▉█';

export class Display {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  cols = COLS;
  rows = ROWS;
  cw = 8; // device px per cell
  chh = 16;
  dpr = 1;
  ch: string[];
  fg: string[];
  bg: string[];
  fl: Uint8Array;
  mk: Int8Array; // facing marker direction per cell (-1 none)
  mkc: string[];
  prevKey: string[];
  font = '"JetBrains Mono", "DejaVu Sans Mono", Menlo, Consolas, monospace';
  offX = 0;
  offY = 0;
  fullRedraw = true;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    const n = COLS * ROWS;
    this.ch = new Array(n).fill(' ');
    this.fg = new Array(n).fill('#c8d2d8');
    this.bg = new Array(n).fill('#05070a');
    this.fl = new Uint8Array(n);
    this.mk = new Int8Array(n).fill(-1);
    this.mkc = new Array(n).fill('');
    this.prevKey = new Array(n).fill('');
    this.resize();
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    const w = window.innerWidth * dpr, h = window.innerHeight * dpr;
    let cw = Math.floor(Math.min(w / COLS, h / ROWS / 2));
    if (cw < 4) cw = 4;
    this.cw = cw;
    this.chh = cw * 2;
    this.canvas.width = cw * COLS;
    this.canvas.height = this.chh * ROWS;
    this.canvas.style.width = `${(cw * COLS) / dpr}px`;
    this.canvas.style.height = `${(this.chh * ROWS) / dpr}px`;
    this.fullRedraw = true;
  }

  /** Convert client mouse coordinates to fractional cell coordinates. */
  toCell(clientX: number, clientY: number): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * COLS;
    const y = ((clientY - r.top) / r.height) * ROWS;
    return [x, y];
  }

  clear(bg = '#05070a'): void {
    this.ch.fill(' ');
    this.bg.fill(bg);
    this.fl.fill(0);
    this.mk.fill(-1);
  }

  inb(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < COLS && y < ROWS;
  }

  set(x: number, y: number, c: string, fg?: string, bg?: string, bold = false): void {
    if (!this.inb(x, y)) return;
    const i = y * COLS + x;
    // Writing over half of a wide glyph clears the other half
    const f = this.fl[i];
    if (f & F_WIDE && x + 1 < COLS) { this.fl[i + 1] = 0; this.ch[i + 1] = ' '; }
    if (f & F_CONT && x > 0) { this.fl[i - 1] = 0; this.ch[i - 1] = ' '; }
    this.ch[i] = c;
    if (fg !== undefined) this.fg[i] = fg;
    if (bg !== undefined) this.bg[i] = bg;
    this.fl[i] = bold ? F_BOLD : 0;
    this.mk[i] = -1;
  }

  setBg(x: number, y: number, bg: string): void {
    if (!this.inb(x, y)) return;
    this.bg[y * COLS + x] = bg;
  }
  getBg(x: number, y: number): string {
    return this.inb(x, y) ? this.bg[y * COLS + x] : '#000000';
  }
  setFg(x: number, y: number, fg: string): void {
    if (!this.inb(x, y)) return;
    this.fg[y * COLS + x] = fg;
  }

  /** A square map tile spanning columns x, x+1. */
  wide(x: number, y: number, c: string, fg: string, bg: string, mark = -1, markColor = ''): void {
    if (!this.inb(x, y) || !this.inb(x + 1, y)) return;
    const i = y * COLS + x;
    this.ch[i] = c; this.fg[i] = fg; this.bg[i] = bg; this.fl[i] = F_WIDE; this.mk[i] = mark; this.mkc[i] = markColor;
    this.ch[i + 1] = ''; this.fg[i + 1] = fg; this.bg[i + 1] = bg; this.fl[i + 1] = F_CONT; this.mk[i + 1] = -1;
  }

  text(x: number, y: number, s: string, fg?: string, bg?: string, maxw = 999, bold = false): number {
    let n = 0;
    for (const c of s) {
      if (n >= maxw) break;
      this.set(x + n, y, c, fg, bg, bold);
      n++;
    }
    return n;
  }

  /** Text with inline color markup: {#rrggbb}colored{/}. Returns printed length. */
  ctext(x: number, y: number, s: string, fg = '#c8d2d8', bg?: string, maxw = 999): number {
    let n = 0;
    const stack: string[] = [fg];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '{') {
        const end = s.indexOf('}', i);
        if (end > i) {
          const tag = s.slice(i + 1, end);
          if (tag === '/') { if (stack.length > 1) stack.pop(); i = end + 1; continue; }
          if (tag.startsWith('#')) { stack.push(tag); i = end + 1; continue; }
        }
      }
      if (n < maxw) this.set(x + n, y, c, stack[stack.length - 1], bg);
      n++;
      i++;
    }
    return Math.min(n, maxw);
  }

  fill(x: number, y: number, w: number, h: number, c: string, fg: string, bg: string): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c, fg, bg);
  }
  fillBg(x: number, y: number, w: number, h: number, bg: string): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.setBg(xx, yy, bg);
  }

  box(x: number, y: number, w: number, h: number, fg: string, bg?: string, style: 'single' | 'double' | 'heavy' | 'round' = 'single', fillInside = true): void {
    const s = style === 'double' ? '═║╔╗╚╝' : style === 'heavy' ? '━┃┏┓┗┛' : style === 'round' ? '─│╭╮╰╯' : '─│┌┐└┘';
    if (fillInside && bg) this.fill(x + 1, y + 1, w - 2, h - 2, ' ', fg, bg);
    for (let i = 1; i < w - 1; i++) { this.set(x + i, y, s[0], fg, bg); this.set(x + i, y + h - 1, s[0], fg, bg); }
    for (let j = 1; j < h - 1; j++) { this.set(x, y + j, s[1], fg, bg); this.set(x + w - 1, y + j, s[1], fg, bg); }
    this.set(x, y, s[2], fg, bg); this.set(x + w - 1, y, s[3], fg, bg);
    this.set(x, y + h - 1, s[4], fg, bg); this.set(x + w - 1, y + h - 1, s[5], fg, bg);
  }

  hline(x: number, y: number, w: number, fg: string, c = '─', bg?: string): void {
    for (let i = 0; i < w; i++) this.set(x + i, y, c, fg, bg);
  }
  vline(x: number, y: number, h: number, fg: string, c = '│', bg?: string): void {
    for (let i = 0; i < h; i++) this.set(x, y + i, c, fg, bg);
  }

  /** Smooth horizontal bar using 1/8 block glyphs. */
  bar(x: number, y: number, w: number, frac: number, fg: string, bg: string, back = '#1a2229'): void {
    frac = Math.max(0, Math.min(1, frac));
    const eighths = Math.round(frac * w * 8);
    for (let i = 0; i < w; i++) {
      const e = Math.max(0, Math.min(8, eighths - i * 8));
      if (e === 8) this.set(x + i, y, '█', fg, back);
      else if (e === 0) this.set(x + i, y, ' ', fg, back);
      else this.set(x + i, y, HBLOCK[e], fg, back);
    }
    void bg;
  }

  // ---- Rendering -------------------------------------------------------------------------
  flush(): void {
    const ctx = this.ctx;
    const cw = this.cw, chh = this.chh;
    const full = this.fullRedraw;
    this.fullRedraw = false;
    let curFont = '';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const normalPx = Math.floor(Math.min(chh * 0.8, cw / 0.6));
    const bigPx = Math.floor(chh * 0.86);
    const fNormal = `${normalPx}px ${this.font}`;
    const fBold = `bold ${normalPx}px ${this.font}`;
    const fBig = `bold ${bigPx}px ${this.font}`;
    const fBigN = `${bigPx}px ${this.font}`;

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const i = y * COLS + x;
        const f = this.fl[i];
        if (f & F_CONT) continue; // drawn with its start cell
        let key: string;
        if (f & F_WIDE) {
          key = 'W' + this.ch[i] + this.fg[i] + this.bg[i] + this.mk[i] + this.mkc[i];
        } else {
          key = this.ch[i] + this.fg[i] + this.bg[i] + f;
        }
        if (!full && key === this.prevKey[i]) continue;
        this.prevKey[i] = key;
        const px = x * cw, py = y * chh;
        const c = this.ch[i];
        const fg = this.fg[i];
        if (f & F_WIDE) {
          this.prevKey[i + 1] = '';
          ctx.fillStyle = this.bg[i];
          ctx.fillRect(px, py, cw * 2, chh);
          if (c !== ' ' && c !== '') {
            if (!this.drawSpecial(c, px, py, cw * 2, chh, fg, this.bg[i])) {
              const fnt = /[A-Za-z0-9@&%]/.test(c) ? fBig : fBigN;
              if (fnt !== curFont) { ctx.font = fnt; curFont = fnt; }
              ctx.fillStyle = fg;
              ctx.fillText(c, px + cw, py + chh * 0.54);
            }
          }
          const m = this.mk[i];
          if (m >= 0) this.drawMarker(px, py, cw * 2, chh, m, this.mkc[i]);
          continue;
        }
        // If previous frame had a wide glyph here, the continuation cell must be repainted too.
        ctx.fillStyle = this.bg[i];
        ctx.fillRect(px, py, cw, chh);
        if (c === ' ' || c === '') continue;
        if (this.drawSpecial(c, px, py, cw, chh, fg, this.bg[i])) continue;
        const fnt = f & F_BOLD ? fBold : fNormal;
        if (fnt !== curFont) { ctx.font = fnt; curFont = fnt; }
        ctx.fillStyle = fg;
        ctx.fillText(c, px + cw / 2, py + chh * 0.54);
      }
    }
    // Any continuation cell whose start was not wide last frame needs invalidation handled above:
    for (let i = 0; i < this.fl.length; i++) if (this.fl[i] & F_CONT) this.prevKey[i] = 'C';
  }

  private drawMarker(px: number, py: number, w: number, h: number, dir: number, color: string): void {
    const ctx = this.ctx;
    const dx = [0, 1, 1, 1, 0, -1, -1, -1][dir];
    const dy = [-1, -1, 0, 1, 1, 1, 0, -1][dir];
    const cx = px + w / 2 + dx * w * 0.42, cy = py + h / 2 + dy * h * 0.42;
    const s = w * 0.11;
    const ang = Math.atan2(dy, dx);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * s * 1.3, cy + Math.sin(ang) * s * 1.3);
    ctx.lineTo(cx + Math.cos(ang + 2.3) * s, cy + Math.sin(ang + 2.3) * s);
    ctx.lineTo(cx + Math.cos(ang - 2.3) * s, cy + Math.sin(ang - 2.3) * s);
    ctx.closePath();
    ctx.fill();
  }

  private drawSpecial(c: string, px: number, py: number, w: number, h: number, fg: string, bg: string): boolean {
    const ctx = this.ctx;
    const b = BOX[c];
    if (b) {
      const t = Math.max(1, Math.round(this.cw / 7));
      const cx = Math.floor(px + w / 2), cy = Math.floor(py + h / 2);
      ctx.fillStyle = fg;
      const seg = (dir: number, wt: number) => {
        if (!wt) return;
        const th = wt === 3 ? t * 2 : t;
        const offs = wt === 2 ? [-t * 1.5, t * 1.5] : [0];
        for (const o of offs) {
          const oo = Math.round(o);
          if (dir === 0) ctx.fillRect(cx - Math.floor(th / 2) + oo, py, th, cy - py + Math.ceil(th / 2) + (wt === 2 ? t * 2 : 0));
          if (dir === 1) ctx.fillRect(cx - Math.floor(th / 2) + oo, cy - Math.floor(th / 2) - (wt === 2 ? t * 2 : 0), th, py + h - cy + Math.floor(th / 2) + (wt === 2 ? t * 2 : 0));
          if (dir === 2) ctx.fillRect(px, cy - Math.floor(th / 2) + oo, cx - px + Math.ceil(th / 2) + (wt === 2 ? t * 2 : 0), th);
          if (dir === 3) ctx.fillRect(cx - Math.floor(th / 2) - (wt === 2 ? t * 2 : 0), cy - Math.floor(th / 2) + oo, px + w - cx + Math.floor(th / 2) + (wt === 2 ? t * 2 : 0), th);
        }
      };
      seg(0, b[0]); seg(1, b[1]); seg(2, b[2]); seg(3, b[3]);
      return true;
    }
    let k = VBLOCK.indexOf(c);
    if (k > 0) {
      ctx.fillStyle = fg;
      const hh = Math.round((h * k) / 8);
      ctx.fillRect(px, py + h - hh, w, hh);
      return true;
    }
    k = HBLOCK.indexOf(c);
    if (k > 0) {
      ctx.fillStyle = fg;
      ctx.fillRect(px, py, Math.round((w * k) / 8), h);
      return true;
    }
    switch (c) {
      case '▀': ctx.fillStyle = fg; ctx.fillRect(px, py, w, Math.round(h / 2)); return true;
      case '▐': ctx.fillStyle = fg; ctx.fillRect(px + Math.round(w / 2), py, w - Math.round(w / 2), h); return true;
      case '░': case '▒': case '▓': {
        ctx.globalAlpha = c === '░' ? 0.22 : c === '▒' ? 0.45 : 0.7;
        ctx.fillStyle = fg;
        ctx.fillRect(px, py, w, h);
        ctx.globalAlpha = 1;
        return true;
      }
      case '■': { ctx.fillStyle = fg; const s = Math.min(w, h) * 0.6; ctx.fillRect(px + (w - s) / 2, py + (h - s) / 2, s, s); return true; }
      case '□': case '◧': {
        const s = Math.min(w, h) * 0.6, x0 = px + (w - s) / 2, y0 = py + (h - s) / 2;
        const lw = Math.max(1, Math.round(this.cw / 8));
        ctx.strokeStyle = fg; ctx.lineWidth = lw;
        ctx.strokeRect(x0 + lw / 2, y0 + lw / 2, s - lw, s - lw);
        if (c === '◧') { ctx.fillStyle = fg; ctx.fillRect(x0, y0, s / 2, s); }
        return true;
      }
      case '▪': { ctx.fillStyle = fg; const s = Math.min(w, h) * 0.3; ctx.fillRect(px + (w - s) / 2, py + (h - s) / 2, s, s); return true; }
      case '◆': {
        ctx.fillStyle = fg; const s = Math.min(w, h) * 0.32; const cx = px + w / 2, cy = py + h / 2;
        ctx.beginPath(); ctx.moveTo(cx, cy - s); ctx.lineTo(cx + s, cy); ctx.lineTo(cx, cy + s); ctx.lineTo(cx - s, cy); ctx.closePath(); ctx.fill(); return true;
      }
      case '●': case '○': case '•': case '◦': {
        const cx = px + w / 2, cy = py + h / 2;
        const r = Math.min(w, h) * (c === '●' || c === '○' ? 0.3 : 0.14);
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
        if (c === '○' || c === '◦') { ctx.strokeStyle = fg; ctx.lineWidth = Math.max(1, this.cw / 6); ctx.stroke(); }
        else { ctx.fillStyle = fg; ctx.fill(); }
        return true;
      }
    }
    void bg;
    return false;
  }
}
