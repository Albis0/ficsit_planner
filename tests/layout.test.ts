import { beforeAll, expect, test } from 'bun:test';
import type { Edge, Node } from '@xyflow/react';
import loadHighs, { type Highs } from 'highs';
import { data } from '../src/lib/data';
import { testEngine } from './helpers/elk';
import { buildGraph, type FlowEdgeData, type Port } from '../src/lib/graph';
import { type Engine, type Floor, fewestCrossings, gridLayout, layoutGraph, routesOf } from '../src/lib/layout';
import { latestOnly } from '../src/lib/layoutClient';
import { countCrossings, edgePath } from '../src/lib/routes';
import { solve } from '../src/lib/solver';

let highs: Highs;
beforeAll(async () => {
  highs = await loadHighs();
});

const standard = () => new Set(data.recipes.filter((x) => x.kind === 'standard').map((x) => x.id));
const plan = (targets: { item: string; rate: number }[]) =>
  solve(highs, { targets, supplies: [], enabledRecipes: standard(), resourceCaps: {}, objective: 'resources' });
const frames = () =>
  buildGraph(
    plan([
      { item: 'Desc_ModularFrame_C', rate: 30 },
      { item: 'Desc_Plastic_C', rate: 20 },
    ]),
    9,
  );

function expectNoOverlap(nodes: Node[]) {
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const [a, b] = [nodes[i], nodes[j]];
      const apart =
        a.position.x + a.width! <= b.position.x + 0.5 ||
        b.position.x + b.width! <= a.position.x + 0.5 ||
        a.position.y + a.height! <= b.position.y + 0.5 ||
        b.position.y + b.height! <= a.position.y + 0.5;
      expect(apart, `${a.id} overlaps ${b.id}`).toBe(true);
    }
}

/** Every route starts at its source's handle on the outflow side and ends at its target's handle on the inflow side. */
function expectRoutesOnHandles(floor: Floor) {
  const byId = new Map(floor.nodes.map((n) => [n.id, n]));
  const at = (n: Node, handle: string) => {
    const h = n.handles!.find((x) => x.id === handle)!;
    return { x: n.position.x + h.x + h.width / 2, y: n.position.y + h.y + h.height / 2 };
  };
  for (const e of floor.edges) {
    const route = (e.data as FlowEdgeData).route!;
    expect(route, `${e.id} has a route`).toBeDefined();
    const src = byId.get(e.source)!;
    const dst = byId.get(e.target)!;
    const start = route.points[0];
    const end = route.points.at(-1)!;
    const out = at(src, e.sourceHandle!);
    const into = at(dst, e.targetHandle!);
    if (floor.dir === 'LR') {
      expect(Math.abs(start.x - (src.position.x + src.width!))).toBeLessThan(1.5);
      expect(Math.abs(start.y - out.y)).toBeLessThan(1.5);
      expect(Math.abs(end.x - dst.position.x)).toBeLessThan(1.5);
      expect(Math.abs(end.y - into.y)).toBeLessThan(1.5);
    } else {
      expect(Math.abs(start.y - (src.position.y + src.height!))).toBeLessThan(1.5);
      expect(Math.abs(start.x - out.x)).toBeLessThan(1.5);
      expect(Math.abs(end.y - dst.position.y)).toBeLessThan(1.5);
      expect(Math.abs(end.x - into.x)).toBeLessThan(1.5);
    }
  }
}

test('left to right: cards apart, every belt from its own output handle to its own input handle', async () => {
  const floor = await layoutGraph(frames(), { dir: 'LR', effort: 'fast' }, testEngine);
  expect(floor.dir).toBe('LR');
  expectNoOverlap(floor.nodes);
  expectRoutesOnHandles(floor);
});

test('top to bottom: the same, and every belt runs downwards overall', async () => {
  const floor = await layoutGraph(frames(), { dir: 'TB', effort: 'fast' }, testEngine);
  expectNoOverlap(floor.nodes);
  expectRoutesOnHandles(floor);
  const byId = new Map(floor.nodes.map((n) => [n.id, n]));
  for (const e of floor.edges) expect(byId.get(e.target)!.position.y).toBeGreaterThan(byId.get(e.source)!.position.y);
});

test('each card has one port per belt end, inputs and outputs on their own sides', async () => {
  const floor = await layoutGraph(frames(), { dir: 'LR', effort: 'fast' }, testEngine);
  for (const n of floor.nodes) {
    const ports = (n.data as { ports?: Port[] }).ports ?? [];
    const ins = floor.edges.filter((e) => e.target === n.id).map((e) => e.targetHandle!);
    const outs = floor.edges.filter((e) => e.source === n.id).map((e) => e.sourceHandle!);
    expect(
      ports
        .filter((p) => p.type === 'target')
        .map((p) => p.id)
        .sort(),
    ).toEqual(ins.sort());
    expect(
      ports
        .filter((p) => p.type === 'source')
        .map((p) => p.id)
        .sort(),
    ).toEqual(outs.sort());
    for (const h of n.handles!) expect(h.position).toBe(h.type === 'target' ? 'left' : 'right');
  }
});

test('ports stay on the card side, even for a big line with many belts', async () => {
  const graph = buildGraph(plan([{ item: 'Desc_IronPlate_C', rate: 1200 }]), 9, { splitLines: 'each' });
  const floor = await layoutGraph(graph, { dir: 'LR', effort: 'fast' }, testEngine);
  for (const n of floor.nodes)
    for (const p of (n.data as { ports?: Port[] }).ports ?? []) {
      expect(p.offset).toBeGreaterThanOrEqual(0);
      expect(p.offset).toBeLessThanOrEqual(n.height!);
    }
});

test('without a fixed direction, a tall screen gets top to bottom and a wide one left to right', async () => {
  const graph = buildGraph(plan([{ item: 'Desc_SpaceElevatorPart_1_C', rate: 5 }]), 9);
  expect((await layoutGraph(graph, { box: { width: 400, height: 900 }, effort: 'fast' }, testEngine)).dir).toBe('TB');
  expect((await layoutGraph(graph, { box: { width: 1600, height: 500 }, effort: 'fast' }, testEngine)).dir).toBe('LR');
});

test('more effort never means more crossings, and the same plan lays out the same way twice', async () => {
  const graph = buildGraph(plan([{ item: 'Desc_ModularFrameHeavy_C', rate: 5 }]), 9);
  const fast = await layoutGraph(graph, { dir: 'LR', effort: 'fast' }, testEngine);
  const thorough = await layoutGraph(graph, { dir: 'LR', effort: 'thorough' }, testEngine);
  expect(countCrossings(routesOf(thorough))).toBeLessThanOrEqual(countCrossings(routesOf(fast)));
  const again = await layoutGraph(graph, { dir: 'LR', effort: 'thorough' }, testEngine);
  expect(again.nodes.map((n) => n.position)).toEqual(thorough.nodes.map((n) => n.position));
});

test('laying out leaves the built graph alone, so it can be laid out again', async () => {
  const graph = frames();
  const before = JSON.stringify(graph);
  await layoutGraph(graph, { dir: 'LR', effort: 'fast' }, testEngine);
  expect(JSON.stringify(graph)).toBe(before);
});

test('single node, no edges: a plan with no belts still lays out', async () => {
  const lone: Node = { id: 'only', type: 'machine', position: { x: 0, y: 0 }, width: 310, height: 130, data: {} };
  const floor = await layoutGraph({ nodes: [lone], edges: [] as Edge[] }, { effort: 'fast' }, testEngine);
  expect(floor.nodes).toHaveLength(1);
  expect(Number.isFinite(floor.nodes[0].position.x)).toBe(true);
});

test('the plain grid fallback keeps cards apart and gives every belt its handles', () => {
  const floor = gridLayout(frames(), 'LR');
  expectNoOverlap(floor.nodes);
  const ids = new Set(floor.nodes.flatMap((n) => n.handles!.map((h) => h.id)));
  for (const e of floor.edges) expect(ids.has(e.sourceHandle!) && ids.has(e.targetHandle!)).toBe(true);
});

test('latest wins: an older layout finishing late is dropped', async () => {
  const take = latestOnly<string>();
  let finishOld!: (v: string) => void;
  let oldStale: () => boolean = () => false;
  const old = take((isStale) => {
    oldStale = isStale;
    return new Promise<string>((r) => (finishOld = r));
  });
  expect(oldStale()).toBe(false);
  const fresh = take(() => Promise.resolve('new'));
  expect(oldStale()).toBe(true);
  finishOld('old');
  expect(await fresh).toBe('new');
  expect(await old).toBeUndefined();
});

test('route is dropped for moved nodes: the belt falls back to a curve', () => {
  const route = {
    points: [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
    ],
    label: { x: 25, y: 0 },
    from: { x: 0, y: 0 },
    to: { x: 60, y: 0 },
    routing: 'POLYLINE' as const,
  };
  const end = { at: { x: 7, y: 7 }, dir: { x: 0, y: 1 } };
  const fallback = (): [string, number, number, typeof end] => ['curve', 1, 2, end];
  expect(edgePath(route, { x: 0, y: 0 }, { x: 60, y: 0 }, fallback)).toEqual([
    'M0,0 L50,0',
    25,
    0,
    { at: { x: 50, y: 0 }, dir: { x: 1, y: 0 } },
  ]);
  expect(edgePath(route, { x: 0, y: 0 }, { x: 90, y: 40 }, fallback)).toEqual(['curve', 1, 2, end]);
  expect(edgePath(undefined, undefined, undefined, fallback)).toEqual(['curve', 1, 2, end]);
});

test('every belt label sits in the gap between the machines it joins, with room kept for it', async () => {
  const floor = await layoutGraph(frames(), { dir: 'LR', effort: 'fast' }, testEngine);
  const byId = new Map(floor.nodes.map((n) => [n.id, n]));
  for (const e of floor.edges) {
    const { label } = (e.data as FlowEdgeData).route!;
    const src = byId.get(e.source)!;
    const dst = byId.get(e.target)!;
    expect(label.x - 88).toBeGreaterThanOrEqual(src.position.x + src.width!);
    expect(label.x + 88).toBeLessThanOrEqual(dst.position.x);
  }
});

test('a very big floor is laid out once per direction, whatever the effort', async () => {
  const chain = Array.from({ length: 250 }, (_, i): Node => ({ id: `n${i}`, position: { x: 0, y: 0 }, width: 100, height: 60, data: {} }));
  const links = chain
    .slice(1)
    .map((n, i): Edge => ({ id: `e${i}`, source: `n${i}`, target: n.id, sourceHandle: `e${i}:out`, targetHandle: `e${i}:in` }));
  let runs = 0;
  const counted: Engine = (g) => {
    runs++;
    return testEngine(g);
  };
  await layoutGraph({ nodes: chain, edges: links }, { dir: 'LR', effort: 'thorough' }, counted);
  expect(runs).toBe(1);
});

test('a card with many belts on one side grows so its belts stay apart', async () => {
  // One ore card feeding 30 smelters, one belt each: too many for either side of it.
  const ore: Node = { id: 'raw:Desc_OreIron_C', position: { x: 0, y: 0 }, width: 330, height: 100, data: {} };
  const smelters = Array.from(
    { length: 30 },
    (_, i): Node => ({ id: `s${i}`, position: { x: 0, y: 0 }, width: 310, height: 130, data: {} }),
  );
  const belts = smelters.map(
    (n, i): Edge => ({ id: `b${i}`, source: ore.id, target: n.id, sourceHandle: `b${i}:out`, targetHandle: `b${i}:in` }),
  );
  const graph = { nodes: [ore, ...smelters], edges: belts };
  for (const dir of ['LR', 'TB'] as const) {
    const floor = await layoutGraph(graph, { dir, effort: 'fast' }, testEngine);
    for (const n of floor.nodes) {
      const ports = (n.data as { ports?: Port[]; side?: number }).ports ?? [];
      const side = dir === 'LR' ? n.height! : n.width!;
      for (const type of ['source', 'target'] as const) {
        const offsets = ports
          .filter((p) => p.type === type)
          .map((p) => p.offset)
          .sort((a, b) => a - b);
        for (let i = 1; i < offsets.length; i++) expect(offsets[i] - offsets[i - 1], `${n.id} ${dir}`).toBeGreaterThanOrEqual(12);
        for (const o of offsets) expect(o).toBeLessThanOrEqual(side);
      }
    }
    // The ore card feeding 30 smelters is the one that has to grow, and says so for the stylesheet.
    const grown = floor.nodes.find((n) => n.id === ore.id)!;
    expect((grown.data as { side?: number }).side).toBe(dir === 'LR' ? grown.height : grown.width);
  }
});

test('with one arrangement to choose from, crossings are not counted at all', () => {
  const only = {
    floor: {
      dir: 'LR' as const,
      nodes: [],
      get edges(): Edge[] {
        throw new Error('counted');
      },
    },
  };
  expect(fewestCrossings([only])).toBe(only);
});
