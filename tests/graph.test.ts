import { beforeAll, expect, test } from 'bun:test';
import loadHighs, { type Highs } from 'highs';
import { data } from '../src/lib/data';
import { buildGraph } from '../src/lib/graph';
import { solve } from '../src/lib/solver';

let highs: Highs;
beforeAll(async () => {
  highs = await loadHighs();
});

test('every node declares a left input and a right output, so belts never enter from the top', () => {
  const r = solve(highs, {
    targets: [
      { item: 'Desc_ModularFrame_C', rate: 30 },
      { item: 'Desc_Plastic_C', rate: 20 },
    ],
    supplies: [],
    enabledRecipes: new Set(data.recipes.filter((x) => x.kind === 'standard').map((x) => x.id)),
    resourceCaps: {},
    objective: 'resources',
  });
  const { nodes, edges } = buildGraph(r, 9);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const e of edges) {
    const src = byId.get(e.source)!.handles!.find((h) => h.type === 'source');
    const dst = byId.get(e.target)!.handles!.find((h) => h.type === 'target');
    expect(src?.position).toBe('right');
    expect(dst?.position).toBe('left');
    expect(dst!.x).toBeLessThan(0);
  }
  expect(nodes.some((n) => n.id === 'target:Desc_ModularFrame_C')).toBe(true);
});

test('top to bottom: inputs on top, outputs below', () => {
  const r = solve(highs, {
    targets: [{ item: 'Desc_IronPlateReinforced_C', rate: 5 }],
    supplies: [],
    enabledRecipes: new Set(data.recipes.filter((x) => x.kind === 'standard').map((x) => x.id)),
    resourceCaps: {},
    objective: 'resources',
  });
  const { nodes, edges } = buildGraph(r, 9, { dir: 'TB' });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const e of edges) {
    const src = byId.get(e.source)!;
    const dst = byId.get(e.target)!;
    expect(src.handles!.find((h) => h.type === 'source')?.position).toBe('bottom');
    expect(dst.handles!.find((h) => h.type === 'target')?.position).toBe('top');
    expect(dst.position.y).toBeGreaterThan(src.position.y);
  }
});

test('without a fixed direction, a tall screen gets top to bottom and a wide one left to right', () => {
  const r = solve(highs, {
    targets: [{ item: 'Desc_SpaceElevatorPart_1_C', rate: 5 }],
    supplies: [],
    enabledRecipes: new Set(data.recipes.filter((x) => x.kind === 'standard').map((x) => x.id)),
    resourceCaps: {},
    objective: 'resources',
  });
  expect(buildGraph(r, 9, { box: { width: 400, height: 900 } }).dir).toBe('TB');
  expect(buildGraph(r, 9, { box: { width: 1600, height: 500 } }).dir).toBe('LR');
});

test('with splitters shown, a belt feeds one place per end and a splitter or merger hands out three at most', () => {
  const all = new Set(data.recipes.filter((x) => x.kind === 'standard').map((x) => x.id));
  for (const [item, rate] of [
    ['Desc_Motor_C', 10],
    ['Desc_Computer_C', 5],
    ['Desc_Plastic_C', 60],
    ['Desc_ModularFrameHeavy_C', 4],
  ] as const) {
    const r = solve(highs, { targets: [{ item, rate }], supplies: [], enabledRecipes: all, resourceCaps: {}, objective: 'resources' });
    const plain = buildGraph(r, 9, { dir: 'LR' });
    const { nodes, edges } = buildGraph(r, 9, { dir: 'LR', splitters: true });
    const ids = new Set(nodes.map((n) => n.id));
    for (const e of edges) expect(ids.has(e.source) && ids.has(e.target)).toBe(true);
    expect(new Set(edges.map((e) => e.id)).size).toBe(edges.length);
    const kind = (id: string) => nodes.find((n) => n.id === id)?.type;
    const out = new Map<string, number>();
    const into = new Map<string, number>();
    for (const e of edges) {
      const item = (e.data as { item: string }).item;
      out.set(`${e.source}|${item}`, (out.get(`${e.source}|${item}`) ?? 0) + 1);
      into.set(`${e.target}|${item}`, (into.get(`${e.target}|${item}`) ?? 0) + 1);
    }
    for (const [key, n] of out) expect(n).toBeLessThanOrEqual(kind(key.split('|')[0]) === 'logistic' ? 3 : 1);
    for (const [key, n] of into) expect(n).toBeLessThanOrEqual(kind(key.split('|')[0]) === 'logistic' ? 3 : 1);
    // What goes into a splitter or merger comes out of it.
    for (const n of nodes.filter((x) => x.type === 'logistic')) {
      const rate = (list: typeof edges) => list.reduce((s, e) => s + (e.data as { rate: number }).rate, 0);
      expect(rate(edges.filter((e) => e.source === n.id))).toBeCloseTo(rate(edges.filter((e) => e.target === n.id)), 6);
    }
    // Machines and what they make are the same; only the logistics are new.
    expect(
      nodes
        .filter((n) => n.type !== 'logistic')
        .map((n) => n.id)
        .sort(),
    ).toEqual(plain.nodes.map((n) => n.id).sort());
    if (item === 'Desc_Motor_C') expect(nodes.some((n) => n.type === 'logistic')).toBe(true);
    expect(plain.nodes.some((n) => n.type === 'logistic')).toBe(false);
  }
});

test('with square belts every belt label sits on its route, and none covers a card or another label', () => {
  const r = solve(highs, {
    targets: [
      { item: 'Desc_Computer_C', rate: 20 },
      { item: 'Desc_Motor_C', rate: 30 },
    ],
    supplies: [],
    enabledRecipes: new Set(data.recipes.filter((x) => x.kind === 'standard').map((x) => x.id)),
    resourceCaps: {},
    objective: 'resources',
  });
  const { nodes, edges } = buildGraph(r, 9, { dir: 'LR', squareBelts: true });
  const spots = edges.map((e) => (e.data as { route?: { labelAt?: { x: number; y: number } } }).route?.labelAt);
  expect(spots.every(Boolean)).toBe(true);
  const box = (p: { x: number; y: number }) => ({ x: p.x - 75, y: p.y - 22, w: 150, h: 44 });
  const hit = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const labels = spots.map((p) => box(p!));
  let overCards = 0;
  for (const l of labels)
    for (const n of nodes) if (hit(l, { x: n.position.x, y: n.position.y, w: n.width ?? 0, h: n.height ?? 0 })) overCards++;
  let overLabels = 0;
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) if (hit(labels[i], labels[j])) overLabels++;
  // Short belts between neighbouring cards leave no clear spot; the rest must be clear.
  expect(overLabels).toBeLessThanOrEqual(Math.ceil(labels.length / 5));
  expect(overCards).toBeLessThanOrEqual(Math.ceil(labels.length / 5));
});

test('a belt running back against the flow goes round under the cards in square runs and is marked as a loop', () => {
  const r = solve(highs, {
    targets: [{ item: 'Desc_AluminumIngot_C', rate: 60 }],
    supplies: [],
    enabledRecipes: new Set(data.recipes.filter((x) => x.kind === 'standard').map((x) => x.id)),
    resourceCaps: {},
    objective: 'resources',
  });
  type Route = { loop?: { x: number; y: number }; square?: { x: number; y: number }[]; labelAt?: { x: number; y: number } };
  for (const dir of ['LR', 'TB'] as const) {
    const { nodes, edges } = buildGraph(r, 9, { dir });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const along = (id: string, end: 'out' | 'in') => {
      const n = byId.get(id)!;
      return dir === 'LR' ? n.position.x + (end === 'out' ? (n.width ?? 0) : 0) : n.position.y + (end === 'out' ? (n.height ?? 0) : 0);
    };
    const loops = edges.filter((e) => (e.data as { route?: Route }).route?.loop);
    // Water out of the scrap refinery back into the alumina one.
    expect(loops.length).toBeGreaterThan(0);
    for (const e of edges) {
      const back = along(e.target, 'in') <= along(e.source, 'out');
      expect(!!(e.data as { route?: Route }).route?.loop).toBe(back);
    }
    for (const e of loops) {
      const route = (e.data as { route: Route }).route;
      expect(route.square).toHaveLength(4);
      expect(route.labelAt).toBeDefined();
      // The run round the cards stays clear of every card in its way.
      const run = route.square!.slice(1, 3);
      const across = (p: { x: number; y: number }) => (dir === 'LR' ? p.y : p.x);
      const lo = Math.min(...run.map((p) => (dir === 'LR' ? p.x : p.y)));
      const hi = Math.max(...run.map((p) => (dir === 'LR' ? p.x : p.y)));
      for (const n of nodes) {
        const [u, v, du, dv] =
          dir === 'LR'
            ? [n.position.x, n.position.y, n.width ?? 0, n.height ?? 0]
            : [n.position.y, n.position.x, n.height ?? 0, n.width ?? 0];
        if (u >= hi || u + du <= lo) continue;
        const at = across(run[0]);
        expect(at <= v || at >= v + dv).toBe(true);
      }
    }
  }
});
