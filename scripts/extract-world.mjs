// What else the world holds: somersloops, mercer spheres, power slugs, crash sites, berries, nuts and mushrooms,
// and where each creature spawns, with the creatures themselves (name, health, speed, what they drop, icon).
// Needs the game installed and the .NET SDK, like extract-map.mjs.
// Usage: bun scripts/extract-world.mjs [game dir]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const GAME = process.argv[2] ?? 'C:/Program Files/Epic Games/Satisfactory';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ficsit-world-'));
const world = JSON.parse(fs.readFileSync('src/data/world.json', 'utf8'));
const { size: SIZE, bounds: BOUNDS } = world;
const px = (v, lo, hi) => Math.round(((v - lo) / (hi - lo)) * SIZE);
const at = (p) => [px(p.x, BOUNDS.x0, BOUNDS.x1), px(p.y, BOUNDS.y0, BOUNDS.y1)];

const extractor = (...args) =>
  execFileSync('dotnet', ['run', '--project', 'tools/map-extractor', '-c', 'Release', '--', GAME, ...args], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
const read = (name) => JSON.parse(fs.readFileSync(path.join(TMP, name), 'utf8'));

extractor('world', path.join(TMP, 'world.json'));
extractor('descriptors', 'Creature/CreatureDescriptors/', path.join(TMP, 'descriptors.json'));
extractor('raw', 'FactoryGame/Content/Localization/StringTables/World_Data.csv', path.join(TMP, 'World_Data.csv'));
const found = read('world.json');
const descriptors = read('descriptors.json');

// The string table: key, English text, and a note that for creatures is often a short description.
const strings = new Map();
for (const line of fs.readFileSync(path.join(TMP, 'World_Data.csv'), 'utf8').split(/\r?\n/)) {
  const cells = [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replaceAll('""', '"'));
  if (cells.length >= 3) strings.set(cells[0], { text: cells[1], note: cells[2] });
}

// Creatures that spawn in the world, and the descriptor (name, icon) that goes with each.
const spawned = [...new Set(found.filter((f) => f.kind === 'spawner' && f.what).map((f) => f.what))];
const hatchers = { Char_CrabHatcher_C: 'hatcher', Char_BigCrabHatcher_C: 'bighatcher' };
extractor('creatures', path.join(TMP, 'creatures.json'), ...spawned, ...Object.keys(hatchers));
const stats = new Map(read('creatures.json').map((c) => [c.id, c]));
const FAMILY = { Hog: 'hog', Spitter: 'spitter', Stinger: 'stinger' };
const DROP = { hog: 'Desc_HogParts_C', spitter: 'Desc_SpitterParts_C', stinger: 'Desc_StingerParts_C', hatcher: 'Desc_HatcherParts_C' };
const ICON = 'FactoryGame/Content/FactoryGame/Character/Creature/CreatureDescriptors/UI';
const hatcher = descriptors.find((d) => d.id === 'Desc_HatcherBasic_C');
// Crab hatchers keep their health in the game's C++ code, out of reach of the archives; these are the Satisfactory wiki's.
const WIKI_HEALTH = { Char_CrabHatcher_C: 20, Char_BigCrabHatcher_C: 45 };
const creatures = [...spawned, ...Object.keys(hatchers)].map((char) => {
  const s = stats.get(char) ?? {};
  const d = descriptors.find((x) => x.creature === char);
  let name = d && strings.get(d.nameKey)?.text;
  let note = d && strings.get(d.nameKey)?.note;
  let icon = d?.icon;
  let id = d?.id;
  // Hatchers have one descriptor between the two sizes; the beetle has none, so it gets the scanner's creature icon.
  if (hatchers[char]) {
    const elite = char === 'Char_BigCrabHatcher_C';
    id = elite ? 'Desc_HatcherElite_C' : hatcher.id;
    icon = hatcher.icon;
    name = `${elite ? 'Elite ' : ''}${strings.get(hatcher.nameKey).text}`;
    note = '';
  }
  if (!id) {
    const short = char.replace(/^Char_|_C$/g, '');
    id = `Desc_${short}_C`;
    name = short;
    icon = 'Monsters';
  }
  // Red forest spitters carry the forest spitters' names in the game.
  if (char.includes('ForestRed')) name = `${name} (red)`;
  const family = hatchers[char] ? 'hatcher' : (Object.entries(FAMILY).find(([k]) => (s.family ?? '').includes(k))?.[1] ?? 'passive');
  return {
    id,
    char,
    name,
    note: note?.startsWith('A ') ? note : undefined,
    family,
    health: s.health ?? WIKI_HEALTH[char],
    run: s.run ?? undefined,
    sprint: s.sprint ?? undefined,
    drop: DROP[family],
    icon: icon?.split('.')[0].split('/').pop(),
  };
});

const ORDER = ['hog', 'spitter', 'stinger', 'hatcher', 'passive'];
creatures.sort(
  (a, b) => ORDER.indexOf(a.family) - ORDER.indexOf(b.family) || (a.health ?? 0) - (b.health ?? 0) || a.name.localeCompare(b.name),
);

// Icons: the game's 256 px creature pictures, stored like the item icons.
const icons = [...new Set(creatures.map((c) => c.icon).filter(Boolean))];
extractor('tex', TMP, ...icons.map((i) => (i === 'Monsters' ? MONSTERS : `${ICON}/${i}`)));
// Which texture each creature's icon comes from, so the app knows the icon exists (and `bun run icons:world` can redo them).
const MONSTERS = 'FactoryGame/Content/FactoryGame/Equipment/ObjectScanner/Icons/Monsters_256';
fs.writeFileSync(
  'src/data/world-icons.json',
  `${JSON.stringify(Object.fromEntries(creatures.map((c) => [c.id, c.icon === 'Monsters' ? MONSTERS : `${ICON}/${c.icon}`])), null, 1)}
`,
);
for (const c of creatures) {
  const file = path.join(TMP, `${c.icon === 'Monsters' ? 'Monsters_256' : c.icon}.png`);
  if (fs.existsSync(file)) await sharp(file).resize(96, 96).webp({ quality: 88 }).toFile(`public/icons/${c.id}.webp`);
  delete c.icon;
}

// Points on the map picture, per kind.
const points = (kind) => found.filter((f) => f.kind === kind).map(at);
const cost = (c) =>
  !c || c.type === 'None' ? 0 : c.type === 'Item' ? { item: c.item, amount: c.amount } : c.type === 'Power' ? { mw: c.power } : 0;
const finds = {
  sloop: points('sloop'),
  sphere: points('sphere'),
  slug1: points('slug1'),
  slug2: points('slug2'),
  slug3: points('slug3'),
  berry: points('berry'),
  nut: points('nut'),
  shroom: points('shroom'),
  pod: found.filter((f) => f.kind === 'pod').map((f) => [...at(f), cost(f.cost)]),
  spawn: found
    .filter((f) => ['spawner', 'hatcher', 'bighatcher'].includes(f.kind))
    .flatMap((f) => {
      const char = f.kind === 'spawner' ? f.what : f.kind === 'hatcher' ? 'Char_CrabHatcher_C' : 'Char_BigCrabHatcher_C';
      const i = creatures.findIndex((c) => c.char === char);
      return i < 0 ? [] : [[...at(f), i, f.count ?? 1]];
    }),
};
// The Codex reads the creatures and how many of everything there is without loading every point.
for (const [i, c] of creatures.entries()) {
  delete c.char;
  const own = finds.spawn.filter((s) => s[2] === i);
  c.spawners = own.length;
  c.count = own.reduce((n, s) => n + s[3], 0);
}
const counts = Object.fromEntries(
  Object.entries(finds)
    .filter(([k]) => k !== 'spawn')
    .map(([k, v]) => [k, v.length]),
);
counts.podFree = finds.pod.filter((p) => !p[2]).length;
counts.podPower = finds.pod.filter((p) => p[2] && 'mw' in p[2]).length;
fs.writeFileSync('src/data/finds.json', `${JSON.stringify(finds)}\n`);
fs.writeFileSync('src/data/creatures.json', `${JSON.stringify({ creatures, counts }, null, 1)}\n`);
console.log(
  Object.entries(finds)
    .map(([k, v]) => `${k} ${v.length}`)
    .join(', '),
);
console.log(`creatures: ${creatures.length}`);
fs.rmSync(TMP, { recursive: true, force: true });
