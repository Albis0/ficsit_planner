import { useEffect, useMemo, useRef, useState } from 'react';
import { type Grid, type Plan, useStore } from '../store';
import { recipeById, recipeUnlocked } from './data';
import { effectiveExtraction, extractionPowerPerUnit, planExtraction } from './extraction';
import { plantUnlocked } from './power';
import type { SolveInput, SolveResult } from './solver';
import { solveAsync } from './solverClient';
import type { SolveFailure } from './solveFailure';

/** Recipes above the unlocked tier (or needing a building that isn't unlocked) stay ticked but sit out. */
export const usableRecipes = (plan: Pick<Plan, 'enabled'>, tier: number) =>
  new Set(plan.enabled.filter((id) => recipeUnlocked(recipeById.get(id)!, tier)));

type SolvedPart = Pick<Plan, 'targets' | 'supplies' | 'enabled' | 'caps' | 'mods' | 'fixed'>;

/** What the solver gets for a factory tab; nothing when it has no targets yet. */
export function factoryInput(plan: SolvedPart, tier: number): SolveInput | undefined {
  const targets = plan.targets.filter((t) => t.rate > 0);
  if (targets.length === 0) return undefined;
  return {
    targets,
    supplies: plan.supplies,
    enabledRecipes: usableRecipes(plan, tier),
    resourceCaps: plan.caps,
    objective: 'resources',
    mods: plan.mods,
    fixed: plan.fixed,
  };
}

/**
 * What the solver gets for the power grid: its plants, the load, and the plan that makes their fuel.
 * Plants above the unlocked tier sit out, like recipes do.
 */
export function gridInput(grid: Pick<Grid, 'plants' | 'headroom' | 'chain'>, demand: number, tier: number): SolveInput | undefined {
  if (grid.plants.length === 0) return undefined;
  const chain = grid.chain;
  return {
    targets: [],
    supplies: chain.supplies,
    enabledRecipes: usableRecipes(chain, tier),
    resourceCaps: chain.caps,
    objective: 'resources',
    mods: chain.mods,
    power: {
      plants: grid.plants.filter((p) => plantUnlocked(p, tier)),
      demand,
      headroom: grid.headroom,
      extraction: extractionPowerPerUnit(effectiveExtraction(chain.extraction, tier)),
    },
  };
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

// Solved draws, kept per plan object and tier: an unchanged factory isn't solved again, and a late
// answer for one tier can't overwrite another's.
const cache = new WeakMap<Plan, Map<number, Entry>>();

function entryFor(plan: Plan, tier: number): Entry {
  const byTier = cache.get(plan) ?? new Map<number, Entry>();
  cache.set(plan, byTier);
  const hit = byTier.get(tier);
  if (hit) return hit;
  const input = factoryInput(plan, tier);
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
  byTier.set(tier, entry);
  return entry;
}

/**
 * How much power every factory tab needs, solved in the background for the power planner. The list
 * only changes when a draw does, so whatever is drawn from it isn't laid out again on every render.
 */
export function useFactoryDraws(enabled: boolean): FactoryDraw[] {
  const plans = useStore((s) => s.plans);
  const tier = useStore((s) => s.tier);
  const [landed, bump] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    for (const plan of plans) {
      const entry = entryFor(plan, tier);
      if (!entry.draw) entry.wait?.then(() => live && bump((n) => n + 1));
    }
    return () => {
      live = false;
    };
  }, [enabled, plans, tier]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `landed` re-reads the cache once a solve lands.
  return useMemo(
    () =>
      plans.map((plan) => {
        const draw = cache.get(plan)?.get(tier)?.draw;
        return { id: plan.id, name: plan.name, mw: draw?.mw, failed: draw?.failed };
      }),
    [plans, tier, landed],
  );
}

/** The factories' total draw the grid has to cover, plus what the player typed in for everything else. */
export function gridDemand(grid: Pick<Grid, 'exclude' | 'extra'>, factories: FactoryDraw[]): number {
  const skip = new Set(grid.exclude);
  return factories.reduce((s, f) => s + (skip.has(f.id) ? 0 : (f.mw ?? 0)), 0) + Math.max(0, grid.extra);
}
