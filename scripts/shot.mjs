// Screenshot helper: node scripts/shot.mjs <query> <out.png> [waitMs] [actions-json]
import { chromium } from 'playwright';
import path from 'path';
const [q = '', out = 'shots/shot.png', wait = '1500', actions = '[]'] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 960 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('file://' + path.resolve('dist/battletext.html') + (q ? '?' + q : ''));
await page.waitForTimeout(+wait);
for (const a of JSON.parse(actions)) {
  if (a.key) await page.keyboard.press(a.key);
  if (a.click) await page.mouse.click(a.click[0] * 10 + 5, a.click[1] * 20 + 10);
  if (a.move) await page.mouse.move(a.move[0] * 10 + 5, a.move[1] * 20 + 10, { steps: 4 });
  if (a.down) { await page.mouse.move(a.down[0] * 10 + 5, a.down[1] * 20 + 10); await page.mouse.down(); }
  if (a.up) { await page.mouse.move(a.up[0] * 10 + 5, a.up[1] * 20 + 10, { steps: 6 }); await page.waitForTimeout(100); await page.mouse.up(); }
  if (a.eval) await page.evaluate(a.eval);
  await page.waitForTimeout(a.wait ?? 300);
}
const clip = process.env.CLIP ? (([x, y, width, height]) => ({ x, y, width, height }))(process.env.CLIP.split(',').map(Number)) : undefined;
await page.screenshot({ path: out, clip, ...(/\.jpe?g$/.test(out) ? { quality: 80 } : {}) });
const le = await page.evaluate(() => window.__lastError);
if (le) errors.push(le);
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
await browser.close();
