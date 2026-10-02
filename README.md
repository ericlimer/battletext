# BattleText

An ASCII-graphics roguelike demake of **BATTLETECH** (2018, Harebrained Schemes), with visual cues taken from Brogue, Cogmind and Caves of Qud. It runs in the browser as a single self-contained HTML file.

This is a non-commercial fan tribute. BattleTech is a trademark of its respective owners.

## Play

```sh
npm install
npm run build          # writes dist/battletext.html
open dist/battletext.html
```

It plays best at 1280×768 or larger, using mouse and keyboard. Buttons show their hotkeys in amber. Hover over nearly anything for a tooltip. The in-game **Field Manual** (`H` on the title screen, `?` in combat) explains the rules.

## What's in it

**Tactical combat**
- Initiative phases 5 to 1 (lights act first, then mediums, heavies and assaults), with Reserve and Master Tactician.
- Walk and sprint ranges with terrain costs. Jump jets use heat. After moving you pick a facing, and front, side and rear arcs matter.
- Evasion pips come from movement and are stripped by each attack. Sensor Lock strips two.
- To-hit uses modifiers from gunnery, range bands, minimum range, evasion, height, cover, obstruction, jumping, indirect fire, night, overheat and PPC sensor scramble. Hovering a weapon shows the full breakdown.
- Hit-location tables are split by arc, and rear armor is separate. Armor absorbs damage first, then structure. Damage transfers inward, and losing a side torso also takes the arm on that side.
- Structure hits can cause critical hits that destroy components. Ammunition can explode, and a Gauss capacitor can discharge.
- Stability damage makes a unit Unsteady, then knocks it down. Heat above 75% overheats the unit, and at 100% it shuts down. Water helps cooling, and each biome modifies heat.
- Resolve is gained from dealing damage and scaling with morale. It pays for Precision Strike (choose the location on the paper doll, head only on prone or shut-down targets) and Vigilance.
- Melee and Death From Above both exist. Brace makes a unit Guarded, and cover comes from light and heavy forest.
- Pilots can be injured and incapacitated. The Safety Cage and Eject both help. Enemies eject when things look hopeless.
- Pilot abilities: Multi-Target, Breaching Shot, Evasive Movement, Ace Pilot, Bulwark, Juggernaut, Sensor Lock and Master Tactician.
- There are seven mission types: Battle, Assassinate, Destroy Base, Defend Base, Ambush Convoy, Escort Convoy and Target Acquisition. Each has optional bonus objectives, reinforcement waves and a withdraw option.
- Maps are procedural across 8 biomes (Lowlands, Highlands, Desert, Badlands, Lunar, Martian, Polar, Tundra). They have elevation with hillshading, forests, water, crags, roads, and destructible buildings and walls. Some missions happen at night.
- Combat uses fog of war with visual range, sensor blips and shared spotting. The AI is utility-based and manages heat, focus-fires, uses melee and DFA, sensor-locks and makes called shots.
- Visuals include animated beams, shells, arcing missile salvos, explosions, smoke and burning wrecks with dynamic colored lighting and screen shake. Procedural sound effects are synthesized with WebAudio.

**Career mode (1,200 days)**
- You found a company: pick a name, a commander background, a difficulty and optionally Ironman. You start with a random HBS-style lance.
- The star map is procedural, with factions (Davion, Liao, Marik, Taurian, Canopus, Aurigan Directorate, Locals, Pirates), territories, jump routes and travel time.
- Contracts show difficulty skulls, pay, employer against target, the objectives, an intel estimate of the opposition and a battlefield survey minimap generated from the contract's own map. You negotiate a split between C-Bills and salvage. Your MRB rating gates contract difficulty. Faction reputation runs from Loathed to Honored and affects pay and prices.
- Salvage: you make priority picks from the pool and the remaining shares are random. Three parts of a chassis let you assemble a 'Mech.
- In the 'Mech Bay, repairs and refits are work orders that take MechTech hours. There is cold storage, and you can sell 'Mechs. Cored 'Mechs are recovered as wrecks unless your whole lance is lost.
- The **Mech Lab** enforces Ballistic, Energy, Missile and Support hardpoints, slots, tonnage, jump-jet classes and armor allocation (front and rear), and warns you about heat and ammo. Refits cost time and money.
- The Barracks lets you spend XP on Gunnery, Piloting, Guts and Tactics, unlock abilities at 5 and 8, heal injuries in the medbay, and record deaths and service history. The hiring hall is at the planet you're docked at.
- Markets are per system, with stock driven by planet tags and prices affected by reputation. There are +/++/+++ weapon variants and rare LosTech. Pirate and frontier systems host a members-only black market.
- The Finance screen has expense levels from Spartan to Extravagant, a funds-history chart and a career ledger. Morale also moves with mission results and deaths; Inspired crews learn faster and miserable ones desert. You can take emergency loans, and you can go bankrupt.
- There are fourteen Argo upgrades: MechTech crews, 'Mech bay pods, medbay, training pods, hydroponics, drive tuning, an automated armory, a tactical operations center and more. Each takes days to install.
- Around thirty random events come with choices, some triggered by the company's situation (injuries, money, morale, pilot quirks). The career ends with a score. Saving is automatic, and you can also export and import save files.

**Skirmish:** build two lances under a C-Bill budget, then pick the mission type, biome and time of day.

## Development

```sh
npm run dev            # unminified build
npm run typecheck
npm run check          # validate the 'Mech roster (slots, hardpoints, tonnage)
node scripts/run.mjs scripts/sim.ts 30 battle,ambush 4    # headless AI battles
node scripts/run.mjs scripts/career-sim.ts 7 h            # headless 1,200-day career bot
node scripts/shot.mjs "skirmish=battle&seed=3" shots/a.png 2500   # screenshot (Playwright)
```

URL flags: `?skirmish=<type>&seed=N` jumps straight into combat, and `&auto&speed=2` lets the AI play both sides.

Source layout:
- `src/engine/`: canvas glyph renderer (square map tiles, vector box drawing), input, immediate-mode UI, color, RNG and noise, sound.
- `src/data/`: weapons and equipment, 38 'Mech variants, vehicles and turrets, factions.
- `src/game/`: frames (loadouts and damage), pilots, company and economy, star map, events, aftermath, saves.
- `src/combat/`: rules (`battle.ts`), AI, missions, terrain and line of sight, effects.
- `src/screens/`: title, skirmish, combat, Argo hub tabs, mech lab, contracts flow and other screens.
