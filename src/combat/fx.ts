// Visual effects in map space: projectiles, beams, particles, lights, floating text.

import { rgb } from '../engine/color';

export interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number;
  glyph: string | string[];
  c0: string; c1: string;
  light?: number; // light radius
  lc?: string; // light color
  bgTint?: number;
  onDie?: () => void;
  delay?: number;
  gravity?: number;
}

export interface Beam {
  x0: number; y0: number; x1: number; y1: number;
  life: number; max: number;
  color: string;
  core: string;
  glyph?: string;
  crackle?: boolean;
  delay?: number;
}

export interface Floater {
  x: number; y: number; text: string; color: string; life: number; max: number; big?: boolean; delay?: number;
}

export interface Light { x: number; y: number; r: number; color: string; intensity: number; }

export class FX {
  parts: Particle[] = [];
  beams: Beam[] = [];
  floats: Floater[] = [];
  flash = 0; // screen flash intensity
  shake = 0;

  busy(): boolean {
    return this.parts.some((p) => !p.gravity && p.max < 2 && p.life < p.max) || this.beams.length > 0;
  }

  update(dt: number): void {
    for (const p of this.parts) {
      if (p.delay && p.delay > 0) { p.delay -= dt; continue; }
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.gravity) p.vy += p.gravity * dt;
      if (p.life >= p.max && p.onDie) { const f = p.onDie; p.onDie = undefined; f(); }
    }
    this.parts = this.parts.filter((p) => p.life < p.max);
    for (const b of this.beams) { if (b.delay && b.delay > 0) { b.delay -= dt; continue; } b.life += dt; }
    this.beams = this.beams.filter((b) => b.life < b.max);
    for (const f of this.floats) { if (f.delay && f.delay > 0) { f.delay -= dt; continue; } f.life += dt; }
    this.floats = this.floats.filter((f) => f.life < f.max);
    this.flash = Math.max(0, this.flash - dt * 3);
    this.shake = Math.max(0, this.shake - dt * 4);
  }

  lights(): Light[] {
    const out: Light[] = [];
    for (const p of this.parts) {
      if (!p.light || (p.delay && p.delay > 0)) continue;
      const f = 1 - p.life / p.max;
      out.push({ x: p.x, y: p.y, r: p.light, color: p.lc ?? p.c0, intensity: f });
    }
    for (const b of this.beams) {
      if (b.delay && b.delay > 0) continue;
      const f = 1 - b.life / b.max;
      out.push({ x: b.x1, y: b.y1, r: 2.5, color: b.color, intensity: f });
      out.push({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, r: 2, color: b.color, intensity: f * 0.6 });
      out.push({ x: b.x0, y: b.y0, r: 1.8, color: b.color, intensity: f * 0.8 });
    }
    return out;
  }

  // ---- Emitters -----------------------------------------------------------------------
  sparks(x: number, y: number, n: number, colors: [string, string], speed = 3, delay = 0, life = 0.4): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random());
      this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: life * (0.6 + Math.random() * 0.6), glyph: ['*', '·', '+', '•'], c0: colors[0], c1: colors[1], delay, light: i === 0 ? 2 : 0 });
    }
  }

  explosion(x: number, y: number, size: number, delay = 0): void {
    const n = 6 + size * 8;
    this.parts.push({ x, y, vx: 0, vy: 0, life: 0, max: 0.35 + size * 0.15, glyph: '☼', c0: '#ffffff', c1: '#f0a830', light: 3 + size * 2, lc: '#ffb040', delay });
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = (1 + size) * (0.6 + Math.random() * 1.4);
      this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: 0.4 + Math.random() * 0.4 + size * 0.1,
        glyph: ['*', '✶', '•', '+', '×'], c0: Math.random() < 0.5 ? '#fff0a0' : '#ffb040', c1: '#a02010', delay });
    }
    // smoke
    for (let i = 0; i < 3 + size * 3; i++) {
      const a = Math.random() * Math.PI * 2, s = 0.3 + Math.random() * 0.6;
      this.parts.push({ x: x + Math.cos(a) * 0.5, y: y + Math.sin(a) * 0.5, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.4, life: 0, max: 1.5 + Math.random() * 1.5 + size * 0.4,
        glyph: ['░', '▒', '░'], c0: '#5a5048', c1: '#1a1816', delay: delay + 0.15, gravity: -0.05 });
    }
    if (size >= 2) { this.flash = Math.max(this.flash, 0.15 * size); this.shake = Math.max(this.shake, 0.3 * size); }
  }

  smoke(x: number, y: number): void {
    this.parts.push({ x: x + (Math.random() - 0.5) * 0.4, y, vx: (Math.random() - 0.5) * 0.3, vy: -0.4 - Math.random() * 0.3, life: 0, max: 2 + Math.random(),
      glyph: ['░', '░', '▒'], c0: '#4a4440', c1: '#141210', gravity: -0.02 });
  }

  fire(x: number, y: number): void {
    this.parts.push({ x: x + (Math.random() - 0.5) * 0.6, y: y + 0.2, vx: (Math.random() - 0.5) * 0.3, vy: -0.8 - Math.random() * 0.5, life: 0, max: 0.5 + Math.random() * 0.4,
      glyph: ['^', '*', '\''], c0: '#ffd060', c1: '#a02010', light: 1.5, lc: '#ff7020' });
  }

  float(x: number, y: number, text: string, color: string, big = false, delay = 0): void {
    // Stack floaters that start at the same tile
    const same = this.floats.filter((f) => Math.abs(f.x - x) < 1.5 && f.life < f.max * 0.6 && Math.abs(f.y - y) < 4).length;
    this.floats.push({ x, y: y - same * 1.0, text, color, life: 0, max: big ? 2.0 : 1.6, big, delay: delay + same * 0.12 });
  }

  /** Bolt/shell travelling from a to b. Returns travel time. */
  projectile(x0: number, y0: number, x1: number, y1: number, glyph: string, c0: string, c1: string, speed: number, delay: number, onHit?: () => void, arc = 0, trail?: string): number {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const t = Math.max(0.08, d / speed);
    if (arc) {
      // Missiles: simulate an arc by splitting into a few segments
      const nx = -(y1 - y0) / (d || 1), ny = (x1 - x0) / (d || 1);
      const steps = 6;
      for (let s = 0; s < steps; s++) {
        const f0 = s / steps, f1 = (s + 1) / steps;
        const o0 = Math.sin(f0 * Math.PI) * arc, o1 = Math.sin(f1 * Math.PI) * arc;
        const ax = x0 + (x1 - x0) * f0 + nx * o0, ay = y0 + (y1 - y0) * f0 + ny * o0;
        const bx = x0 + (x1 - x0) * f1 + nx * o1, by = y0 + (y1 - y0) * f1 + ny * o1;
        const seg = t / steps;
        this.parts.push({ x: ax, y: ay, vx: (bx - ax) / seg, vy: (by - ay) / seg, life: 0, max: seg, glyph, c0, c1: c0, delay: delay + s * seg, light: 1.2, lc: '#ffa040',
          onDie: s === steps - 1 ? onHit : undefined });
        if (trail) this.parts.push({ x: ax, y: ay, vx: 0, vy: -0.2, life: 0, max: 0.5, glyph: trail, c0: '#8a8078', c1: '#2a2826', delay: delay + s * seg + seg * 0.5 });
      }
    } else {
      this.parts.push({ x: x0, y: y0, vx: (x1 - x0) / t, vy: (y1 - y0) / t, life: 0, max: t, glyph, c0, c1, delay, light: 1.5, lc: c0, onDie: onHit });
    }
    return t;
  }

  beam(x0: number, y0: number, x1: number, y1: number, color: string, core: string, dur: number, delay: number, crackle = false): void {
    this.beams.push({ x0, y0, x1, y1, life: 0, max: dur, color, core, delay, crackle });
  }
}

export function lightAt(lights: Light[], x: number, y: number): [number, number, number] {
  let r = 0, g = 0, b = 0;
  for (const l of lights) {
    const d2 = (l.x - x) ** 2 + (l.y - y) ** 2;
    if (d2 > l.r * l.r) continue;
    const f = (1 - Math.sqrt(d2) / l.r) * l.intensity;
    const c = rgb(l.color);
    r += (c[0] / 255) * f;
    g += (c[1] / 255) * f;
    b += (c[2] / 255) * f;
  }
  return [r, g, b];
}
