// Live-tunable timings for attack playback, dialled in from the in-combat tuning panel ([T]).
// Values persist per browser and are logged to telemetry when the panel closes.

export interface TuneDef { key: TuneKey; label: string; min: number; max: number; step: number; def: number; unit: string }
export type TuneKey = 'aim' | 'groupGap' | 'ripple' | 'shotSpeed' | 'impactAt' | 'endHold' | 'hitStop' | 'blink' | 'blinkRate' | 'sheetHold';

export const TUNE_DEFS: TuneDef[] = [
  { key: 'aim', label: 'Aim line before the first shot', min: 0, max: 1.5, step: 0.05, def: 0.55, unit: 's' },
  { key: 'groupGap', label: 'Pause after each weapon', min: 0, max: 1.5, step: 0.05, def: 0.3, unit: 's' },
  { key: 'ripple', label: 'Same-weapon ripple (× shot time)', min: 0.1, max: 1.2, step: 0.05, def: 0.35, unit: '×' },
  { key: 'shotSpeed', label: 'Shot and missile speed', min: 0.25, max: 2, step: 0.05, def: 1, unit: '×' },
  { key: 'impactAt', label: 'Sheet updates at (× shot time)', min: 0.3, max: 1.3, step: 0.05, def: 0.8, unit: '×' },
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
