import { data, type Recipe, type Stack } from './data';

/**
 * The multipliers a save can be started with in the game's advanced settings: what recipes take, how much power
 * machines draw, and what the Space Elevator asks for. 1 is the game as shipped.
 */
export interface GameRules {
  parts: number;
  power: number;
  elevator: number;
}

export const DEFAULT_GAME: GameRules = { parts: 1, power: 1, elevator: 1 };
export const GAME_RANGE = { min: 0.01, max: 100 };

export const isDefaultGame = (g: GameRules | undefined) => !g || (g.parts === 1 && g.power === 1 && g.elevator === 1);

/** Items in a canister or a tank: what a Packager makes from a fluid. */
export const PACKAGED = new Set(
  data.recipes
    .filter(
      (r) => r.machine === 'Build_Packager_C' && r.inputs.some((i) => i.item === 'Desc_FluidCanister_C' || i.item === 'Desc_GasTank_C'),
    )
    .flatMap((r) => r.outputs.map((o) => o.item))
    .filter((id) => data.items[id]?.form === 'solid'),
);

/** Recipes as the game data ships them, kept so the multipliers always start from the real numbers. */
const BASE = new Map(data.recipes.map((r) => [r.id, { inputs: r.inputs.map((s) => ({ ...s })), power: r.power, range: r.powerRange }]));
const BASE_EXTRACTOR = new Map(data.extractors.map((e) => [e.id, e.power]));

/** Half and up goes up: 0.75 → 1, 1.25 → 1, 6.25 → 6, 2.5 → 3. Never below one item. */
const roundItems = (n: number) => Math.max(1, Math.floor(n + 0.5 + 1e-9));

/**
 * A recipe's inputs under a part cost multiplier, following how the game does it: each solid input is multiplied
 * per craft and rounded to whole items, fluids are multiplied as they are, and recipes that take or make packaged
 * fluids aren't changed at all (Diluted Packaged Fuel included). Outputs stay the same.
 */
export function scaledInputs(recipe: Pick<Recipe, 'duration' | 'inputs' | 'outputs'>, base: Stack[], parts: number): Stack[] {
  if (parts === 1) return base.map((s) => ({ ...s }));
  if ([...base, ...recipe.outputs].some((s) => PACKAGED.has(s.item))) return base.map((s) => ({ ...s }));
  const perCraft = 60 / recipe.duration;
  return base.map((s) => {
    if (data.items[s.item]?.form !== 'solid') return { item: s.item, rate: s.rate * parts };
    return { item: s.item, rate: roundItems((s.rate / perCraft) * parts) * perCraft };
  });
}

let applied = '1|1';

/**
 * Puts the multipliers into the game data the whole app reads (the solver, the floor, the Codex lines), from the
 * shipped numbers every time. The solver's worker calls it too, with what each request carries.
 */
export function applyGame(g: GameRules = DEFAULT_GAME) {
  const key = `${g.parts}|${g.power}`;
  if (key === applied) return;
  applied = key;
  for (const r of data.recipes) {
    const base = BASE.get(r.id);
    if (!base) continue;
    r.inputs = scaledInputs(r, base.inputs, g.parts);
    r.power = base.power * g.power;
    if (base.range) r.powerRange = [base.range[0] * g.power, base.range[1] * g.power];
  }
  for (const e of data.extractors) e.power = (BASE_EXTRACTOR.get(e.id) ?? e.power) * g.power;
}

/** What one Space Elevator phase asks for under the elevator multiplier, in whole parts. */
export const elevatorAmount = (amount: number, g: GameRules | undefined) =>
  !g || g.elevator === 1 ? amount : Math.max(1, Math.round(amount * g.elevator));
