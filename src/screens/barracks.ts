// Barracks and Hiring Hall.

import { UI } from '../engine/ui';
import { C } from '../engine/color';
import type { ArgoScreen } from './argo';
import { company, saveGame } from '../game/save';
import { pilotCap, pilotStatus, addLog, sys } from '../game/company';
import { Pilot, SKILLS, SKILL_NAMES, SKILL_DESC, xpCost, trainSkill, salary, health, ability, ABILITIES, pilotRank, skillTotal } from '../game/pilot';
import { cb, cbk, wrap } from '../engine/util';
import { skillLine, healthPips } from './widgets';

export function drawBarracksTab(ui: UI, argo: ArgoScreen, x: number, y: number, w: number, h: number): void {
  const d = ui.d, c = company!;
  const st = (argo.st.barracks ??= { mode: 'roster', sel: 0, list: { scroll: 0 }, confirm: false });
  if (ui.button(x + 2, y, 'ROSTER', { active: st.mode === 'roster', w: 12, center: true })) { st.mode = 'roster'; st.sel = 0; }
  if (ui.button(x + 15, y, 'HIRING HALL', { active: st.mode === 'hire', w: 15, center: true, disabled: !!c.travel, tip: c.travel ? 'Only available while docked.' : '' })) { st.mode = 'hire'; st.sel = 0; }
  const living = c.pilots.filter((p) => !p.dead);
  d.text(x + 34, y, `MechWarriors ${living.length}/${pilotCap(c)}`, C.dim);
  const list: Pilot[] = st.mode === 'roster' ? [...living, ...c.pilots.filter((p) => p.dead)] : c.hires[c.location] ?? [];
  const y0 = y + 2;
  ui.panel(x + 1, y0, 52, h - 2, st.mode === 'roster' ? 'ROSTER' : `HIRING HALL · ${sys(c).name.toUpperCase()}`);
  const cl = ui.list(x + 2, y0 + 1, 50, h - 4, list, st.list, (p, i, lx, ly, lw, hov) => {
    const sel = st.sel === i;
    const bg = sel ? '#16242e' : hov ? '#121c24' : '#0a0e13';
    d.fill(lx, ly, lw, 3, ' ', C.text, bg);
    if (sel) d.vline(lx, ly, 3, C.accent, '▌', bg);
    d.text(lx + 2, ly, p.sigil, p.color, bg);
    d.text(lx + 4, ly, p.callsign, p.dead ? C.red : C.bright, bg, 16, true);
    d.text(lx + 21, ly, pilotRank(p), C.dim, bg);
    const s = pilotStatus(c, p);
    if (st.mode === 'roster') d.text(lx + lw - 1 - s.text.length, ly, s.text, s.color, bg);
    else d.text(lx + lw - 9, ly, cbk(p.hireCost ?? 0).padStart(8), C.cbill, bg);
    d.text(lx + 4, ly + 1, p.name, C.dim, bg, 24);
    d.ctext(lx + 30, ly + 1, skillLine(p), C.text, bg);
    const ab = p.abilities.map((a) => ability(a).name).join(', ');
    d.text(lx + 4, ly + 2, ab || (p.xp >= 1000 ? `${p.xp} XP unspent` : '—'), ab ? C.faint : p.xp >= 1000 ? C.accent : C.faint, bg, lw - 6);
  }, 3);
  if (cl >= 0) { st.sel = cl; st.confirm = false; }
  const p = list[Math.min(st.sel, list.length - 1)];
  const dx = x + 54, dw = w - 55;
  if (!p) { ui.panel(dx, y0, dw, h - 2, ''); d.text(dx + 3, y0 + 2, st.mode === 'hire' ? 'Nobody is looking for work here.' : 'No MechWarriors.', C.dim); return; }
  ui.panel(dx, y0, dw, h - 2, `${p.callsign.toUpperCase()}${p.commander ? ' · COMMANDER' : ''}`);
  let yy = y0 + 2;
  d.text(dx + 3, yy, p.sigil, p.color, undefined, 99, true);
  d.text(dx + 5, yy, `${p.name}`, C.bright, undefined, 40, true);
  d.text(dx + 48, yy, `${pilotRank(p)} · origin: ${p.origin}`, C.dim, undefined, dw - 50);
  yy += 2;
  for (const l of wrap(p.bio, dw - 8)) d.text(dx + 3, yy++, l, C.text);
  yy++;
  d.ctext(dx + 3, yy, `Health ${healthPips(p)}  {#6d7f8a}(${health(p) - p.injuries}/${health(p)}){/}`, C.dim);
  d.ctext(dx + 40, yy, `Salary {#f0c850}${p.commander ? '—' : cb(salary(p))}{/}/mo`, C.dim);
  d.ctext(dx + 72, yy, `Missions {#f2f6f8}${p.missions}{/} · Kills {#f2f6f8}${p.kills}{/}`, C.dim);
  yy += 2;
  d.ctext(dx + 3, yy++, `Experience: {#f0a830}${p.xp}{/} unspent  {#6d7f8a}(${p.xpTotal} total){/}`, C.dim);
  yy++;
  // Skills with training buttons
  for (const s of SKILLS) {
    const v = p[s];
    d.text(dx + 3, yy, SKILL_NAMES[s].padEnd(10), C.text);
    for (let k = 0; k < 10; k++) d.set(dx + 13 + k * 2, yy, k < v ? '■' : '·', k < v ? (k >= 7 ? C.accent : k >= 4 ? C.cyan : C.text) : C.faint);
    d.text(dx + 34, yy, String(v).padStart(2), C.bright, undefined, 99, true);
    if (st.mode === 'roster' && !p.dead && v < 10) {
      const cost = xpCost(v);
      if (ui.button(dx + 38, yy, `+ ${cost} XP`, { style: 'plain', w: 13, disabled: p.xp < cost, fg: p.xp >= cost ? C.green : C.faint, tip: [SKILL_DESC[s], `Raise to ${v + 1} for ${cost} XP.`] })) {
        const msg = trainSkill(p, s);
        saveGame(c);
        argo.notify(msg ?? `${p.callsign}: ${SKILL_NAMES[s]} ${p[s]}`, C.green);
      }
    }
    if (ui.hover(dx + 3, yy, 32, 1)) ui.setTip(SKILL_DESC[s]);
    yy++;
  }
  yy++;
  d.text(dx + 3, yy++, 'ABILITIES', C.accent, undefined, 99, true);
  if (!p.abilities.length) d.text(dx + 3, yy++, 'None yet. Abilities unlock at skill 5 and 8 (max 3, one tier-8).', C.faint);
  for (const a of p.abilities) {
    const ab = ability(a);
    d.ctext(dx + 3, yy, `{#f0a830}${ab.name}{/} {#6d7f8a}(${SKILL_NAMES[ab.skill]} ${ab.tier}){/}`, C.text);
    for (const l of wrap(ab.desc, dw - 36)) d.text(dx + 34, yy++, l, C.dim);
  }
  // Next abilities
  const next = ABILITIES.filter((a) => !p.abilities.includes(a.id) && p[a.skill] < a.tier && p[a.skill] >= a.tier - 3).slice(0, 2);
  for (const a of next) d.ctext(dx + 3, yy++, `{#3b4a54}Next: ${a.name} at ${SKILL_NAMES[a.skill]} ${a.tier}{/}`, C.faint);
  yy++;
  if (p.timeline.length && st.mode === 'roster') {
    d.text(dx + 3, yy++, 'SERVICE RECORD', C.accent, undefined, 99, true);
    for (const t of p.timeline.slice(-4)) d.text(dx + 3, yy++, t, C.faint, undefined, dw - 6);
  }
  // Actions
  const by = y0 + h - 5;
  if (st.mode === 'hire') {
    const full = living.length >= pilotCap(c);
    d.ctext(dx + 3, by - 1, `Hiring bonus {#f0c850}${cb(p.hireCost ?? 0)}{/}, then {#f0c850}${cb(salary(p))}{/}/month.`, C.dim);
    if (ui.button(dx + 3, by + 1, 'HIRE', { key: 'Enter', style: 'block', w: 14, center: true, disabled: full || c.funds < (p.hireCost ?? 0), tip: full ? 'Barracks are full (see Argo upgrades).' : '' })) {
      c.funds -= p.hireCost ?? 0;
      c.stats.spent += p.hireCost ?? 0;
      c.pilots.push(p);
      c.hires[c.location] = list.filter((q) => q !== p);
      p.timeline.push(`Joined ${c.name} on day ${c.day}.`);
      addLog(c, `Hired ${p.callsign} (${p.name}) for ${cb(p.hireCost ?? 0)}.`, '#6ad46a');
      saveGame(c);
      argo.notify(`${p.callsign} joins the company`, C.green);
    }
  } else if (!p.commander && !p.dead) {
    if (!st.confirm) { if (ui.button(dx + 3, by + 1, 'Dismiss', { style: 'plain', fg: C.dim, tip: 'Release this MechWarrior from their contract.' })) st.confirm = true; }
    else if (ui.button(dx + 3, by + 1, 'Confirm dismissal', { style: 'plain', fg: C.red })) {
      c.pilots = c.pilots.filter((q) => q !== p);
      c.lancePilots = c.lancePilots.map((id) => (id === p.id ? null : id));
      addLog(c, `${p.callsign} was dismissed.`, '#9ab');
      saveGame(c); st.confirm = false; st.sel = 0;
    }
  }
  void skillTotal;
}
