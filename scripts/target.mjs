// Targeting test: teleport enemies near the lance, select one, inspect to-hit, fire.
import { chromium } from 'playwright';
import path from 'path';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 960 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto('file://' + path.resolve('dist/battletext.html') + '?skirmish=battle&seed=' + (process.argv[2] ?? 12));
await page.waitForTimeout(2000);
await page.keyboard.press('Enter'); await page.waitForTimeout(1200);
await page.evaluate(() => {
  const s = window.__app.top(); const b = s.b;
  const p = b.units.filter((u) => u.team === 0); const e = b.units.filter((u) => u.team === 1);
  const m = b.map;
  e.forEach((u, i) => {
    let x = p[0].x + 6 + (i % 2) * 2, y = p[0].y - 2 + i * 2;
    for (let k = 0; k < 20; k++) { const t = m.terr[y * m.w + x]; if (t !== 'rock' && t !== 'deep' && t !== 'building' && !b.unitAt(x, y)) break; x++; }
    u.x = x; u.y = y; u.facing = 6;
  });
  b.updateVisibility(); s.reach = null;
});
const tileXY = async (tx, ty) => page.evaluate(([tx, ty]) => { const s = window.__app.top(); return [((tx - s.camX) * 2 + 1) * 10, (ty - s.camY + 1) * 20 + 10]; }, [tx, ty]);
const e0 = await page.evaluate(() => { const u = window.__app.top().b.units.find((u) => u.team === 1); return [u.x, u.y]; });
const [ex, ey] = await tileXY(e0[0], e0[1]);
await page.mouse.click(ex, ey); await page.waitForTimeout(300);
await page.mouse.move(1100, 330); await page.waitForTimeout(300);
await page.screenshot({ path: 'shots/tg_select.png' });
await page.keyboard.press('f'); await page.waitForTimeout(250);
await page.screenshot({ path: 'shots/tg_fire1.png' });
await page.waitForTimeout(300);
await page.screenshot({ path: 'shots/tg_fire2.png' });
await page.waitForTimeout(2500);
await page.screenshot({ path: 'shots/tg_after.png' });
const le = await page.evaluate(() => window.__lastError); if (le) errs.push(le);
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no errors');
await browser.close();
