import { recipeById } from '../../data';
import { type ExtractionUse, PURITIES, type Purity } from '../../extraction';
import { describeUse, type RecipeUse, type SolveResult, shardsFor, type Target } from '../../solver';
import { extractorById, extractorRate } from '../ports';
import type { Model } from '../types';
import { type CalcResult, countOf } from './result';

/*
  A hand-built model's numbers in the shape the rest of the planner reads, so the totals, the list and the transport
  view work the same on a manual floor. Each machine node is its own line (two nodes with one recipe stay two rows);
  extractors become the raw inputs, things brought in the supplies, outputs the targets.
*/

export interface ManualResult extends SolveResult {
  manual: true;
}

/** Adds up per item. */
const add = (list: Target[], item: string, rate: number) => {
  if (rate <= 1e-9) return;
  const hit = list.find((x) => x.item === item);
  if (hit) hit.rate += rate;
  else list.push({ item, rate });
};

export function adaptModel(model: Model, calc: CalcResult | undefined): { result: ManualResult; extraction: ExtractionUse[] } {
  const recipes: RecipeUse[] = [];
  const raw: Target[] = [];
  const supplies: Target[] = [];
  const targets: Target[] = [];
  const surplus: Target[] = [];
  const extraction: ExtractionUse[] = [];
  for (const n of model.nodes) {
    const c = calc?.nodes[n.id];
    const u = c?.u ?? 0;
    if (n.k === 'machine') {
      const count = countOf(n, c);
      const built = count > 1e-9 ? describeUse0(n.recipe, n.clock ?? 1, n.sloops ?? 0, count) : undefined;
      if (!built) continue;
      // What's built is set by the node; what flows by how busy it runs.
      recipes.push({
        ...built,
        inputs: built.inputs.map((s) => ({ ...s, rate: s.rate * u })),
        outputs: built.outputs.map((s) => ({ ...s, rate: s.rate * u })),
        power: built.power * u,
        node: n.id,
      });
      for (const [q, x] of (c?.spare ?? []).entries()) add(surplus, built.recipe.outputs[q]?.item ?? '', x);
    } else if (n.k === 'extract') {
      const e = extractorById.get(n.extractor);
      if (!e) continue;
      const count = n.n ?? 1;
      const clock = n.clock ?? 1;
      const built = Math.max(1, Math.ceil(count - 1e-6));
      const each = (clock * count) / built;
      const rate = extractorRate(e, n.purity) * clock * count * u;
      add(raw, n.item, rate);
      const per = (p: Purity) => extractorRate(e, p) * clock;
      extraction.push({
        item: n.item,
        rate,
        extractor: e,
        counts: Object.fromEntries(
          PURITIES.map((p) => [p, Math.ceil((extractorRate(e, n.purity) * clock * count) / per(p) - 1e-6)]),
        ) as Record<Purity, number>,
        built,
        power: built * e.power * each ** e.powerExp * u,
        clock: each,
        shards: built * shardsFor(each),
      });
    } else if (n.k === 'in' && n.item) add(supplies, n.item, c?.outs[0] ?? 0);
    else if (n.k === 'storage' && n.mode === 'empty' && n.item) add(supplies, n.item, c?.outs[0] ?? 0);
  }
  // What reaches the outputs, sinks and filling containers, item by item.
  for (const l of model.links) {
    const to = model.nodes.find((n) => n.id === l.b);
    if (!to || !(to.k === 'out' || to.k === 'sink' || (to.k === 'storage' && to.mode === 'fill'))) continue;
    for (const [item, rate] of calc?.links[l.id]?.items ?? []) add(to.k === 'out' && to.tag !== 'spare' ? targets : surplus, item, rate);
  }
  const result: ManualResult = {
    manual: true,
    recipes,
    raw: raw.sort((a, b) => b.rate - a.rate),
    supplies,
    targets,
    surplus,
    missing: [],
    power: recipes.reduce((s, u) => s + u.power, 0),
    shards: recipes.reduce((s, u) => s + u.shards, 0),
    sloops: recipes.reduce((s, u) => s + u.sloops, 0),
    scale: 1,
    prices: new Map(),
  };
  return { result, extraction };
}

/** A machine node as the solver would describe that many machines at that clock. */
function describeUse0(recipe: string, clock: number, sloops: number, n: number): RecipeUse | undefined {
  const r = recipeById.get(recipe);
  return r ? describeUse(r, { clock, sloops }, n, 'set') : undefined;
}

/**
 * A hand-built floor's products and what comes into it, as targets and supplies: each output card's limit, or what
 * reaches it when it has none, added up per item. Rebuilding starts from these, so the floor built afresh makes what
 * the panel lists. Inputs standing in for something nothing here could make aren't supplies.
 */
export function floorEnds(model: Model, calc: CalcResult | undefined): { targets: Target[]; supplies: Target[] } {
  const targets: Target[] = [];
  const supplies: Target[] = [];
  for (const n of model.nodes) {
    if (n.k !== 'out' && n.k !== 'in') continue;
    if (n.tag === 'spare' || n.tag === 'bring') continue;
    let rate = 0;
    let item = n.item;
    for (const l of model.links) {
      if (l.b !== n.id && l.a !== n.id) continue;
      const c = calc?.links[l.id];
      rate += c?.rate ?? 0;
      item ??= c?.items[0]?.[0];
    }
    if (!item) continue;
    add(n.k === 'out' ? targets : supplies, item, n.lim ?? rate);
  }
  return { targets, supplies };
}
