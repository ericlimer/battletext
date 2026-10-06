// Preview pixel-art portraits: node scripts/pixpreview.mjs <src/data/pixart/gN.ts> <out.png> [Name ...]
// For each 'Mech: the portrait as the Mech Bay shows it, its zone map (one colour per location), and a damaged
// example (right arm destroyed, left torso red, legs amber). The dashed box is the size budget for its class.
import * as esbuild from 'esbuild';
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import fs from 'fs';
import path from 'path';
import os from 'os';

const [file, out = 'pix.png', ...only] = process.argv.slice(2);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pix-'));
const entry = path.join(tmp, 'entry.ts');
fs.writeFileSync(entry, `export * from ${JSON.stringify(path.resolve(file))};\nexport { pixColor, pixZone, pixWidth } from ${JSON.stringify(path.resolve('src/data/pixart.ts'))};\nexport { CHASSIS } from ${JSON.stringify(path.resolve('src/data/mechs.ts'))};`);
await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'out.mjs'), logLevel: 'warning' });
const mod = await import(pathToFileURL(path.join(tmp, 'out.mjs')).href);
const group = Object.entries(mod).find(([k, v]) => /^G\d$/.test(k) && v && typeof v === 'object')[1];
const { pixColor, pixZone, pixWidth, CHASSIS } = mod;
const ZC = { HD: '#ffffff', CT: '#e04040', LT: '#40c040', RT: '#4080ff', LA: '#e0c020', RA: '#c040e0', LL: '#20d0d0', RL: '#ff8020' };
const DMG = { RA: -1, LT: 0.2, LL: 0.5, RL: 0.5 };
const budget = (tons) => tons < 40 ? [32, 28] : tons < 60 ? [40, 32] : tons < 80 ? [44, 36] : [50, 40];
const tint = (col, h) => {
  if (h === undefined || h >= 0.98) return col;
  if (h < 0) return '#3a2626';
  const mix = (a, b, t) => '#' + [0, 2, 4].map((i) => Math.round(parseInt(a.slice(1 + i, 3 + i), 16) * (1 - t) + parseInt(b.slice(1 + i, 3 + i), 16) * t).toString(16).padStart(2, '0')).join('');
  return h > 0.3 ? mix(col, '#f09040', 0.6) : mix(col, '#ff4a3a', 0.75);
};
const S = 6; // screen pixels per art pixel
let html = '<body style="background:#0a0f14;color:#c8d2d8;font:14px monospace;margin:10px">';
for (const [name, a] of Object.entries(group)) {
  if (only.length && !only.includes(name)) continue;
  const w = pixWidth(a), h = a.px.length;
  const tons = CHASSIS.find((c) => c.name === name)?.tons ?? 50;
  const [bw, bh] = budget(tons);
  const errs = [];
  if (w > bw) errs.push(`too wide ${w}>${bw}`);
  if (h > bh) errs.push(`too tall ${h}>${bh}`);
  if (h % 2) errs.push('odd row count');
  const bad = new Set(a.px.join('').replace(/[.=#%@oclbmp ]/g, ''));
  if (bad.size) errs.push('unknown pixels ' + [...bad].join(''));
  const zs = new Set(); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (pixColor(a.px[y][x], y, h)) zs.add(pixZone(a, x, y));
  const miss = ['HD', 'CT', 'LT', 'RT', 'LA', 'RA', 'LL', 'RL'].filter((z) => !zs.has(z));
  if (miss.length) errs.push('no pixels in ' + miss.join(','));
  html += `<div style="margin:6px 0 2px">${name} · ${tons}t · ${w}×${h} px (${w}×${h / 2} cells, budget ${bw}×${bh}) <span style="color:#ff6a5a">${errs.join(' · ')}</span></div><div style="display:flex;gap:24px;align-items:flex-end">`;
  for (const mode of ['plain', 'zones', 'damaged']) {
    html += `<div style="position:relative;width:${bw * S}px;height:${bh * S}px;outline:1px dashed #2a3640;background:#0e151b">`;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let c = pixColor(a.px[y][x], y, h);
      if (!c) continue;
      const z = pixZone(a, x, y);
      if (mode === 'zones') c = ZC[z];
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
const page = await browser.newPage({ viewport: { width: 1100, height: 400 } });
await page.goto(pathToFileURL(path.join(tmp, 'p.html')).href);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('wrote', out);
