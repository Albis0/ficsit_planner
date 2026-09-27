import world from '../data/world.json';
import { DEFAULT_LAYERS, knownLayer } from './finds';

/** A resource node, a well's satellite node or a geyser, placed on the map picture (0..size px). */
export interface WorldNode {
  kind: 'node' | 'well' | 'geyser';
  item: string;
  /** 0 impure, 1 normal, 2 pure. */
  purity: 0 | 1 | 2;
  x: number;
  y: number;
  /** A satellite's well, as an index into WELLS. */
  well?: number;
}

/** Side of the map picture in pixels; its tiles go from zoom 0 (one 256 px tile) to MAX_TILE_ZOOM. */
export const MAP_SIZE = world.size;
export const MAX_TILE_ZOOM = Math.log2(MAP_SIZE / 256);
export const NODES = world.nodes as WorldNode[];
/** The middle of each resource well, where its pressurizer goes. */
export const WELLS = world.wells as { item: string; x: number; y: number }[];

/** How the map's filter reads: resources left off, which purities show, and which other layers are on. */
export interface MapFilter {
  hidden: string[];
  purities: number[];
  /** Artifacts, power slugs, crash sites, plants and creatures that show. */
  layers: string[];
}

export const DEFAULT_MAP_FILTER: MapFilter = { hidden: [], purities: [0, 1, 2], layers: DEFAULT_LAYERS };

/** The resources on the map, in the order the filter lists them: ores, then fluids, then geysers. */
export const MAP_GROUPS: { id: 'ores' | 'fluids' | 'geysers'; items: string[] }[] = (() => {
  const count = new Map<string, number>();
  for (const n of NODES) count.set(n.item, (count.get(n.item) ?? 0) + 1);
  const fluids = ['Desc_LiquidOil_C', 'Desc_NitrogenGas_C', 'Desc_Water_C'];
  const byCount = (a: string, b: string) => (count.get(b) ?? 0) - (count.get(a) ?? 0);
  const all = [...count.keys()];
  return [
    { id: 'ores', items: all.filter((i) => !fluids.includes(i) && i !== 'Desc_Geyser_C').sort(byCount) },
    { id: 'fluids', items: fluids.filter((i) => count.has(i)) },
    { id: 'geysers', items: ['Desc_Geyser_C'] },
  ];
})();

const KNOWN = new Set(MAP_GROUPS.flatMap((g) => g.items));

/** A saved filter as it can be trusted: known resources only, purities 0 to 2. */
export function cleanMapFilter(v: unknown): MapFilter {
  const f = (v && typeof v === 'object' ? v : {}) as Partial<Record<keyof MapFilter, unknown>>;
  const hidden = Array.isArray(f.hidden) ? f.hidden.filter((i): i is string => typeof i === 'string' && KNOWN.has(i)) : [];
  const purities = Array.isArray(f.purities)
    ? [...new Set(f.purities.filter((p): p is number => p === 0 || p === 1 || p === 2))].sort()
    : DEFAULT_MAP_FILTER.purities;
  const layers = Array.isArray(f.layers) ? [...new Set(f.layers.filter(knownLayer))] : DEFAULT_MAP_FILTER.layers;
  return { hidden: [...new Set(hidden)], purities, layers };
}

/** Nodes of one resource by purity: [impure, normal, pure]. */
export function purityCounts(item: string): [number, number, number] {
  const c: [number, number, number] = [0, 0, 0];
  for (const n of NODES) if (n.item === item) c[n.purity]++;
  return c;
}
