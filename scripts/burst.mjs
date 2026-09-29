// Take a series of screenshots over time: node scripts/burst.mjs <query> <prefix> <startMs> <count> <intervalMs>
import { chromium } from 'playwright';
import path from 'path';
const [q, prefix, start, count, interval] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 960 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto('file://' + path.resolve('dist/battletext.html') + '?' + q);
await page.waitForTimeout(+start);
for (let i = 0; i < +count; i++) { await page.screenshot({ path: `${prefix}${i}.png` }); await page.waitForTimeout(+interval); }
const le = await page.evaluate(() => window.__lastError); if (le) console.log('ERR', le);
await browser.close();
