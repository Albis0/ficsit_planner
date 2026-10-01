import { beforeAll, expect, test } from 'bun:test';
import loadHighs, { type Highs } from 'highs';
import { data } from '../src/lib/data';
import { buildGraph, type FlowEdgeData, type MachineNodeData } from '../src/lib/graph';
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

test('splitting for a belt tier: lines become groups of whole machines whose every belt fits', () => {
  const r = solve(highs, {
    targets: [
      { item: 'Desc_ModularFrame_C', rate: 30 },
      { item: 'Desc_Plastic_C', rate: 120 },
    ],
    supplies: [],
    enabledRecipes: new Set(data.recipes.filter((x) => x.kind === 'standard').map((x) => x.id)),
    resourceCaps: {},
    objective: 'resources',
  });
  const whole = buildGraph(r, 9);
  const { nodes, edges } = buildGraph(r, 9, { split: { belt: 60, pipe: 300 } });
  const machines = nodes.filter((n) => n.type === 'machine');
  const grouped = machines.filter((n) => (n.data as MachineNodeData).group);
  expect(grouped.length).toBeGreaterThan(0);

  // Each line's groups place exactly the line's machines.
  for (const u of r.recipes) {
    const mine = machines.filter((n) => n.id === `recipe:${u.recipe.id}` || n.id.startsWith(`recipe:${u.recipe.id}#`));
    const uses = mine.map((n) => (n.data as MachineNodeData).use);
    expect(uses.reduce((s, g) => s + g.built, 0)).toBe(u.built);
    expect(uses.reduce((s, g) => s + g.count, 0)).toBeCloseTo(u.count, 6);
    expect(uses.reduce((s, g) => s + g.sloops, 0)).toBe(u.sloops);
    expect(uses.flatMap((g) => g.clocks)).toEqual(u.clocks);
  }

  // Every belt into or out of a group fits on one Mk.1 belt or pipe.
  const ids = new Set(grouped.map((n) => n.id));
  for (const e of edges.filter((e) => e.type === 'flow' && (ids.has(e.source) || ids.has(e.target)))) {
    const d = e.data as FlowEdgeData;
    expect(d.rate).toBeLessThanOrEqual((data.items[d.item].form === 'solid' ? 60 : 300) + 1e-6);
  }

  // Nothing is lost on the way: each item moves as much as before the split.
  const moved = (es: typeof edges) => {
    const m = new Map<string, number>();
    for (const e of es.filter((e) => e.type === 'flow')) {
      const d = e.data as FlowEdgeData;
      m.set(d.item, (m.get(d.item) ?? 0) + d.rate);
    }
    return m;
  };
  const before = moved(whole.edges);
  for (const [item, rate] of moved(edges)) expect(rate).toBeCloseTo(before.get(item)!, 4);
});
