import { data } from '../data';
import { clusters } from './cluster';
import type { SaveFactory } from './map';
import { type FloorFromSave, toModels } from './toModel';
import type { SaveBuilding, SaveData } from './types';

const RECIPE = new Map(data.recipes.map((r) => [r.id, r]));

/** What a factory is named after: of what its machines make and do not use themselves, the part worth the most points. */
function mainItem(group: readonly SaveBuilding[]): string | undefined {
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

/** The buildings of each factory at the last import, by factory id: a factory found again keeps its id, and its links. */
export type Members = Record<string, string[]>;

/**
 * A factory of this import takes the id of the one at the last import that most of whose buildings it still has; a
 * factory rebuilt from scratch gets a new one.
 */
function sameAs(group: readonly SaveBuilding[], previous: Members, taken: Set<string>): string | undefined {
  const here = new Set(group.map((b) => b.id));
  let best: string | undefined;
  let most = 0;
  for (const [id, was] of Object.entries(previous)) {
    if (taken.has(id) || !was.length) continue;
    const kept = was.filter((b) => here.has(b)).length / was.length;
    if (kept >= 0.5 && kept > most) {
      most = kept;
      best = id;
    }
  }
  return best;
}

export type FoundFactories = { list: SaveFactory[]; floors: Map<string, FloorFromSave>; members: Members };

/** The save's factories: each named, counted, and drawn as a floor. */
export function findFactories(save: Pick<SaveData, 'buildings' | 'links'>, previous: Members = {}): FoundFactories {
  // A group of only generators is a power plant: it is listed under Power circuits, not as a factory.
  const groups = clusters(save.buildings, save.links).filter((g) => g.some((b) => b.kind === 'machine'));
  // Big ones first, so they get their old id before a small piece split off them could.
  groups.sort((a, b) => b.length - a.length);
  const models = toModels(save.buildings, save.links, groups);
  const found: FoundFactories = { list: [], floors: new Map(), members: {} };
  const taken = new Set<string>();
  groups.forEach((group, i) => {
    const count: Record<string, number> = {};
    const recipes: Record<string, number> = {};
    for (const b of group) {
      if (b.kind !== 'machine' && b.kind !== 'generator') continue;
      count[b.cls] = (count[b.cls] ?? 0) + 1;
      if (b.recipe && RECIPE.has(b.recipe)) recipes[b.recipe] = (recipes[b.recipe] ?? 0) + 1;
    }
    const item = mainItem(group) ?? group.find((b) => b.kind === 'generator')?.cls;
    if (!item) return;
    const ids = group.map((b) => b.id).sort();
    let id = sameAs(group, previous, taken) ?? ids[0];
    for (let n = 2; taken.has(id); n++) id = `${ids[0].slice(0, 70)}_${n}`;
    taken.add(id);
    found.list.push({ id, item, count, recipes });
    found.floors.set(id, models[i]);
    found.members[id] = ids;
  });
  return found;
}
