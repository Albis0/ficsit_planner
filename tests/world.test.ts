import { expect, test } from 'bun:test';
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
  expect(cleanMapFilter(undefined)).toEqual({ hidden: [], purities: [0, 1, 2] });
  expect(cleanMapFilter({ hidden: ['Desc_Coal_C', 'nope', 3, 'Desc_Coal_C'], purities: [2, 5, 0, 2] })).toEqual({
    hidden: ['Desc_Coal_C'],
    purities: [0, 2],
  });
});
