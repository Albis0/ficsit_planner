import { beforeAll, expect, test } from 'bun:test';
import loadHighs, { type Highs } from 'highs';
import { data } from '../src/lib/data';
import { buildGraph } from '../src/lib/graph';
import { layoutGraph } from '../src/lib/layout';
import { solve } from '../src/lib/solver';
import { testEngine } from './helpers/elk';

let highs: Highs;
beforeAll(async () => {
  highs = await loadHighs();
});

test('every belt has its own handle at each end: outputs on the right, inputs on the left', async () => {
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
  const { nodes, edges } = await layoutGraph(buildGraph(r, 9), { dir: 'LR', effort: 'fast' }, testEngine);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const e of edges) {
    expect(e.sourceHandle).toBe(`${e.id}:out`);
    expect(e.targetHandle).toBe(`${e.id}:in`);
    const src = byId.get(e.source)!.handles!.find((h) => h.id === e.sourceHandle);
    const dst = byId.get(e.target)!.handles!.find((h) => h.id === e.targetHandle);
    expect(src?.type).toBe('source');
    expect(src?.position).toBe('right');
    expect(dst?.type).toBe('target');
    expect(dst?.position).toBe('left');
  }
  // One handle per belt end, no spares.
  const ends = edges.length * 2;
  expect(nodes.reduce((s, n) => s + n.handles!.length, 0)).toBe(ends);
  // Handles stay on the card, spread along its side.
  for (const n of nodes) for (const h of n.handles!) expect(h.y + h.height / 2).toBeGreaterThan(0);
  for (const n of nodes) for (const h of n.handles!) expect(h.y + h.height / 2).toBeLessThan(n.height!);
});
