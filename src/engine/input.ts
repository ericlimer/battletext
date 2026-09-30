import { Display } from './display';
import { unlockAudio } from './sound';

export interface KeyEv {
  key: string;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  used: boolean;
}

export class Input {
  mx = -100; // fractional cell coordinates
  my = -100;
  down = false;
  clicked = false;
  rclicked = false;
  dbl = false;
  wheel = 0;
  keys: KeyEv[] = [];
  moved = false;
  held = new Set<string>();
  private lastClickT = 0;

  constructor(private d: Display) {
    const c = d.canvas;
    window.addEventListener('mousemove', (e) => {
      const [x, y] = d.toCell(e.clientX, e.clientY);
      this.mx = x; this.my = y; this.moved = true;
    });
    c.addEventListener('mousedown', (e) => {
      unlockAudio();
      if (e.button === 0) this.down = true;
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0 && this.down) {
        this.down = false;
        this.clicked = true;
        const t = performance.now();
        if (t - this.lastClickT < 320) this.dbl = true;
        this.lastClickT = t;
      }
      if (e.button === 2) this.rclicked = true;
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' || e.key === ' ' || e.key.startsWith('Arrow') || e.key === 'F1' || e.key === 'Backspace') e.preventDefault();
      if (e.metaKey) return;
      unlockAudio();
      this.held.add(e.key.length === 1 ? e.key.toLowerCase() : e.key);
      this.keys.push({ key: e.key, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, used: false });
    });
    window.addEventListener('keyup', (e) => { this.held.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key); });
    window.addEventListener('blur', () => { this.held.clear(); this.down = false; });
  }

  get cx(): number { return Math.floor(this.mx); }
  get cy(): number { return Math.floor(this.my); }

  endFrame(): void {
    this.clicked = false;
    this.rclicked = false;
    this.dbl = false;
    this.wheel = 0;
    this.keys = [];
    this.moved = false;
  }
}
