// Drive a career: new → contract → combat (auto) → aftermath → salvage. Screenshots along the way.
import { chromium } from 'playwright';
import path from 'path';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 960 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto('file://' + path.resolve('dist/battletext.html') + '?auto&speed=16');
await page.waitForTimeout(2000);
const key = async (k, w = 400) => { await page.keyboard.press(k); await page.waitForTimeout(w); };
const shot = async (n) => { await page.screenshot({ path: `shots/f_${n}.png` }); };
await key('n'); await key('Enter', 800);
await key('2'); await shot('contracts');
await key('Enter'); await shot('negotiate');
await key('Enter'); await shot('drop');
await key('Enter', 3000); await shot('combat0');
for (let i = 0; i < 200; i++) {
  await page.waitForTimeout(2000);
  const top = await page.evaluate(() => window.__app.top().constructor.name);
  if (top !== 'CombatScreen') break;
  const res = await page.evaluate(() => window.__app.top().b.result);
  if (res) { await page.waitForTimeout(1500); await shot('combatEnd'); await key('Enter', 800); break; }
}
await shot('aftermath');
await key('Enter', 600); await shot('salvage');
// pick first salvage items by clicking rows
for (let r = 0; r < 3; r++) { await page.mouse.click(300, (5 + r) * 20 + 10); await page.waitForTimeout(200); }
await shot('salvage2');
await key('Enter', 600); await shot('salvage3');
for (let r = 3; r < 12; r++) { await page.mouse.click(300, (5 + r) * 20 + 10); await page.waitForTimeout(120); }
await key('Enter', 600); await shot('salvage4');
await key('Enter', 600);
for (let i = 0; i < 40; i++) { const dd = await page.evaluate(() => window.__app.stack[0].c.deployDays); if (!dd) break; await page.waitForTimeout(250); }
await shot('back');
await key('4', 500); await shot('mechbay');
await key('5', 500); await shot('barracks');
await key('6', 500); await shot('store');
await key('3', 500); await shot('starmap');
await key('7', 500); await shot('finance');
await key('8', 500); await shot('argo');
const le = await page.evaluate(() => window.__lastError);
if (le) errs.push(le);
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no errors');
await browser.close();
