import { expect, test } from 'bun:test';
import { reachableRaw } from '../src/lib/solution';
import { defaultEnabled } from '../src/store';

const standard = new Set(defaultEnabled());

test('a plan counts only the resources its goals are made from', () => {
  expect([...reachableRaw(['Desc_IronPlate_C'], standard)]).toEqual(['Desc_OreIron_C']);
  const fuel = reachableRaw(['Desc_LiquidFuel_C'], standard);
  expect(fuel.has('Desc_LiquidOil_C')).toBe(true);
  expect(fuel.has('Desc_OreIron_C')).toBe(false);
});

test('coal generators need their water too', () => {
  const coal = reachableRaw(['Desc_Coal_C', 'Desc_Water_C'], standard);
  expect([...coal].sort()).toEqual(['Desc_Coal_C', 'Desc_Water_C']);
});
