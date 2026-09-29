// Manual combat input test: select → preview → confirm move → face → end.
import { chromium } from 'playwright';
import path from 'path';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 960 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto('file://' + path.resolve('dist/battletext.html') + '?skirmish=battle&seed=11');
await page.waitForTimeout(2000);
await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
const tileXY = async (tx, ty) => page.evaluate(([tx, ty]) => { const s = window.__app.top(); return [((tx - s.camX) * 2 + 1) * 10, (ty - s.camY + 1) * 20 + 10]; }, [tx, ty]);
const info = async () => page.evaluate(() => { const s = window.__app.top(); const u = s.sel; return { sel: u && u.name, x: u && u.x, y: u && u.y, mode: s.mode, pending: s.pending, phase: s.b.phase, round: s.b.round, active: s.b.active && s.b.active.name, actor: s.lastActor }; });
console.log('start', await info());
for (let k = 0; k < 4; k++) {
  const inf = await info();
  if (!inf.sel) { await page.waitForTimeout(3000); continue; }
  const [x, y] = await tileXY(inf.x + 5, inf.y);
  await page.mouse.move(x, y); await page.waitForTimeout(300);
  if (k === 0) await page.screenshot({ path: 'shots/p_hover.png' });
  await page.mouse.click(x, y); await page.waitForTimeout(200);
  console.log('after 1st click', await info());
  await page.mouse.click(x, y); await page.waitForTimeout(1200);
  console.log('after move', await info());
  if (k === 0) await page.screenshot({ path: 'shots/p_moved.png' });
  // End turn: E then click to confirm facing
  await page.keyboard.press('e'); await page.waitForTimeout(200);
  const [fx, fy] = await tileXY(inf.x + 9, inf.y);
  await page.mouse.move(fx, fy); await page.waitForTimeout(200);
  await page.mouse.click(fx, fy); await page.waitForTimeout(1500);
  console.log('after end', await info());
}
await page.waitForTimeout(6000);
await page.screenshot({ path: 'shots/p_after.png' });
console.log('final', await info());
const le = await page.evaluate(() => window.__lastError); if (le) errs.push(le);
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no errors');
await browser.close();
