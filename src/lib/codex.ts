import { useEffect, useState } from 'react';
import { type Cost, data, generatorById, producersOf, type Recipe, recipeById, recipeTier } from './data';
import { searchKey } from './text';

/**
 * The Codex: the game's own descriptions and everything the planner data doesn't carry (equipment,
 * vehicles, every building, milestones, MAM research, the AWESOME Shop), from scripts/extract-codex.mjs.
 * It's loaded on first visit, so the planner doesn't pay for it.
 */
export type ItemKind = 'resource' | 'part' | 'equipment' | 'consumable' | 'ammo';

export interface CodexItem {
  name: string;
  kind: ItemKind;
  desc: string;
  form: 'solid' | 'liquid' | 'gas';
  /** Per inventory slot; solids only. */
  stack?: number;
  sink: number;
  /** MJ per item, or per m³ for fluids. */
  energy?: number;
  radioactive?: number;
  alien?: boolean;
}

export type BuildingGroup = 'production' | 'extraction' | 'power' | 'logistics' | 'fluids' | 'storage' | 'transport' | 'special';
export type StatKey = 'power' | 'beltRate' | 'flow' | 'fluidStore' | 'slots' | 'sloopSlots' | 'storeMWh' | 'makes';

export interface CodexBuilding {
  name: string;
  group: BuildingGroup;
  desc: string;
  cost?: Cost[];
  /** Schematic that unlocks it. */
  unlock?: string;
  stats?: [StatKey, number][];
}

export interface CodexVehicle {
  name: string;
  desc: string;
  slots?: number;
  fluid?: boolean;
  cost?: Cost[];
  unlock?: string;
}

export interface Craft {
  id: string;
  name: string;
  inputs: Cost[];
  amount: number;
  unlock?: string;
}

export type SchematicType = 'hub' | 'milestone' | 'mam' | 'alternate' | 'shop';
export type Extra =
  | { k: 'slots' | 'arm'; n: number }
  | { k: 'scan'; items: string[] }
  | { k: 'overclock' | 'sloops' | 'map' | 'blueprints' | 'depot' };

export interface Schematic {
  id: string;
  name: string;
  type: SchematicType;
  tier: number;
  /** MAM tree or AWESOME Shop shelf. */
  group?: string;
  cost: Cost[];
  /** Seconds the HUB takes to ship a milestone, or the MAM to research. */
  time?: number;
  /** Planner recipes, building ids, item ids and vehicle ids it unlocks. */
  unlocks: string[];
  extras?: Extra[];
  /** Items it hands over (shop purchases). */
  gives?: Cost[];
  /** Schematics that must come first. */
  after: string[];
}

export interface CodexData {
  items: Record<string, CodexItem>;
  buildings: Record<string, CodexBuilding>;
  vehicles: Record<string, CodexVehicle>;
  crafts: Record<string, Craft[]>;
  handCraft: string[];
  recipeUnlock: Record<string, string>;
  schematics: Schematic[];
}

export type Category =
  | 'parts'
  | 'resources'
  | 'buildings'
  | 'vehicles'
  | 'equipment'
  | 'milestones'
  | 'research'
  | 'alternates'
  | 'shop'
  | 'guides';
export const CATEGORIES: Category[] = [
  'parts',
  'resources',
  'buildings',
  'vehicles',
  'equipment',
  'milestones',
  'research',
  'alternates',
  'shop',
  'guides',
];

export type GuideId = 'overclock' | 'sloops' | 'nodes' | 'fuel' | 'transport' | 'world' | 'sink';
export const GUIDES: GuideId[] = ['overclock', 'sloops', 'nodes', 'fuel', 'transport', 'world', 'sink'];

/** A game icon for each guide. */
export const GUIDE_ICON: Record<GuideId, string> = {
  overclock: 'Desc_CrystalShard_C',
  sloops: 'Desc_WAT1_C',
  nodes: 'Build_MinerMk3_C',
  fuel: 'Build_GeneratorFuel_C',
  transport: 'Build_ConveyorBeltMk6_C',
  world: 'Build_RadarTower_C',
  sink: 'Build_ResourceSink_C',
};

/** A Codex page: its home, a category, or one entry. Written into the address as #codex/<kind>/<id>. */
export type Page =
  | { kind: 'home' }
  | { kind: 'cat'; id: Category }
  | { kind: 'item' | 'building' | 'vehicle' | 'schematic'; id: string }
  | { kind: 'guide'; id: GuideId };

export const pageKey = (p: Page) => (p.kind === 'home' ? '' : `${p.kind}/${p.id}`);

export function parsePage(key: string | undefined): Page {
  const [kind, id] = (key ?? '').split('/');
  if (kind === 'cat' && CATEGORIES.includes(id as Category)) return { kind, id: id as Category };
  if (kind === 'guide' && GUIDES.includes(id as GuideId)) return { kind, id: id as GuideId };
  if ((kind === 'item' || kind === 'building' || kind === 'vehicle' || kind === 'schematic') && id) return { kind, id };
  return { kind: 'home' };
}

let loaded: CodexData | undefined;
let loading: Promise<CodexData> | undefined;

export function loadCodex(): Promise<CodexData> {
  loading ??= import('../data/codex.json').then((m) => {
    loaded = m.default as unknown as CodexData;
    return loaded;
  });
  return loading;
}

/** The Codex data and its index, or undefined while the file is still on its way. */
export function useCodex(): CodexIndex | undefined {
  const [codex, setCodex] = useState(() => (loaded ? indexOf(loaded) : undefined));
  useEffect(() => {
    if (!codex) loadCodex().then((c) => setCodex(indexOf(c)));
  }, [codex]);
  return codex;
}

/** One search hit or grid tile: what it is, what to call it and which icon to show. */
export interface Entry {
  page: Page;
  name: string;
  icon?: string;
  /** Short line under the name: a tier, a group, points. */
  note?: string;
}

export interface CodexIndex {
  data: CodexData;
  schematic: Map<string, Schematic>;
  /** Recipes that take an item in. */
  usedIn: Map<string, Recipe[]>;
  /** Buildings, vehicles and equipment whose build cost includes an item. */
  builtWith: Map<string, { page: Page; amount: number }[]>;
  /** Schematics paid for with an item. */
  paidWith: Map<string, { id: string; amount: number }[]>;
  /** Shop purchases that hand over an item. */
  soldAs: Map<string, { id: string; amount: number }[]>;
  /** Schematic that unlocks a building, vehicle, equipment or recipe. */
  unlockOf: Map<string, string>;
  /** Everything searchable. */
  entries: Entry[];
}

let cached: CodexIndex | undefined;

/** Reverse lookups over the Codex and the planner data, built once. */
export function indexOf(codex: CodexData): CodexIndex {
  if (cached?.data === codex) return cached;
  const push = <V>(m: Map<string, V[]>, k: string, v: V) => {
    const list = m.get(k);
    if (list) list.push(v);
    else m.set(k, [v]);
  };
  const usedIn = new Map<string, Recipe[]>();
  for (const r of data.recipes) for (const i of r.inputs) push(usedIn, i.item, r);

  const builtWith = new Map<string, { page: Page; amount: number }[]>();
  for (const [id, b] of Object.entries(codex.buildings))
    for (const c of b.cost ?? []) push(builtWith, c.item, { page: { kind: 'building', id }, amount: c.amount });
  for (const [id, v] of Object.entries(codex.vehicles))
    for (const c of v.cost ?? []) push(builtWith, c.item, { page: { kind: 'vehicle', id }, amount: c.amount });
  for (const [id, crafts] of Object.entries(codex.crafts))
    for (const c of crafts[0].inputs) push(builtWith, c.item, { page: { kind: 'item', id }, amount: c.amount });

  const paidWith = new Map<string, { id: string; amount: number }[]>();
  const soldAs = new Map<string, { id: string; amount: number }[]>();
  const unlockOf = new Map<string, string>();
  for (const s of codex.schematics) {
    for (const c of s.cost) push(paidWith, c.item, { id: s.id, amount: c.amount });
    for (const g of s.gives ?? []) push(soldAs, g.item, { id: s.id, amount: g.amount });
    for (const u of s.unlocks) if (!unlockOf.has(u)) unlockOf.set(u, s.id);
  }

  const entries: Entry[] = [];
  for (const [id, it] of Object.entries(codex.items)) entries.push({ page: { kind: 'item', id }, name: it.name, icon: id });
  for (const [id, b] of Object.entries(codex.buildings)) entries.push({ page: { kind: 'building', id }, name: b.name, icon: id });
  for (const [id, v] of Object.entries(codex.vehicles)) entries.push({ page: { kind: 'vehicle', id }, name: v.name, icon: id });
  for (const s of codex.schematics) entries.push({ page: { kind: 'schematic', id: s.id }, name: s.name, icon: schematicIcon(s, codex) });

  cached = {
    data: codex,
    schematic: new Map(codex.schematics.map((s) => [s.id, s])),
    usedIn,
    builtWith,
    paidWith,
    soldAs,
    unlockOf,
    entries,
  };
  return cached;
}

/**
 * Where a part first becomes makeable with a standard recipe: a milestone tier, or a MAM tree for
 * parts like Caterium Ingot that research unlocks. Undefined for parts no standard recipe makes.
 */
export function partSource(id: string, index: Pick<CodexIndex, 'data' | 'schematic'>): { tier: number } | { mam: string } | undefined {
  const tiers: number[] = [];
  const trees: string[] = [];
  const standard = (producersOf.get(id) ?? []).filter((r) => r.kind === 'standard');
  // Its own recipe first: Silica comes from Quartz research, not as Alumina Solution's leftover.
  const own = standard.filter((r) => r.outputs[0].item === id);
  for (const r of own.length ? own : standard) {
    const unlock = index.data.recipeUnlock[r.id];
    const s = unlock ? index.schematic.get(unlock) : undefined;
    if (s?.type === 'mam') trees.push(s.group ?? '');
    else tiers.push(recipeTier(r));
  }
  if (tiers.length) return { tier: Math.min(...tiers) };
  if (trees.length) return { mam: trees[0] };
  return undefined;
}

/** A picture for a schematic, which has none of its own: what it unlocks or hands over, else what it costs. */
export function schematicIcon(s: Schematic, codex: CodexData): string | undefined {
  for (const u of s.unlocks) {
    const r = recipeById.get(u);
    if (r) return r.outputs[0].item;
    if (codex.buildings[u] || codex.vehicles[u] || codex.items[u]) return u;
  }
  return s.gives?.[0]?.item ?? s.cost[0]?.item ?? SCHEMATIC_ICON[s.type];
}

/** Where a schematic comes from, as a picture, for the ones that neither cost nor give anything to show. */
const SCHEMATIC_ICON: Record<SchematicType, string> = {
  hub: 'Build_TradingPost_C',
  milestone: 'Build_TradingPost_C',
  mam: 'Build_Mam_C',
  alternate: 'Desc_HardDrive_C',
  shop: 'Desc_ResourceSinkCoupon_C',
};

/** Where an id lives in the Codex. */
export function pageOf(id: string, codex: CodexData): Page | undefined {
  if (recipeById.has(id)) return { kind: 'item', id: recipeById.get(id)!.outputs[0].item };
  if (codex.items[id]) return { kind: 'item', id };
  if (codex.buildings[id]) return { kind: 'building', id };
  if (codex.vehicles[id]) return { kind: 'vehicle', id };
  return undefined;
}

export function nameOf(id: string, codex: CodexData): string {
  return (
    codex.items[id]?.name ??
    codex.buildings[id]?.name ??
    codex.vehicles[id]?.name ??
    data.items[id]?.name ??
    recipeById.get(id)?.name ??
    generatorById.get(id)?.name ??
    id
  );
}

/** Search across every page; names that start with the text first. */
export function search(index: CodexIndex, text: string, limit = 60): Entry[] {
  const q = searchKey(text.trim());
  if (!q) return [];
  const hits = index.entries.filter((e) => searchKey(e.name).includes(q));
  hits.sort((a, b) => Number(!searchKey(a.name).startsWith(q)) - Number(!searchKey(b.name).startsWith(q)) || a.name.localeCompare(b.name));
  return hits.slice(0, limit);
}

/** Standard recipes first, then alternates, each by the tier they arrive at. */
export function recipesFor(item: string): Recipe[] {
  return [...(producersOf.get(item) ?? [])]
    .filter((r) => r.kind !== 'power')
    .sort(
      (a, b) =>
        Number(a.kind === 'alternate') - Number(b.kind === 'alternate') || recipeTier(a) - recipeTier(b) || a.name.localeCompare(b.name),
    );
}

/** Largest, most-used, most valuable: a few facts pulled from the data for the Codex home. */
export function funFacts(index: CodexIndex): { key: string; vars: Record<string, string | number>; page: Page }[] {
  const { data: codex, usedIn } = index;
  const facts: { key: string; vars: Record<string, string | number>; page: Page }[] = [];
  const parts = Object.entries(codex.items).filter(([, it]) => it.kind === 'part');
  const [topSink, topSinkItem] = parts.reduce((best, cur) => (cur[1].sink > best[1].sink ? cur : best));
  facts.push({ key: 'factSink', vars: { name: topSinkItem.name, points: topSinkItem.sink }, page: { kind: 'item', id: topSink } });
  const [mostUsed, uses] = [...usedIn.entries()]
    .filter(([id]) => !data.items[id]?.raw)
    .reduce((best, cur) => (cur[1].length > best[1].length ? cur : best));
  facts.push({
    key: 'factMostUsed',
    vars: { name: codex.items[mostUsed]?.name ?? mostUsed, n: uses.length },
    page: { kind: 'item', id: mostUsed },
  });
  const nuclear = data.generators.find((g) => g.id === 'Build_GeneratorNuclear_C');
  const biomass = data.generators.find((g) => g.id === 'Build_GeneratorBiomass_Automated_C');
  if (nuclear && biomass)
    facts.push({
      key: 'factNuclear',
      vars: { n: Math.round(nuclear.power / biomass.power) },
      page: { kind: 'building', id: nuclear.id },
    });
  const alternates = codex.schematics.filter((s) => s.type === 'alternate').length;
  facts.push({ key: 'factAlternates', vars: { n: alternates }, page: { kind: 'cat', id: 'alternates' } });
  const [bigRecipe] = [...data.recipes].filter((r) => r.kind !== 'power').sort((a, b) => b.inputs.length - a.inputs.length);
  facts.push({
    key: 'factInputs',
    vars: { name: bigRecipe.name, n: bigRecipe.inputs.length },
    page: { kind: 'item', id: bigRecipe.outputs[0].item },
  });
  const research = codex.schematics.filter((s) => s.type === 'mam').length;
  facts.push({ key: 'factResearch', vars: { n: research }, page: { kind: 'cat', id: 'research' } });
  return facts;
}
