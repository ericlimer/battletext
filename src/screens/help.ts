// Field manual.

import { Screen, app } from './app';
import { UI } from '../engine/ui';
import { C } from '../engine/color';
import { COLS, ROWS } from '../engine/display';
import { wrap } from '../engine/util';

const PAGES: [string, string[]][] = [
  ['OVERVIEW', [
    '{#f0a830}BattleText{/} is an ASCII roguelike demake of BATTLETECH (2018). You command a mercenary company in the Aurigan Reach for 1,200 days: take contracts, fight turn-based lance battles, salvage wrecks, repair and refit your \'Mechs, and keep your MechWarriors alive and paid.',
    '',
    'The game is played with mouse and keyboard. Buttons show their hotkey in {#f0a830}amber{/}. Hover almost anything for a tooltip.',
    '',
    '{#f0a830}Skirmish{/} lets you build two lances under a C-Bill budget and fight any mission type on any biome.',
  ]],
  ['COMBAT', [
    '{#f0a830}Initiative.{/} Rounds are split into phases 5..1. Light \'Mechs act in phase 4, mediums in 3, heavies in 2, assaults in 1 (Master Tactician: +1). In each phase your units act first, in any order. [R]eserve delays a unit one phase.',
    '',
    '{#f0a830}Movement.{/} Blue tiles are walking range (you may still attack), amber tiles are sprint range (no attack, extra evasion). [J]ump jets ignore terrain but cost heat. Click a tile to preview, click again or press Space to confirm. When you end a turn you choose a facing — protect your rear armor!',
    '',
    '{#f0a830}Evasion ◆.{/} Moving further builds evasion pips; each pip is -8% to hit you. Every attack strips one pip. Sensor Lock strips two.',
    '',
    '{#f0a830}Attacking.{/} Click an enemy to target it, then click again or press [F]. Toggle weapons with [1]-[9] or by clicking them. A pilot with Multi-Target can Shift-click a second (and third) enemy to split the enabled weapons between them; reassigned weapons show →tag in orange. Hover a weapon for the complete to-hit breakdown: gunnery, range bands, evasion, height, cover, jumping, indirect fire.',
    '',
    '{#f0a830}Damage.{/} Hits land on locations by attack arc: front, side or rear (rear torsos have thin armor). Damage chews through armor, then structure; structure hits may cause critical hits that destroy components — or detonate ammunition. Lose a side torso and you lose that arm. The \'Mech dies if its head or center torso is destroyed, both legs are gone, or its pilot is incapacitated.',
    '',
    '{#f0a830}Stability & Heat.{/} Heavy weapons and melee fill the target\'s stability bar; past half it is Unsteady (no evasion), full means a knockdown. Heat above 75% overheats (-10% accuracy, internal damage); at 100% the \'Mech shuts down.',
    '',
    '{#f0a830}Resolve.{/} Earned by dealing damage and kills (rate depends on morale). Spend it on [P]recision Strike (choose the hit location; the head only on prone or shut-down targets) or [V]igilance (Guarded + Entrenched).',
    '',
    '{#f0a830}Melee.{/} [M] moves adjacent and strikes with the \'Mech\'s full weight; [D]eath From Above jumps onto the target. Both deal heavy stability damage.',
  ]],
  ['MAP', [
    '{#f0a830}Reading the battlefield.{/} Each map tile is one square. Brighter ground is higher ground: firing downhill is easier, uphill harder. A dark {#3a3a3a}▁{/} or {#3a3a3a}▏{/} edge marks a drop to lower ground. Press [Z] to cycle elevation views: Shading, Tint (colour bands), Contours (lines on every drop), Terraces (strong brightness steps) and Numbers (height digits). Your choice is remembered.',
    '',
    '{#6ac46a}♣{/}  Light forest: 20% cover, slows movement, lightly obstructs fire through it.',
    '{#3a8a3a}♠{/}  Heavy forest: 35% cover, slow going, blocks sight after a few tiles.',
    '{#4a8ad8}~{/}  Shallow water: +15 heat sinking, slow.        {#2a5ab8}≈{/}  Deep water: +30 heat sinking, very slow, partial cover.',
    '{#a8a8a0}▲ ^{/} Crags: impassable, block line of sight.         {#c8c0a8}·{/}  Road: fast movement.',
    '{#b0b0a8}┌─┐{/} Buildings and walls: block movement and sight; can be destroyed. {#ff7a58}╔═╗{/} hostile objective  {#6fd8ff}╔═╗{/} allied objective.',
    '{#7a6e5e}%{/}  Rubble: slow, slight cover.                     {#8a7060}¤ &{/} \'Mech and vehicle wrecks mark where units fell.',
    '',
    '{#f0c040}◎{/}  Data beacon (Target Acquisition).   {#e8503a}×{/}  Escape or exit point.   {#e8503a}?{/}  Sensor contact: something is there, but out of sight.',
    '',
    '{#f0a830}Fog of war.{/} Tiles your lance cannot see are dimmed; units there are remembered as ghosts or shown as sensor blips. At night visual range drops to 10 tiles, but sensors still work.',
  ]],
  ['MISSIONS', [
    '{#f0a830}⚔ Battle.{/} Destroy every hostile unit. Heavier contracts bring reinforcements.',
    '{#f0a830}◎ Assassinate.{/} Kill a named commander and their escort. After round 9, or once badly hurt, the target runs for the map edge.',
    '{#f0a830}■ Destroy Base.{/} Level the base\'s primary structures. Turrets and a garrison lance defend it.',
    '{#f0a830}⌂ Defend Base.{/} Waves of raiders go for your employer\'s facility. Keep at least one primary structure standing; allied turrets help.',
    '{#f0a830}» Ambush Convoy.{/} Destroy at least two of four haulers (three on 4+ skull contracts) before they leave the map. Their escort screens ahead.',
    '{#f0a830}« Escort Convoy.{/} The haulers wait for your lance and halt when hostiles close in. Get two of three to the east edge.',
    '{#f0a830}◎ Target Acquisition.{/} Move a unit onto each of three beacons with no enemy within two tiles to secure it.',
    '',
    'Every contract has optional objectives worth bonus C-Bills. You can withdraw at any time, but the employer will not pay and your standing suffers.',
  ]],
  ['CAREER', [
    '{#f0a830}Contracts.{/} Each system offers contracts of varying difficulty (■ = one skull). Negotiate between C-Bills and salvage shares. Your MRB rating limits the difficulty you can accept; complete contracts to raise it. Reputation with factions improves pay and prices.',
    '',
    '{#f0a830}Salvage.{/} After a successful contract you pick your priority salvage from the pool — weapons, equipment and \'Mech parts. The rest of your shares are assigned randomly. Three parts of the same chassis let you assemble a new \'Mech in the Mech Bay.',
    '',
    '{#f0a830}Time and money.{/} Every 30 days you pay salaries, \'Mech upkeep and Argo costs. Repairs, refits and healing take time. Use Advance (Space) to pass time until something finishes. Two months in debt and the company is bankrupt.',
    '',
    '{#f0a830}Barracks.{/} Spend MechWarrior experience to raise Gunnery, Piloting, Guts and Tactics. Abilities unlock at 5 and 8. Hire new pilots at starports.',
    '',
    '{#f0a830}Mech Lab.{/} Weapons must match hardpoints (Ballistic, Energy, Missile, Support). Watch tonnage, slots and heat. Armor costs weight: 80 points per ton.',
    '',
    '{#f0a830}The Argo.{/} Upgrade your dropship with more \'Mech bays, MechTech crews, medical facilities, training pods and crew comforts.',
  ]],
];

export class HelpScreen implements Screen {
  page = 0;
  render(ui: UI): void {
    const d = ui.d;
    d.fill(0, 0, COLS, ROWS, ' ', C.text, C.bg);
    ui.header(0, 0, COLS, 'FIELD MANUAL', C.bg, C.accent);
    PAGES.forEach(([t], i) => { if (ui.button(2 + i * 16, 2, t, { key: String(i + 1), active: this.page === i, w: 15, center: true })) this.page = i; });
    let y = 5;
    for (const p of PAGES[this.page][1]) for (const l of wrap(p, 120)) d.ctext(6, y++, l, C.text);
    if (ui.button(2, ROWS - 3, 'Back', { key: 'Escape' })) app.pop();
  }
}
