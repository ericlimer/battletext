// Month-end financial report, in the spirit of BATTLETECH's quarterly report.

import { Screen, app } from './app';
import { UI } from '../engine/ui';
import { C } from '../engine/color';
import { COLS } from '../engine/display';
import { company, saveGame } from '../game/save';
import { EXPENSE_LEVELS, monthlyExpenses, morale, moraleName, dateStr } from '../game/company';
import { cb } from '../engine/util';

export class MonthReportScreen implements Screen {
  modal = true;
  render(ui: UI): void {
    const d = ui.d, c = company!;
    const L = c.ledger?.[c.ledger.length - 1];
    if (!L) { app.pop(); return; }
    const w = 72, h = 26, x = (COLS - w) >> 1, y = 8;
    ui.panel(x, y, w, h, 'MONTHLY REPORT', { style: 'double', fg: '#8a7a3a', bg: '#0e0d08', titleFg: C.cbill });
    d.text(x + 4, y + 2, `${dateStr(L.day - 30)} — ${dateStr(L.day)}`, C.bright, undefined, 99, true);
    const row = (yy: number, label: string, v: number, sign = true) => {
      d.text(x + 4, yy, label, C.text);
      d.text(x + w - 22, yy, `${sign && v > 0 ? '+' : ''}${cb(v)}`.padStart(16), v < 0 ? C.red : v > 0 ? C.green : C.dim);
    };
    let yy = y + 4;
    row(yy++, 'Funds at start of month', L.start, false);
    yy++;
    row(yy++, 'Contract payments and bonuses', L.contracts);
    row(yy++, 'Sales and other income', L.sales);
    row(yy++, 'Repairs, refits and purchases', -L.other);
    if (L.loans) row(yy++, 'Loans received', L.loans);
    if (L.repaid) row(yy++, 'Loan repayments', -L.repaid);
    row(yy++, 'Operating costs (payroll, upkeep)', -L.operating);
    d.hline(x + 4, yy++, w - 8, C.border);
    const net = L.end - L.start;
    row(yy++, 'Net for the month', net);
    row(yy++, 'Funds now', L.end, false);
    yy++;
    const e = monthlyExpenses(c);
    const runway = e.total > 0 ? Math.floor(c.funds / e.total) : 99;
    d.ctext(x + 4, yy++, `Next month's costs {#f0c850}${cb(e.total)}{/} · runway {${runway < 2 ? '#e8503a' : '#f2f6f8'}}${Math.max(0, runway)} month${runway === 1 ? '' : 's'}{/}`, C.dim);
    const m = morale(c);
    d.ctext(x + 4, yy++, `Morale {#f2f6f8}${m}{/} (${moraleName(m)})`, C.dim);
    yy++;
    d.text(x + 4, yy++, 'Expense level for next month:', C.dim);
    EXPENSE_LEVELS.forEach((lv, i) => {
      if (ui.button(x + 4 + i * 13, yy, lv.name, { active: c.expense === i, w: 12, center: true, tip: `Salaries x${lv.mult.toFixed(2)}, morale ${lv.morale >= 0 ? '+' : ''}${lv.morale}` })) { c.expense = i; saveGame(c); }
    });
    if (ui.button(x + w - 16, y + h - 2, 'Continue', { key: 'Enter' }) || ui.key('Escape')) app.pop();
  }
}
