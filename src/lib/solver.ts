import type { Highs } from 'highs';
import { data, producersOf, resourceWeights, type Recipe } from './data';

export interface Target {
  item: string;
  rate: number;
}

/**
 * Clock speed (1 = 100%, up to 2.5 with 3 power shards) and somersloops per machine.
 * sloops may be fractional: it's the average over the recipe's machines, so 3 sloops across
 * 4 one-slot constructors is 0.75. Output is linear in sloops, so the average is exact for flows.
 */
export interface RecipeMod {
  clock: number;
  sloops: number;
}

export const NO_MOD: RecipeMod = { clock: 1, sloops: 0 };

export interface SolveInput {
  targets: Target[];
  /** Items you already have on hand, per minute (e.g. a train delivering plates). */
  supplies: Target[];
  enabledRecipes: Set<string>;
  /** Per raw resource cap, per minute. Missing = world limit. */
  resourceCaps: Record<string, number>;
  objective: 'resources' | 'power';
  mods?: Record<string, RecipeMod>;
  /**
   * Raw resources the player pinned to an exact amount. When set, targets keep their ratio but
   * scale up or down to whatever those inputs can feed.
   */
  fixed?: Record<string, number>;
}

export interface RecipeUse {
  recipe: Recipe;
  mod: RecipeMod;
  /** Machines needed at the configured clock (fractional). */
  count: number;
  /** Machines you actually place. */
  built: number;
  /** Average clock across the placed machines. */
  clock: number;
  /** Clock of each placed machine; overclocked lines mix 100% machines with shard-boosted ones. */
  clocks: number[];
  power: number;
  shards: number;
  sloops: number;
  /** Total per-minute flows across all placed machines. */
  inputs: Target[];
  outputs: Target[];
}

export interface SolveResult {
  recipes: RecipeUse[];
  raw: Target[];
  supplies: Target[];
  targets: Target[];
  surplus: Target[];
  /** Items no enabled recipe or supply can make. You need to bring these in. */
  missing: Target[];
  power: number;
  shards: number;
  sloops: number;
  /** How much the targets were scaled to match pinned inputs (1 when nothing is pinned). */
  scale: number;
  /** Marginal cost of one more unit/min of each item, in weighted raw resources. */
  prices: Map<string, number>;
}

const EPS = 1e-6;
const MISSING_PENALTY = 1e5;
const MAX_SCALE = 1e4;

/** Power shards a machine needs for a given clock: each one adds 50% above 100%. */
export const shardsFor = (clock: number) => (clock > 1 + 1e-9 ? Math.ceil((clock - 1) / 0.5 - 1e-9) : 0);

/** Output multiplier from somersloops: filled slots / total slots on top of 100%. */
export function amplification(recipe: Recipe, mod: RecipeMod): number {
  const slots = data.machines[recipe.machine].somersloopSlots;
  return slots > 0 ? 1 + Math.min(mod.sloops, slots) / slots : 1;
}

/** Power of one machine: base × amplification² × clock^exponent. */
export function machinePower(recipe: Recipe, mod: RecipeMod, clock = mod.clock): number {
  const machine = data.machines[recipe.machine];
  return recipe.power * amplification(recipe, mod) ** 2 * clock ** machine.powerExp;
}

/** Power of the placed machines when the sloops go into as few machines as possible (full ones first). */
function placedPower(recipe: Recipe, clocks: number[], sloopsTotal: number): number {
  const slots = data.machines[recipe.machine].somersloopSlots;
  let left = sloopsTotal;
  let power = 0;
  for (const clock of clocks) {
    const s = slots > 0 ? Math.min(slots, left) : 0;
    left -= s;
    power += machinePower(recipe, { clock, sloops: s }, clock);
  }
  return power;
}

/**
 * Clocks for the placed machines. Underclocked lines run evenly. Overclocked lines keep every
 * machine at 100% and push only as many as needed past it, 50% per shard, so they use the fewest
 * shards: 5 machines' worth on 4 machines is two at 150% and two at 100%, i.e. 2 shards, not 4.
 */
function machineClocks(built: number, units: number): number[] {
  if (units <= built + EPS) return Array(built).fill(units / built);
  let extra = units - built;
  return Array.from({ length: built }, () => {
    const add = Math.min(1.5, extra);
    extra -= add;
    return 1 + add;
  });
}

export function describeUse(recipe: Recipe, mod: RecipeMod, count: number): RecipeUse {
  const built = Math.max(1, Math.ceil(count - EPS));
  const clock = (mod.clock * count) / built;
  const amp = amplification(recipe, mod);
  const slots = data.machines[recipe.machine].somersloopSlots;
  const sloops = Math.round(built * Math.min(mod.sloops, slots));
  const clocks = machineClocks(built, mod.clock * count);
  const shards = clocks.reduce((s, c) => s + shardsFor(c), 0);
  return {
    inputs: recipe.inputs.map((s) => ({ item: s.item, rate: s.rate * mod.clock * count })),
    outputs: recipe.outputs.map((s) => ({ item: s.item, rate: s.rate * mod.clock * amp * count })),
    recipe,
    mod,
    count,
    built,
    clock,
    clocks,
    power: placedPower(recipe, clocks, sloops),
    shards,
    sloops,
  };
}

interface Model {
  recipes: Recipe[];
  rv: Map<string, string>;
  sv: Map<string, string>;
  rowItem: string[];
  lp: (phase: 'max-scale' | { scale: number }) => string;
  demand: Map<string, number>;
  given: Map<string, number>;
  modOf: (r: Recipe) => RecipeMod;
}

function buildModel(input: SolveInput): Model {
  const recipes = data.recipes.filter((r) => input.enabledRecipes.has(r.id));
  const rv = new Map(recipes.map((r, i) => [r.id, `r${i}`]));
  const modOf = (r: Recipe) => input.mods?.[r.id] ?? NO_MOD;
  // LP variable = machines at the configured clock, so rates scale by clock and somersloop output boost.
  const netRate = (r: Recipe, id: string) => {
    const mod = modOf(r);
    const amp = amplification(r, mod);
    let net = 0;
    for (const o of r.outputs) if (o.item === id) net += o.rate * mod.clock * amp;
    for (const i of r.inputs) if (i.item === id) net -= i.rate * mod.clock;
    return net;
  };
  const scaling = Object.keys(input.fixed ?? {}).length > 0;

  const demand = new Map<string, number>();
  for (const t of input.targets) demand.set(t.item, (demand.get(t.item) ?? 0) + t.rate);
  const given = new Map<string, number>();
  for (const s of input.supplies) given.set(s.item, (given.get(s.item) ?? 0) + s.rate);

  // Every item touched by an enabled recipe or a target gets a balance row.
  const itemIds = new Set<string>(demand.keys());
  for (const r of recipes) for (const s of [...r.inputs, ...r.outputs]) itemIds.add(s.item);
  for (const id of Object.keys(input.fixed ?? {})) itemIds.add(id);

  const enabledProducers = (id: string) => producersOf.get(id)?.some((r) => input.enabledRecipes.has(r.id));
  const sv = new Map<string, string>();
  const costs: string[] = [];
  const bounds: string[] = [];
  let si = 0;
  for (const id of itemIds) {
    const item = data.items[id];
    if (item?.raw) {
      const name = `s${si++}`;
      sv.set(id, name);
      const w = input.objective === 'power' ? 1e-3 * (resourceWeights[id] ?? 1) : (resourceWeights[id] ?? 1);
      costs.push(`${fmt(Math.max(w, 1e-5))} ${name}`);
      const cap = input.fixed?.[id] ?? input.resourceCaps[id] ?? data.worldLimits[id];
      bounds.push(cap == null ? `${name} >= 0` : `0 <= ${name} <= ${fmt(cap)}`);
    } else if (!enabledProducers(id)) {
      const name = `m${si++}`;
      sv.set(id, name);
      costs.push(`${MISSING_PENALTY} ${name}`);
      // When scaling to pinned inputs, conjuring missing items would make the scale unbounded.
      bounds.push(scaling ? `0 <= ${name} <= 0` : `${name} >= 0`);
    }
  }

  for (const r of recipes) {
    // Tie-breaker keeps the plan from building machines it doesn't need.
    const p = machinePower(r, modOf(r));
    const cost = input.objective === 'power' ? p : 1e-4 * p + 1e-4;
    costs.push(`${fmt(cost)} ${rv.get(r.id)}`);
  }

  const rowItem: string[] = [];
  const rowTerms: { terms: string[]; id: string }[] = [];
  for (const id of itemIds) {
    const terms: string[] = [];
    for (const r of recipes) {
      const net = netRate(r, id);
      if (Math.abs(net) > EPS) terms.push(`${net >= 0 ? '+' : '-'} ${fmt(Math.abs(net))} ${rv.get(r.id)}`);
    }
    const s = sv.get(id);
    if (s) terms.push(`+ ${s}`);
    if (terms.length === 0) continue;
    rowTerms.push({ terms, id });
    rowItem.push(id);
  }

  const lp = (phase: 'max-scale' | { scale: number }) => {
    const rows = rowTerms.map(({ terms, id }, i) => {
      const d = demand.get(id) ?? 0;
      const g = given.get(id) ?? 0;
      // Scaling: net >= k·demand - given, with k a variable in the first phase.
      if (phase === 'max-scale' && d > 0) return ` b${i}: ${terms.join(' ')} - ${fmt(d)} k >= ${fmt(-g)}`;
      const k = phase === 'max-scale' ? 1 : phase.scale;
      return ` b${i}: ${terms.join(' ')} >= ${fmt(d * k - g)}`;
    });
    const objective = phase === 'max-scale' ? ['Maximize', ' obj: k'] : ['Minimize', ` obj: ${costs.join(' + ') || '0'}`];
    const extra = phase === 'max-scale' ? [` 0 <= k <= ${MAX_SCALE}`] : [];
    return [...objective, 'Subject To', ...rows, 'Bounds', ...bounds.map((b) => ` ${b}`), ...extra, 'End'].join('\n');
  };

  return { recipes, rv, sv, rowItem, lp, demand, given, modOf };
}

export function solve(solver: Highs, input: SolveInput): SolveResult {
  const model = buildModel(input);
  const { recipes, rv, sv, rowItem, demand, given, modOf } = model;

  let scale = 1;
  if (Object.keys(input.fixed ?? {}).length > 0) {
    const first = solver.solve(model.lp('max-scale'), { output_flag: false });
    if (first.Status !== 'Optimal') throw new Error(`Çözücü durdu: ${first.Status}`);
    scale = Math.max(0, first.Columns.k?.Primal ?? 0);
    if (scale < 1e-9) {
      throw new Error('Sabitlediğin girdilerle bu hedefler hiç üretilemiyor. Eksik bir tarif ya da ham madde var; sabitlemeyi kaldır ya da tarif aç.');
    }
    // Shave a hair off so the second phase stays feasible under float noise.
    scale *= 1 - 1e-9;
  }

  const res = solver.solve(model.lp({ scale }), { output_flag: false });
  if (res.Status !== 'Optimal') {
    throw new Error(
      res.Status === 'Infeasible'
        ? 'Bu hedef, kaynak limitlerinle üretilemiyor. Limitleri artır ya da hedefi düşür.'
        : `Çözücü durdu: ${res.Status}`,
    );
  }
  const val = (name: string) => Math.max(0, res.Columns[name]?.Primal ?? 0);

  const prices = new Map<string, number>();
  res.Rows.forEach((row, i) => {
    const dual = 'Dual' in row ? Math.abs(row.Dual as number) : 0;
    if (rowItem[i]) prices.set(rowItem[i], dual);
  });

  const used: RecipeUse[] = [];
  for (const r of recipes) {
    const count = val(rv.get(r.id)!);
    if (count > EPS) used.push(describeUse(r, modOf(r), count));
  }

  const net = new Map<string, number>();
  const add = (id: string, x: number) => net.set(id, (net.get(id) ?? 0) + x);
  for (const u of used) {
    for (const o of u.outputs) add(o.item, o.rate);
    for (const i of u.inputs) add(i.item, -i.rate);
  }

  const raw: Target[] = [];
  const missing: Target[] = [];
  for (const [id, name] of sv) {
    const x = val(name);
    if (x <= EPS) continue;
    (name.startsWith('s') ? raw : missing).push({ item: id, rate: x });
    add(id, x);
  }
  const usedSupplies: Target[] = [];
  for (const [id, rate] of given) {
    add(id, rate);
    usedSupplies.push({ item: id, rate });
  }

  const targets = [...demand].map(([item, rate]) => ({ item, rate: rate * scale }));
  const surplus: Target[] = [];
  for (const [id, x] of net) {
    const extra = x - (demand.get(id) ?? 0) * scale;
    if (extra > 1e-4) surplus.push({ item: id, rate: extra });
  }

  used.sort((a, b) => depthOf(a.recipe) - depthOf(b.recipe));
  raw.sort((a, b) => b.rate - a.rate);

  return {
    recipes: used,
    raw,
    supplies: usedSupplies,
    targets,
    surplus,
    missing,
    power: used.reduce((s, u) => s + u.power, 0),
    shards: used.reduce((s, u) => s + u.shards, 0),
    sloops: used.reduce((s, u) => s + u.sloops, 0),
    scale,
    prices,
  };
}

/**
 * Places a limited stock of somersloops and power shards where they help most.
 *
 * Somersloops go first, to the machines whose inputs are the most expensive in raw resources per
 * slot (the solver's shadow prices), since doubling their output saves the most upstream work.
 * Shards then overclock the recipes with the most machines, to cut building count. Each step
 * re-solves and only sticks if the total stays within stock.
 */
export function autoAssign(solver: Highs, input: SolveInput, stock: { sloops: number; shards: number }): Record<string, RecipeMod> {
  const mods: Record<string, RecipeMod> = {};
  const run = () => solve(solver, { ...input, mods });
  let result = run();

  const inputValue = (u: RecipeUse, r: SolveResult) =>
    u.recipe.inputs.reduce((s, i) => s + i.rate * (r.prices.get(i.item) ?? 0), 0);

  const loopable = result.recipes
    .filter((u) => data.machines[u.recipe.machine].somersloopSlots > 0)
    .map((u) => ({ u, score: inputValue(u, result) / data.machines[u.recipe.machine].somersloopSlots }))
    .sort((a, b) => b.score - a.score);

  for (const { u } of loopable) {
    const slots = data.machines[u.recipe.machine].somersloopSlots;
    for (let n = slots; n >= 1; n--) {
      mods[u.recipe.id] = { clock: 1, sloops: n };
      const trial = run();
      if (trial.sloops <= stock.sloops) {
        result = trial;
        break;
      }
      delete mods[u.recipe.id];
    }
  }

  // Leftover sloops: part of a recipe's machines get them. Converge the average so
  // built × average is a whole number that fits the stock.
  for (const { u } of loopable) {
    const left = stock.sloops - result.sloops;
    if (left <= 0) break;
    if (mods[u.recipe.id]) continue;
    const slots = data.machines[u.recipe.machine].somersloopSlots;
    let built = result.recipes.find((x) => x.recipe.id === u.recipe.id)?.built ?? u.built;
    let best: SolveResult | undefined;
    for (let step = 0; step < 4; step++) {
      const give = Math.min(left, built * slots - 1);
      if (give <= 0) break;
      mods[u.recipe.id] = { clock: 1, sloops: give / built };
      const trial = run();
      const now = trial.recipes.find((x) => x.recipe.id === u.recipe.id);
      if (trial.sloops <= stock.sloops && now) best = trial;
      if (!now || now.built === built) break;
      built = now.built;
    }
    if (best) result = best;
    else delete mods[u.recipe.id];
  }

  // Shards: take machines off the lines with the most of them. Removing machines means the rest
  // must cover `units` of 100%-machine work; each shard adds 50% to one machine (max 3 per machine),
  // so with `left` shards the line can shrink to max(units - left/2, units/2.5) machines.
  const clockable = [...result.recipes].sort((a, b) => b.built - a.built);
  for (const u of clockable) {
    const now = result.recipes.find((x) => x.recipe.id === u.recipe.id);
    if (!now || now.built < 2) continue;
    const left = stock.shards - result.shards;
    if (left <= 0) break;
    const base = mods[u.recipe.id] ?? NO_MOD;
    const units = now.count * base.clock;
    let target = Math.max(Math.ceil(units - left * 0.5 - EPS), Math.ceil(units / 2.5 - EPS), 1);
    for (; target < now.built; target++) {
      mods[u.recipe.id] = { ...base, clock: units / target };
      const trial = run();
      if (trial.shards <= stock.shards && trial.sloops <= stock.sloops) {
        result = trial;
        break;
      }
    }
    if (target >= now.built) {
      if (base === NO_MOD) delete mods[u.recipe.id];
      else mods[u.recipe.id] = base;
    }
  }

  return mods;
}

// Rough production depth so tables read from ore to product.
const depthCache = new Map<string, number>();
function depthOf(r: Recipe, seen = new Set<string>()): number {
  const hit = depthCache.get(r.id);
  if (hit !== undefined) return hit;
  if (seen.has(r.id)) return 0;
  seen.add(r.id);
  let d = 0;
  for (const i of r.inputs) {
    if (data.items[i.item]?.raw) continue;
    const p = producersOf.get(i.item)?.find((x) => x.kind === 'standard') ?? producersOf.get(i.item)?.[0];
    if (p) d = Math.max(d, depthOf(p, seen) + 1);
  }
  depthCache.set(r.id, d);
  return d;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(8).replace(/0+$/, '');
}
