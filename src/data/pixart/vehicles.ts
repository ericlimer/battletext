// Pixel-art portraits for combat vehicles and emplacements, in the same half-block style as the 'Mech
// portraits (see ../pixart.ts for the pixel alphabet and pixColor). Vehicles are drawn head-on from a
// little above: the front plate at the bottom, the engine deck behind the turret, and the vehicle's right
// side on the viewer's left (like the 'Mechs).
//
// `zones` has the same shape as `px`; each character names the location that pixel shows:
//   'T' turret   'F' front   'L' left side   'R' right side   'B' rear / engine deck   '.' none
// Carriers have no turret, so their launchers sit on the rear deck ('B'). Emplacements are all 'T'.

export interface VehArt { px: string[]; zones: string[] }

type ZoneFn = (x: number, y: number) => string;
type Part = [px: string[], zone: string | ZoneFn, x: number, y: number];

/** Left half (viewer's left) mirrored into a full row set. */
const sym = (half: string[]): string[] => half.map((r) => r + [...r].reverse().join(''));

/** Paint parts onto a w x h canvas in order (later parts on top); '.' pixels are transparent. */
function compose(w: number, h: number, parts: Part[]): VehArt {
  const px = Array.from({ length: h }, () => Array(w).fill('.'));
  const zs = Array.from({ length: h }, () => Array(w).fill('.'));
  for (const [rows, z, ox, oy] of parts) {
    rows.forEach((r, y) => [...r].forEach((c, x) => {
      const X = ox + x, Y = oy + y;
      if (c === '.' || X < 0 || Y < 0 || X >= w || Y >= h) return;
      px[Y][X] = c;
      zs[Y][X] = typeof z === 'string' ? z : z(x, y);
    }));
  }
  return { px: px.map((r) => r.join('')), zones: zs.map((r) => r.join('')) };
}

/** Hull zones: `side` columns at each edge are the right (viewer's left) and left sides; rows above `deck` are the rear deck. */
const hullZ = (w: number, side: number, deck: number): ZoneFn => (x, y) => (x < side ? 'R' : x >= w - side ? 'L' : y < deck ? 'B' : 'F');

// ---- Hulls -------------------------------------------------------------------------------------------

// Tracked, 40 wide: engine deck, fenders over the tracks, glacis with a driver's vision block.
const TRK40 = sym([
  '.......=============',
  '......=#%#%#%#%#%#%#',
  '.....=##############',
  '=====%%%%%%%%%%%%%%%',
  '#@#@%===============',
  '@#@#%###############',
  '#@#@%###############',
  '@#@#%##%cc%#########',
  '#@#@%###############',
  '@#@#%%%%%%%%%%%%%%%%',
  '#@#@%@@@@@@@@@@@@@@@',
  '%%%%%...............',
]);
// Tracked, 36 wide (light tanks).
const TRK36 = sym([
  '......============',
  '.....=#%#%#%#%#%#%',
  '....=#############',
  '====%%%%%%%%%%%%%%',
  '#@#@%=============',
  '@#@#%#############',
  '#@#@%##%cc%#######',
  '@#@#%%%%%%%%%%%%%%',
  '#@#@%@@@@@@@@@@@@@',
  '%%%%..............',
]);
// Wheeled, 38 wide: body sits higher, fat tyres at the corners.
const WHL38 = sym([
  '.......============',
  '......=#%#%#%#%#%#%',
  '.....=#############',
  '..===%%%%%%%%%%%%%%',
  '..##%==============',
  '..##%##############',
  '@@##%##%cc%########',
  '@@@%%##############',
  '@%@%%%%%%%%%%%%%%%%',
  '@@@@...@@@@@@@@@@@@',
  '@@@@...............',
  '%%%%...............',
]);
// Hover, 38 wide: low wedge, wide skirt, a dark air cushion underneath.
const HOV38 = sym([
  '.........==========',
  '.......==#%#%#%#%#%',
  '.....==############',
  '...==%%%%%%%%%%%%%%',
  '.==##%=============',
  '=###%%##%cc%#######',
  '%%%%%%%%%%%%%%%%%%%',
  '.@@@@@@@@@@@@@@@@@@',
  '..%.%.%.%.%.%.%.%.%',
  '...................',
]);

// ---- Shared barrel / muzzle bits (pointing at the viewer, foreshortened downwards) ---------------------
const BARREL2 = ['.bb.', '.bb.', '.bb.', '%@@%'];
const BARREL2L = ['.bb.', '.bb.', '.bb.', '.bb.', '%@@%'];

export const VPIX: Record<string, VehArt> = {
  // Wheeled troop carrier: tall boxy body, small MG cupola, six wheels.
  APC: compose(34, 20, [
    [sym([
      '....=============',
      '...=#############',
      '..=##############',
      '..#%#%#%#%#%#%#%#',
      '..###############',
      '=====%%%%%%%%%%%%',
      '#####============',
      '#################',
      '@@###%cc%########',
      '@@###############',
      '@@@%%%%%%%%%%%%%%',
      '@%@@...@@@@@@@@@@',
      '@@@@.............',
      '%%%%.............',
    ]), hullZ(34, 5, 5), 0, 6],
    [sym([
      '...======',
      '..=######',
      '.=##%c%##',
      '%%%%%%%%%',
      '...@@@@@@',
    ]), 'T', 8, 2],
    [['b.b', 'b.b', 'b.b'], 'T', 9, 0],
    [['b.b', 'b.b', 'b.b'], 'T', 22, 0],
  ]),

  // Hovertank: low wedge on a skirt, flat turret with a medium laser and a two-tube SRM box.
  JEDGAR: compose(38, 16, [
    [HOV38, hullZ(38, 4, 3), 0, 6],
    [[
      '.....=========.....',
      '...==#########==...',
      '.==#############==.',
      '=#@ll@%#####%m@m%#=',
      '%%%%%%%%%%%%%%%%%%%',
      '...@@@@@@@@@@@@@...',
    ], 'T', 9, 2],
  ]),

  // Tracked light tank: small round turret, single AC/5.
  SCORPION: compose(36, 18, [
    [TRK36, hullZ(36, 4, 3), 0, 8],
    [sym([
      '...=====',
      '.==#####',
      '=#####%c',
      '########',
      '%%%%%%%%',
      '.@@@@@@@',
    ]), 'T', 10, 3],
    [BARREL2, 'T', 16, 9],
  ]),

  // Wheeled light tank: sleek turret, twin medium lasers, hull MG.
  GALLEON: compose(38, 18, [
    [WHL38, hullZ(38, 4, 3), 0, 6],
    [sym([
      '....======',
      '..==######',
      '.=#####%c%',
      '=@ll@#####',
      '%%%%%%%%%%',
      '..@@@@@@@@',
    ]), 'T', 9, 2],
    [['bb', '@@'], 'F', 25, 12],
  ]),

  // Wheeled missile tank: turret is a pair of launcher boxes, LRM-10 and SRM-6.
  STRIKER: compose(38, 20, [
    [WHL38, hullZ(38, 4, 3), 0, 8],
    [[
      '..==========....========..',
      '.=##########%..=########%.',
      '.#m@m@m@m@m@%..#m@m@m@##%.',
      '.#@@@@@@@@@@%..#@@@@@@##%.',
      '.#m@m@m@m@m@%..#m@m@m@##%.',
      '.%%%%%%%%%%%%==%%%%%%%%%%.',
      '..=####################=..',
      '..%%%%%%%%%%%%%%%%%%%%%%..',
      '....@@@@@@@@@@@@@@@@@@....',
    ], 'T', 6, 1],
  ]),

  // Tracked medium tank: rounded turret, AC/5 and a coax MG.
  VEDETTE: compose(40, 20, [
    [TRK40, hullZ(40, 5, 3), 0, 8],
    [sym([
      '.....=====',
      '...==#####',
      '..=#######',
      '.=#####%c%',
      '.#########',
      '.%%%%%%%%%',
      '..@@@@@@@@',
    ]), 'T', 10, 2],
    [BARREL2L, 'T', 18, 8],
    [['b', '@'], 'T', 23, 7],
  ]),

  // Boxy medium tank: large laser in the mantlet, SRM-4 racks on the turret cheeks.
  BULLDOG: compose(40, 20, [
    [TRK40, hullZ(40, 5, 3), 0, 8],
    [[
      '......==============......',
      '....==##############==....',
      '..==######%c%#########==..',
      '.=#m@m@###############m@m@#',
      '.#%@@@@%###%@@@@%####%@@@@%',
      '.#%m@m@%###@llll@####%m@m@%',
      '.#%@@@@%###@llll@####%@@@@%',
      '.%%%%%%%%%%%@@@@%%%%%%%%%%%',
      '....@@@@@@@@@@@@@@@@@@@@...',
    ].map((r) => r.slice(0, 26)), 'T', 7, 1],
  ]),

  // Wheeled anti-aircraft carrier: three long AC/2 barrels raised skywards.
  PIKE: compose(38, 22, [
    [WHL38, hullZ(38, 4, 3), 0, 10],
    [[
      '...b......b......b...',
      '...b......b......b...',
      '...b......b......b...',
      '...b......b......b...',
      '..=b=....=b=....=b=..',
      '..@@@....@@@....@@@..',
      '.==================..',
      '=####################',
      '#####%c%#############',
      '%%%%%%%%%%%%%%%%%%%%%',
      '...@@@@@@@@@@@@@@@...',
    ].map((r) => r.padEnd(21, '.')), 'T', 8, 1],
  ]),

  // Heavy tank: big turret with an LRM-10 box on the roof, PPC in the mantlet, SRM-6 on the left cheek;
  // a medium laser in the hull front.
  MANTICORE: compose(40, 22, [
    [TRK40, hullZ(40, 5, 3), 0, 10],
    [[
      '........===========.......',
      '.......=m@m@m@m@m@#%......',
      '.......=m@m@m@m@m@#%......',
      '....====%%%%%%%%%%%%===...',
      '..==######################',
      '.=############%@@%#m@m@m#%',
      '=#####%c%#####@pp@#@@@@@#%',
      '##############@pp@#m@m@m#%',
      '%%%%%%%%%%%%%%%%%%%%%%%%%%',
      '...@@@@@@@@@@@@@@@@@@@@...',
    ], 'T', 6, 1],
    [['pp', 'pp', 'pp', '@@'], 'T', 20, 10],
    [['@l@'], 'F', 9, 16],
  ]),

  // Tracked carrier: two big LRM-20 launcher boxes on the rear deck, no turret.
  LRMC: compose(40, 22, [
    [TRK40, hullZ(40, 5, 3), 0, 10],
    [sym([
      '..==============....',
      '.=##############%...',
      '.#m@m@m@m@m@m@##%...',
      '.#@@@@@@@@@@@@##%...',
      '.#m@m@m@m@m@m@##%...',
      '.#@@@@@@@@@@@@##%...',
      '.#m@m@m@m@m@m@##%...',
      '.#@@@@@@@@@@@@##%...',
      '.#m@m@m@m@m@m@##%...',
      '.%%%%%%%%%%%%%%%%...',
      '....@@@@@@@@@@@@@@@@',
    ]).map((r, y) => y === 2 || y === 4 || y === 6 || y === 8 ? r : r), 'B', 0, 1],
  ]),

  // Tracked carrier: four SRM-6 racks in a block on the rear deck.
  SRMC: compose(40, 20, [
    [TRK40, hullZ(40, 5, 3), 0, 8],
    [sym([
      '....=========.=====',
      '....#m@m@m@#%.#m@m@',
      '....#@@@@@@#%.#@@@@',
      '....#m@m@m@#%.#m@m@',
      '....%%%%%%%%%.%%%%%',
      '....=========.=====',
      '....#m@m@m@#%.#m@m@',
      '....#@@@@@@#%.#@@@@',
      '....#m@m@m@#%.#m@m@',
      '....%%%%%%%%%.%%%%%',
    ]), 'B', 0, 0],
  ]),

  // Tracked PPC carrier: armoured casemate on the hull with three PPCs side by side.
  SCHREK: compose(40, 22, [
    [TRK40, hullZ(40, 5, 3), 0, 10],
    [sym([
      '.....===============',
      '...==###############',
      '..=#################',
      '..%%%%%%%%%%%%%%%%%%',
    ]), 'B', 0, 2],
    [[
      '..####################################..',
      '..#####%@@%#######%@@%#######%@@%#####..',
      '..#####@pp@#######@pp@#######@pp@#####..',
      '..#####@pp@#######@pp@#######@pp@#####..',
      '..#####%pp%#######%pp%#######%pp%#####..',
      '..%%%%%%pp%%%%%%%%%pp%%%%%%%%%pp%%%%%%..',
      '.......%pp%.......%pp%.......%pp%.......',
      '.......@@@@.......@@@@.......@@@@.......',
    ], 'F', 0, 6],
  ]),

  // Heavy tank: massive turret with twin AC/20s.
  DEMOLISHER: compose(40, 24, [
    [TRK40, hullZ(40, 5, 3), 0, 12],
    [sym([
      '......=========',
      '...===#########',
      '.==############',
      '=#########%c%##',
      '###############',
      '###############',
      '%%%%%%%%%%%%%%%',
      '..@@@@@@@@@@@@@',
    ]), 'T', 5, 3],
    [[
      '%@@@@%',
      '@=bb%@',
      '.=bb%.',
      '.=bb%.',
      '=bbbb%',
      'b@@@@%',
      'b@@@@%',
      '%%%%%%',
    ], 'T', 9, 8],
    [[
      '%@@@@%',
      '@=bb%@',
      '.=bb%.',
      '.=bb%.',
      '=bbbb%',
      'b@@@@%',
      'b@@@@%',
      '%%%%%%',
    ], 'T', 25, 8],
  ]),

  // Armoured cargo truck: tall box body behind a cab with a windscreen and headlights.
  HAULER: compose(34, 22, [
    [sym([
      '..===============',
      '.=###############',
      '.#%#%#%#%#%#%#%#%',
      '.################',
      '.#%#%#%#%#%#%#%#%',
      '.################',
      '.%%%%%%%%%%%%%%%%',
    ]), hullZ(34, 3, 99), 0, 0],
    [sym([
      '....=============',
      '...=#############',
      '...#ccccccccc%###',
      '...#ccccccccc%###',
      '...%%%%%%%%%%%%%%',
      '...#oo#@%@%@%@%@%',
      '...###@%@%@%@%@%@',
      '@@@####%@%@%@%@%@',
      '@%@%%%%%%%%%%%%%%',
      '@@@@=============',
      '@@@@.............',
      '@@@@.............',
      '%%%%.............',
    ]), (x, y) => (x < 4 || x >= 30 ? (x < 4 ? 'R' : 'L') : 'F'), 0, 7],
  ]),

  // ---- Emplacements (all 'T')
  // Light turret: low concrete dome with twin laser ports.
  'TUR-L': compose(24, 16, [
    [sym([
      '........====',
      '......==####',
      '....==######',
      '...=########',
      '..=#########',
      '..#@ll@#####',
      '..##########',
      '.=%%%%%%%%%%',
      '=###########',
      '#%#%#%#%#%#%',
      '############',
      '%%%%%%%%%%%%',
    ]), 'T', 0, 4],
    [sym(['....====', '..==####', '.=###%c%', '%%%%%%%%']), 'T', 4, 0],
  ]),

  // Medium turret: armoured block on a bunker, LRM-10 box on the roof, AC/5 run out to the side.
  'TUR-M': compose(24, 20, [
    [[
      '...==========...........',
      '...=m@m@m@m@m#%.........',
      '...#@@@@@@@@@#%.........',
      '...#m@m@m@m@m#%.........',
      '...%%%%%%%%%%%%.........',
      '..===============.......',
      '.=###############=......',
      '=######%c%########%.....',
      '##################@bbbbb',
      '##################@%%%%@',
      '##################%.....',
      '%%%%%%%%%%%%%%%%%%%.....',
    ], 'T', 0, 0],
    [sym([
      '..==========',
      '.=##########',
      '=###########',
      '#%#%#%#%#%#%',
      '############',
      '############',
      '%%%%%%%%%%%%',
      '@@@@@@@@@@@@',
    ]), 'T', 0, 12],
  ]),

  // Heavy turret: fortified block with an LRM-15 box, a PPC and an AC/10 run out to either side.
  'TUR-H': compose(24, 24, [
    [[
      '......============......',
      '......#m@m@m@m@m#%......',
      '......#@@@@@@@@@#%......',
      '......#m@m@m@m@m#%......',
      '......#@@@@@@@@@#%......',
      '......#m@m@m@m@m#%......',
      '......%%%%%%%%%%%%......',
      '...==================...',
      '..=##################=..',
      '..#######%c%#########%..',
      'ppp@################@bbb',
      '%%%@################@%%%',
      '..%##################%..',
      '..%%%%%%%%%%%%%%%%%%%%..',
    ], 'T', 0, 0],
    [sym([
      '..==========',
      '.=##########',
      '=###########',
      '#%#%#%#%#%#%',
      '############',
      '############',
      '%%%%%%%%%%%%',
      '@@@@@@@@@@@@',
      '@@@@@@@@@@@@',
      '%%%%%%%%%%%%',
    ]), 'T', 0, 14],
  ]),
};
