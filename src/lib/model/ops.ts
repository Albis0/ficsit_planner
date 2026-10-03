import { portAccepts, portsOf } from './ports';
import type { MLink, MNode, Model } from './types';

/*
  Every change to a model is a pure function from the old model to a new one, so the editor can keep the old one for
  undo and the store only ever sees whole models.
*/

/** Short ids in base 36, handed out in order. */
export function nextIds(m: Model, n: number): { ids: string[]; seq: number } {
  const ids = Array.from({ length: n }, (_, i) => (m.seq + i).toString(36));
  return { ids, seq: m.seq + n };
}

/** A node as it's put down, before it has an id. */
export type NodeInit = MNode extends infer N ? (N extends MNode ? Omit<N, 'id'> : never) : never;

export function addNode(m: Model, init: NodeInit): { model: Model; id: string } {
  const { ids, seq } = nextIds(m, 1);
  const n = { ...init, id: ids[0] } as MNode;
  return { model: { ...m, seq, nodes: [...m.nodes, n] }, id: n.id };
}

/** Takes nodes off the floor with every belt touching them. */
export function removeNodes(m: Model, ids: Iterable<string>): Model {
  const gone = new Set(ids);
  if (gone.size === 0) return m;
  return {
    ...m,
    nodes: m.nodes.filter((n) => !gone.has(n.id)),
    links: m.links.filter((l) => !gone.has(l.a) && !gone.has(l.b)),
  };
}

export function removeLinks(m: Model, ids: Iterable<string>): Model {
  const gone = new Set(ids);
  return gone.size ? { ...m, links: m.links.filter((l) => !gone.has(l.id)) } : m;
}

/** New top left corners, rounded to whole units. Belts on a moved card lose their bends and label spot and take the short way. */
export function moveNodes(m: Model, to: Map<string, { x: number; y: number }>): Model {
  const moved = new Set(
    [...to].filter(([id, p]) => m.nodes.some((n) => n.id === id && (n.x !== Math.round(p.x) || n.y !== Math.round(p.y)))).map(([id]) => id),
  );
  if (moved.size === 0) return m;
  return {
    ...m,
    nodes: m.nodes.map((n) => {
      const p = to.get(n.id);
      return p && moved.has(n.id) ? { ...n, x: Math.round(p.x), y: Math.round(p.y) } : n;
    }),
    links: m.links.map((l) => {
      if ((!l.pts && !l.lbl) || (!moved.has(l.a) && !moved.has(l.b))) return l;
      const { pts: _, lbl: __, ...rest } = l;
      return rest;
    }),
  };
}

/** Changes one node. Keys set to undefined are taken off, so defaults stay out of the saved model. */
export function updateNode(m: Model, id: string, patch: Record<string, unknown>): Model {
  return {
    ...m,
    nodes: m.nodes.map((n) => {
      if (n.id !== id) return n;
      const next = { ...n, ...patch } as Record<string, unknown>;
      for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
      return next as unknown as MNode;
    }),
  };
}

export function updateLink(m: Model, id: string, patch: Partial<Omit<MLink, 'id' | 'a' | 'b' | 'ap' | 'bp'>>): Model {
  return {
    ...m,
    links: m.links.map((l) => {
      if (l.id !== id) return l;
      const next = { ...l, ...patch } as Record<string, unknown>;
      for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
      return next as unknown as MLink;
    }),
  };
}

/** Why two ends can't be joined, or undefined when they can. */
export type ConnectProblem = 'same' | 'noPort' | 'medium' | 'item';

export function canConnect(m: Model, a: string, ap: number, b: string, bp: number): ConnectProblem | undefined {
  if (a === b) return 'same';
  const from = m.nodes.find((n) => n.id === a);
  const to = m.nodes.find((n) => n.id === b);
  if (!from || !to) return 'noPort';
  const out = portsOf(from).outs[ap];
  const inn = portsOf(to).ins[bp];
  if (!out || !inn) return 'noPort';
  if (out.medium && inn.medium && out.medium !== inn.medium) return 'medium';
  if (out.item && !portAccepts(inn, out.item)) return 'item';
  return undefined;
}

/** A belt between two ends; whatever was already on either end comes off, as one end holds one belt. */
export function connect(m: Model, a: string, ap: number, b: string, bp: number, extra: Partial<MLink> = {}): { model: Model; id?: string } {
  if (canConnect(m, a, ap, b, bp)) return { model: m };
  const { ids, seq } = nextIds(m, 1);
  const links = m.links.filter((l) => !(l.a === a && l.ap === ap) && !(l.b === b && l.bp === bp));
  return { model: { ...m, seq, links: [...links, { ...extra, id: ids[0], a, ap, b, bp }] }, id: ids[0] };
}

/** Cards and the belts between them, as copied: apart from any floor until pasted. */
export interface Clip {
  nodes: MNode[];
  links: MLink[];
}

/** The picked cards and every belt running between two of them; not ticked built, belts without bends. */
export function copyNodes(m: Model, ids: Iterable<string>): Clip | undefined {
  const keep = new Set(ids);
  const nodes = m.nodes
    .filter((n) => keep.has(n.id))
    .map((n) => {
      const { done: _, ...rest } = n;
      return rest as MNode;
    });
  if (!nodes.length) return undefined;
  const links = m.links
    .filter((l) => keep.has(l.a) && keep.has(l.b))
    .map((l) => {
      const { pts: _, lbl: __, ...rest } = l;
      return rest;
    });
  return { nodes, links };
}

/** Puts a copy down with its top left card corner moved by `dx`, `dy`; new ids throughout. Returns the new cards. */
export function pasteClip(m: Model, clip: Clip, dx: number, dy: number): { model: Model; ids: string[] } {
  const { ids, seq } = nextIds(m, clip.nodes.length + clip.links.length);
  const to = new Map(clip.nodes.map((n, i) => [n.id, ids[i]]));
  const nodes = clip.nodes.map((n) => ({ ...n, id: to.get(n.id)!, x: Math.round(n.x + dx), y: Math.round(n.y + dy) }) as MNode);
  const links = clip.links.map((l, i) => ({ ...l, id: ids[clip.nodes.length + i], a: to.get(l.a)!, b: to.get(l.b)! }));
  return { model: { ...m, seq, nodes: [...m.nodes, ...nodes], links: [...m.links, ...links] }, ids: nodes.map((n) => n.id) };
}

const tidyNumber = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * The same output with the machines at 100%: 7 at 95% become 6 at 100% and one at 65% (a count of 6.65). A count and
 * clock as the panel keeps them, with the defaults left off.
 */
export function fullSpeed(n: number, clock: number): { n?: number; clock?: number } {
  const count = tidyNumber(n * clock);
  return { n: count === 1 ? undefined : count, clock: undefined };
}

/** The same output with every machine at one clock: 6 at 100% and one at 65% become 7 at 95%. */
export function evenSpeed(n: number, clock: number): { n?: number; clock?: number } {
  const count = Math.max(1, Math.ceil(n - 1e-6));
  const each = tidyNumber((n * clock) / count);
  return { n: count === 1 ? undefined : count, clock: each === 1 ? undefined : each };
}

/**
 * Miners making a rate typed in: the same miners at another clock, or more of them once 250% can't reach it. Never
 * fewer miners than are there, and the defaults left off.
 */
export function minerFor(rate: number, each: number, n: number): { n?: number; clock?: number } {
  const units = rate / each;
  const count = units / n > 2.5 + 1e-9 ? Math.ceil(units / 2.5 - 1e-9) : n;
  const clock = Math.min(2.5, Math.max(0.01, tidyNumber(units / count)));
  return { n: count === 1 ? undefined : count, clock: clock === 1 ? undefined : clock };
}
