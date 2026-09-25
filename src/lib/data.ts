import raw from '../data/gamedata.json';

export type Form = 'solid' | 'liquid' | 'gas';

export interface Item {
  id: string;
  name: string;
  form: Form;
  sink: number;
  color?: string;
  raw: boolean;
  /** What it gives a generator: MJ per item, or per m³ for fluids. Only on fuels. */
  energy?: number;
}

export interface Stack {
  item: string;
  rate: number;
}

/** 'power' marks the stand-in recipe a power plant becomes for the solver (see lib/power.ts). */
export type RecipeKind = 'standard' | 'alternate' | 'converter' | 'power';

export interface Recipe {
  id: string;
  name: string;
  kind: RecipeKind;
  /** Milestone tier that unlocks it, when it comes from a milestone. */
  tier?: number;
  machine: string;
  duration: number;
  power: number;
  powerRange?: [number, number];
  inputs: Stack[];
  outputs: Stack[];
}

export interface Cost {
  item: string;
  amount: number;
}

export interface Machine {
  id: string;
  name: string;
  power: number;
  powerExp: number;
  variable: boolean;
  somersloopSlots: number;
  /** Milestone tier that unlocks the building. */
  tier: number;
  cost: Cost[];
}

export interface Transport {
  id: string;
  name: string;
  rate: number;
  tier: number;
}

export interface Extractor {
  id: string;
  name: string;
  /** Per minute on a normal node at 100% clock. */
  rate: number;
  power: number;
  powerExp: number;
  /** Resources it can pull; empty means any solid (miners). */
  resources: string[];
  /** Whether node purity applies (water extractors sit on any water). */
  purity: boolean;
  tier: number;
  cost: Cost[];
}

export interface GeneratorFuel {
  item: string;
  /** Spent fuel left behind, per fuel item burnt (nuclear waste). */
  byproduct?: string;
  byproductAmount?: number;
}

export interface Generator {
  id: string;
  name: string;
  /** Fuel burners; geothermal, which runs on a geyser; the augmenter, which boosts the whole grid. */
  kind: 'fuel' | 'geothermal' | 'augmenter';
  /** MW at 100%: a burner's rating, the augmenter's own output. */
  power: number;
  fuels: GeneratorFuel[];
  /** Also needed while running (water), at supplementRatio litres per MJ made. */
  supplement?: string;
  supplementRatio: number;
  /** Geothermal: average output on a normal geyser is constant + factor, times purity for others. */
  swing?: { constant: number; factor: number };
  /** Augmenter: grid-wide boost, and the extra while fed one booster item every duration seconds. */
  boost?: number;
  booster?: { item: string; boost: number; duration: number };
  tier: number;
  cost: Cost[];
}

export interface PowerStorage {
  id: string;
  name: string;
  /** MWh held when full. */
  capacity: number;
  /** Most it charges or discharges at, MW. */
  rate: number;
  tier: number;
  cost: Cost[];
}

interface GameData {
  items: Record<string, Item>;
  recipes: Recipe[];
  machines: Record<string, Machine>;
  worldLimits: Record<string, number | null>;
  belts: Transport[];
  pipes: Transport[];
  extractors: Extractor[];
  generators: Generator[];
  powerStorage: PowerStorage;
}

export const data = raw as GameData;

export const generatorById = new Map(data.generators.map((g) => [g.id, g]));

/** Any building by id, for its name, icon and cost: production machines, generators and extractors. */
export const buildingById = (id: string): { id: string; name: string; tier: number; cost: Cost[] } | undefined =>
  data.machines[id] ??
  generatorById.get(id) ??
  data.extractors.find((e) => e.id === id) ??
  (data.powerStorage.id === id ? data.powerStorage : undefined);

export const recipeById = new Map(data.recipes.map((r) => [r.id, r]));

export const producersOf = new Map<string, Recipe[]>();
for (const r of data.recipes) {
  for (const o of r.outputs) {
    const list = producersOf.get(o.item) ?? [];
    list.push(r);
    producersOf.set(o.item, list);
  }
}

/** Items a player would plan for: anything a recipe produces, excluding raw resources. */
export const craftableItems = Object.values(data.items).filter((i) => !i.raw && producersOf.has(i.id));

export const rawItems = Object.values(data.items).filter((i) => i.raw);

/** Rarity weight per raw resource: scarcer resources cost more in the optimizer. */
export const resourceWeights: Record<string, number> = (() => {
  const iron = data.worldLimits.Desc_OreIron_C ?? 1;
  const w: Record<string, number> = {};
  for (const [id, limit] of Object.entries(data.worldLimits)) w[id] = limit ? iron / limit : 0;
  return w;
})();

/**
 * Cheapest belt or pipe unlocked at the player's tier that carries this rate. When even the best
 * unlocked one is too slow, lanes says how many to run side by side.
 */
export function transportFor(item: Item, rate: number, tier = 99): { transport: Transport; lanes: number } {
  const all = item.form === 'solid' ? data.belts : data.pipes;
  const unlocked = all.filter((t) => t.tier <= tier);
  const options = unlocked.length ? unlocked : all.slice(0, 1);
  const fit = options.find((t) => t.rate >= rate - 1e-6);
  if (fit) return { transport: fit, lanes: 1 };
  const best = options.at(-1)!;
  return { transport: best, lanes: Math.ceil(rate / best.rate - 1e-6) };
}

/** Tier that makes a recipe usable: the later of its own unlock and its building's. */
export const recipeTier = (r: Recipe) => Math.max(r.tier ?? 0, buildingById(r.machine)?.tier ?? 0);

/** Is the recipe usable at this tier: its own unlock and its building's. */
export const recipeUnlocked = (r: Recipe, tier: number) => recipeTier(r) <= tier;

/**
 * Earliest tier at which an item can be made with a standard recipe (alternates need hard drives,
 * so they don't count). Undefined when nothing standard makes it.
 */
export function itemTier(id: string): number | undefined {
  const tiers = (producersOf.get(id) ?? []).filter((r) => r.kind === 'standard').map(recipeTier);
  return tiers.length ? Math.min(...tiers) : undefined;
}

/** Why an item the plan needs has no working recipe, so the UI can offer the matching fix. */
export type MissingReason = { kind: 'tier'; tier: number } | { kind: 'off'; recipe: string } | { kind: 'none' };

export function whyMissing(id: string, tier: number, enabled: Set<string>): MissingReason {
  const producers = producersOf.get(id) ?? [];
  const off = producers.filter((r) => recipeUnlocked(r, tier) && !enabled.has(r.id));
  // Turning one recipe back on is enough; the standard one if it's among them.
  const pick = off.find((r) => r.kind === 'standard') ?? off[0];
  if (pick) return { kind: 'off', recipe: pick.id };
  const needed = itemTier(id);
  if (needed !== undefined && needed > tier) return { kind: 'tier', tier: needed };
  return { kind: 'none' };
}
