import { expect, test } from 'bun:test';
import codex from '../src/data/codex.json';
import { data } from '../src/lib/data';
import { cleanMapFilter, MAP_GROUPS, MAP_SIZE, NODES, purityCounts, WELLS } from '../src/lib/world';

test('the world has the nodes the game has', () => {
  // Counts from the game's own level (1.2.4): nodes, well satellites and geysers.
  expect(NODES.filter((n) => n.kind === 'node')).toHaveLength(459);
  expect(NODES.filter((n) => n.kind === 'well')).toHaveLength(118);
  expect(NODES.filter((n) => n.kind === 'geyser')).toHaveLength(31);
  expect(WELLS).toHaveLength(17);
  expect(purityCounts('Desc_OreIron_C')).toEqual([39, 42, 46]);
  expect(purityCounts('Desc_Geyser_C')).toEqual([9, 13, 9]);
});

test('every node is a known resource, on the picture', () => {
  for (const n of NODES) {
    if (n.kind !== 'geyser') expect(data.items[n.item]?.raw).toBe(true);
    expect(n.x).toBeGreaterThan(0);
    expect(n.x).toBeLessThan(MAP_SIZE);
    expect(n.y).toBeGreaterThan(0);
    expect(n.y).toBeLessThan(MAP_SIZE);
    if (n.kind === 'well') expect(WELLS[n.well!]?.item).toBe(n.item);
  }
});

test('the filter lists every resource once', () => {
  const listed = MAP_GROUPS.flatMap((g) => g.items);
  expect(new Set(listed).size).toBe(listed.length);
  expect(new Set(listed)).toEqual(new Set(NODES.map((n) => n.item)));
});

test('a saved filter is cleaned', () => {
  expect(cleanMapFilter(undefined)).toEqual({ hidden: [], purities: [0, 1, 2], layers: [] });
  expect(
    cleanMapFilter({
      hidden: ['Desc_Coal_C', 'nope', 3, 'Desc_Coal_C'],
      purities: [2, 5, 0, 2],
      layers: ['slug1', 'x', 'Desc_HogBasic_C', 4],
    }),
  ).toEqual({
    hidden: ['Desc_Coal_C'],
    purities: [0, 2],
    layers: ['slug1', 'Desc_HogBasic_C'],
  });
});

test('the finds and creatures read from the level', async () => {
  const { loadWorld } = await import('../src/lib/finds');
  const w = await loadWorld();
  expect(w.finds.sloop).toHaveLength(106);
  expect(w.finds.sphere).toHaveLength(298);
  expect(w.finds.pod).toHaveLength(118);
  expect([w.finds.slug1.length, w.finds.slug2.length, w.finds.slug3.length]).toEqual([596, 389, 257]);
  for (const layer of Object.values(w.finds)) for (const [x, y] of layer) expect(x > 0 && x < MAP_SIZE && y > 0 && y < MAP_SIZE).toBe(true);
  for (const c of w.creatures) {
    expect(c.name.length).toBeGreaterThan(2);
    if (c.drop) expect(codex.items[c.drop as keyof typeof codex.items]).toBeDefined();
  }
  expect(w.creatures.every((c) => c.spawners > 0 && c.count >= c.spawners)).toBe(true);
});
