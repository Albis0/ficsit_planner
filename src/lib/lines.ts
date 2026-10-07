import { data } from './data';
import type { RecipeUse, SolveInput, SolveResult, Target } from './solver';

/** One line of a factory: the products it makes and its own solution, with machines of its own. */
export interface Line {
  items: string[];
  result: SolveResult;
}

const sum = (lists: Target[][]): Target[] => {
  const total = new Map<string, number>();
  for (const list of lists) for (const x of list) total.set(x.item, (total.get(x.item) ?? 0) + x.rate);
  return [...total].map(([item, rate]) => ({ item, rate }));
};

/** Recipes used in several lines as one entry: the machines of every line added up, each line still built whole. */
function mergeRecipes(parts: SolveResult[]): RecipeUse[] {
  const byId = new Map<string, RecipeUse[]>();
  for (const r of parts) for (const u of r.recipes) byId.set(u.recipe.id, [...(byId.get(u.recipe.id) ?? []), u]);
  return [...byId.values()].map((uses) => {
    if (uses.length === 1) return uses[0];
    const built = uses.reduce((s, u) => s + u.built, 0);
    return {
      ...uses[0],
      count: uses.reduce((s, u) => s + u.count, 0),
      built,
      clock: uses.reduce((s, u) => s + u.clock * u.built, 0) / built,
      clocks: uses.flatMap((u) => u.clocks),
      power: uses.reduce((s, u) => s + u.power, 0),
      shards: uses.reduce((s, u) => s + u.shards, 0),
      sloops: uses.reduce((s, u) => s + u.sloops, 0),
      inputs: sum(uses.map((u) => u.inputs)),
      outputs: sum(uses.map((u) => u.outputs)),
    };
  });
}

/** Every line's answer as one, for the totals, the list and the transport view; the lines themselves stay on `lines`. */
export function mergeLines(lines: Line[]): SolveResult {
  const parts = lines.map((l) => l.result);
  const first = parts[0];
  return {
    ...first,
    recipes: mergeRecipes(parts),
    raw: sum(parts.map((r) => r.raw)).sort((a, b) => b.rate - a.rate),
    supplies: sum(parts.map((r) => r.supplies)),
    targets: sum(parts.map((r) => r.targets)),
    surplus: sum(parts.map((r) => r.surplus)),
    missing: sum(parts.map((r) => r.missing)),
    power: parts.reduce((s, r) => s + r.power, 0),
    shards: parts.reduce((s, r) => s + r.shards, 0),
    sloops: parts.reduce((s, r) => s + r.sloops, 0),
    lines,
  };
}

/**
 * Makes the products marked as lines of their own each in a solution of their own, and the rest together: where two
 * lines need the same part, each makes its own. What one line mines is gone for the next, so the lines share the
 * resource limits. Items on hand and pinned inputs go to the first line, which is the shared one when there is one.
 */
export function solveInLines(solveOne: (input: SolveInput) => SolveResult, input: SolveInput): SolveResult {
  const own = new Set(input.lines ?? []);
  const apart = input.targets.filter((t) => own.has(t.item));
  const together = input.targets.filter((t) => !own.has(t.item));
  const { lines: _, ...rest } = input;
  if (apart.length === 0 || input.targets.length < 2) return solveOne(rest);
  const groups = [...(together.length ? [together] : []), ...apart.map((t) => [t])];
  const lines: Line[] = [];
  let caps = input.resourceCaps;
  for (const [i, targets] of groups.entries()) {
    const result = solveOne({
      ...rest,
      targets,
      supplies: i === 0 ? input.supplies : [],
      fixed: i === 0 ? input.fixed : undefined,
      resourceCaps: caps,
    });
    lines.push({ items: targets.map((t) => t.item), result });
    const left = { ...caps };
    for (const x of result.raw) {
      const cap = caps[x.item] ?? data.worldLimits[x.item];
      if (typeof cap === 'number' && Number.isFinite(cap)) left[x.item] = Math.max(0, cap - x.rate);
    }
    caps = left;
  }
  return mergeLines(lines);
}
