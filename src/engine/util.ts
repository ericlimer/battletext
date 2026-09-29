export function stripMarkup(s: string): string {
  return s.replace(/\{(#[0-9a-fA-F]{3,6}|\/)\}/g, '');
}

export function vlen(s: string): number {
  return [...stripMarkup(s)].length;
}

/** Word-wrap plain or markup text. Markup tags do not count towards width; open color tags are
 * re-emitted on continuation lines. */
export function wrap(s: string, width: number): string[] {
  const out: string[] = [];
  for (const para of s.split('\n')) {
    const words = para.split(' ');
    let line = '';
    let len = 0;
    for (const w of words) {
      const wl = vlen(w);
      if (len > 0 && len + 1 + wl > width) {
        out.push(line);
        line = w;
        len = wl;
      } else {
        line = len > 0 || line.length > 0 ? line + ' ' + w : w;
        len += (len > 0 ? 1 : 0) + wl;
      }
    }
    out.push(line);
  }
  // Carry unclosed color tags across lines
  const fixed: string[] = [];
  let open: string[] = [];
  for (const l of out) {
    let prefix = open.map((c) => `{${c}}`).join('');
    const re = /\{(#[0-9a-fA-F]{3,6}|\/)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(l))) {
      if (m[1] === '/') open.pop();
      else open.push(m[1]);
    }
    fixed.push(prefix + l);
  }
  return fixed;
}

export function cb(n: number, withSign = false): string {
  const s = Math.abs(Math.round(n)).toLocaleString('en-US');
  const sign = n < 0 ? '-' : withSign ? '+' : '';
  return `${sign}¢${s}`;
}

/** Compact C-Bills, e.g. ¢1.25M, ¢340K */
export function cbk(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1e6) return `${sign}¢${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e3) return `${sign}¢${Math.round(a / 1e3)}K`;
  return `${sign}¢${Math.round(a)}`;
}

export function pad(s: string, n: number, right = false): string {
  const l = vlen(s);
  if (l >= n) return s;
  return right ? ' '.repeat(n - l) + s : s + ' '.repeat(n - l);
}

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export function pct(f: number): string {
  return `${Math.round(f * 100)}%`;
}

export function plural(n: number, s: string, p = s + 's'): string {
  return `${n} ${n === 1 ? s : p}`;
}

export function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
