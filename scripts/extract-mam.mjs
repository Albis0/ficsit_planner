// The MAM's research trees as the game lays them out: each node's place on the grid, what it needs first and the
// route its lines take. Read from the game's BPD_ResearchTree_* assets with tools/map-extractor. Needs src/data/codex.json
// (for the tree names) and the .NET SDK. Writes src/data/mam.json: { [tree name]: { cols, rows, nodes: [...] } }, where a
// node is { id, x, y, parents: [id], hiddenBy: [id], roads: [{ to: id, points: [[x, y], ...] }] }.
// Also writes src/data/mam-icons.json ({ schematic id: texture path }, the picture each research wears in the game; feed it to
// tools/icon-extractor, `bun run icons:mam`).
// Usage: bun scripts/extract-mam.mjs [game dir]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const GAME = process.argv[2] ?? process.env.SATISFACTORY_DIR ?? 'C:/Program Files/Epic Games/Satisfactory';
const dataDir = path.join(import.meta.dirname, '..', 'src', 'data');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ficsit-mam-'));
const codex = JSON.parse(fs.readFileSync(path.join(dataDir, 'codex.json'), 'utf8'));
const mam = new Map(codex.schematics.map((s) => [s.id, s]));

const DIR = 'FactoryGame/Content/FactoryGame/Schematics/Research/';
const TREES = ['AlienTech', 'Caterium', 'Nutrients', 'AlienOrganisms', 'Sulfur', 'PowerSlugs', 'Quartz', 'Mycelia'];
const list = path.join(TMP, 'paths.txt');
const bulk = path.join(TMP, 'trees.json');
fs.writeFileSync(list, TREES.map((t) => `${DIR}BPD_ResearchTree_${t}.uasset`).join('\n'));
execFileSync('dotnet', ['run', '--project', 'tools/map-extractor', '-c', 'Release', '--', GAME, 'bulk', list, bulk], {
  stdio: ['ignore', 'inherit', 'inherit'],
});
const assets = JSON.parse(fs.readFileSync(bulk, 'utf8'));

// The game's field names carry a hash after them (Coordinates_23_5A3D…).
const field = (o, name) => o?.[Object.keys(o ?? {}).find((k) => k.startsWith(`${name}_`)) ?? ''];
// A missing coordinate is 0.
const at = (c) => [field(c, 'X') ?? 0, field(c, 'Y') ?? 0];
const idOf = (ref) => ref?.ObjectName?.match(/'(\w+)'/)?.[1];

const out = {};
for (const tree of TREES) {
  const exports = assets[`${DIR}BPD_ResearchTree_${tree}.uasset`] ?? [];
  const raw = exports
    .filter((e) => e.Type === 'BPD_ResearchTreeNode_C')
    .map((e) => e.Properties.mNodeDataStruct)
    .map((n) => ({ id: idOf(field(n, 'Schematic')), at: at(field(n, 'Coordinates')), n }))
    .filter((n) => n.id && mam.has(n.id));
  if (!raw.length) throw new Error(`no nodes read for ${tree}`);
  const byAt = new Map(raw.map((n) => [n.at.join(','), n.id]));
  const nodes = raw.map(({ id, at: [x, y], n }) => ({
    id,
    x,
    y,
    parents: [...new Set((field(n, 'Parents') ?? []).map((p) => byAt.get(at(p).join(','))).filter(Boolean))],
    hiddenBy: [...new Set((field(n, 'UnhiddenBy') ?? []).map((p) => byAt.get(at(p).join(','))).filter(Boolean))],
    roads: (field(n, 'ChildrenAndRoads') ?? [])
      .map((r) => ({
        to: byAt.get(at(r.Key).join(',')),
        points: (field(r.Value, 'Points') ?? []).map(at),
      }))
      .filter((r) => r.to),
  }));
  // Named the way the Codex names its trees.
  const name = mam.get(nodes[0].id).group;
  out[name] = {
    cols: Math.max(...nodes.map((n) => n.x)) + 1,
    rows: Math.max(...nodes.map((n) => n.y)) + 1,
    nodes,
  };
}
fs.writeFileSync(path.join(dataDir, 'mam.json'), JSON.stringify(out));

// The picture each research and milestone wears: its schematic's mSchematicIcon, found by file name under Schematics/.
// The HUB's milestones wear theirs too.
const hub = codex.schematics.filter((s) => s.type === 'hub' || s.type === 'milestone').map((s) => s.id);
const ids = [...Object.values(out).flatMap((t) => t.nodes.map((n) => n.id)), ...hub];
const files = execFileSync(
  'dotnet',
  ['run', '--project', 'tools/map-extractor', '-c', 'Release', '--', GAME, 'list', 'FactoryGame/Content/FactoryGame/Schematics/'],
  {
    encoding: 'utf8',
    maxBuffer: 1 << 26,
    stdio: ['ignore', 'pipe', 'inherit'],
  },
)
  .split(/\r?\n/)
  .filter((l) => l.endsWith('.uasset'));
const fileOf = new Map(files.map((f) => [`${path.basename(f, '.uasset')}_C`, f]));
const missing = ids.filter((id) => !fileOf.has(id));
if (missing.length) console.warn(`no schematic file for ${missing.join(', ')}`);
fs.writeFileSync(
  list,
  ids
    .filter((id) => fileOf.has(id))
    .map((id) => fileOf.get(id))
    .join('\n'),
);
const schem = path.join(TMP, 'schematics.json');
execFileSync('dotnet', ['run', '--project', 'tools/map-extractor', '-c', 'Release', '--', GAME, 'bulk', list, schem], {
  stdio: ['ignore', 'inherit', 'inherit'],
});
const schematics = JSON.parse(fs.readFileSync(schem, 'utf8'));
const icons = {};
for (const id of ids.filter((x) => fileOf.has(x))) {
  const props = (schematics[fileOf.get(id)] ?? []).find((e) => e.Properties?.mSchematicIcon)?.Properties;
  const obj = props?.mSchematicIcon?.ResourceObject?.ObjectPath;
  if (obj) icons[id] = obj.replace(/^\/Game\//, 'FactoryGame/Content/').replace(/\.\d+$/, '');
}
fs.writeFileSync(path.join(dataDir, 'mam-icons.json'), JSON.stringify(icons, null, 1));
console.log(`${Object.keys(icons).length} of ${ids.length} researches and milestones have a picture`);
fs.rmSync(TMP, { recursive: true, force: true });
console.log(
  Object.entries(out)
    .map(([k, v]) => `${k}: ${v.nodes.length} nodes, ${v.cols}x${v.rows}`)
    .join('\n'),
);
