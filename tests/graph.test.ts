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
