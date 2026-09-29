// Persistence: localStorage autosave plus JSON export/import.

import { Company } from './company';

const KEY = 'battletext.career.v1';
export let company: Company | null = null;
export function setCompany(c: Company | null): void { company = c; }

export function hasSave(): boolean {
  try { return !!localStorage.getItem(KEY); } catch { return false; }
}

export function saveGame(c: Company | null = company): boolean {
  if (!c) return false;
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
    company = c;
    return c;
  } catch { return null; }
}

export function deleteSave(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function exportSave(c: Company | null = company): void {
  if (!c) return;
  const blob = new Blob([JSON.stringify(c)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${c.name.replace(/[^\w]+/g, '_')}_day${c.day}.battletext.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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
