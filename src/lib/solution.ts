import { type GameRules, isDefaultGame } from './game';
import { useEffect, useMemo, useRef, useState } from 'react';
import { aimOf, exportsOf, type Plan, poweredBy, type PowerPlan, useStore } from '../store';
import { data, recipeById, recipeUnlocked } from './data';
import { effectiveExtraction, extractionPowerPerUnit, extractorCost, planExtraction } from './extraction';
import { plantUnlocked } from './power';
import type { ClockSpread } from './settings';
import type { SolveInput, SolveResult, Target } from './solver';
import { solveAsync } from './solverClient';
import type { SolveFailure } from './solveFailure';

/** Recipes above the unlocked tier (or needing a building that isn't unlocked) stay ticked but sit out. */
export const usableRecipes = (plan: Pick<Plan, 'enabled'>, tier: number) =>
  new Set(plan.enabled.filter((id) => recipeUnlocked(recipeById.get(id)!, tier)));

const EMPTIES = new Set(['Desc_FluidCanister_C', 'Desc_GasTank_C']);
/** Unpackaging gives the fluid back from its package, which only ever loops back to the same fluid. */
const unpacks = (r: { outputs: { item: string }[] }) => r.outputs.some((o) => EMPTIES.has(o.item));

/**
 * Raw resources a plan could draw on: everything its goals can be made from with the given recipes,
 * walking back from the goals. A raw resource is mined, so the walk stops there.
 */
export function reachableRaw(goals: Iterable<string>, recipes: Set<string>): Set<string> {
  const raw = new Set<string>();
  const seen = new Set<string>();
  const queue = [...goals];
  while (queue.length) {
    const item = queue.pop()!;
    if (seen.has(item)) continue;
    seen.add(item);
    if (data.items[item]?.raw) {
      raw.add(item);
      continue;
    }
    for (const id of recipes) {
      const r = recipeById.get(id);
      if (r && !unpacks(r) && r.outputs.some((o) => o.item === item)) for (const i of r.inputs) queue.push(i.item);
    }
  }
  return raw;
}

type SolvedPart = Pick<Plan, 'targets' | 'supplies' | 'enabled' | 'caps' | 'mods' | 'fixed' | 'extraction'>;

export type Export = { item: string; rate: number; to: string };

/** A factory's own targets plus what other tabs take from it, one entry per item. */
export function withExports(targets: Target[], exports: Export[] = []): Target[] {
  const total = new Map<string, number>();
  for (const t of [...targets, ...exports]) if (t.rate > 0) total.set(t.item, (total.get(t.item) ?? 0) + t.rate);
  return [...total].map(([item, rate]) => ({ item, rate }));
}

/** What a plan keeps down: rare resources first, all resources the same, or the number of machines. */
export type Aim = 'rarity' | 'equal' | 'buildings';

const aimInput = (aim: Aim) => ({
  objective: aim === 'buildings' ? ('buildings' as const) : ('resources' as const),
  equalWeights: aim === 'equal',
});

/** What the solver gets for a factory tab; nothing when it has nothing to make yet. */
export function factoryInput(
  plan: SolvedPart,
  tier: number,
  exports: Export[] = [],
  aim: Aim = 'rarity',
  game?: GameRules,
  clocks?: ClockSpread,
): SolveInput | undefined {
  const targets = withExports(plan.targets, exports);
  if (targets.length === 0) return undefined;
  return {
    targets,
    supplies: plan.supplies,
    enabledRecipes: usableRecipes(plan, tier),
    resourceCaps: plan.caps,
    mods: plan.mods,
    fixed: plan.fixed,
    ...aimInput(aim),
    // Fewest buildings counts the miners and pumps too.
    ...(aim === 'buildings' ? { extractorCost: extractorCost(effectiveExtraction(plan.extraction, tier)) } : {}),
    ...(isDefaultGame(game) ? {} : { game }),
    ...(clocks ? { clocks } : {}),
  };
}

const WATER = 'Desc_Water_C';
const RAW = Object.values(data.items).filter((i) => i.raw && i.id !== WATER);

type PowerPart = Pick<PowerPlan, 'plants' | 'sizeBy' | 'have' | 'headroom' | 'ownLoad' | 'chain'>;

/**
 * What the solver gets for a power plant: its generators, the MW it has to carry, and the plan that
 * makes their fuel. Plants above the unlocked tier sit out, like recipes do.
 *
 * Sized to what you have, the listed items are all there is: every other resource but water is
 * off, and the plant makes as much as those allow.
 */
export function powerInput(
  pp: PowerPart,
  demand: number,
  tier: number,
  aim: Aim = 'rarity',
  game?: GameRules,
  clocks?: ClockSpread,
): SolveInput | undefined {
  if (pp.plants.length === 0) return undefined;
  const chain = pp.chain;
  const have = pp.sizeBy === 'have';
  let caps = chain.caps;
  let supplies = chain.supplies;
  if (have) {
    caps = Object.fromEntries(RAW.map((i) => [i.id, 0]));
    supplies = [];
    for (const h of pp.have) {
      if (data.items[h.item]?.raw) caps[h.item] = h.rate;
      else supplies.push(h);
    }
  }
  return {
    targets: [],
    supplies,
    enabledRecipes: usableRecipes(chain, tier),
    resourceCaps: caps,
    mods: chain.mods,
    ...aimInput(aim),
    ...(isDefaultGame(game) ? {} : { game }),
    ...(clocks ? { clocks } : {}),
    power: {
      plants: pp.plants.filter((p) => plantUnlocked(p, tier)),
      demand: have ? 0 : demand,
      headroom: pp.sizeBy === 'factories' ? pp.headroom : 0,
      extraction: extractionPowerPerUnit(effectiveExtraction(chain.extraction, tier)),
      ownLoad: pp.ownLoad,
      maximize: have,
    },
  };
}

/**
 * What other tabs take from this factory. Kept as the same array while nothing about it changes, so
 * editing an unrelated tab doesn't solve this one again.
 */
export function useExports(id: string): Export[] {
  const key = useStore((s) => JSON.stringify(exportsOf(s.plans, id)));
  return useMemo(() => JSON.parse(key) as Export[], [key]);
}

/**
 * Solves in the worker whenever the input changes, a moment after typing stops. While inactive it
 * keeps its last answer and waits; coming back to the same input doesn't solve it again.
 */
export function useSolve(input: SolveInput | undefined, active = true) {
  const [state, setState] = useState<{ result?: SolveResult; error?: SolveFailure; busy: boolean }>({ busy: false });
  const solved = useRef<SolveInput | undefined>(undefined);
  useEffect(() => {
    if (!active || (input && input === solved.current)) return;
    if (!input) {
      solved.current = undefined;
      setState({ busy: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, busy: true }));
    // Debounce so typing "120" doesn't solve for 1 and 12 first.
    const timer = setTimeout(async () => {
      try {
        const result = await solveAsync(input);
        if (!cancelled) setState({ result, busy: false });
      } catch (e) {
        if (!cancelled) setState({ error: e as SolveFailure, busy: false });
      }
      if (!cancelled) solved.current = input;
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setState((s) => (s.busy ? { ...s, busy: false } : s));
    };
  }, [input, active]);
  return state;
}

/** One factory's pull on the grid: its machines plus the miners and pumps feeding them. */
export interface FactoryDraw {
  id: string;
  name: string;
  /** MW; undefined while solving or when the factory has nothing planned. */
  mw?: number;
  failed?: boolean;
}

interface Draw {
  mw?: number;
  failed?: boolean;
}

interface Entry {
  draw?: Draw;
  /** Settles (never rejects) once `draw` is filled in. */
  wait?: Promise<void>;
}

const drawKey = (tier: number, exports: Export[], aim: Aim, game: GameRules, clocks: ClockSpread) =>
  `${tier}|${aim}|${game.parts}|${game.power}|${clocks}|${JSON.stringify(exports)}`;

// Solved draws, kept per plan object and tier: an unchanged factory isn't solved again, and a late
// answer for one tier can't overwrite another's.
const cache = new WeakMap<Plan, Map<string, Entry>>();

function entryFor(plan: Plan, tier: number, exports: Export[], aim: Aim, game: GameRules, clocks: ClockSpread): Entry {
  const byTier = cache.get(plan) ?? new Map<string, Entry>();
  cache.set(plan, byTier);
  const key = drawKey(tier, exports, aim, game, clocks);
  const hit = byTier.get(key);
  if (hit) return hit;
  const input = factoryInput(plan, tier, exports, aim, game, clocks);
  const entry: Entry = input ? {} : { draw: { mw: 0 } };
  if (input) {
    entry.wait = solveAsync(input).then(
      (r) => {
        const extraction = planExtraction(r.raw, effectiveExtraction(plan.extraction, tier));
        entry.draw = { mw: r.power + extraction.reduce((s, u) => s + u.power, 0) };
      },
      () => {
        entry.draw = { failed: true };
      },
    );
  }
  byTier.set(key, entry);
  return entry;
}

/**
 * How much power every factory tab needs, solved in the background for the power planner. The list
 * only changes when a draw does, so whatever is drawn from it isn't laid out again on every render.
 */
export function useFactoryDraws(enabled: boolean): FactoryDraw[] {
  const plans = useStore((s) => s.plans);
  const tier = useStore((s) => s.tier);
  const aim = useStore(aimOf);
  const game = useStore((s) => s.settings.game);
  const clocks = useStore((s) => s.settings.clockSpread);
  const [landed, bump] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    for (const plan of plans) {
      const entry = entryFor(plan, tier, exportsOf(plans, plan.id), aim, game, clocks);
      if (!entry.draw) entry.wait?.then(() => live && bump((n) => n + 1));
    }
    return () => {
      live = false;
    };
  }, [enabled, plans, tier, aim, game, clocks]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `landed` re-reads the cache once a solve lands.
  return useMemo(
    () =>
      plans.map((plan) => {
        const draw = cache.get(plan)?.get(drawKey(tier, exportsOf(plans, plan.id), aim, game, clocks))?.draw;
        return { id: plan.id, name: plan.name, mw: draw?.mw, failed: draw?.failed };
      }),
    [plans, tier, aim, game, clocks, landed],
  );
}

/** What a power plant has to carry besides its own fuel chain. */
export interface PowerLoad {
  /** MW the solver sizes auto generators to: the target, or the factories and other consumers. */
  demand: number;
  /** Factories ticked on this plant, with what each one draws. */
  fed: FactoryDraw[];
  /** Their total. */
  factories: number;
}

export function powerLoad(pp: Pick<PowerPlan, 'sizeBy' | 'want' | 'factories' | 'extra'>, draws: FactoryDraw[]): PowerLoad {
  if (pp.sizeBy !== 'factories') return { demand: pp.sizeBy === 'want' ? Math.max(0, pp.want) : 0, fed: [], factories: 0 };
  const on = poweredBy(pp, draws);
  const fed = draws.filter((f) => on.has(f.id));
  const factories = fed.reduce((s, f) => s + (f.mw ?? 0), 0);
  return { demand: factories + Math.max(0, pp.extra), fed, factories };
}
