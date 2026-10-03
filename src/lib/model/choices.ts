import { data, recipeById, recipeTier } from '../data';
import { compile } from './calc/compile';
import type { NodeInit } from './ops';
import { extractorById, type Medium, mediumOf, portsOf } from './ports';
import type { LogisticKind, MNode, Model } from './types';
import { cardSize, freeSpot, portY } from './layout';

/*
  What can be put down on a hand-built floor, as the chooser lists it: recipes, miners and pumps, splitters and
  mergers, things coming in and going out. Opened from a belt let go on the floor, it lists only what fits that belt's
  end, and says which end of the new card the belt goes on.
*/

export type ChoiceTab = 'make' | 'raw' | 'logistic' | 'io';
export const CHOICE_TABS: ChoiceTab[] = ['make', 'raw', 'logistic', 'io'];

/** A belt end waiting for something: the side of the new card it goes on, and what it carries. */
export interface Want {
  /** 'in' when the belt comes from an output (the new card takes it), 'out' when it goes to an input. */
  side: 'in' | 'out';
  /** The end it was drawn from. */
  node: string;
  port: number;
  /** What it carries, when that's one thing. */
  item?: string;
  medium: Medium;
}

export interface Choice {
  key: string;
  tab: ChoiceTab;
  init: NodeInit;
  /** The end of the new card a waiting belt goes on. */
  port?: number;
  /** Milestone tier it opens at. */
  tier: number;
  /** Recipes the planner has on for this factory. */
  marked?: boolean;
}

/** The belt end at a node's port, as something waiting for a card. */
export function wantAt(m: Model, tier: number, node: string, side: 'in' | 'out', port: number): Want | undefined {
  const n = m.nodes.find((x) => x.id === node);
  if (!n) return undefined;
  const p = (side === 'out' ? portsOf(n).outs : portsOf(n).ins)[port];
  if (!p) return undefined;
  // A splitter's end carries whatever reaches the splitter; a merger's input whatever leaves it.
  let item = p.item;
  if (!item) {
    const net = compile(m, tier);
    const c = net.byId.get(node);
    const seen = new Set<string>();
    for (const a of (side === 'out' ? c?.inArcs : c?.outArcs) ?? []) for (const i of a?.items ?? []) seen.add(i);
    if (seen.size === 1) item = [...seen][0];
  }
  const medium = p.medium ?? (item ? mediumOf(item) : 'belt');
  return { side: side === 'out' ? 'in' : 'out', node, port, item, medium };
}

const LOGISTIC: { kind: LogisticKind; medium: Medium }[] = [
  { kind: 'splitter', medium: 'belt' },
  { kind: 'merger', medium: 'belt' },
  { kind: 'junction', medium: 'pipe' },
];

/** The extractor a resource is usually got with at this tier: the best one unlocked, a node pump before a well. */
function extractorOf(item: string, tier: number) {
  const solid = data.items[item]?.form === 'solid';
  const options = data.extractors.filter((e) => (e.resources.length ? e.resources.includes(item) : solid));
  const pumps = options.filter((e) => e.id !== 'Build_FrackingExtractor_C');
  const pool = (pumps.length ? pumps : options).sort((a, b) => a.tier - b.tier);
  return pool.filter((e) => e.tier <= tier).at(-1) ?? pool[0];
}

/** Everything that fits, in the order the chooser shows it: what's on and unlocked first. */
export function choicesFor(want: Want | undefined, tier: number, marked: ReadonlySet<string> = new Set()): Choice[] {
  const out: Choice[] = [];
  const fits = (item: string) => !want || (want.item ? item === want.item : mediumOf(item) === want.medium);

  // Recipes: what takes the belt's item (or makes what the input wants).
  const recipes: Choice[] = [];
  for (const r of data.recipes) {
    if (r.kind === 'power') continue;
    const ends = want ? (want.side === 'in' ? r.inputs : r.outputs) : undefined;
    const port = ends ? ends.findIndex((s) => fits(s.item)) : undefined;
    if (port === -1) continue;
    recipes.push({
      key: `r:${r.id}`,
      tab: 'make',
      init: { k: 'machine', recipe: r.id, auto: true, x: 0, y: 0 },
      ...(port !== undefined ? { port } : {}),
      tier: recipeTier(r),
      ...(marked.has(r.id) ? { marked: true } : {}),
    });
  }
  const rank = (c: Choice) => (c.tier <= tier ? 0 : 2) + (c.marked ? 0 : 1);
  const nameOf = (c: Choice) => (c.init.k === 'machine' ? (recipeById.get(c.init.recipe)?.name ?? '') : '');
  // Then standard recipes before alternates, and converters last. For a belt, the earliest ones first (Iron Plate
  // before Ficsite Ingot); for the whole list, by name.
  const kind = (c: Choice) => {
    const k = c.init.k === 'machine' ? recipeById.get(c.init.recipe)?.kind : undefined;
    return k === 'standard' ? 0 : k === 'alternate' ? 1 : 2;
  };
  recipes.sort((a, b) => rank(a) - rank(b) || kind(a) - kind(b) || (want ? a.tier - b.tier : 0) || nameOf(a).localeCompare(nameOf(b)));
  out.push(...recipes);

  // Miners and pumps, one per resource, for an input that wants it.
  if (!want || want.side === 'out')
    for (const item of Object.values(data.items)
      .filter((i) => i.raw && fits(i.id))
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const e = extractorOf(item.id, tier);
      if (!e) continue;
      out.push({
        key: `x:${item.id}`,
        tab: 'raw',
        init: { k: 'extract', extractor: e.id, item: item.id, x: 0, y: 0 },
        port: 0,
        tier: e.tier,
      });
    }

  // Splitters, mergers, junctions and the sink.
  for (const { kind, medium } of LOGISTIC) {
    if (want && want.medium !== medium) continue;
    out.push({ key: `l:${kind}`, tab: 'logistic', init: { k: 'logistic', kind, x: 0, y: 0 }, ...(want ? { port: 0 } : {}), tier: 0 });
  }
  if (!want || (want.side === 'in' && want.medium === 'belt'))
    out.push({ key: 'sink', tab: 'logistic', init: { k: 'sink', x: 0, y: 0 }, ...(want ? { port: 0 } : {}), tier: 2 });

  // Leaving the factory, or coming in from outside it.
  if (!want || want.side === 'in')
    out.push({ key: 'out', tab: 'io', init: { k: 'out', ...(want?.item ? { item: want.item } : {}), x: 0, y: 0 }, port: 0, tier: 0 });
  if (!want || want.side === 'out')
    for (const item of Object.values(data.items)
      .filter((i) => fits(i.id))
      .sort((a, b) => a.name.localeCompare(b.name)))
      out.push({ key: `i:${item.id}`, tab: 'io', init: { k: 'in', item: item.id, x: 0, y: 0 }, port: 0, tier: 0 });
  return out;
}

/** The words a choice is found by: its recipe, building and every item it takes or makes. */
export function choiceWords(c: Choice): string[] {
  const n = c.init;
  if (n.k === 'machine') {
    const r = recipeById.get(n.recipe);
    if (!r) return [];
    return [r.name, data.machines[r.machine]?.name ?? '', ...[...r.inputs, ...r.outputs].map((s) => data.items[s.item]?.name ?? '')];
  }
  if (n.k === 'extract') return [data.items[n.item]?.name ?? '', extractorById.get(n.extractor)?.name ?? ''];
  if (n.k === 'in' || n.k === 'out') return [n.item ? (data.items[n.item]?.name ?? '') : ''];
  return [];
}

/**
 * Where the new card goes: with a waiting belt, its end on the spot the belt was let go (to the right of an output,
 * to the left of an input); otherwise centred on the spot. Then off any card already there.
 */
export function placeChoice(m: Model, c: Choice, at: { x: number; y: number }, want?: Want): MNode {
  const probe = { ...c.init, id: '' } as MNode;
  const { w, h } = cardSize(probe);
  let x = at.x - w / 2;
  let y = at.y - h / 2;
  if (want && c.port !== undefined) {
    const ends = want.side === 'in' ? portsOf(probe).ins : portsOf(probe).outs;
    x = want.side === 'in' ? at.x + 20 : at.x - w - 20;
    y = at.y - portY(h, c.port, ends.length);
  }
  return { ...probe, ...freeSpot(m.nodes, { x, y, w, h }) };
}
