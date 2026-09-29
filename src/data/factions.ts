// Factions of the Aurigan Reach and its neighbours (career mode).

export interface Faction {
  id: string;
  name: string;
  short: string;
  color: string;
  vehicleRatio: number; // share of vehicles in their forces
  techBias: number; // 0..1 chance modifier for upgraded gear
  desc: string;
  employer: boolean; // offers contracts
  enemies: string[]; // factions they fight
  prefers: string[]; // chassis name bias
}

export const FACTIONS: Faction[] = [
  { id: 'davion', name: 'Federated Suns', short: 'Davion', color: '#f0c850', vehicleRatio: 0.2, techBias: 0.6, employer: true,
    enemies: ['liao', 'pirates', 'taurian'], prefers: ['Enforcer', 'Centurion', 'Jenner', 'Victor', 'BattleMaster', 'Wolverine'],
    desc: 'The largest Great House of the Inner Sphere. Rich, proud and ever at war with House Liao.' },
  { id: 'liao', name: 'Capellan Confederation', short: 'Liao', color: '#6ad46a', vehicleRatio: 0.25, techBias: 0.4, employer: true,
    enemies: ['davion', 'canopus', 'aurigan'], prefers: ['Vindicator', 'Raven', 'Catapult', 'Cicada', 'Awesome', 'Stalker'],
    desc: 'A paranoid, militaristic Great House with an uncanny talent for survival and subterfuge.' },
  { id: 'marik', name: 'Free Worlds League', short: 'Marik', color: '#b27ae8', vehicleRatio: 0.2, techBias: 0.5, employer: true,
    enemies: ['liao', 'pirates'], prefers: ['Griffin', 'Orion', 'Thunderbolt', 'Awesome', 'Trebuchet', 'Firestarter'],
    desc: 'A fractious confederation of worlds with the finest industrial base in the Inner Sphere.' },
  { id: 'taurian', name: 'Taurian Concordat', short: 'Taurian', color: '#d88a4a', vehicleRatio: 0.35, techBias: 0.3, employer: true,
    enemies: ['davion', 'pirates', 'canopus'], prefers: ['Commando', 'Vulcan', 'Hunchback', 'Dragon', 'Zeus'],
    desc: 'Isolationist and heavily armed, the Taurians see Davion plots behind every star.' },
  { id: 'canopus', name: 'Magistracy of Canopus', short: 'Canopus', color: '#e878b0', vehicleRatio: 0.4, techBias: 0.4, employer: true,
    enemies: ['liao', 'taurian', 'pirates'], prefers: ['Shadow Hawk', 'Locust', 'Blackjack', 'Quickdraw', 'Highlander'],
    desc: 'A wealthy, pleasure-loving Periphery realm ruled by the Magestrix and her formidable military.' },
  { id: 'aurigan', name: 'Aurigan Directorate', short: 'Directorate', color: '#6ab8e8', vehicleRatio: 0.3, techBias: 0.35, employer: true,
    enemies: ['pirates', 'liao', 'locals'], prefers: ['Locust', 'Spider', 'Centurion', 'Shadow Hawk', 'Kintaro', 'Banshee'],
    desc: 'The usurper government of the Aurigan Reach. Generous paymasters, ruthless enforcers.' },
  { id: 'locals', name: 'Planetary Government', short: 'Locals', color: '#c8c8b0', vehicleRatio: 0.55, techBias: 0.15, employer: true,
    enemies: ['pirates', 'aurigan'], prefers: ['UrbanMech', 'Locust', 'Commando', 'Centurion', 'Blackjack'],
    desc: 'Independent worlds with small militias. They rarely pay well, but they always need help.' },
  { id: 'pirates', name: 'Pirates', short: 'Pirates', color: '#e8503a', vehicleRatio: 0.4, techBias: 0.25, employer: false,
    enemies: ['davion', 'liao', 'marik', 'taurian', 'canopus', 'aurigan', 'locals'], prefers: ['Locust', 'Firestarter', 'Jenner', 'Shadow Hawk', 'JagerMech'],
    desc: 'Bandit kings and scavengers who prey on the weak worlds of the Periphery.' },
];

const BY_ID = new Map(FACTIONS.map((f) => [f.id, f]));
export function faction(id: string): Faction {
  return BY_ID.get(id) ?? FACTIONS[FACTIONS.length - 1];
}

export const REP_LEVELS = [
  { min: -100, name: 'Loathed', color: '#e8503a' },
  { min: -60, name: 'Hated', color: '#e8703a' },
  { min: -25, name: 'Disliked', color: '#e8a03a' },
  { min: -10, name: 'Indifferent', color: '#a8a8a8' },
  { min: 10, name: 'Liked', color: '#b8d86a' },
  { min: 35, name: 'Friendly', color: '#6ad46a' },
  { min: 70, name: 'Honored', color: '#5fd0e8' },
];
export function repLevel(v: number): { name: string; color: string; idx: number } {
  let r = 0;
  for (let i = 0; i < REP_LEVELS.length; i++) if (v >= REP_LEVELS[i].min) r = i;
  return { ...REP_LEVELS[r], idx: r };
}
