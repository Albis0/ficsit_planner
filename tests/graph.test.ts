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
    targets: [{ item: 'Desc_ModularFrame_C', rate: 30 }, { item: 'Desc_Plastic_C', rate: 20 }],
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
