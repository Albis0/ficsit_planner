import type { Highs } from 'highs';
import { craftableItems, data, producersOf, type Recipe, recipeById } from './data';
import { type Plant, plantRecipe } from './power';
import { SolverError, type SolveResult, solve, type Target } from './solver';

/**
 * Worked-out numbers for the Codex, beyond what the game files say: the whole production line behind
 * each part, how its recipes compare once their inputs are made too, and what each fuel costs to
 * burn. Worked out ahead of time by scripts/codex-insights.ts into src/data/insights.json, with the
 * planner's own solver, so the Codex opens at once and a test can check the file is up to date.
 */

/** One step of a line: a recipe and how many of its buildings (at 100%) it takes. */
export type Step = [recipe: string, machines: number];

export interface Line {
  /** Items a minute the line is sized for: what one building of the recipe makes. */
  rate: number;
  steps: Step[];
  raw: Target[];
  /** Raw resources a minute, water left out (it's free and endless). */
  rawTotal: number;
  /** MW for the production buildings, miners and pumps not counted. */
  power: number;
  /** Buildings placed, counting each step's rounded up. */
  buildings: number;
  /** What's left over. */
  surplus: Target[];
  /** Items no standard recipe makes, which this line needs brought in. */
  missing: Target[];
}

export interface ItemInsight {
  /** The recipe the line is built on: the item's own standard one. */
  recipe: string;
  line: Line;
  /** Every recipe whose main product this is, each line built with it and standard recipes for the rest. */
  compare: (Line & { recipe: string })[];
}

export interface FuelInsight {
  generator: string;
  fuel: string;
  /** MW one generator makes. */
  mw: number;
  /** Raw resources a minute behind one generator's fuel (and water), made with standard recipes. */
  raw: Target[];
  rawTotal: number;
  /** MW the production buildings making that fuel draw. */
  chainPower: number;
  /** What has to be brought in: fuel nothing makes (leaves, wood, mycelia are picked by hand) or its ingredients. */
  missing: Target[];
}

export interface Insights {
  items: Record<string, ItemInsight>;
  fuels: FuelInsight[];
}

const WATER = 'Desc_Water_C';
const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
/**
 * The recipes every line starts from: the standard ones, plus alternates for parts no standard recipe makes
 * (turbofuel, compacted coal), so a line that needs one shows how it's made instead of asking for it.
 */
const standard = (() => {
  const ids = data.recipes.filter((r) => r.kind === 'standard').map((r) => r.id);
  const made = new Set(data.recipes.filter((r) => r.kind === 'standard').map((r) => r.outputs[0].item));
  const fill = data.recipes.filter((r) => r.kind === 'alternate' && !made.has(r.outputs[0].item)).map((r) => r.id);
  return [...ids, ...fill];
})();

const EMPTIES = new Set(['Desc_FluidCanister_C', 'Desc_GasTank_C']);

/**
 * The recipes whose first product is the item (not ones that only leave it over). Converters and
 * unpacking (which only gives back a fluid packed earlier) are left out.
 */
export const mainRecipes = (item: string) =>
  (producersOf.get(item) ?? []).filter(
    (r) =>
      r.outputs[0].item === item && r.kind !== 'converter' && r.kind !== 'power' && !r.outputs.slice(1).some((o) => EMPTIES.has(o.item)),
  );

function lineOf(r: SolveResult, rate: number): Line {
  const raw = r.raw.map((x) => ({ item: x.item, rate: round(x.rate) }));
  return {
    rate: round(rate),
    steps: r.recipes.map((u) => [u.recipe.id, round(u.count)] as Step),
    raw,
    rawTotal: round(r.raw.filter((x) => x.item !== WATER).reduce((s, x) => s + x.rate, 0)),
    power: round(r.power, 3),
    buildings: r.recipes.reduce((s, u) => s + u.built, 0),
    surplus: r.surplus.map((x) => ({ item: x.item, rate: round(x.rate) })),
    missing: r.missing.map((x) => ({ item: x.item, rate: round(x.rate) })),
  };
}

/** The line for `rate` of an item, made with this recipe and standard recipes for everything else. */
function lineWith(highs: Highs, item: string, rate: number, recipe: Recipe): Line | undefined {
  const enabled = new Set(standard);
  for (const r of mainRecipes(item)) enabled.delete(r.id);
  enabled.add(recipe.id);
  try {
    const r = solve(highs, { targets: [{ item, rate }], supplies: [], enabledRecipes: enabled, resourceCaps: {}, objective: 'resources' });
    return lineOf(r, rate);
  } catch (e) {
    if (e instanceof SolverError) return undefined;
    throw e;
  }
}

export function itemInsight(highs: Highs, item: string): ItemInsight | undefined {
  const recipes = mainRecipes(item);
  const standards = recipes.filter((r) => r.kind === 'standard');
  const first = standards[0] ?? recipes[0];
  if (!first) return undefined;
  // With more than one standard recipe (biomass from leaves, wood, mycelia or alien protein), the line uses the
  // one the solver finds cheapest, sized to what one of its buildings makes.
  let base = first;
  if (standards.length > 1) {
    const enabled = new Set(standard);
    try {
      const r = solve(highs, {
        targets: [{ item, rate: first.outputs[0].rate }],
        supplies: [],
        enabledRecipes: enabled,
        resourceCaps: {},
        objective: 'resources',
      });
      base = standards.find((x) => r.recipes.some((u) => u.recipe.id === x.id)) ?? first;
    } catch (e) {
      if (!(e instanceof SolverError)) throw e;
    }
  }
  const rate = base.outputs[0].rate;
  const line = lineWith(highs, item, rate, base);
  if (!line) return undefined;
  const compare = recipes
    .map((r) => {
      const l = r === base ? line : lineWith(highs, item, rate, r);
      return l && { recipe: r.id, ...l };
    })
    .filter((x): x is Line & { recipe: string } => !!x);
  return { recipe: base.id, line, compare };
}

export function fuelInsights(highs: Highs): FuelInsight[] {
  const out: FuelInsight[] = [];
  for (const g of data.generators) {
    if (g.kind !== 'fuel') continue;
    for (const f of g.fuels) {
      const plant: Plant = { id: 'p', generator: g.id, fuel: f.item, by: 'count', amount: 1, clock: 1 };
      // The generator's own intake, as targets: fuel and water, made the way every line is.
      const targets = plantRecipe(plant).inputs;
      const enabled = new Set(standard);
      try {
        const r = solve(highs, { targets, supplies: [], enabledRecipes: enabled, resourceCaps: {}, objective: 'resources' });
        const line = lineOf(r, 1);
        out.push({
          generator: g.id,
          fuel: f.item,
          mw: g.power,
          raw: line.raw,
          rawTotal: line.rawTotal,
          chainPower: line.power,
          missing: line.missing,
        });
      } catch (e) {
        if (!(e instanceof SolverError)) throw e;
      }
    }
  }
  return out;
}

export function buildInsights(highs: Highs): Insights {
  const items: Record<string, ItemInsight> = {};
  for (const it of [...craftableItems].sort((a, b) => a.id.localeCompare(b.id))) {
    const insight = itemInsight(highs, it.id);
    if (insight) items[it.id] = insight;
  }
  return { items, fuels: fuelInsights(highs) };
}

/** How an alternate compares with the standard recipe for the same part: raw resources, power and buildings, as shares. */
export function versusStandard(insight: ItemInsight | undefined, recipe: string) {
  if (!insight) return undefined;
  const base = insight.compare.find((c) => c.recipe === insight.recipe);
  const alt = insight.compare.find((c) => c.recipe === recipe);
  if (!base || !alt || alt === base || base.missing.length > 0 || recipeById.get(insight.recipe)?.kind !== 'standard') return undefined;
  const share = (a: number, b: number) => (b > 0 ? a / b - 1 : 0);
  return {
    raw: share(alt.rawTotal, base.rawTotal),
    power: share(alt.power, base.power),
    buildings: share(alt.buildings, base.buildings),
    /** Needs something no standard recipe makes: another alternate, or items brought in. */
    needsMore: alt.missing.length > 0,
  };
}
