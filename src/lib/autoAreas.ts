import type { Edge, Node } from '@xyflow/react';
import { data } from './data';
import type { MachineNodeData } from './graph';
import type { GroupNode } from './model/types';

/** Room an area keeps round the cards in it, and above them for its name. */
const PAD = 20;
const TOP = 40;
/** The least an area's edge may keep from the cards in it, and the gap left between two areas that met. */
const TIGHT = 6;
const GAP = 6;
/** One colour for each area in turn. */
const COLORS = ['#fa9549', '#4fa8e6', '#7ac36a', '#c47be0', '#e6c84f', '#e66a6a', '#4fd1c5'];

/**
 * The product chains of a floor: every machine that takes two things made by other machines (a Rotor takes rods and
 * screws) with all the machines that work only towards it, by the machine they work towards. A machine that feeds two
 * such products belongs to neither. The splitters and mergers whose belts all lead into one chain stand in it too.
 */
export function chains(nodes: Node[], edges: Edge[]): Map<string, string[]> {
  const machines = new Map<string, Node>();
  for (const n of nodes) {
    if (n.type !== 'machine') continue;
    const { use } = n.data as MachineNodeData;
    if (use.recipe.kind !== 'power') machines.set(n.id, n);
  }
  const logistic = new Set(nodes.filter((n) => n.type === 'logistic').map((n) => n.id));
  const outL = new Map<string, string[]>();
  const inL = new Map<string, string[]>();
  for (const e of edges) {
    outL.set(e.source, [...(outL.get(e.source) ?? []), e.target]);
    inL.set(e.target, [...(inL.get(e.target) ?? []), e.source]);
  }
  // The machines at the far end of a card's belts, through any splitters and mergers between.
  const reach = (id: string, next: Map<string, string[]>): string[] => {
    const found = new Set<string>();
    const seen = new Set<string>();
    const go = (at: string) => {
      for (const to of next.get(at) ?? []) {
        if (seen.has(to)) continue;
        seen.add(to);
        if (machines.has(to)) found.add(to);
        else if (logistic.has(to)) go(to);
      }
    };
    go(id);
    return [...found];
  };
  const assembly = (id: string) => reach(id, inL).length >= 2;
  const owner = new Map<string, string | undefined>();
  const ownerOf = (id: string, path = new Set<string>()): string | undefined => {
    if (owner.has(id)) return owner.get(id);
    if (assembly(id)) {
      owner.set(id, id);
      return id;
    }
    if (path.has(id)) return undefined;
    path.add(id);
    const to = reach(id, outL).map((t) => ownerOf(t, path));
    path.delete(id);
    const one = to.length > 0 && to.every((o) => o !== undefined && o === to[0]) ? to[0] : undefined;
    owner.set(id, one);
    return one;
  };
  const members = new Map<string, string[]>();
  for (const id of machines.keys()) {
    const o = ownerOf(id);
    if (o) members.set(o, [...(members.get(o) ?? []), id]);
  }
  for (const [root, ids] of members) if (ids.length < 2) members.delete(root);
  // A splitter or merger goes with the chain all its belts lead into, and with a chain only.
  const chainOf = new Map([...members].flatMap(([root, ids]) => ids.map((id) => [id, root] as const)));
  for (let again = true; again; ) {
    again = false;
    for (const id of logistic) {
      if (chainOf.has(id)) continue;
      const to = (outL.get(id) ?? []).map((t) => chainOf.get(t));
      if (to.length === 0 || to.some((c) => c === undefined || c !== to[0])) continue;
      chainOf.set(id, to[0]!);
      members.get(to[0]!)!.push(id);
      again = true;
    }
  }
  return members;
}

/** The Auto floor's own areas: a box round each product chain's machines, named for the product. */
export function autoAreas(nodes: Node[], edges: Edge[]): GroupNode[] {
  const members = chains(nodes, edges);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const machines = new Map(nodes.filter((n) => n.type === 'machine').map((n) => [n.id, n]));
  const areas: GroupNode[] = [];
  for (const [root, ids] of members) {
    if (ids.length < 2) continue;
    const boxes = ids.map((id) => byId.get(id)!);
    const x0 = Math.min(...boxes.map((n) => n.position.x));
    const y0 = Math.min(...boxes.map((n) => n.position.y));
    const x1 = Math.max(...boxes.map((n) => n.position.x + (n.width ?? 0)));
    const y1 = Math.max(...boxes.map((n) => n.position.y + (n.height ?? 0)));
    const item = (machines.get(root)!.data as MachineNodeData).use.recipe.outputs[0]?.item;
    areas.push({
      id: `auto:${root}`,
      k: 'group',
      x: x0 - PAD,
      y: y0 - TOP,
      // Wide enough for its name.
      w: Math.max(x1 - x0 + 2 * PAD, 100 + 14 * (data.items[item ?? '']?.name.length ?? 0)),
      h: y1 - y0 + TOP + PAD,
      color: COLORS[areas.length % COLORS.length],
      ...(item ? { label: data.items[item]?.name, icon: item } : {}),
    });
  }
  // Where the layout has left another product's machines inside, the area would claim them: it is left out.
  const clean = areas.filter((a) => {
    const mine = new Set(members.get(a.id.slice('auto:'.length)));
    return [...machines.values()].every((n) => {
      if (mine.has(n.id)) return true;
      const w = n.width ?? 0;
      const h = n.height ?? 0;
      const x = Math.min(a.x + a.w, n.position.x + w) - Math.max(a.x, n.position.x);
      const y = Math.min(a.y + a.h, n.position.y + h) - Math.max(a.y, n.position.y);
      return !(x > w / 2 && y > h / 2);
    });
  });
  return apart(clean, new Map(clean.map((a) => [a.id, { l: PAD, t: TOP, r: PAD, b: PAD }])));
}

type Room = { l: number; t: number; r: number; b: number };

/** Areas whose edges met are drawn back from each other, each giving up what room it can spare round its cards. */
function apart(areas: GroupNode[], room: Map<string, Room>): GroupNode[] {
  const list = areas.map((a) => ({ ...a }));
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const [a, b] = [list[i], list[j]];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox <= 0 || oy <= 0) continue;
      const sideways = ox < oy;
      const [first, second] = (sideways ? a.x <= b.x : a.y <= b.y) ? [a, b] : [b, a];
      const [ra, rb] = [room.get(first.id)!, room.get(second.id)!];
      // The first gives up its far edge, the second its near edge.
      const spare = [Math.max(0, (sideways ? ra.r : ra.b) - TIGHT), Math.max(0, (sideways ? rb.l : rb.t) - TIGHT)];
      const need = (sideways ? ox : oy) + GAP;
      // The first gives what it can; a later area keeps the room for its name as far as it may.
      const takeA = Math.min(spare[0], need);
      const takeB2 = Math.min(spare[1], need - takeA);
      if (sideways) {
        first.w -= takeA;
        second.x += takeB2;
        second.w -= takeB2;
      } else {
        first.h -= takeA;
        second.y += takeB2;
        second.h -= takeB2;
      }
    }
  return list;
}
