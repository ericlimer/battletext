// Store: buy from the local market, sell from storage.

import { UI } from '../engine/ui';
import { C } from '../engine/color';
import type { ArgoScreen } from './argo';
import { company, saveGame } from '../game/save';
import { sys, sellPrice, bays, addLog, priceMult, PARTS_NEEDED } from '../game/company';
import { item, HARD_COLORS } from '../data/items';
import { chassis } from '../data/mechs';
import { newMechFrame, weaponSummary } from '../game/frame';
import { faction, repLevel } from '../data/factions';
import { cb, cbk } from '../engine/util';
import { weaponTip, hardpointStr } from './widgets';

type Cat = 'all' | 'weapon' | 'equip' | 'ammo' | 'mech';

export function drawStoreTab(ui: UI, argo: ArgoScreen, x: number, y: number, w: number, h: number): void {
  const d = ui.d, c = company!;
  const st = (argo.st.store ??= { cat: 'all' as Cat, buy: { scroll: 0 }, sell: { scroll: 0 }, confirmPart: '' });
  if (c.travel) {
    ui.panel(x + 1, y, w - 2, h, 'STORE');
    d.text(x + 4, y + 3, 'Markets are only accessible while docked.', C.cyan);
    return;
  }
  const s = sys(c);
  const own = faction(s.owner);
  const cats: [Cat, string][] = [['all', 'All'], ['weapon', 'Weapons'], ['equip', 'Equipment'], ['ammo', 'Ammo'], ['mech', '\'Mechs & Parts']];
  cats.forEach(([k, n], i) => { if (ui.button(x + 2 + i * 17, y, n, { active: st.cat === k, w: 16, center: true })) st.cat = k; });
  d.ctext(x + 90, y, `{${own.color}}${own.short}{/} market · ${repLevel(c.rep[s.owner] ?? 0).name} · prices x${priceMult(c, s).toFixed(2)}`, C.dim);
  const match = (kind: 'item' | 'part' | 'mech', id: string) => {
    if (st.cat === 'all') return true;
    if (st.cat === 'mech') return kind !== 'item';
    if (kind !== 'item') return false;
    const k = item(id).kind;
    return st.cat === 'weapon' ? k === 'weapon' : st.cat === 'ammo' ? k === 'ammo' : k !== 'weapon' && k !== 'ammo';
  };
  // Buy
  const stock = (c.stores[c.location] ?? []).filter((si) => si.qty > 0 && match(si.kind, si.id));
  const half = Math.floor((w - 3) / 2);
  ui.panel(x + 1, y + 2, half, h - 2, `BUY · ${s.name.toUpperCase()}`);
  const bl = ui.list(x + 2, y + 3, half - 2, h - 4, stock, st.buy, (si, _i, lx, ly, lw, hov) => {
    const bg = hov ? '#16222c' : '#0a0e13';
    d.fill(lx, ly, lw, 1, ' ', C.text, bg);
    const afford = c.funds >= si.price;
    if (si.kind === 'item') {
      const dd = item(si.id);
      d.set(lx + 1, ly, dd.kind === 'weapon' ? dd.hard! : dd.kind === 'ammo' ? '•' : '◦', dd.kind === 'weapon' ? HARD_COLORS[dd.hard!] : C.dim, bg);
      d.text(lx + 3, ly, dd.name, dd.tier ? C.accent : C.text, bg, 30);
      d.text(lx + 34, ly, `${dd.tons}t`, C.faint, bg);
      if (hov) ui.setTip([...weaponTip(si.id), `Owned: ${c.inventory[si.id] ?? 0}`]);
    } else {
      const ch = chassis(si.id);
      d.text(lx + 1, ly, si.kind === 'mech' ? '▣' : '⚙', si.kind === 'mech' ? C.accent : C.cyan, bg);
      d.text(lx + 3, ly, `${ch.name} ${ch.id}${si.kind === 'part' ? ' part' : ''}`, si.kind === 'mech' ? C.bright : C.cyan, bg, 30);
      d.text(lx + 34, ly, `${ch.tons}t`, C.faint, bg);
      if (hov) ui.setTip([`${ch.name} ${ch.id} · ${ch.tons}t`, si.kind === 'part' ? `One of ${PARTS_NEEDED} parts needed to assemble. You have ${c.parts[si.id] ?? 0}.` : 'Complete, combat-ready \'Mech with stock loadout.', ch.desc, weaponSummary(newMechFrame(si.id))]);
    }
    d.text(lx + 40, ly, `x${si.qty}`, C.dim, bg);
    d.text(lx + lw - 10, ly, cbk(si.price).padStart(9), afford ? C.cbill : C.red, bg);
  });
  if (bl >= 0) {
    const si = stock[bl];
    if (c.funds < si.price) argo.notify('Not enough C-Bills', C.red);
    else if (si.kind === 'mech' && c.mechs.length >= bays(c) && false) argo.notify('No free bays', C.red);
    else {
      c.funds -= si.price; c.stats.spent += si.price; si.qty--;
      if (si.kind === 'item') c.inventory[si.id] = (c.inventory[si.id] ?? 0) + 1;
      else if (si.kind === 'part') c.parts[si.id] = (c.parts[si.id] ?? 0) + 1;
      else { const f = newMechFrame(si.id); if (c.mechs.length < bays(c)) c.mechs.push(f); else c.storage.push(f); addLog(c, `Purchased ${chassis(si.id).name} ${si.id} for ${cb(si.price)}.`, '#f0c850'); }
      saveGame(c);
      argo.notify(`Bought ${si.kind === 'item' ? item(si.id).name : chassis(si.id).name} for ${cbk(si.price)}`, C.cbill);
    }
  }
  // Sell
  const inv = Object.entries(c.inventory).filter(([id, n]) => n > 0 && match('item', id)).map(([id, n]) => ({ kind: 'item' as const, id, n }));
  const parts = st.cat === 'all' || st.cat === 'mech' ? Object.entries(c.parts).filter(([, n]) => n > 0).map(([id, n]) => ({ kind: 'part' as const, id, n })) : [];
  const sellList = [...parts, ...inv];
  const sx = x + 2 + half;
  ui.panel(sx, y + 2, w - half - 3, h - 2, 'SELL · COMPANY STORAGE');
  const sl = ui.list(sx + 1, y + 3, w - half - 5, h - 4, sellList, st.sell, (e, _i, lx, ly, lw, hov) => {
    const bg = hov ? '#16222c' : '#0a0e13';
    d.fill(lx, ly, lw, 1, ' ', C.text, bg);
    let name: string, price: number;
    if (e.kind === 'item') { name = item(e.id).name; price = sellPrice(c, e.id); if (hov) ui.setTip(weaponTip(e.id)); }
    else { name = `${chassis(e.id).name} ${e.id} part`; price = Math.round(chassis(e.id).cost * 0.12 / 1000) * 1000; }
    d.text(lx + 1, ly, name, e.kind === 'part' ? C.cyan : C.text, bg, 34);
    d.text(lx + 38, ly, `x${e.n}`, C.dim, bg);
    d.text(lx + lw - 10, ly, cbk(price).padStart(9), C.cbill, bg);
  });
  if (sl >= 0 && sellList[sl].kind === 'part' && st.confirmPart !== sellList[sl].id) {
    st.confirmPart = sellList[sl].id;
    argo.notify(`Click again to sell a ${chassis(sellList[sl].id).name} part`, C.warn);
  } else if (sl >= 0) {
    st.confirmPart = '';
    const e = sellList[sl];
    let price: number;
    if (e.kind === 'item') { price = sellPrice(c, e.id); c.inventory[e.id]--; }
    else { price = Math.round(chassis(e.id).cost * 0.12 / 1000) * 1000; c.parts[e.id]--; }
    c.funds += price;
    saveGame(c);
    argo.notify(`Sold for ${cbk(price)}`, C.cbill);
  }
  void hardpointStr;
}
