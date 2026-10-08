import { useEffect, useMemo, useRef, useState } from 'react';
import { aimOf, type PowerPlan, useStore } from '../store';
import { type PoolLine, plantTakesFromPool, poolLines, poolSources, takesFromPool } from './pool';
import { effectiveExtraction, type ExtractionUse, planExtraction } from './extraction';
import type { GameRules } from './game';
import { type FactoryDraw, type FactoryEntry, powerInput, powerLoad, useFactoryEntries } from './solution';
import type { SolveResult, Target } from './solver';
import { solveAsync } from './solverClient';

/** One factory tab on the "All" page. */
export interface FactoryRow {
  id: string;
  name: string;
  manual: boolean;
  /** Nothing planned on it yet. */
  empty: boolean;
  /** Still being worked out. */
  pending: boolean;
  failed: boolean;
  makes: Target[];
  /** What it mines and pumps. */
  raw: Target[];
  /** What it brings in: items on hand and the ones taken from another tab. */
  brings: Target[];
  surplus: Target[];
  /** What it makes beyond what it needs: its surplus less what was handed to it and left unused. This is what goes to the pool. */
  leaves: Target[];
  /** MW it draws, miners and pumps included. */
  mw: number;
  machines: number;
  extractors: number;
}

/** One power plant tab on the "All" page. */
export interface PlantRow {
  id: string;
  name: string;
  /** The first generator's building, for the icon. */
  icon?: string;
  empty: boolean;
  pending: boolean;
  failed: boolean;
  /** MW it puts on the grid. */
  made: number;
  /** MW its own fuel chain draws. */
  own: number;
  surplus: Target[];
  /** What it makes beyond what it was given; this is what goes to the pool. */
  leaves: Target[];
}

export interface Overview {
  factories: FactoryRow[];
  plants: PlantRow[];
  totals: Totals;
  /** What every factory and plant leaves over, less what's taken from it. */
  pool: PoolLine[];
  pending: boolean;
}

export interface Totals {
  /** MW every factory draws. */
  used: number;
  /** MW every plant puts on the grid, and what their own fuel chains draw out of it. */
  made: number;
  own: number;
  /** What's left once the factories and the plants' own chains are served; negative when the grid falls short. */
  spare: number;
  machines: number;
  extractors: number;
}

/** Adds lists of items up per item, the largest first. */
export function sumItems(lists: Target[][]): Target[] {
  const total = new Map<string, number>();
  for (const list of lists) for (const x of list) if (x.rate > 1e-9) total.set(x.item, (total.get(x.item) ?? 0) + x.rate);
  return [...total].map(([item, rate]) => ({ item, rate })).sort((a, b) => b.rate - a.rate);
}

const sumOf = (list: { built: number }[]) => list.reduce((s, u) => s + u.built, 0);

/** A surplus less what was handed over and just sits there: only what was made is left. */
export function madeBeyond(surplus: Target[], given: Target[]): Target[] {
  const have = new Map<string, number>();
  for (const g of given) have.set(g.item, (have.get(g.item) ?? 0) + g.rate);
  return surplus.map((x) => ({ item: x.item, rate: x.rate - (have.get(x.item) ?? 0) })).filter((x) => x.rate > 1e-4);
}

export function factoryRow(e: FactoryEntry, planned: boolean): FactoryRow {
  const r = e.result;
  return {
    id: e.id,
    name: e.name,
    manual: e.manual,
    empty: !planned,
    pending: !planned ? false : e.mw === undefined && !e.failed,
    failed: !!e.failed,
    makes: r?.targets ?? [],
    raw: r?.raw ?? [],
    brings: sumItems([r?.supplies ?? [], r?.missing ?? []]),
    surplus: r?.surplus ?? [],
    leaves: r ? madeBeyond(r.surplus, r.supplies) : [],
    mw: e.mw ?? 0,
    machines: r ? sumOf(r.recipes) : 0,
    extractors: sumOf(e.extraction ?? []),
  };
}

/** The totals above the rows: power served and short, and how many buildings. */
export function totalsOf(factories: FactoryRow[], plants: PlantRow[]): Totals {
  const used = factories.reduce((s, f) => s + f.mw, 0);
  const made = plants.reduce((s, p) => s + p.made, 0);
  const own = plants.reduce((s, p) => s + p.own, 0);
  return {
    used,
    made,
    own,
    spare: made - own - used,
    machines: factories.reduce((s, f) => s + f.machines, 0),
    extractors: factories.reduce((s, f) => s + f.extractors, 0),
  };
}

interface PlantEntry {
  result?: SolveResult;
  extraction?: ExtractionUse[];
  failed?: boolean;
  pending: boolean;
}

// Plants solved for the page, by what went into them: an unchanged plant isn't solved again.
const plantCache = new Map<string, PlantEntry>();

function plantEntry(pp: PowerPlan, demand: number, tier: number, aim: ReturnType<typeof aimOf>, game: GameRules, land: () => void) {
  const key = JSON.stringify([pp, demand, tier, aim, game]);
  const hit = plantCache.get(key);
  if (hit) return hit;
  const input = pp.sizeBy === 'have' && pp.have.length === 0 ? undefined : powerInput(pp, demand, tier, aim, game);
  const entry: PlantEntry = { pending: !!input };
  plantCache.set(key, entry);
  if (plantCache.size > 60) plantCache.delete(plantCache.keys().next().value as string);
  if (input)
    solveAsync(input).then(
      (r) => {
        entry.result = r;
        entry.extraction = planExtraction(r.raw, effectiveExtraction(pp.chain.extraction, tier));
        entry.pending = false;
        land();
      },
      () => {
        entry.failed = true;
        entry.pending = false;
        land();
      },
    );
  return entry;
}

/** Every power plant worked out in the background, each with the load the factories put on it. */
function usePlantRows(draws: FactoryDraw[], enabled = true): PlantRow[] {
  const plants = useStore((s) => s.power);
  const tier = useStore((s) => s.tier);
  const aim = useStore(aimOf);
  const game = useStore((s) => s.settings.game);
  const [landed, bump] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `landed` re-reads the cache once a solve lands.
  return useMemo(
    () =>
      (enabled ? plants : []).map((pp): PlantRow => {
        const load = powerLoad(pp, draws);
        const e = plantEntry(pp, load.demand, tier, aim, game, () => alive.current && bump((n) => n + 1));
        const r = e.result;
        const own = pp.ownLoad && r ? r.power + (e.extraction ?? []).reduce((s, u) => s + u.power, 0) : 0;
        return {
          id: pp.id,
          name: pp.name,
          icon: pp.plants[0]?.generator,
          empty: pp.plants.length === 0,
          pending: e.pending,
          failed: !!e.failed,
          made: r?.grid?.generation ?? 0,
          own,
          surplus: r?.surplus ?? [],
          leaves: r ? madeBeyond(r.surplus, r.supplies) : [],
        };
      }),
    [enabled, plants, draws, tier, aim, game, landed],
  );
}

/** Every factory and power plant worked out in the background, for the "All" page. */
export function useOverview(): Overview {
  const plans = useStore((s) => s.plans);
  const power = useStore((s) => s.power);
  const entries = useFactoryEntries(true);
  const draws: FactoryDraw[] = useMemo(() => entries.map(({ id, name, mw, failed }) => ({ id, name, mw, failed })), [entries]);
  const rows = usePlantRows(draws);
  return useMemo(() => {
    const factories = entries.map((e) => {
      const plan = plans.find((p) => p.id === e.id);
      const planned = !!plan && (plan.floor === 'manual' ? !!plan.model?.nodes.length : plan.targets.length > 0);
      return factoryRow(e, planned || (e.result?.recipes.length ?? 0) > 0);
    });
    return {
      factories,
      plants: rows,
      totals: totalsOf(factories, rows),
      pool: poolLines(
        [...factories.map((f) => f.leaves), ...rows.map((p) => p.leaves)],
        [...takesFromPool(plans), ...plantTakesFromPool(power)],
      ),
      pending: factories.some((f) => f.pending) || rows.some((p) => p.pending),
    };
  }, [entries, plans, power, rows]);
}

/** Who leaves each item over for the pool, by name: every other factory and plant, for naming the source on a "from the pool" card. */
export function usePoolSources(forPlan: string | undefined, on: boolean): Map<string, string[]> {
  const entries = useFactoryEntries(on);
  const draws: FactoryDraw[] = useMemo(() => entries.map(({ id, name, mw, failed }) => ({ id, name, mw, failed })), [entries]);
  const rows = usePlantRows(draws, on);
  return useMemo(() => {
    const made = [
      ...entries
        .filter((e) => e.id !== forPlan)
        .map((e) => ({ name: e.name, leaves: e.result ? madeBeyond(e.result.surplus, e.result.supplies) : [] })),
      ...rows.map((p) => ({ name: p.name, leaves: p.leaves })),
    ];
    return poolSources(made);
  }, [entries, rows, forPlan]);
}

/**
 * What a factory or a plant could take from the pool: what every other factory and plant leaves over, less what the
 * others already take. Worked out only when asked (`on`), since it solves every tab.
 */
export function usePool(forPlan: string | undefined, on: boolean, forPlant?: string): PoolLine[] {
  const plans = useStore((s) => s.plans);
  const power = useStore((s) => s.power);
  const entries = useFactoryEntries(on);
  const draws: FactoryDraw[] = useMemo(() => entries.map(({ id, name, mw, failed }) => ({ id, name, mw, failed })), [entries]);
  const rows = usePlantRows(draws, on);
  return useMemo(() => {
    if (!on) return [];
    const others = entries.filter((e) => e.id !== forPlan);
    return poolLines(
      [
        ...others.map((e) => (e.result ? madeBeyond(e.result.surplus, e.result.supplies) : [])),
        ...rows.filter((p) => p.id !== forPlant).map((p) => p.leaves),
      ],
      [...takesFromPool(plans.filter((p) => p.id !== forPlan)), ...plantTakesFromPool(power.filter((p) => p.id !== forPlant))],
    );
  }, [on, entries, rows, plans, power, forPlan, forPlant]);
}
