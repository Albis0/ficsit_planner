import { data, type Generator, generatorById, type Recipe } from './data';
import { PURITY, type Purity } from './extraction';
import type { RecipeUse } from './solver';

/**
 * How a power plant is sized: whatever the grid still needs ('auto', worked out by the solver),
 * a set number of generators, or a set output in MW.
 */
export type PlantSize = 'auto' | 'count' | 'power';

/** One row of generators on the power grid, all the same building burning the same fuel. */
export interface Plant {
  id: string;
  generator: string;
  /** What it burns; fuel generators only. */
  fuel?: string;
  by: PlantSize;
  /** Generators for 'count', MW for 'power'; unused for 'auto'. */
  amount: number;
  /** Clock of each generator, 1 = 100%, up to 2.5 with power shards. */
  clock: number;
  /** Geothermal: the geyser's purity. */
  purity?: Purity;
  /** Augmenter: fed Alien Power Matrix for the bigger boost. */
  fed?: boolean;
}

export const MAX_CLOCK = 2.5;

/** Recipe ids the solver gives power plants, so a result can be traced back to its plant. */
export const PLANT_PREFIX = 'power:';
export const plantIdOf = (recipeId: string) => (recipeId.startsWith(PLANT_PREFIX) ? recipeId.slice(PLANT_PREFIX.length) : undefined);

export const generatorOf = (p: Plant): Generator => generatorById.get(p.generator)!;

/** Burners can be sized to fit the demand; geysers and augmenters come in whatever number the map and somersloops allow. */
export const sizable = (g: Generator) => g.kind === 'fuel';

/** Geysers run at their own pace and augmenters at a fixed output; only burners take a clock. */
export const clockable = (g: Generator) => g.kind === 'fuel';

/** Clock the solver should run a plant's generators at. */
export const plantClock = (p: Plant) => (clockable(generatorOf(p)) ? p.clock : 1);

/**
 * "Fix the count": the generators as the solver worked them out, whole ones each at the clock the total came to. Keeping
 * the plant's own clock instead would burn more than the plan has, e.g. 29 at 100% for 28.8 generators' worth of fuel.
 */
export function fixedAs(use: Pick<RecipeUse, 'built' | 'clock'>): Partial<Plant> {
  return { by: 'count', amount: use.built, clock: Math.min(MAX_CLOCK, Math.max(0.01, use.clock)) };
}

/**
 * "Fill to 100%": whole generators, every one at 100%. Sized to what you have the count rounds down, since the fuel
 * can't stretch; sized any other way it rounds up, so the load is still met. Undefined when not even one runs full.
 */
export function filledTo100(
  use: Pick<RecipeUse, 'count'> & { mod: Pick<RecipeUse['mod'], 'clock'> },
  have: boolean,
): Partial<Plant> | undefined {
  const exact = use.count * use.mod.clock;
  const n = have ? Math.floor(exact + 1e-6) : Math.ceil(exact - 1e-6);
  return n >= 1 ? { by: 'count', amount: n, clock: 1 } : undefined;
}

/** Fixed-size plants always use a count or an output; auto only makes sense for burners. */
export const plantSize = (p: Plant): PlantSize => (sizable(generatorOf(p)) ? p.by : 'count');

/**
 * A geyser's average output: 200 MW on a normal one, half on impure, double on pure. Over each
 * minute it swings between half and one and a half times that.
 */
export function geyserPower(g: Generator, purity: Purity): number {
  const swing = g.swing ?? { constant: g.power, factor: 0 };
  return (swing.constant + swing.factor) * PURITY[purity];
}

/** How far a geyser's output swings either side of its average. */
export const GEYSER_SWING = 0.5;

/** MW one of the plant's generators makes, before any augmenter boost. */
export function unitPower(p: Plant): number {
  const g = generatorOf(p);
  if (g.kind === 'geothermal') return geyserPower(g, p.purity ?? 'normal');
  if (g.kind === 'augmenter') return g.power;
  return g.power * p.clock;
}

/** Share of the grid the augmenters add on top, e.g. 0.3 for one fed augmenter. */
export function gridBoost(plants: Plant[]): number {
  let boost = 0;
  for (const p of plants) {
    const g = generatorOf(p);
    if (g.kind !== 'augmenter') continue;
    boost += Math.max(0, Math.round(p.amount)) * ((g.boost ?? 0) + (p.fed && g.booster ? g.booster.boost : 0));
  }
  return boost;
}

/** Fuel burnt per minute by one generator at 100%. */
export function fuelRate(g: Generator, fuel: string): number {
  const energy = data.items[fuel]?.energy;
  return energy ? (g.power * 60) / energy : 0;
}

/**
 * The plant as a recipe the solver can use: one "machine" is one generator at 100%, taking its fuel
 * and water and leaving its waste. It makes no item; its MW go into the solver's power balance.
 */
export function plantRecipe(p: Plant): Recipe {
  const g = generatorOf(p);
  const inputs: Recipe['inputs'] = [];
  const outputs: Recipe['outputs'] = [];
  const fuel = g.kind === 'fuel' ? g.fuels.find((f) => f.item === p.fuel) : undefined;
  if (fuel) {
    const rate = fuelRate(g, fuel.item);
    inputs.push({ item: fuel.item, rate });
    if (g.supplement) inputs.push({ item: g.supplement, rate: (g.power * 60 * g.supplementRatio) / 1000 });
    if (fuel.byproduct && fuel.byproductAmount) outputs.push({ item: fuel.byproduct, rate: rate * fuel.byproductAmount });
  }
  if (g.kind === 'augmenter' && p.fed && g.booster) inputs.push({ item: g.booster.item, rate: 60 / g.booster.duration });
  return {
    id: PLANT_PREFIX + p.id,
    name: fuel ? data.items[fuel.item].name : g.name,
    kind: 'power',
    machine: g.id,
    duration: 60,
    power: 0,
    inputs,
    outputs,
  };
}

/** A plant the solver can model: a known building, and a fuel it actually burns. */
export function plantValid(p: Plant): boolean {
  const g = generatorById.get(p.generator);
  return !!g && (g.kind !== 'fuel' || g.fuels.some((f) => f.item === p.fuel));
}

/** Is the plant's building (and its fuel's production) available at this tier. */
export const plantUnlocked = (p: Plant, tier: number) => generatorOf(p).tier <= tier;

/** Fuels a burner takes that nothing in the game makes: leaves, wood and mycelia are picked by hand. */
export const handFed = (item: string) => !data.recipes.some((r) => r.outputs.some((o) => o.item === item));

/** Every generator and fuel pairing, for the "add a power plant" picker. */
export const PLANT_OPTIONS: { generator: Generator; fuel?: string }[] = data.generators.flatMap((g) =>
  g.kind === 'fuel' ? g.fuels.map((f) => ({ generator: g, fuel: f.item })) : [{ generator: g }],
);

/** What a power plant is sized to: the fuel you have, a set output, or the factories it powers. */
export type SizeBy = 'have' | 'want' | 'factories';

/** Name a new plant takes from its first generator, so tabs read "Coal plant", "Fuel plant". */
export const PLANT_NAMES: Record<string, string> = {
  Build_GeneratorBiomass_Automated_C: 'Biomass plant',
  Build_GeneratorCoal_C: 'Coal plant',
  Build_GeneratorFuel_C: 'Fuel plant',
  Build_GeneratorNuclear_C: 'Nuclear plant',
  Build_GeneratorGeoThermal_C: 'Geothermal plant',
  Build_AlienPowerBuilding_C: 'Augmenters',
};
