import { NODES } from '../world';

/** The map layers a save says were picked up: Somersloops, Mercer Spheres, the three slugs, and looted drop pods. */
export const PICKED_LAYERS = ['sloop', 'sphere', 'slug1', 'slug2', 'slug3', 'pod'] as const;
export type PickedLayer = (typeof PICKED_LAYERS)[number];

/** Buildings with no card in the planner that the map shows where the save has them. */
export const LANDMARKS = ['Build_TradingPost_C', 'Build_SpaceElevator_C', 'Build_Mam_C', 'Build_ResourceSinkShop_C', 'Build_RadarTower_C'];

/** A factory in the save as the map draws it: a dashed box around its buildings, named after what it makes. */
export type SaveFactory = {
  id: string;
  /** What it is named after: its main product, or for a power plant its generator. */
  item: string;
  /** On the map picture, px: left, top, right, bottom. */
  box: [number, number, number, number];
  /** Production buildings and generators in it, by class. */
  count: Record<string, number>;
};

/** What a save puts on the map. Indexes point into finds.json and world.json, places are map picture px. */
export type SaveMap = {
  picked: Partial<Record<PickedLayer, number[]>>;
  /** Nodes with an extractor on them: node index, extractor class, clock (1 = 100%). */
  miners: [node: number, extractor: string, clock: number][];
  landmarks: [cls: string, x: number, y: number][];
  factories: SaveFactory[];
  /** Pickups and nodes the save names that this map does not have. */
  missed: number;
};

const int = (v: unknown, below: number): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < below;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const id = (v: unknown): v is string => typeof v === 'string' && /^\w{1,80}$/.test(v);
const arr = (v: unknown) => (Array.isArray(v) ? v : []);

/** A stored save map as it can be trusted; anything broken is left out. */
export function cleanSaveMap(v: unknown): SaveMap | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const m = v as Record<string, unknown>;
  const picked: SaveMap['picked'] = {};
  const p = (m.picked && typeof m.picked === 'object' ? m.picked : {}) as Record<string, unknown>;
  for (const l of PICKED_LAYERS) {
    const list = arr(p[l]).filter((i) => int(i, 10_000));
    if (list.length) picked[l] = [...new Set(list)];
  }
  return {
    picked,
    miners: arr(m.miners).filter(
      (x): x is SaveMap['miners'][number] =>
        Array.isArray(x) && int(x[0], NODES.length) && id(x[1]) && num(x[2]) && x[2] >= 0 && x[2] <= 2.5,
    ),
    landmarks: arr(m.landmarks).filter(
      (x): x is SaveMap['landmarks'][number] => Array.isArray(x) && LANDMARKS.includes(x[0]) && num(x[1]) && num(x[2]),
    ),
    factories: arr(m.factories).filter(
      (f): f is SaveFactory =>
        !!f &&
        typeof f === 'object' &&
        id(f.id) &&
        id(f.item) &&
        Array.isArray(f.box) &&
        f.box.length === 4 &&
        f.box.every(num) &&
        !!f.count &&
        typeof f.count === 'object' &&
        Object.entries(f.count).every(([k, n]) => id(k) && int(n, 1e6)),
    ),
    missed: int(m.missed, 1e6) ? m.missed : 0,
  };
}
