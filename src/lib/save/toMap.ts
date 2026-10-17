import names from '../../data/world-names.json';
import world from '../../data/world.json';
import { data } from '../data';
import { clusters } from './cluster';
import { PICKED_LAYERS, type PickedLayer, type SaveFactory, type SaveMap } from './map';
import type { SaveData } from './types';

// The world's own names, loaded only with the import window: a pickup or node by its actor name.
const PICKUP = new Map<string, [PickedLayer, number]>();
for (const l of PICKED_LAYERS)
  names[l].forEach((n, i) => {
    PICKUP.set(n, [l, i]);
  });
const NODE = new Map(names.node.map((n, i) => [n, i]));
const WELL = new Set(names.well);

const { size, bounds } = world;
const round = (v: number) => Math.round(v * 10) / 10;
/** Game units (cm) to the map picture, as scripts/extract-map.mjs places nodes. */
export const toPx = (x: number, y: number): [number, number] => [
  round(((x - bounds.x0) / (bounds.x1 - bounds.x0)) * size),
  round(((y - bounds.y0) / (bounds.y1 - bounds.y0)) * size),
];
/** A factory box reaches this far past its outermost buildings, cm: buildings are drawn by their middle. */
const PAD = 1500;

const RECIPE = new Map(data.recipes.map((r) => [r.id, r]));

/** What a factory is named after: of what its machines make and do not use themselves, the part worth the most points. */
function mainItem(group: SaveData['buildings']): string | undefined {
  const made = new Map<string, number>();
  const used = new Set<string>();
  for (const b of group) {
    const r = b.recipe ? RECIPE.get(b.recipe) : undefined;
    if (!r || b.kind !== 'machine') continue;
    const out = r.outputs[0]?.item;
    if (out) made.set(out, (made.get(out) ?? 0) + 1);
    for (const i of r.inputs) used.add(i.item);
  }
  const ends = [...made.keys()].filter((i) => !used.has(i));
  const pick = ends.length ? ends : [...made.keys()];
  const worth = (i: string) => data.items[i]?.sink ?? 0;
  return pick.sort((a, b) => worth(b) - worth(a) || (made.get(b) ?? 0) - (made.get(a) ?? 0))[0];
}

/** Puts a save on the map: what was picked up, which nodes are mined, the landmarks, and (if asked) the factories. */
export function toMap(save: SaveData, factories: boolean): SaveMap {
  const picked: SaveMap['picked'] = {};
  let missed = 0;
  for (const name of save.collected) {
    const at = PICKUP.get(name);
    if (!at) {
      missed++;
      continue;
    }
    const list = picked[at[0]] ?? [];
    list.push(at[1]);
    picked[at[0]] = list;
  }
  const miners: SaveMap['miners'] = [];
  for (const b of save.buildings) {
    if (!b.node || b.kind === 'pressurizer') continue;
    const i = NODE.get(b.node);
    if (i !== undefined) miners.push([i, b.cls, b.clock ?? 1]);
    // Water extractors stand in water, not on a node; mods bring nodes of their own.
    else if (/^BP_(ResourceNode|Fracking)/.test(b.node) && !WELL.has(b.node)) missed++;
  }
  const out: SaveMap = {
    picked,
    miners,
    landmarks: save.landmarks.map((l) => [l.cls, ...toPx(l.x, l.y)]),
    factories: [],
    missed,
  };
  if (!factories) return out;
  for (const group of clusters(save.buildings, save.links)) {
    const count: Record<string, number> = {};
    for (const b of group) if (b.kind === 'machine' || b.kind === 'generator') count[b.cls] = (count[b.cls] ?? 0) + 1;
    const generator = group.find((b) => b.kind === 'generator')?.cls;
    const item = mainItem(group) ?? generator;
    if (!item) continue;
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const b of group) {
      x0 = Math.min(x0, b.x);
      y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x);
      y1 = Math.max(y1, b.y);
    }
    const box = [...toPx(x0 - PAD, y0 - PAD), ...toPx(x1 + PAD, y1 + PAD)] as SaveFactory['box'];
    const id = group.map((b) => b.id).sort()[0];
    out.factories.push({ id, item, box, count });
  }
  return out;
}
