// Persistence: localStorage autosave plus JSON export/import.

import { Company } from './company';
import { ensureIcons } from './pilot';

const KEY = 'battletext.career.v1';
export let company: Company | null = null;
export function setCompany(c: Company | null): void { company = c; }

export function hasSave(): boolean {
  try { return !!localStorage.getItem(KEY); } catch { return false; }
}

export function saveGame(c: Company | null = company): boolean {
  if (!c) return false;
  ensureIcons(c.pilots);
  try { localStorage.setItem(KEY, JSON.stringify(c)); return true; } catch { return false; }
}

function valid(o: unknown): o is Company {
  const c = o as Company;
  return !!c && typeof c === 'object' && c.version === 1 && Array.isArray(c.pilots) && Array.isArray(c.systems) && Array.isArray(c.mechs);
}

export function loadGame(): Company | null {
  try {
    const s = localStorage.getItem(KEY);
    if (!s) return null;
    const c = JSON.parse(s);
    if (!valid(c)) return null;
    // Older saves could keep fallen MechWarriors assigned to the lance
    c.lancePilots = c.lancePilots.map((id: string | null) => (id && c.pilots.some((p: { id: string; dead?: boolean }) => p.id === id && !p.dead) ? id : null));
    ensureIcons(c.pilots);
    company = c;
    return c;
  } catch { return null; }
}

export function deleteSave(): void {
  try { localStorage.removeItem(KEY); localStorage.removeItem(BACKUP); } catch { /* ignore */ }
}

/** Non-ironman careers keep a snapshot taken before each deployment. */
const BACKUP = 'battletext.career.backup.v1';
export function saveBackup(c: Company): void {
  if (c.ironman) return;
  try { localStorage.setItem(BACKUP, JSON.stringify(c)); } catch { /* ignore */ }
}
export function hasBackup(): boolean {
  try { return !!localStorage.getItem(BACKUP); } catch { return false; }
}
export function restoreBackup(): Company | null {
  try {
    const s = localStorage.getItem(BACKUP);
    if (!s) return null;
    const c = JSON.parse(s);
    if (!valid(c)) return null;
    company = c;
    saveGame(c);
    return c;
  } catch { return null; }
}

/** Offers the save as a file. Inside the claude.ai artifact viewer this goes through its downloads capability
 *  (the viewer confirms the save); a plain page falls back to a download link. Resolves with a status line. */
export async function exportSave(c: Company | null = company): Promise<string> {
  if (!c) return 'No company to export.';
  const filename = `${c.name.replace(/[^\w]+/g, '_')}_day${c.day}.battletext.json`;
  const data = JSON.stringify(c);
  const cl = (window as any).claude;
  if (cl?.use) {
    const dl = await cl.use('downloads').catch(() => null);
    if (dl) {
      try { await dl.save({ filename, data }); return `Saved ${filename}.`; } catch (e) {
        const code = (e as { code?: string })?.code;
        return code === 'declined' ? 'Export cancelled.' : code === 'rate_limited' ? 'A save prompt is already open.' : `Export unavailable here (${code ?? 'error'}).`;
      }
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return `Exported ${filename}.`;
}

export function importSave(text: string): boolean {
  try {
    const c = JSON.parse(text);
    if (!valid(c)) return false;
    company = c;
    saveGame(c);
    return true;
  } catch { return false; }
}
