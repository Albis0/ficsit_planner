import { expect, test } from 'bun:test';
import loadHighs from 'highs';
import { calcModel } from '../src/lib/model/calc';
import { emptyModel, type Model } from '../src/lib/model/types';

// A pump into three refineries; the first Plastic makes twice the plastic its canister line can use, so it can't run.
const nodes = [
  { id: '1', x: 0, y: 0, k: 'extract', extractor: 'Build_OilPump_C', item: 'Desc_LiquidOil_C', purity: 'pure', clock: 1.25 },
  { id: '2', x: 0, y: 0, k: 'logistic', kind: 'junction' },
  { id: '4', x: 0, y: 0, k: 'machine', recipe: 'Recipe_Rubber_C', n: 4 },
  { id: '7', x: 0, y: 0, k: 'machine', recipe: 'Recipe_Plastic_C', n: 5 },
  { id: '9', x: 0, y: 0, k: 'machine', recipe: 'Recipe_Plastic_C' },
  { id: 'b', x: 0, y: 0, k: 'out', item: 'Desc_Rubber_C' },
  { id: 'd', x: 0, y: 0, k: 'out', item: 'Desc_Plastic_C' },
  { id: 'n', x: 0, y: 0, k: 'machine', recipe: 'Recipe_FluidCanister_C', auto: true },
  { id: 'p', x: 0, y: 0, k: 'machine', recipe: 'Recipe_ResidualFuel_C', auto: true },
  { id: 'r', x: 0, y: 0, k: 'machine', recipe: 'Recipe_Fuel_C', auto: true },
  { id: 'w', x: 0, y: 0, k: 'out', item: 'Desc_Fuel_C' },
];
const links = [
  ['3', '1', 0, '2', 0],
  ['6', '2', 1, '4', 0],
  ['8', '2', 2, '7', 0],
  ['a', '2', 0, '9', 0],
  ['c', '4', 0, 'b', 0],
  ['e', '7', 0, 'd', 0],
  ['o', '9', 0, 'n', 0],
  ['q', '9', 1, 'p', 0],
  ['s', 'n', 0, 'r', 1],
  ['t', 'p', 0, 'r', 0],
  ['x', 'r', 0, 'w', 0],
].map(([id, a, ap, b, bp]) => ({ id, a, ap, b, bp }));

test('a machine whose outputs can not be taken says so, and the pump keeps what it is set to', async () => {
  const highs = await loadHighs();
  const r = calcModel(highs, { ...emptyModel(), nodes, links } as unknown as Model, 9);
  expect(r.nodes['9'].status).toBe('blocked');
  // The machines that size themselves just follow it: nothing to flag on them.
  expect(r.nodes.n.status).toBe('idle');
  expect(r.nodes['4'].status).toBe('full');
  expect(r.nodes['1'].status).toBe('partial');
  expect(r.nodes['1'].outs[0]).toBeCloseTo(270, 3);
  expect(r.nodes['1'].unused).toBeCloseTo(30, 3);
});
