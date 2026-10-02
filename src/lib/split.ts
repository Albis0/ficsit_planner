import type { Recipe } from './data';
import { type BuildGroups, buildGroups } from './groups';
import { describeUse, type RecipeUse, type SolveResult } from './solver';

/** Where a belt ends: another machine line, the factory's product, or what's left over. */
export type Destination = { kind: 'recipe'; recipe: Recipe } | { kind: 'target' | 'surplus' };

/** One belt between two nodes of the factory graph. */
export interface Flow {
  from: string;
  to: string;
  item: string;
  rate: number;
  /** What the `to` end is, for naming it. Unset for belts into a machine line from a raw input. */
  dest?: Destination;
}

const EPS = 1e-6;

/**
 * Who sends what to whom. Each item's producers are matched to its consumers greedily (largest first), which keeps
 * the number of belts low compared to splitting every producer proportionally across every consumer. The graph draws
 * these as belts; a line's split by destination reads them too, so both always agree. Node ids: `recipe:<id>`,
 * `raw:`/`supply:`/`missing:`/`target:`/`surplus:` + item. A line feeding itself shows up with `from === to`.
 */
export function matchFlows(result: SolveResult): Flow[] {
  type End = { node: string; rate: number; dest?: Destination };
  const producers = new Map<string, End[]>();
  const consumers = new Map<string, End[]>();
  const push = (m: typeof producers, item: string, end: End) => {
    if (end.rate <= EPS) return;
    const list = m.get(item) ?? [];
    list.push(end);
    m.set(item, list);
  };
  for (const r of result.raw) push(producers, r.item, { node: `raw:${r.item}`, rate: r.rate });
  for (const s of result.supplies) push(producers, s.item, { node: `supply:${s.item}`, rate: s.rate });
  for (const m of result.missing) push(producers, m.item, { node: `missing:${m.item}`, rate: m.rate });
  for (const u of result.recipes) {
    const node = `recipe:${u.recipe.id}`;
    for (const o of u.outputs) push(producers, o.item, { node, rate: o.rate });
    for (const i of u.inputs) push(consumers, i.item, { node, rate: i.rate, dest: { kind: 'recipe', recipe: u.recipe } });
  }
  for (const t of result.targets) push(consumers, t.item, { node: `target:${t.item}`, rate: t.rate, dest: { kind: 'target' } });
  for (const s of result.surplus) push(consumers, s.item, { node: `surplus:${s.item}`, rate: s.rate, dest: { kind: 'surplus' } });

  const flows: Flow[] = [];
  for (const [item, prod] of producers) {
    const cons = consumers.get(item);
    if (!cons) continue;
    const p = prod.map((x) => ({ ...x })).sort((a, b) => b.rate - a.rate);
    const c = cons.map((x) => ({ ...x })).sort((a, b) => b.rate - a.rate);
    let i = 0;
    let j = 0;
    while (i < p.length && j < c.length) {
      const rate = Math.min(p[i].rate, c[j].rate);
      if (rate > 1e-4) flows.push({ from: p[i].node, to: c[j].node, item, rate, dest: c[j].dest });
      p[i].rate -= rate;
      c[j].rate -= rate;
      if (p[i].rate <= EPS) i++;
      if (c[j].rate <= EPS) j++;
    }
  }
  return flows;
}

export interface SplitGroup {
  /** Where this group's main output goes; more than one when a destination was too small for a machine of its own. */
  to: Destination[];
  /** The same as graph node ids (`recipe:<id>`, `target:<item>`…). */
  nodes: string[];
  /** Main output it sends there, a minute. */
  rate: number;
  /** The group's own machines, clocks, power and flows, byproducts included in proportion. */
  use: RecipeUse;
  /** Set when even this group's belts or pipes don't fit one of the best unlocked. */
  groups?: BuildGroups;
}

export interface Split {
  /** The main output that's split. */
  item: string;
  /** Biggest destination first. */
  groups: SplitGroup[];
  /** Machines the split takes beyond building the line as one, at most one fewer than the groups. */
  extra: number;
}

/** Below this a destination can't have a machine of its own: the game's clock doesn't go under 1%. */
const MIN_CLOCK = 0.01;

/**
 * A line whose main output goes to several places, built as one group of machines per place, each sized to it:
 * 4 smelters sending 73.55/min to rods and 46.45/min to plates become 2 × 100% + 1 × 45.17% for the rods and
 * 1 × 100% + 1 × 54.83% for the plates. No splitter ratio to work out, and each group gets one belt. Each group rounds up on its own, so it can take
 * up to (groups − 1) more machines than the line; that's counted in `extra`. Undefined for a single destination, for a
 * single machine, and for power plants.
 */
export function splitByDestination(use: RecipeUse, flows: Flow[], tier: number): Split | undefined {
  const item = use.recipe.outputs[0]?.item;
  if (!item || use.recipe.kind === 'power' || use.built < 2) return undefined;
  const from = `recipe:${use.recipe.id}`;
  const out = flows.filter((f) => f.from === from && f.item === item && f.dest).sort((a, b) => b.rate - a.rate);
  const total = out.reduce((s, f) => s + f.rate, 0);
  if (out.length < 2 || total <= EPS) return undefined;

  // Machines at the configured clock for each destination; any too small to run even one at 1% joins the biggest.
  const parts: { to: Destination[]; nodes: string[]; rate: number }[] = [];
  for (const f of out) {
    const units = (use.count * use.mod.clock * f.rate) / total;
    if (parts.length > 0 && units < MIN_CLOCK - EPS) {
      parts[0].to.push(f.dest!);
      parts[0].nodes.push(f.to);
      parts[0].rate += f.rate;
    } else parts.push({ to: [f.dest!], nodes: [f.to], rate: f.rate });
  }
  if (parts.length < 2) return undefined;

  const groups = parts.map((p) => {
    const part = describeUse(use.recipe, use.mod, (use.count * p.rate) / total, use.spread);
    return { to: p.to, nodes: p.nodes, rate: p.rate, use: part, groups: buildGroups(part, tier) };
  });
  const extra = groups.reduce((s, g) => s + g.use.built, 0) - use.built;
  return { item, groups, extra };
}

/**
 * What building every split line as a group per destination adds to the plan: machines (by building), MW and power
 * shards. For the totals when the graph draws a card per destination, so they count the machines on the floor.
 */
export function splitExtras(result: SolveResult, tier: number) {
  const flows = matchFlows(result);
  const machines = new Map<string, number>();
  let power = 0;
  let shards = 0;
  for (const u of result.recipes) {
    const split = splitByDestination(u, flows, tier);
    if (!split) continue;
    if (split.extra > 0) machines.set(u.recipe.machine, (machines.get(u.recipe.machine) ?? 0) + split.extra);
    power += split.groups.reduce((s, g) => s + g.use.power, 0) - u.power;
    shards += split.groups.reduce((s, g) => s + g.use.shards, 0) - u.shards;
  }
  return { machines, power, shards };
}
