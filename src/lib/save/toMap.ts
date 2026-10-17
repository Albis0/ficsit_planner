import names from '../../data/world-names.json';
import world from '../../data/world.json';
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
/** Puts a save on the map: what was picked up, which nodes are mined, the landmarks, and the factories found in it. */
export function toMap(save: SaveData, factories: SaveFactory[]): SaveMap {
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
  return {
    picked,
    miners,
    landmarks: save.landmarks.map((l) => [l.cls, ...toPx(l.x, l.y)]),
    factories,
    missed,
  };
}
