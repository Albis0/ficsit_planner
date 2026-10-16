// Milestones that unlock something the planner uses (recipe, building, belt, pipe, miner, plant, vehicle). The tier
// window lets a player mark these as not bought yet. Reads the Codex data, so run it after extract-codex.
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.join(import.meta.dirname, '..', 'src', 'data');
const read = (name) => JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));
const codex = read('codex.json');
const g = read('gamedata.json');

const planner = new Set([
  ...g.recipes.map((r) => r.id),
  ...Object.keys(g.machines),
  ...g.belts.map((x) => x.id),
  ...g.pipes.map((x) => x.id),
  ...g.extractors.map((x) => x.id),
  ...g.generators.map((x) => x.id),
  g.powerStorage.id,
  ...g.vehicles.map((x) => x.id),
  ...g.stations.map((x) => x.id),
]);

const list = codex.schematics
  .filter((s) => s.type === 'milestone')
  .map((s) => ({ id: s.id, name: s.name, tier: s.tier, unlocks: s.unlocks.filter((u) => planner.has(u)) }))
  .filter((m) => m.unlocks.length)
  .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));

const owner = new Map();
for (const m of list)
  for (const u of m.unlocks) {
    if (owner.has(u)) throw new Error(`${u} is unlocked by both ${owner.get(u)} and ${m.id}`);
    owner.set(u, m.id);
  }

fs.writeFileSync(path.join(dataDir, 'milestones.json'), JSON.stringify(list));
console.log('milestones', list.length);
