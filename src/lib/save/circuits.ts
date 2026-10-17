import names from '../../data/world-names.json';
import { data, generatorById, recipeById } from '../data';
import { PURITIES } from '../extraction';
import { gridBoost, type Plant, unitPower } from '../power';
import { machinePower } from '../solver';
import { NODES } from '../world';
import type { SaveGrid } from './map';
import type { SaveBuilding, SaveData } from './types';

const NODE = new Map(names.node.map((n, i) => [n, i]));
const EXTRACTOR = new Map(data.extractors.map((e) => [e.id, e]));

/** What one placed building draws, MW, at its clock: machines on a recipe and extractors. Pumps and pressurizers are not counted. */
function draws(b: SaveBuilding): number {
  const clock = b.clock ?? 1;
  if (b.kind === 'extractor') {
    const e = EXTRACTOR.get(b.cls);
    return e ? e.power * clock ** e.powerExp : 0;
  }
  const r = b.kind === 'machine' && b.recipe ? recipeById.get(b.recipe) : undefined;
  return r && r.kind !== 'power' ? machinePower(r, { clock, sloops: b.sloops ?? 0 }) : 0;
}

type Row = SaveGrid['plants'][number];

/** A generator as a power plant row: fuel burners by fuel and clock, geysers by purity, augmenters by whether they are fed. */
function rowOf(b: SaveBuilding, fuelOf: Map<string, string>): Omit<Row, 'n'> | undefined {
  const g = generatorById.get(b.cls);
  if (!g) return undefined;
  if (g.kind === 'geothermal') {
    const node = b.node === undefined ? undefined : NODES[NODE.get(b.node) ?? -1];
    return { generator: g.id, clock: 1, purity: PURITIES[node?.purity ?? 1] };
  }
  if (g.kind === 'augmenter') return { generator: g.id, clock: 1, ...(b.fuel && b.fuel === g.booster?.item ? { fed: true as const } : {}) };
  if (!g.fuels.length) return { generator: g.id, clock: b.clock ?? 1 };
  // One standing empty is counted as burning what the others of its kind on the circuit burn.
  const fuel = g.fuels.some((f) => f.item === b.fuel) ? b.fuel! : (fuelOf.get(g.id) ?? g.fuels[0].item);
  return { generator: g.id, fuel, clock: Math.round((b.clock ?? 1) * 1e4) / 1e4 };
}

/** The power circuits of a save that have generators: their generators as plant rows, batteries, and MW made and drawn. Most MW first. */
export function findGrids(save: Pick<SaveData, 'buildings' | 'circuits'>): SaveGrid[] {
  const byId = new Map(save.buildings.map((b) => [b.id, b]));
  const grids: SaveGrid[] = [];
  for (const c of save.circuits) {
    const members = c.members.flatMap((m) => byId.get(m) ?? []);
    const gens = members.filter((b) => b.kind === 'generator');
    if (!gens.length) continue;
    const fuelOf = new Map<string, string>();
    for (const b of gens) if (b.fuel && generatorById.get(b.cls)?.fuels.some((f) => f.item === b.fuel)) fuelOf.set(b.cls, b.fuel);
    const rows = new Map<string, Row>();
    for (const b of gens) {
      const row = rowOf(b, fuelOf);
      if (!row) continue;
      const key = JSON.stringify(row);
      const has = rows.get(key);
      if (has) has.n++;
      else rows.set(key, { ...row, n: 1 });
    }
    const plants = [...rows.values()];
    const asPlants = plants.map((r): Plant => ({ ...r, id: '', by: 'count', amount: r.n }));
    const boost = 1 + gridBoost(asPlants);
    const made = asPlants.reduce((s, p) => s + unitPower(p) * p.amount, 0) * boost;
    grids.push({
      id: c.id,
      plants: plants.sort((a, b) => b.n - a.n),
      batteries: members.filter((b) => b.kind === 'battery').length,
      made: Math.round(made * 10) / 10,
      used: Math.round(members.reduce((s, b) => s + draws(b), 0) * 10) / 10,
    });
  }
  return grids.sort((a, b) => b.made - a.made);
}
