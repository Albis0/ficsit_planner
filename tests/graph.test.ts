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
