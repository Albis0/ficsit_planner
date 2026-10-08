import { describe, expect, test } from 'bun:test';
import { cleanPlan } from '../src/lib/sanitize';
import { poolShare } from '../src/lib/overview';
import type { SolveResult } from '../src/lib/solver';
import { makeFromLeftover, newPlan, togglePooled } from '../src/store';
import { recipesTaking } from '../src/components/SurplusMake';
import { data } from '../src/lib/data';

const HOR = 'Desc_HeavyOilResidue_C';
const FUEL = 'Desc_LiquidFuel_C';
const RESIDUAL = 'Recipe_ResidualFuel_C';

const plan = () => {
  const p = newPlan('A');
  return { ...p, targets: [{ item: 'Desc_Plastic_C', rate: 60 }] };
};

describe('making something from a leftover', () => {
  test('the recipe, its product for as much as the leftover makes, and the pool, in one step', () => {
    const p = plan();
    const patch = makeFromLeftover(RESIDUAL, HOR, 30)(p);
    const r = data.recipes.find((x) => x.id === RESIDUAL)!;
    const taken = r.inputs.find((s) => s.item === HOR)!;
    const made = r.outputs.find((s) => s.item === FUEL)!;
    const want = Math.floor(((30 * made.rate) / taken.rate) * 100) / 100;
    expect(patch.targets).toEqual([...p.targets, { item: FUEL, rate: want }]);
    expect(patch.pooled).toEqual([FUEL]);
    expect(patch.enabled).toContain(RESIDUAL);
  });

  test('a product already on the targets gets the amount added, and is not listed twice', () => {
    const p = { ...plan(), targets: [{ item: FUEL, rate: 10 }], pooled: [FUEL] };
    const patch = makeFromLeftover(RESIDUAL, HOR, 30)(p);
    expect(patch.targets).toHaveLength(1);
    expect(patch.targets?.[0].rate).toBeGreaterThan(10);
    expect(patch.pooled).toEqual([FUEL]);
  });

  test('nothing changes for a recipe that does not take the leftover, or for none of it', () => {
    expect(makeFromLeftover('Recipe_IronPlate_C', HOR, 30)(plan())).toEqual({});
    expect(makeFromLeftover(RESIDUAL, HOR, 0)(plan())).toEqual({});
  });

  test('the menu lists recipes that are on, standard ones first, and never one that only gives the item back', () => {
    const on = new Set(data.recipes.map((r) => r.id));
    const list = recipesTaking(HOR, on, 9);
    expect(list.map((r) => r.id)).toContain(RESIDUAL);
    expect(list.every((r) => r.inputs.some((s) => s.item === HOR))).toBe(true);
    const firstAlt = list.findIndex((r) => r.kind !== 'standard');
    expect(firstAlt < 0 || list.slice(firstAlt).every((r) => r.kind !== 'standard')).toBe(true);
    // Turned off, it is not offered.
    expect(recipesTaking(HOR, new Set(), 9)).toEqual([]);
  });
});

describe('offering a product to the pool', () => {
  const result = (over: Partial<SolveResult>) => ({ targets: [], surplus: [], supplies: [], ...over }) as unknown as SolveResult;

  test('toggling puts the product in and takes it out', () => {
    const p = plan();
    expect(togglePooled('Desc_Plastic_C')(p).pooled).toEqual(['Desc_Plastic_C']);
    expect(togglePooled('Desc_Plastic_C')({ ...p, pooled: ['Desc_Plastic_C'] }).pooled).toBeUndefined();
  });

  test('the pool gets the leftover and the products offered to it, not the ones that are not', () => {
    const r = result({
      surplus: [{ item: HOR, rate: 30 }],
      targets: [
        { item: FUEL, rate: 20 },
        { item: 'Desc_Plastic_C', rate: 60 },
      ],
    });
    expect(poolShare({ result: r, pooled: [FUEL] })).toEqual([
      { item: HOR, rate: 30 },
      { item: FUEL, rate: 20 },
    ]);
    expect(poolShare({ result: r })).toEqual([{ item: HOR, rate: 30 }]);
    expect(poolShare({})).toEqual([]);
  });

  test('saved plans keep only offered products that are still targets', () => {
    const base = plan();
    const saved = cleanPlan({ ...base, targets: [{ item: FUEL, rate: 5 }], pooled: [FUEL, 'Desc_Gone_C', 3] }, base);
    expect(saved.pooled).toEqual([FUEL]);
    expect(cleanPlan({ ...base, pooled: [] }, base).pooled).toBeUndefined();
  });
});
