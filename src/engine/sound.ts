// Procedural sound effects via WebAudio. No assets: everything is synthesized.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let muted = false;
let volume = 0.5;
const lastPlay = new Map<string, number>();

try {
  muted = localStorage.getItem('battletext.muted') === '1';
  const v = localStorage.getItem('battletext.volume');
  if (v) volume = +v;
} catch { /* storage unavailable */ }

function ensure(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC() as AudioContext;
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    // Gentle compression keeps salvos from clipping
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    master.connect(comp);
    comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch { ctx = null; }
  return ctx;
}

/** Call from a user gesture so the browser allows audio. */
export function unlockAudio(): void {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume().catch(() => undefined);
}

export function isMuted(): boolean { return muted; }
export function setMuted(m: boolean): void {
  muted = m;
  if (master) master.gain.value = m ? 0 : volume;
  try { localStorage.setItem('battletext.muted', m ? '1' : '0'); } catch { /* ignore */ }
}

function throttle(key: string, ms: number): boolean {
  const now = performance.now();
  if ((lastPlay.get(key) ?? 0) + ms > now) return false;
  lastPlay.set(key, now);
  return true;
}

function env(g: GainNode, t: number, a: number, peak: number, dec: number): void {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
}

function tone(type: OscillatorType, f0: number, f1: number, dur: number, peak: number, delay = 0, filter?: { type: BiquadFilterType; f: number; q?: number }): void {
  const c = ctx!;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = c.createGain();
  env(g, t, 0.005, peak, dur);
  let node: AudioNode = o;
  if (filter) {
    const bq = c.createBiquadFilter();
    bq.type = filter.type; bq.frequency.value = filter.f; bq.Q.value = filter.q ?? 1;
    o.connect(bq); node = bq;
  }
  node.connect(g);
  g.connect(master!);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(dur: number, peak: number, ftype: BiquadFilterType, f0: number, f1: number, delay = 0, q = 1): void {
  const c = ctx!;
  const t = c.currentTime + delay;
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  s.playbackRate.value = 0.8 + Math.random() * 0.4;
  const bq = c.createBiquadFilter();
  bq.type = ftype;
  bq.Q.value = q;
  bq.frequency.setValueAtTime(f0, t);
  bq.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = c.createGain();
  env(g, t, 0.004, peak, dur);
  s.connect(bq); bq.connect(g); g.connect(master!);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.05);
}

export type Sfx = 'laser' | 'llaser' | 'slaser' | 'ppc' | 'ac' | 'ac20' | 'gauss' | 'mg' | 'flamer' | 'srm' | 'lrm' | 'boom' | 'bigboom' | 'hit' | 'step' | 'jump' | 'click' | 'alert' | 'crit' | 'melee';

export function sfx(kind: Sfx, delay = 0, intensity = 1): void {
  if (muted) return;
  const c = ensure();
  if (!c || c.state !== 'running') return;
  const v = intensity;
  switch (kind) {
    case 'laser':
      tone('sawtooth', 1800, 260, 0.22, 0.12 * v, delay, { type: 'lowpass', f: 3000 });
      tone('sine', 900, 180, 0.2, 0.1 * v, delay);
      break;
    case 'llaser':
      tone('sawtooth', 1200, 120, 0.4, 0.14 * v, delay, { type: 'lowpass', f: 2200 });
      tone('square', 600, 90, 0.35, 0.05 * v, delay, { type: 'lowpass', f: 1200 });
      break;
    case 'slaser':
      tone('sawtooth', 2400, 600, 0.12, 0.08 * v, delay, { type: 'lowpass', f: 4000 });
      break;
    case 'ppc':
      noise(0.5, 0.35 * v, 'bandpass', 3000, 400, delay, 2);
      tone('square', 110, 40, 0.5, 0.12 * v, delay, { type: 'lowpass', f: 600 });
      noise(0.08, 0.4 * v, 'highpass', 5000, 2000, delay);
      break;
    case 'ac':
      noise(0.18, 0.5 * v, 'lowpass', 2400, 300, delay);
      tone('sine', 140, 50, 0.18, 0.3 * v, delay);
      break;
    case 'ac20':
      noise(0.35, 0.8 * v, 'lowpass', 1800, 120, delay);
      tone('sine', 90, 30, 0.4, 0.6 * v, delay);
      break;
    case 'gauss':
      tone('sine', 300, 2400, 0.12, 0.15 * v, delay);
      noise(0.2, 0.5 * v, 'highpass', 800, 3000, delay + 0.1);
      tone('sine', 60, 30, 0.2, 0.4 * v, delay + 0.1);
      break;
    case 'mg':
      for (let i = 0; i < 4; i++) noise(0.04, 0.25 * v, 'bandpass', 2500, 1200, delay + i * 0.05, 3);
      break;
    case 'flamer':
      noise(0.6, 0.35 * v, 'bandpass', 700, 300, delay, 0.7);
      break;
    case 'srm':
      noise(0.25, 0.22 * v, 'bandpass', 800, 2400, delay, 1.5);
      break;
    case 'lrm':
      noise(0.45, 0.2 * v, 'bandpass', 500, 1800, delay, 1.2);
      break;
    case 'hit':
      if (!throttle('hit', 35)) return;
      noise(0.12, 0.25 * v, 'lowpass', 1500, 200, delay);
      break;
    case 'boom':
      noise(0.6, 0.6 * v, 'lowpass', 1200, 60, delay);
      tone('sine', 70, 25, 0.6, 0.4 * v, delay);
      break;
    case 'bigboom':
      noise(1.4, 0.9 * v, 'lowpass', 900, 40, delay);
      tone('sine', 55, 18, 1.2, 0.8 * v, delay);
      noise(0.3, 0.5 * v, 'highpass', 3000, 800, delay);
      break;
    case 'crit':
      tone('square', 880, 440, 0.12, 0.06 * v, delay);
      tone('square', 660, 330, 0.12, 0.06 * v, delay + 0.08);
      break;
    case 'step':
      if (!throttle('step', 90)) return;
      tone('sine', 70 * (0.9 + Math.random() * 0.2), 35, 0.12, 0.25 * v, delay);
      noise(0.08, 0.08 * v, 'lowpass', 400, 100, delay);
      break;
    case 'jump':
      noise(0.7, 0.3 * v, 'bandpass', 400, 1200, delay, 0.8);
      break;
    case 'melee':
      noise(0.25, 0.7 * v, 'lowpass', 900, 80, delay);
      tone('square', 120, 40, 0.25, 0.25 * v, delay, { type: 'lowpass', f: 500 });
      break;
    case 'click':
      if (!throttle('click', 40)) return;
      tone('square', 1200, 900, 0.03, 0.03 * v, delay, { type: 'lowpass', f: 3000 });
      break;
    case 'alert':
      tone('triangle', 660, 660, 0.12, 0.08 * v, delay);
      tone('triangle', 880, 880, 0.18, 0.08 * v, delay + 0.12);
      break;
  }
}

export function weaponSfx(base: string): Sfx {
  if (base === 'ML') return 'laser';
  if (base === 'LL') return 'llaser';
  if (base === 'SL') return 'slaser';
  if (base === 'PPC') return 'ppc';
  if (base === 'AC20') return 'ac20';
  if (base.startsWith('AC')) return 'ac';
  if (base === 'GAUSS') return 'gauss';
  if (base === 'MG') return 'mg';
  if (base === 'FL') return 'flamer';
  if (base.startsWith('SRM')) return 'srm';
  return 'lrm';
}
