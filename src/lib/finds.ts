import { useEffect, useState } from 'react';

/** A point on the map picture (0..size px). */
export type Point = [x: number, y: number];
/** A crash site: where, and what opening it takes (nothing, parts, or power). */
export type Pod = [x: number, y: number, cost: 0 | { item: string; amount: number } | { mw: number }];
/** A creature spawner: where, which creature (index into the creatures) and how many it spawns. */
export type Spawn = [x: number, y: number, creature: number, count: number];

export interface Finds {
  sloop: Point[];
  sphere: Point[];
  slug1: Point[];
  slug2: Point[];
  slug3: Point[];
  berry: Point[];
  nut: Point[];
  shroom: Point[];
  pod: Pod[];
  spawn: Spawn[];
}

export type Family = 'hog' | 'spitter' | 'stinger' | 'hatcher' | 'passive';

/** A creature, read from its blueprint and descriptor. Speeds in cm/s, as the game keeps them. */
export interface Creature {
  id: string;
  name: string;
  /** The game's short description, where it has one. */
  note?: string;
  family: Family;
  health?: number;
  run?: number;
  sprint?: number;
  /** The remains it leaves, an item id. */
  drop?: string;
  /** Spawn points in the world, and how many of it they hold together. */
  spawners: number;
  count: number;
}

/** How many of each find the world holds, and how many crash sites open for free or for power. */
export type FindCounts = Record<Exclude<keyof Finds, 'spawn'> | 'podFree' | 'podPower', number>;

export interface World {
  finds: Finds;
  creatures: Creature[];
}

/** Everything that isn't a resource node: artifacts, power slugs, crash sites, plants, then creatures. */
export const LAYER_GROUPS = [
  { id: 'artifacts', layers: ['sloop', 'sphere', 'pod'] },
  { id: 'slugs', layers: ['slug1', 'slug2', 'slug3'] },
  { id: 'plants', layers: ['berry', 'nut', 'shroom'] },
] as const;

export type PointLayer = Exclude<keyof Finds, 'pod' | 'spawn'>;
export type Layer = (typeof LAYER_GROUPS)[number]['layers'][number];

/** The item each layer is (or gives, for crash sites: a hard drive). */
export const LAYER_ITEM: Record<Layer, string> = {
  sloop: 'Desc_WAT1_C',
  sphere: 'Desc_WAT2_C',
  pod: 'Desc_HardDrive_C',
  slug1: 'Desc_Crystal_C',
  slug2: 'Desc_Crystal_mk2_C',
  slug3: 'Desc_Crystal_mk3_C',
  berry: 'Desc_Berry_C',
  nut: 'Desc_Nut_C',
  shroom: 'Desc_Shroom_C',
};

/** The ring each layer's pins get: the colour of the thing itself where it has one. */
export const LAYER_RING: Record<Layer, string> = {
  sloop: '#e0508f',
  sphere: '#9b7cf2',
  pod: '#fa9549',
  slug1: '#4fa3e8',
  slug2: '#f2c14e',
  slug3: '#b36bf0',
  berry: '#d86a8c',
  nut: '#c8a36a',
  shroom: '#7cc46a',
};

export const CREATURE_RING: Record<Family, string> = {
  hog: '#e0685c',
  spitter: '#e0685c',
  stinger: '#e0685c',
  hatcher: '#e0685c',
  passive: '#9fc3cf',
};

/** Layers on until the player turns more on: none, so the map opens on the resource nodes alone. */
export const DEFAULT_LAYERS: string[] = [];

const LAYERS = new Set<string>(LAYER_GROUPS.flatMap((g) => g.layers));
/** A layer id worth keeping from a saved filter: a known layer, or a creature (its descriptor's id). */
export const knownLayer = (id: unknown): id is string =>
  typeof id === 'string' && (LAYERS.has(id) || (/^Desc_\w+_C$/.test(id) && id.length < 64));

/** Which layer an item has points on, if any: somersloops, mercer spheres, slugs and plants. */
export const layerOfItem = (item: string): Layer | undefined =>
  (Object.keys(LAYER_ITEM) as Layer[]).find((l) => l !== 'pod' && LAYER_ITEM[l] === item);

let loaded: World | undefined;
let loading: Promise<World> | undefined;

/** The finds and creatures, loaded the first time the map or the Codex needs them. */
export function loadWorld(): Promise<World> {
  loading ??= Promise.all([import('../data/finds.json'), import('../data/creatures.json')]).then(([f, c]) => {
    loaded = { finds: f.default as unknown as Finds, creatures: c.default.creatures as Creature[] };
    return loaded;
  });
  return loading;
}

export function useWorld(): World | undefined {
  const [world, setWorld] = useState(loaded);
  useEffect(() => {
    if (!world) loadWorld().then(setWorld);
  }, [world]);
  return world;
}

/** How many points a layer has on the map: pins, or creatures for a creature's spawners. */
export function layerCount(world: World, layer: string): number {
  if (layer in world.finds) return world.finds[layer as keyof Finds].length;
  return world.creatures.find((c) => c.id === layer)?.count ?? 0;
}
