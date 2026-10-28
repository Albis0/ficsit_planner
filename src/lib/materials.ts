import { useMemo } from 'react';
import { useStore, useTier } from '../store';
import { buildingById, data } from './data';
import type { ExtractionUse } from './extraction';
import { type FactoryEntry, useFactoryEntries } from './solution';
import type { RecipeUse, SolveResult } from './solver';
import { matchFlows, splitByDestination } from './split';

/** Buildings to place and the parts they cost, summed across the whole plan. */
export function buildBill(result: SolveResult, extraction: ExtractionUse[], extra?: Map<string, number>) {
  const buildings = new Map<string, number>();
  const add = (id: string, n: number) => buildings.set(id, (buildings.get(id) ?? 0) + n);
  for (const u of result.recipes) add(u.recipe.machine, u.built);
  // With a card per destination on the floor, the machines those cards add are built too.
  for (const [id, n] of extra ?? []) add(id, n);
  for (const e of extraction) add(e.extractor.id, e.built);

  const parts = new Map<string, number>();
  for (const [id, n] of buildings) {
    const cost = buildingById(id)?.cost ?? [];
    for (const c of cost) parts.set(c.item, (parts.get(c.item) ?? 0) + c.amount * n);
  }
  return {
    buildings: [...buildings].sort((a, b) => b[1] - a[1]),
    parts: [...parts].filter(([id]) => data.items[id]).sort((a, b) => b[1] - a[1]),
  };
}

/** One part or building to get, with how much each factory needs of it. */
export interface BillLine {
  id: string;
  total: number;
  by: { id: string; name: string; amount: number }[];
}

export interface Source {
  id: string;
  name: string;
  result?: SolveResult;
  extraction?: ExtractionUse[];
  /** Machines ticked as built in the game: they are left out of what is still to get. */
  done?: (u: RecipeUse) => boolean;
  /** Machines a line adds when the floor builds a card for each place it feeds, as the floor and the table count them. */
  extra?: (u: RecipeUse) => number;
}

/** What it takes to build all the factories, per part and per building, and who needs how much of each. Largest first. */
export function allMaterials(sources: Source[], builtToo: boolean): { parts: BillLine[]; buildings: BillLine[] } {
  const parts = new Map<string, BillLine>();
  const buildings = new Map<string, BillLine>();
  const put = (into: Map<string, BillLine>, id: string, who: Source, amount: number) => {
    const line = into.get(id) ?? { id, total: 0, by: [] };
    line.total += amount;
    line.by.push({ id: who.id, name: who.name, amount });
    into.set(id, line);
  };
  for (const s of sources) {
    if (!s.result) continue;
    const left = builtToo || !s.done ? s.result : { ...s.result, recipes: s.result.recipes.filter((u) => !s.done?.(u)) };
    const extra = new Map<string, number>();
    for (const u of left.recipes) {
      const n = s.extra?.(u) ?? 0;
      if (n > 0) extra.set(u.recipe.machine, (extra.get(u.recipe.machine) ?? 0) + n);
    }
    const bill = buildBill(left, s.extraction ?? [], extra);
    for (const [id, n] of bill.buildings) put(buildings, id, s, n);
    for (const [id, n] of bill.parts) put(parts, id, s, n);
  }
  const sorted = (m: Map<string, BillLine>) =>
    [...m.values()]
      .filter((l) => l.total > 0)
      .map((l) => ({ ...l, by: l.by.filter((b) => b.amount > 0).sort((a, b) => b.amount - a.amount) }))
      .sort((a, b) => b.total - a.total);
  return { parts: sorted(parts), buildings: sorted(buildings) };
}

/** Whether the factory's machines on this row are ticked built: a recipe on an Auto floor, a card on a Manual one. */
const doneOf =
  (plan: { built?: string[]; model?: { nodes: { id: string; done?: true }[] } } | undefined) =>
  (u: RecipeUse): boolean =>
    u.node ? !!plan?.model?.nodes.find((n) => n.id === u.node)?.done : !!plan?.built?.includes(u.recipe.id);

/** A card per destination on an Auto floor: the machines each line adds for it. A Manual floor is already what's built. */
function extraOf(result: SolveResult | undefined, each: boolean, tier: number) {
  if (!result || !each || 'manual' in result) return undefined;
  const flows = matchFlows(result);
  return (u: RecipeUse) => splitByDestination(u, flows, tier)?.extra ?? 0;
}

/** Every factory's materials for the window on the "All" page. */
export function useMaterials(builtToo: boolean) {
  const plans = useStore((s) => s.plans);
  const each = useStore((s) => s.settings.splitLines) === 'each';
  const tier = useTier();
  const entries = useFactoryEntries(true);
  return useMemo(() => {
    const sources: Source[] = entries.map((e: FactoryEntry) => ({
      id: e.id,
      name: e.name,
      result: e.result,
      extraction: e.extraction,
      done: doneOf(plans.find((p) => p.id === e.id)),
      extra: extraOf(e.result, each, tier),
    }));
    return allMaterials(sources, builtToo);
  }, [entries, plans, builtToo, each, tier]);
}
