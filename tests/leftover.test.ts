import { describe, expect, test } from 'bun:test';
import { cleanPlan } from '../src/lib/sanitize';
import { poolShare } from '../src/lib/overview';
import type { SolveResult } from '../src/lib/solver';
import { addNode } from '../src/lib/model/ops';
import { emptyModel } from '../src/lib/model/types';
import { takesFromPool, POOL } from '../src/lib/pool';
import { dropSource, exportsOf, makeFromLeftover, newPlan, togglePooled } from '../src/store';
import { packsForSink, recipesTaking } from '../src/components/SurplusMake';
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

  test('a liquid leftover can be packed into a part the Sink takes, a solid one needs no packing', () => {
    const all = new Set(data.recipes.map((r) => r.id));
    const packing = recipesTaking(HOR, all, 9).filter((r) => packsForSink(r, HOR));
    expect(packing.map((r) => r.id)).toContain('Recipe_PackagedOilResidue_C');
    const patch = makeFromLeftover('Recipe_PackagedOilResidue_C', HOR, 30)(plan());
    expect(patch.targets).toContainEqual({ item: 'Desc_PackagedOilResidue_C', rate: 30 });
    expect(recipesTaking('Desc_IronPlate_C', all, 9).some((r) => packsForSink(r, 'Desc_IronPlate_C'))).toBe(false);
  });
});

describe('input cards on a hand-built floor that name their source', () => {
  const hand = (from?: string) => {
    const p = newPlan('Hand');
    const model = addNode(emptyModel(), { k: 'in', item: HOR, lim: 12, ...(from ? { from } : {}), x: 0, y: 0 }).model;
    return { ...p, floor: 'manual' as const, model };
  };

  test('a card from the pool counts as taking from the pool, one without a source does not', () => {
    expect(takesFromPool([hand(POOL)])).toEqual([[{ item: HOR, rate: 12 }]]);
    expect(takesFromPool([hand()])).toEqual([[]]);
  });

  test('a card from a factory is an export of that factory, for the card limit', () => {
    const other = newPlan('Other');
    const mine = hand(other.id);
    expect(exportsOf([other, mine], other.id)).toEqual([{ item: HOR, rate: 12, to: mine.id }]);
  });

  test('taking from a factory that is gone leaves the card as plain stock', () => {
    const other = newPlan('Other');
    const [kept] = dropSource([hand(other.id)], other.id);
    const card = kept.model?.nodes.find((n) => n.k === 'in');
    expect(card && 'from' in card).toBe(false);
    expect(dropSource([hand(POOL)], 'x')[0].model?.nodes.some((n) => n.k === 'in' && n.from === POOL)).toBe(true);
  });
});

describe('making something from the leftover of a line of its own', () => {
  const RUBBER = 'Desc_Rubber_C';
  const PLASTIC = 'Desc_Plastic_C';
  const own = () => ({
    ...newPlan('Lines'),
    targets: [
      { item: PLASTIC, rate: 100 },
      { item: RUBBER, rate: 100 },
    ],
    separate: [PLASTIC, RUBBER],
  });

  test('the line the leftover comes from stops being a line of its own, the other one stays', () => {
    const patch = makeFromLeftover(RESIDUAL, HOR, 50, [PLASTIC])(own());
    expect(patch.separate).toEqual([RUBBER]);
    expect(makeFromLeftover(RESIDUAL, HOR, 50, [PLASTIC, RUBBER])(own()).separate).toBeUndefined();
    // Without the line, nothing about the lines changes.
    expect('separate' in makeFromLeftover(RESIDUAL, HOR, 50)(own())).toBe(false);
  });

  test('what is made from it takes the leftover and no oil of its own', async () => {
    const { default: loadHighs } = await import('highs');
    const { solve, solveInLines } = await import('../src/lib/solver').then(async (m) => ({
      solve: m.solve,
      solveInLines: (await import('../src/lib/lines')).solveInLines,
    }));
    const highs = await loadHighs();
    const p = own();
    const patch = makeFromLeftover(RESIDUAL, HOR, 50, [PLASTIC])(p);
    const enabled = new Set(patch.enabled);
    const input = {
      targets: patch.targets ?? p.targets,
      supplies: [],
      enabledRecipes: enabled,
      resourceCaps: {},
      objective: 'resources' as const,
      lines: patch.separate ?? [],
    };
    const r = solveInLines((i) => solve(highs, i), input);
    const oil = r.raw.find((x) => x.item === 'Desc_LiquidOil_C')?.rate ?? 0;
    // 150 for the plastic, 150 for the rubber, none more for the fuel.
    expect(oil).toBeCloseTo(300, 3);
  });
});
