// Preview vehicle / emplacement portraits: node scripts/vehpreview.mjs <out.png> [ID ...]
// For each vehicle: the portrait, its zone map (one colour per location) and a damaged example
// (turret destroyed, right side red, front amber). The dashed box is the size budget (40x24, turrets 24x24).
import * as esbuild from 'esbuild';
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import fs from 'fs';
import path from 'path';
import os from 'os';

const [out = 'veh.png', ...only] = process.argv.slice(2);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vpix-'));
const entry = path.join(tmp, 'entry.ts');
fs.writeFileSync(entry, `export { VPIX } from ${JSON.stringify(path.resolve('src/data/pixart/vehicles.ts'))};\nexport { pixColor } from ${JSON.stringify(path.resolve('src/data/pixart.ts'))};\nexport { VEHICLES } from ${JSON.stringify(path.resolve('src/data/vehicles.ts'))};`);
await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'out.mjs'), logLevel: 'warning' });
const { VPIX, pixColor, VEHICLES } = await import(pathToFileURL(path.join(tmp, 'out.mjs')).href);
const ZC = { T: '#ffffff', F: '#e04040', L: '#40c040', R: '#4080ff', B: '#ff8020' };
const DMG = { T: -1, R: 0.2, F: 0.5 };
const tint = (col, h) => {
  if (h === undefined || h >= 0.98) return col;
  if (h < 0) return '#3a2626';
  const mix = (a, b, t) => '#' + [0, 2, 4].map((i) => Math.round(parseInt(a.slice(1 + i, 3 + i), 16) * (1 - t) + parseInt(b.slice(1 + i, 3 + i), 16) * t).toString(16).padStart(2, '0')).join('');
  return h > 0.3 ? mix(col, '#f09040', 0.6) : mix(col, '#ff4a3a', 0.75);
};
const S = 6;
let html = '<body style="background:#0a0f14;color:#c8d2d8;font:14px monospace;margin:10px">';
const missingArt = VEHICLES.filter((v) => !VPIX[v.id]).map((v) => v.id);
if (missingArt.length) html += `<div style="color:#ff6a5a">no art: ${missingArt.join(', ')}</div>`;
for (const v of VEHICLES) {
  const a = VPIX[v.id];
  if (!a || (only.length && !only.includes(v.id))) continue;
  const w = Math.max(...a.px.map((r) => r.length)), h = a.px.length;
  const [bw, bh] = v.kind === 'turret' ? [24, 24] : [40, 24];
  const errs = [];
  if (w > bw) errs.push(`too wide ${w}>${bw}`);
  if (h > bh) errs.push(`too tall ${h}>${bh}`);
  if (h % 2) errs.push('odd row count');
  if (a.zones.length !== h || a.zones.some((r, i) => r.length !== a.px[i].length)) errs.push('zone mask shape differs');
  const bad = new Set(a.px.join('').replace(/[.=#%@oclbmp ]/g, ''));
  if (bad.size) errs.push('unknown pixels ' + [...bad].join(''));
  const zs = new Set();
  let unz = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (pixColor(a.px[y][x], y, h)) { const z = a.zones[y]?.[x]; if (!z || z === '.') unz++; else zs.add(z); }
  if (unz) errs.push(`${unz} pixels without zone`);
  const want = Object.entries(v.armor).filter(([, n]) => n > 0).map(([k]) => k);
  const miss = want.filter((z) => !zs.has(z));
  if (miss.length) errs.push('no pixels in ' + miss.join(','));
  const extra = [...zs].filter((z) => !want.includes(z));
  if (extra.length) errs.push('zones not on this vehicle ' + extra.join(','));
  html += `<div style="margin:6px 0 2px">${v.id} · ${v.name} · ${v.tons}t · ${w}×${h} px <span style="color:#ff6a5a">${errs.join(' · ')}</span></div><div style="display:flex;gap:24px;align-items:flex-end">`;
  for (const mode of ['plain', 'zones', 'damaged']) {
    html += `<div style="position:relative;width:${bw * S}px;height:${bh * S}px;outline:1px dashed #2a3640;background:#0e151b">`;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let c = pixColor(a.px[y][x], y, h);
      if (!c) continue;
      const z = a.zones[y][x];
      if (mode === 'zones') c = ZC[z] ?? '#ff00ff';
      if (mode === 'damaged') c = tint(c, DMG[z]);
      html += `<i style="position:absolute;left:${((bw - w) >> 1) * S + x * S}px;top:${(bh - h) * S + y * S}px;width:${S}px;height:${S}px;background:${c}"></i>`;
    }
    html += '</div>';
  }
  html += '</div>';
}
html += `<div style="margin-top:8px;color:#6d7f8a">zones: ${Object.entries(ZC).map(([k, v]) => `<b style="color:${v}">${k}</b>`).join(' ')}</div></body>`;
fs.writeFileSync(path.join(tmp, 'p.html'), html);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 400 } });
await page.goto(pathToFileURL(path.join(tmp, 'p.html')).href);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('wrote', out);
