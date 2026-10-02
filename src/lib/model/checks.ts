import { portsOf } from './ports';
import { isPart, type Model } from './types';

/** Per end of a card: true where it needs a belt and has none. */
export interface OpenEnds {
  ins: boolean[];
  outs: boolean[];
}

/**
 * The ends left open that matter. A machine stops with an input or output open (an output only while open outputs
 * aren't counted as left over); a splitter's spare outputs and a merger's spare inputs are fine as in the game, as
 * long as one on each side is used.
 */
export function openEnds(m: Model): Map<string, OpenEnds> {
  const wired = new Map<string, OpenEnds>();
  for (const n of m.nodes) {
    if (!isPart(n)) continue;
    const p = portsOf(n);
    wired.set(n.id, { ins: p.ins.map(() => false), outs: p.outs.map(() => false) });
  }
  for (const l of m.links) {
    const a = wired.get(l.a);
    const b = wired.get(l.b);
    if (a && l.ap < a.outs.length) a.outs[l.ap] = true;
    if (b && l.bp < b.ins.length) b.ins[l.bp] = true;
  }
  const open = new Map<string, OpenEnds>();
  for (const n of m.nodes) {
    const w = wired.get(n.id);
    if (!w) continue;
    let ins = w.ins.map((x) => !x);
    let outs = w.outs.map((x) => !x);
    if (n.k === 'logistic') {
      // One belt on each side is enough.
      if (w.ins.some(Boolean)) ins = ins.map(() => false);
      if (w.outs.some(Boolean)) outs = outs.map(() => false);
    } else if (n.k === 'unknown') {
      ins = ins.map(() => false);
      outs = outs.map(() => false);
    } else if (m.drain && (n.k === 'machine' || n.k === 'gen' || n.k === 'extract')) outs = outs.map(() => false);
    open.set(n.id, { ins, outs });
  }
  return open;
}

/** Cards with an end that needs a belt, in the order the line runs (left to right, then top to bottom). */
export function openCards(m: Model, open = openEnds(m)): string[] {
  return m.nodes
    .filter((n) => {
      const o = open.get(n.id);
      return !!o && (o.ins.some(Boolean) || o.outs.some(Boolean));
    })
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .map((n) => n.id);
}
