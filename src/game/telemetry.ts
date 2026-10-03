// Play telemetry and bookmarks.
//
// Everything is recorded for the developer (Claude) to read back between play sessions, so the
// player's feedback costs them as little effort as possible. On the published artifact it lands in
// the artifact's own database (collections `sessions`, `events`, `marks`), with bookmark screenshots
// in its asset store; when the page runs anywhere else it is kept in localStorage instead.

import { company } from './save';

declare const __BUILD__: string;

type Ev = { t: number; k: string; [x: string]: unknown };
type DbLike = { doc(p: string): { set(d: Record<string, unknown>): Promise<void> } };
type AssetsLike = { upload(b: Blob, o?: { type?: string }): Promise<{ id: string }> };

const startedAt = Date.now();
const sid = new Date(startedAt).toISOString().replace(/[-:]/g, '').slice(0, 15) + '-' + Math.random().toString(36).slice(2, 6);
let events: Ev[] = [];
let chunk = 0, marks = 0;
const counters: Record<string, Record<string, number>> = { click: {}, key: {}, tip: {}, screenTime: {} };
let db: DbLike | null = null, assets: AssetsLike | null = null;
let ready = false, flushing = false, lastFlush = Date.now();
let screen = '';

export const telemetry = {
  sid,
  /** Where data is going, for the title screen. */
  status(): string { return !ready ? 'connecting…' : db ? 'on · saved to this artifact\'s private database' : 'on · kept in this browser only'; },
  marks(): number { return marks; },
};

export function build(): string { try { return __BUILD__; } catch { return 'dev'; } }

/** Records one event. Keep payloads small: they are batched and uploaded. */
export function track(k: string, data: Record<string, unknown> = {}): void {
  events.push({ t: Math.round((Date.now() - startedAt) / 100) / 10, k, ...data });
  if (events.length >= 400) { if (ready) void flush(); else if (events.length > 5000) events.splice(0, 1000); }
}

/** Bumps an aggregate counter (button clicks, keys, tooltips) — cheap enough to call every frame. */
export function count(group: string, key: string, by = 1): void {
  const g = (counters[group] ??= {});
  g[key] = (g[key] ?? 0) + by;
}

export function setScreen(name: string): void {
  if (name === screen) return;
  screen = name;
  track('screen', { name });
}
export function currentScreen(): string { return screen; }

/** Called every frame with the frame time, to total time per screen. */
export function tick(dt: number): void {
  if (screen) count('screenTime', screen, Math.round(dt * 1000) / 1000);
  if (Date.now() - lastFlush > 60000 && events.length) void flush();
}

export async function initTelemetry(): Promise<void> {
  const cl = (window as any).claude;
  try { db = cl?.use ? await cl.use('db') : null; } catch { db = null; }
  try { assets = cl?.use ? await cl.use('assets') : null; } catch { assets = null; }
  ready = true;
  track('session', { build: build(), w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio, ua: navigator.userAgent.slice(0, 120), store: db ? 'db' : 'local' });
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flush(); });
  addEventListener('error', (e) => track('error', { msg: String(e.message).slice(0, 300) }));
}

/** Uploads buffered events plus the session summary. One write in flight at a time. */
export async function flush(): Promise<void> {
  if (flushing || !ready) return;
  flushing = true;
  lastFlush = Date.now();
  const batch = events;
  events = [];
  const c = company;
  const career = c ? { name: c.name, day: c.day, funds: c.funds, mrb: c.mrb, missions: c.stats.missions, wins: c.stats.wins, mechs: c.mechs.length, pilots: c.pilots.filter((p) => !p.dead).length } : null;
  const summary = { sid, build: build(), career, start: new Date(startedAt).toISOString(), last: new Date().toISOString(), minutes: Math.round((Date.now() - startedAt) / 6000) / 10, chunks: chunk + (batch.length ? 1 : 0), marks, counters };
  try {
    if (db) {
      if (batch.length) await db.doc(`events/${sid}_${String(chunk).padStart(3, '0')}`).set({ sid, n: chunk, events: batch });
      if (batch.length) chunk++;
      await db.doc(`sessions/${sid}`).set(summary);
    } else {
      localPush('bt.telemetry.events', batch, 3000);
      try { localStorage.setItem('bt.telemetry.session.' + sid, JSON.stringify(summary)); } catch { /* full */ }
    }
  } catch (e) {
    // Keep the batch for the next attempt rather than losing it
    events = [...batch, ...events].slice(-2000);
    track('telemetry_error', { code: (e as any)?.code ?? String(e).slice(0, 80) });
  } finally { flushing = false; }
}

function localPush(key: string, items: unknown[], max: number): void {
  try {
    const prev = JSON.parse(localStorage.getItem(key) ?? '[]');
    localStorage.setItem(key, JSON.stringify([...prev, ...items].slice(-max)));
  } catch { /* storage full or blocked */ }
}

export interface BookmarkCtx {
  screen: string;
  cell: [number, number];
  tip: string[] | null;
  /** The text row under the cursor, as drawn. */
  line: string;
  /** Whatever the screen reports about its state (day, funds, round, selected unit…). */
  state: Record<string, unknown>;
}

/** Saves a bookmark: context, optional note, and a screenshot with the spot circled. */
export async function saveBookmark(ctx: BookmarkCtx, note: string, shot: Blob | null): Promise<string> {
  marks++;
  const id = `${sid}_m${String(marks).padStart(2, '0')}`;
  const doc: Record<string, unknown> = { id, sid, at: new Date().toISOString(), t: Math.round((Date.now() - startedAt) / 1000), build: build(), note, ...ctx };
  track('bookmark', { id, screen: ctx.screen, note: note.slice(0, 120) });
  try {
    if (shot && assets) { const r = await assets.upload(shot, { type: 'image/png' }); doc.shot = r.id; }
  } catch (e) { doc.shotError = (e as any)?.code ?? 'failed'; }
  try {
    if (db) await db.doc(`marks/${id}`).set(doc);
    else localPush('bt.marks', [doc], 200);
  } catch { localPush('bt.marks', [doc], 200); }
  void flush();
  return id;
}
