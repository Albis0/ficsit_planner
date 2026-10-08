import { craftableItems, data, itemTier, rawTier, recipeById, recipeTier, SPECIAL_ITEMS } from '../data';
import { type ExtractionSettings, effectiveExtraction } from '../extraction';
import { compile } from './calc/compile';
import type { NodeInit } from './ops';
import { extractorById, type Medium, mediumOf, portsOf } from './ports';
import type { LogisticKind, MNode, Model } from './types';
import { cardSize, dirOf, endSpot, freeSpot } from './layout';

/*
  What can be put down on a hand-built floor, as the chooser lists it: recipes, miners and pumps, splitters and
  mergers, and the final products that leave the floor. Opened from a belt let go on the floor, it lists only what fits
  that belt's end, and says which end of the new card the belt goes on.
*/

/**
 * Special: gear made in the factory (ammo, equipment, power shards), kept apart from the parts. End: a final product,
 * the card a finished item leaves the floor on. What comes into the floor from outside is added in the side panel.
 */
export type ChoiceTab = 'make' | 'raw' | 'end' | 'logistic' | 'special';
export const CHOICE_TABS: ChoiceTab[] = ['make', 'raw', 'end', 'logistic', 'special'];

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
}

/** What the factory's side panel says about what goes down: the recipes it has on, and the miner it counts with. */
export interface ChoiceRules {
  /** Recipes turned on in Recipes; unset lists every recipe. */
  on?: ReadonlySet<string>;
  /** Miner, node purity and clock from Resources; unset is the best miner unlocked, on a normal node, at 100%. */
  extraction?: ExtractionSettings;
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

/**
 * The extractor a resource is got with at this tier: the miner picked in Resources (or the best one unlocked when that
 * isn't yet), a node pump before a well.
 */
function extractorOf(item: string, tier: number, ex?: ExtractionSettings) {
  const solid = data.items[item]?.form === 'solid';
  if (solid && ex) {
    const miner = data.extractors.find((e) => e.id === effectiveExtraction(ex, tier).miner);
    if (miner) return miner;
  }
  const options = data.extractors.filter((e) => (e.resources.length ? e.resources.includes(item) : solid));
  const pumps = options.filter((e) => e.id !== 'Build_FrackingExtractor_C');
  const pool = (pumps.length ? pumps : options).sort((a, b) => a.tier - b.tier);
  return pool.filter((e) => e.tier <= tier).at(-1) ?? pool[0];
}

/** Everything that fits and is turned on, in the order the chooser shows it: what's unlocked first. */
export function choicesFor(want: Want | undefined, tier: number, rules: ChoiceRules = {}): Choice[] {
  const { on, extraction: ex } = rules;
  const out: Choice[] = [];
  const fits = (item: string) => !want || (want.item ? item === want.item : mediumOf(item) === want.medium);

  // Recipes: what takes the belt's item (or makes what the input wants).
  const recipes: Choice[] = [];
  for (const r of data.recipes) {
    // Turned off in Recipes: off here too, as on the Auto floor.
    if (r.kind === 'power' || (on && !on.has(r.id))) continue;
    const ends = want ? (want.side === 'in' ? r.inputs : r.outputs) : undefined;
    const port = ends ? ends.findIndex((s) => fits(s.item)) : undefined;
    if (port === -1) continue;
    recipes.push({
      key: `r:${r.id}`,
      tab: r.outputs.some((o) => SPECIAL_ITEMS.has(o.item)) ? 'special' : 'make',
      init: { k: 'machine', recipe: r.id, auto: true, x: 0, y: 0 },
      ...(port !== undefined ? { port } : {}),
      tier: recipeTier(r),
    });
  }
  const rank = (c: Choice) => (c.tier <= tier ? 0 : 1);
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
      const e = extractorOf(item.id, tier, ex);
      if (!e) continue;
      // The node purity and clock Resources counts with.
      const purity = e.purity ? ex?.purity : undefined;
      const clock = ex ? (ex.overclock?.[item.id] ?? ex.clock) : 1;
      out.push({
        key: `x:${item.id}`,
        tab: 'raw',
        init: {
          k: 'extract',
          extractor: e.id,
          item: item.id,
          ...(purity && purity !== 'normal' ? { purity } : {}),
          ...(Math.abs(clock - 1) > 1e-12 ? { clock } : {}),
          x: 0,
          y: 0,
        },
        port: 0,
        // Not before anything takes it.
        tier: Math.max(e.tier, rawTier(item.id) ?? 0),
      });
    }

  // A final product: the item on a belt waiting for an end, or any item that can be made. Built backwards from there by
  // letting a belt go from its input.
  if (!want || (want.side === 'in' && want.item)) {
    const items = want?.item ? [data.items[want.item]] : craftableItems;
    const ends = items
      .filter(Boolean)
      .map((i) => ({ i, tier: itemTier(i.id) ?? 0 }))
      .sort((a, b) => Number(a.tier > tier) - Number(b.tier > tier) || a.i.name.localeCompare(b.i.name));
    for (const { i, tier: needs } of ends)
      out.push({
        key: `o:${i.id}`,
        tab: 'end',
        init: { k: 'out', item: i.id, x: 0, y: 0 },
        ...(want ? { port: 0 } : {}),
        tier: needs,
      });
  }

  // Splitters, mergers, junctions and the sink.
  for (const { kind, medium } of LOGISTIC) {
    if (want && want.medium !== medium) continue;
    out.push({ key: `l:${kind}`, tab: 'logistic', init: { k: 'logistic', kind, x: 0, y: 0 }, ...(want ? { port: 0 } : {}), tier: 0 });
  }
  if (!want || (want.side === 'in' && want.medium === 'belt'))
    out.push({ key: 'sink', tab: 'logistic', init: { k: 'sink', x: 0, y: 0 }, ...(want ? { port: 0 } : {}), tier: 2 });

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
 * Where the new card goes: with a waiting belt, its end on the spot the belt was let go (after an output, before an
 * input, the way the floor runs); otherwise centred on the spot. Then off any card already there.
 */
export function placeChoice(m: Model, c: Choice, at: { x: number; y: number }, want?: Want): MNode {
  const dir = dirOf(m);
  const probe = { ...c.init, id: '' } as MNode;
  const { w, h } = cardSize(probe, dir);
  let x = at.x - w / 2;
  let y = at.y - h / 2;
  if (want && c.port !== undefined) {
    const end = endSpot(probe, want.side, c.port, dir);
    const after = want.side === 'in';
    if (dir === 'TB') {
      x = at.x - end.x;
      y = after ? at.y + 20 : at.y - h - 20;
    } else {
      x = after ? at.x + 20 : at.x - w - 20;
      y = at.y - end.y;
    }
  }
  return { ...probe, ...freeSpot(m.nodes, { x, y, w, h }, dir) };
}
