import { data, type Extractor, generatorById, type Recipe, recipeById } from '../data';
import { PURITY } from '../extraction';
import { plantRecipe } from '../power';
import type { LogisticKind, MNode, Runner } from './types';

/** Solid things ride belts; liquids and gases go through pipes. */
export type Medium = 'belt' | 'pipe';

export const mediumOf = (item: string): Medium => (data.items[item]?.form === 'solid' ? 'belt' : 'pipe');

export interface Port {
  /** The one item it takes or gives; unset takes whatever arrives (splitters, outputs). */
  item?: string;
  /** Belt or pipe; unset takes either (an output that takes anything). */
  medium?: Medium;
}

export interface Ports {
  ins: Port[];
  outs: Port[];
}

const port = (item: string): Port => ({ item, medium: mediumOf(item) });
const any = (medium: Medium, n: number): Port[] => Array.from({ length: n }, () => ({ medium }));

/** Inputs and outputs of each attachment, as in the game. */
export function logisticPorts(kind: LogisticKind, ins = 1): Ports {
  switch (kind) {
    case 'merger':
    case 'prio':
      return { ins: any('belt', 3), outs: any('belt', 1) };
    case 'junction': {
      const n = Math.min(3, Math.max(1, Math.round(ins)));
      return { ins: any('pipe', n), outs: any('pipe', 4 - n) };
    }
    default:
      return { ins: any('belt', 1), outs: any('belt', 3) };
  }
}

export const extractorById = new Map(data.extractors.map((e) => [e.id, e]));

/** One extractor's output a minute at 100%, on its node's purity (water extractors sit on any water). */
export function extractorRate(e: Extractor, purity: keyof typeof PURITY = 'normal'): number {
  return e.rate * (e.purity ? PURITY[purity] : 1);
}

/**
 * What one machine of a node does at 100%, as a recipe: a production recipe as it is, a generator's fuel, water and
 * waste, an extractor's output. Undefined when the game no longer has it.
 */
export function runnerRecipe(n: Runner): Recipe | undefined {
  if (n.k === 'machine') return recipeById.get(n.recipe);
  if (n.k === 'gen') {
    if (!generatorById.has(n.generator)) return undefined;
    return plantRecipe({ id: n.id, generator: n.generator, fuel: n.fuel, by: 'count', amount: n.n ?? 1, clock: n.clock ?? 1 });
  }
  const e = extractorById.get(n.extractor);
  if (!e || !data.items[n.item]) return undefined;
  return {
    id: `extract:${n.id}`,
    name: e.name,
    kind: 'standard',
    machine: e.id,
    duration: 60,
    power: e.power,
    inputs: [],
    outputs: [{ item: n.item, rate: extractorRate(e, n.purity) }],
  };
}

/** A node's inputs and outputs, in order: link ends point at these by index. */
export function portsOf(n: MNode): Ports {
  switch (n.k) {
    case 'machine':
    case 'gen':
    case 'extract': {
      const r = runnerRecipe(n);
      return r ? { ins: r.inputs.map((s) => port(s.item)), outs: r.outputs.map((s) => port(s.item)) } : { ins: [], outs: [] };
    }
    case 'in':
      return { ins: [], outs: [n.item ? port(n.item) : {}] };
    case 'out':
      return { ins: [n.item ? port(n.item) : {}], outs: [] };
    case 'logistic':
      return logisticPorts(n.kind, n.ins);
    case 'sink':
      return { ins: any('belt', 1), outs: [] };
    case 'storage':
      return n.mode === 'fill'
        ? { ins: any('belt', 1), outs: [] }
        : n.mode === 'empty'
          ? { ins: [], outs: [n.item ? port(n.item) : { medium: 'belt' }] }
          : { ins: any('belt', 1), outs: any('belt', 1) };
    case 'unknown':
      return { ins: Array.from({ length: n.ins }, () => ({})), outs: Array.from({ length: n.outs }, () => ({})) };
    default:
      return { ins: [], outs: [] };
  }
}

/** Whether a port takes an item: its own item, or anything on its kind of line. */
export const portAccepts = (p: Port, item: string) => (p.item ? p.item === item : !p.medium || p.medium === mediumOf(item));
