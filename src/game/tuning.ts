// Live-tunable timings for attack playback, dialled in from the in-combat tuning panel ([T]).
// Values persist per browser and are logged to telemetry when the panel closes.

export interface TuneDef { key: TuneKey; label: string; min: number; max: number; step: number; def: number; unit: string }
export type TuneKey = 'aim' | 'groupGap' | 'ripple' | 'shotSpeed' | 'impactAt' | 'missScale' | 'endHold' | 'hitStop' | 'blink' | 'blinkRate' | 'sheetHold';

export const TUNE_DEFS: TuneDef[] = [
  { key: 'aim', label: 'Aim line before the first shot', min: 0, max: 1.5, step: 0.05, def: 0.55, unit: 's' },
  { key: 'groupGap', label: 'Pause after each weapon', min: 0, max: 1.5, step: 0.05, def: 0.3, unit: 's' },
  { key: 'ripple', label: 'Same-weapon ripple (× shot time)', min: 0.1, max: 1.2, step: 0.05, def: 0.35, unit: '×' },
  { key: 'shotSpeed', label: 'Shot and missile speed', min: 0.25, max: 2, step: 0.05, def: 1, unit: '×' },
  { key: 'impactAt', label: 'Sheet updates at (× shot time)', min: 0.3, max: 1.3, step: 0.05, def: 0.8, unit: '×' },
  { key: 'missScale', label: 'A clean miss takes (× a hit)', min: 0.3, max: 1, step: 0.05, def: 1, unit: '×' },
  { key: 'endHold', label: 'Hold after the last shot', min: 0, max: 2.5, step: 0.05, def: 0.5, unit: 's' },
  { key: 'hitStop', label: 'Hit-stop on heavy hits', min: 0, max: 0.6, step: 0.02, def: 0.12, unit: 's' },
  { key: 'blink', label: 'Struck part blinks for', min: 0.2, max: 2, step: 0.05, def: 0.6, unit: 's' },
  { key: 'blinkRate', label: 'Blink on/off period', min: 0.04, max: 0.4, step: 0.02, def: 0.1, unit: 's' },
  { key: 'sheetHold', label: 'Sheet stays up after volley', min: 0.4, max: 5, step: 0.1, def: 1.6, unit: 's' },
];

const STORE = 'bt.tune';
export const TUNE: Record<TuneKey, number> = Object.fromEntries(TUNE_DEFS.map((t) => [t.key, t.def])) as Record<TuneKey, number>;
try {
  const saved = JSON.parse(localStorage.getItem(STORE) ?? '{}');
  for (const t of TUNE_DEFS) if (typeof saved[t.key] === 'number') TUNE[t.key] = Math.max(t.min, Math.min(t.max, saved[t.key]));
} catch { /* private mode */ }

/** The R11 combat reviewer's suggested cadence, one click away in the panel. */
export const REVIEWER_PRESET: Partial<Record<TuneKey, number>> = { aim: 0.35, groupGap: 0.15, ripple: 0.25, shotSpeed: 1.3, impactAt: 0.8, missScale: 0.6, endHold: 0.35, hitStop: 0.08, blink: 0.5, blinkRate: 0.1, sheetHold: 1.1 };
export function applyPreset(p: Partial<Record<TuneKey, number>>): void {
  for (const [k, v] of Object.entries(p)) TUNE[k as TuneKey] = v!;
  saveTune();
}

export function saveTune(): void {
  try { localStorage.setItem(STORE, JSON.stringify(TUNE)); } catch { /* private mode */ }
}
export function resetTune(): void {
  for (const t of TUNE_DEFS) TUNE[t.key] = t.def;
  saveTune();
}
/** Settings that differ from the defaults, for telemetry. */
export function tuneDiff(): Record<string, number> {
  return Object.fromEntries(TUNE_DEFS.filter((t) => Math.abs(TUNE[t.key] - t.def) > 1e-9).map((t) => [t.key, TUNE[t.key]]));
}

/** Play options kept per browser: semi-debug helpers the player can switch off. */
export const OPTS = { undo: true };
try { const o = JSON.parse(localStorage.getItem('bt.opts') ?? '{}'); if (typeof o.undo === 'boolean') OPTS.undo = o.undo; } catch { /* private mode */ }
export function saveOpts(): void { try { localStorage.setItem('bt.opts', JSON.stringify(OPTS)); } catch { /* private mode */ } }
