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

/** New top left corners, rounded to whole units. Belts on a moved card lose their bends and take the short way. */
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
      if (!l.pts || (!moved.has(l.a) && !moved.has(l.b))) return l;
      const { pts: _, ...rest } = l;
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
