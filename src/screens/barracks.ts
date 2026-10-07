// Barracks and Hiring Hall.

import { UI } from '../engine/ui';
import { C } from '../engine/color';
import type { ArgoScreen } from './argo';
import { company, saveGame } from '../game/save';
import { pilotCap, pilotStatus, addLog, sys } from '../game/company';
import { Pilot, Skill, AbilityDef, ROLES, roleOf, isRoleSkill, nextUnlock, SKILLS, SKILL_NAMES, SKILL_DESC, xpCost, trainSkill, salary, health, ability, ABILITIES, pilotRank, skillTotal, quirk } from '../game/pilot';
import { cb, cbk, wrap } from '../engine/util';
import { skillLine, healthPips, roleTag, ROLE_COLOR } from './widgets';

let trainConfirm = '';

/** What a skill level unlocks, for the milestone pips. */
function milestone(s: Skill, lv: number): { kind: 'ability' | 'health'; text: string; more: string[] } | null {
  const abs = ABILITIES.filter((a) => a.skill === s && a.tier === lv);
  if (abs.length) return { kind: 'ability', text: abs.map((a) => a.name).join(', ') + (s === 'gut' && (lv === 4 || lv === 7 || lv === 10) ? ' and +1 health' : ''), more: abs.map((a) => a.desc) };
  if (s === 'gut' && (lv === 4 || lv === 7 || lv === 10)) return { kind: 'health', text: '+1 pilot health', more: ['One more injury before the pilot is out of the fight.'] };
  return null;
}

/** Tooltip for an ability: what it does, and whether this pilot can still take it. */
function abilityTip(a: AbilityDef, p?: Pilot): string[] {
  const out = [`{#f0a830}${a.name}{/} {#6d7f8a}(${SKILL_NAMES[a.skill]} ${a.tier}, ${a.active ? 'active: a button in combat' : 'passive'}){/}`, a.desc];
  if (p && !p.abilities.includes(a.id)) {
    if (p.abilities.length >= 3) out.push('{#ff6a5a}This pilot already has the maximum of 3 abilities.{/}');
    else if (a.tier === 8 && p.abilities.some((x) => ability(x).tier === 8)) out.push('{#ff6a5a}Only one tier-8 ability per pilot, and this one has it.{/}');
    else if (a.tier === 8 && !p.abilities.some((x) => ability(x).skill === a.skill)) out.push(`Needs ${ABILITIES.find((b) => b.skill === a.skill && b.tier === 5)!.name} (the ${SKILL_NAMES[a.skill]} 5 ability) first.`);
  }
  return out;
}

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
    if (st.mode === 'roster') {
      d.text(lx + lw - 1 - s.text.length, ly, s.text, s.color, bg);
      const canTrain = !p.dead && SKILLS.some((k) => p[k] < 10 && p.xp >= xpCost(p[k]));
      if (canTrain) d.text(lx + lw - 6 - s.text.length, ly, '▲XP', C.accent, bg);
    } else d.text(lx + lw - 9, ly, cbk(p.hireCost ?? 0).padStart(8), C.cbill, bg);
    d.text(lx + 4, ly + 1, p.name, C.dim, bg, 24);
    d.ctext(lx + 30, ly + 1, skillLine(p), C.text, bg);
    const ab = p.abilities.map((a) => ability(a).name).join(', ');
    const qs = (p.quirks ?? []).map((q) => quirk(q).name).join(', ');
    const rn = roleOf(p)?.name;
    if (rn) d.text(lx + 4, ly + 2, rn, ROLE_COLOR, bg);
    const rx = lx + 4 + (rn ? rn.length + 3 : 0);
    if (rn) d.text(rx - 2, ly + 2, '·', C.faint, bg);
    // Fit the line: full names, then a quirk count, then abilities by first word, then just counts (hover for the lot)
    const room = lx + lw - 2 - rx, nq = p.quirks?.length ?? 0, qn = nq ? `${nq} quirk${nq > 1 ? 's' : ''}` : '';
    const abS = p.abilities.map((a) => ability(a).name.split(' ')[0]).join(', '), na = p.abilities.length;
    const fits = [[ab, qs], [ab, qn], [abS, qs], [abS, qn], [na ? `${na} abilit${na > 1 ? 'ies' : 'y'}` : '', qn]].map((xs) => xs.filter(Boolean).join(' · '));
    const line = fits.find((t) => t.length <= room) ?? fits[fits.length - 1];
    d.text(rx, ly + 2, line || (p.xp >= 1000 ? `${p.xp} XP unspent` : '—'), ab || qs ? C.faint : p.xp >= 1000 ? C.accent : C.faint, bg, room);
    if (line !== fits[0] && ui.hover(rx, ly + 2, room, 1)) ui.setTip([ab && `Abilities: ${ab}`, qs && `Quirks: ${qs}`].filter(Boolean) as string[]);
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
  // Role: the player's plan for this MechWarrior; its two skills are highlighted everywhere
  if (st.mode === 'roster' && !p.dead) {
    d.text(dx + 3, yy, 'Role', C.dim);
    let rx = dx + 9;
    for (const r of ROLES) {
      const on = p.role === r.id;
      if (ui.button(rx, yy, r.name, { style: 'plain', w: r.name.length + 2, active: on, fg: on ? C.bg : ROLE_COLOR, tip: [`{${ROLE_COLOR}}${r.name}{/}: ${SKILL_NAMES[r.skills[0]]} + ${SKILL_NAMES[r.skills[1]]}`, r.desc, on ? 'Click again to clear the role.' : 'Assign this role. It only marks which skills to train.'] })) { p.role = on ? undefined : r.id; saveGame(c); }
      rx += r.name.length + 3;
    }
  } else if (roleOf(p)) d.ctext(dx + 3, yy, `Role ${roleTag(p)}`, C.dim);
  yy += 2;
  // Skills with training buttons
  let pipTip: string[] | null = null;
  for (const s of SKILLS) {
    const v = p[s];
    const inRole = isRoleSkill(p, s);
    if (inRole) d.text(dx + 1, yy, '▸', ROLE_COLOR);
    d.text(dx + 3, yy, SKILL_NAMES[s].padEnd(10), inRole ? ROLE_COLOR : C.text, undefined, 99, inRole);
    // Milestone pips: ◆ an ability unlocks at that level, ♥ Guts adds pilot health
    for (let k = 0; k < 10; k++) {
      const lv = k + 1, ms = milestone(s, lv), have = k < v;
      const col = have ? (k >= 7 ? C.accent : k >= 4 ? C.cyan : C.text) : ms ? (ms.kind === 'ability' ? '#a07a30' : '#a04a4a') : C.faint;
      d.set(dx + 13 + k * 2, yy, ms ? (ms.kind === 'ability' ? (have ? '◆' : '◇') : have ? '♥' : '♡') : have ? '■' : '·', col);
      if (ms && ui.hover(dx + 13 + k * 2, yy, 1, 1)) pipTip = [`${SKILL_NAMES[s]} ${lv}: ${ms.text}`, ...ms.more];
    }
    d.text(dx + 34, yy, String(v).padStart(2), C.bright, undefined, 99, true);
    if (st.mode === 'roster' && !p.dead && v < 10) {
      const cost = xpCost(v);
      const key = `${p.id}:${s}`, arm = trainConfirm === key;
      if (ui.button(dx + 38, yy, arm ? 'CONFIRM?' : `+ ${cost} XP`, { style: 'plain', w: 13, disabled: p.xp < cost, fg: arm ? C.accent : p.xp >= cost ? C.green : C.faint, tip: [SKILL_DESC[s], `Raise to ${v + 1} for ${cost} XP. Click twice; XP spent cannot be refunded.`] })) {
        if (!arm) trainConfirm = key;
        else {
          trainConfirm = '';
          const msg = trainSkill(p, s);
          saveGame(c);
          argo.notify(msg ?? `${p.callsign}: ${SKILL_NAMES[s]} ${p[s]}`, C.green);
        }
      }
    }
    const unlock = !p.dead ? nextUnlock(p, s) : null;
    if (unlock) d.text(dx + 52, yy, `→ ${unlock}`, inRole ? ROLE_COLOR : C.dim);
    if (pipTip) ui.setTip(pipTip); else if (ui.hover(dx + 3, yy, 32, 1)) ui.setTip([SKILL_DESC[s], ...(inRole ? [`One of ${p.callsign}'s ${roleOf(p)!.name} skills.`] : [])]);
    pipTip = null;
    yy++;
  }
  d.ctext(dx + 3, yy++, '{#a07a30}◇{/} ability unlocks   {#a04a4a}♡{/} +1 pilot health   {#3b4a54}(hover a marker){/}', C.faint);
  // What the numbers mean in combat
  yy++;
  d.text(dx + 3, yy++, 'COMBAT PROFILE', C.accent, undefined, 99, true);
  const prof: [string, string][] = [
    ['Base accuracy', `${55 + p.gun * 3}%`], ['Crit chance', `+${p.gun * 3}%`],
    ['Melee accuracy', `${60 + p.pil * 3}%`], ['Stability dmg taken', `-${Math.round(p.pil * 2.5)}%`],
    ['Indirect fire', `${-20 + p.tac}%`], ['Ejection risk', `-${p.gut * 3}%`],
  ];
  prof.forEach(([k, v], i) => d.ctext(dx + 3 + (i % 2) * 36, yy + (i >> 1), `${k.padEnd(20)}{#f2f6f8}${v}{/}`, C.dim));
  yy += 3;
  if (p.quirks?.length) {
    yy++;
    d.text(dx + 3, yy++, 'QUIRKS', C.accent, undefined, 99, true);
    for (const qid of p.quirks) { const q = quirk(qid); d.ctext(dx + 3, yy++, `{${q.good ? '#6ad46a' : '#e8a03a'}}${q.name}{/} {#6d7f8a}— ${q.desc}{/}`, C.text, undefined, dw - 6); }
  }
  yy++;
  d.text(dx + 3, yy++, 'ABILITIES', C.accent, undefined, 99, true);
  if (!p.abilities.length) d.text(dx + 3, yy++, 'None yet. Abilities unlock at skill 5 and 8 (max 3, one tier-8).', C.faint);
  for (const a of p.abilities) {
    const ab = ability(a);
    d.ctext(dx + 3, yy, `{#f0a830}${ab.name}{/} {#6d7f8a}(${SKILL_NAMES[ab.skill]} ${ab.tier}){/}`, C.text);
    if (ui.hover(dx + 3, yy, 30, 1)) ui.setTip(abilityTip(ab));
    for (const l of wrap(ab.desc, dw - 36)) d.text(dx + 34, yy++, l, C.dim);
  }
  // Next abilities
  // Only abilities this pilot could still take (3 at most, one tier-8, tier-8 after its skill's tier-5)
  const canTake = (a: AbilityDef) => p.abilities.length < 3 && (a.tier === 5 || (!p.abilities.some((x) => ability(x).tier === 8) && p.abilities.some((x) => ability(x).skill === a.skill)));
  const next = ABILITIES.filter((a) => !p.abilities.includes(a.id) && p[a.skill] < a.tier && p[a.skill] >= a.tier - 3 && canTake(a)).slice(0, 2);
  for (const a of next) {
    const w = 6 + a.name.length;
    d.ctext(dx + 3, yy, `{#4a5a64}Next:{/} {#7ab8d0}${a.name}{/} {#4a5a64}at ${SKILL_NAMES[a.skill]} ${a.tier}{/}`, C.faint);
    if (ui.hover(dx + 3, yy, w + 14, 1)) { d.text(dx + 9, yy, a.name, C.bright); ui.setTip(abilityTip(a, p)); }
    yy++;
  }
  yy++;
  if (p.timeline.length && st.mode === 'roster') {
    d.text(dx + 3, yy++, 'SERVICE RECORD', C.accent, undefined, 99, true);
    for (const t of p.timeline.slice(-Math.max(2, Math.min(8, y0 + h - 7 - yy)))) d.text(dx + 3, yy++, t, C.faint, undefined, dw - 6);
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
