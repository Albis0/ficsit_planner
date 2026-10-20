import { data, generatorById } from '../data';
import { PURITIES, type Purity } from '../extraction';
import { NODES } from '../world';

/** The map layers a save says were picked up: Somersloops, Mercer Spheres, the three slugs, and looted drop pods. */
export const PICKED_LAYERS = ['sloop', 'sphere', 'slug1', 'slug2', 'slug3', 'pod'] as const;
export type PickedLayer = (typeof PICKED_LAYERS)[number];

/** Buildings with no card in the planner that the map shows where the save has them. */
export const LANDMARKS = ['Build_TradingPost_C', 'Build_SpaceElevator_C', 'Build_Mam_C', 'Build_ResourceSinkShop_C', 'Build_RadarTower_C'];

/** A factory in the save, named after what it makes; its floor is kept apart (store-idb). */
export type SaveFactory = {
  id: string;
  /** What it is named after: its main product, or for a power plant its generator. */
  item: string;
  /** Production buildings and generators in it, by class. */
  count: Record<string, number>;
  /** Machines on each recipe: what a factory linked to it is held against. */
  recipes: Record<string, number>;
};

/** What a save puts on the map, and the factories it lists. Indexes point into finds.json and world.json, places are map picture px. */
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
const counts = (v: unknown): v is Record<string, number> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.entries(v).every(([k, n]) => id(k) && int(n, 1e6));

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
    factories: arr(m.factories)
      .filter(
        (f): f is SaveFactory =>
          !!f &&
          typeof f === 'object' &&
          id(f.id) &&
          id(f.item) &&
          counts(f.count) &&
          // Kept before recipes were counted: they come with the next import.
          (f.recipes === undefined || counts(f.recipes)),
      )
      .map((f) => ({ id: f.id, item: f.item, count: f.count, recipes: f.recipes ?? {} })),
    missed: int(m.missed, 1e6) ? m.missed : 0,
  };
}

/** A power circuit in the save with generators on it (circuits.ts finds them). */
export type SaveGrid = {
  id: number;
  /** Its generators as power plant rows: one per building, fuel and clock; geysers by purity, augmenters by being fed. */
  plants: { generator: string; fuel?: string; clock: number; n: number; purity?: Purity; fed?: true }[];
  batteries: number;
  /** MW the generators make running, augmenter boost included. */
  made: number;
  /** MW its machines and extractors draw at their clocks. */
  used: number;
};

/** Stored power circuits as they can be trusted; a broken one is left out. */
export function cleanGrids(v: unknown): SaveGrid[] {
  return arr(v).filter(
    (g): g is SaveGrid =>
      !!g &&
      typeof g === 'object' &&
      Number.isInteger(g.id) &&
      int(g.batteries, 1e6) &&
      num(g.made) &&
      num(g.used) &&
      arr(g.plants).length > 0 &&
      arr(g.plants).every(
        (p) =>
          !!p &&
          typeof p === 'object' &&
          !!generatorById.get(p.generator) &&
          (p.fuel === undefined || id(p.fuel)) &&
          num(p.clock) &&
          p.clock > 0 &&
          p.clock <= 2.5 &&
          int(p.n, 1e6) &&
          p.n > 0 &&
          (p.purity === undefined || PURITIES.includes(p.purity)) &&
          (p.fed === undefined || p.fed === true),
      ),
  );
}

/** A production building, generator or extractor by its class. */
export const buildingOf = (id: string): { name: string } | undefined =>
  data.machines[id] ?? data.generators.find((g) => g.id === id) ?? data.extractors.find((e) => e.id === id);

/** What a save factory is called: the part it is named after, or for a power plant its generator. */
export const factoryTitle = (f: Pick<SaveFactory, 'item'>): { name: string } | undefined => data.items[f.item] ?? buildingOf(f.item);
