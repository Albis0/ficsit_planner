import { beforeAll, describe, expect, test } from 'bun:test';
import loadHighs, { type Highs } from 'highs';
import { data } from '../src/lib/data';
import { describeUse, NO_MOD, solve } from '../src/lib/solver';
import { type Flow, matchFlows, splitByDestination } from '../src/lib/split';

let highs: Highs;
beforeAll(async () => {
  highs = await loadHighs();
});

const recipe = (id: string) => data.recipes.find((r) => r.id === id)!;
const standard = () => new Set(data.recipes.filter((r) => r.kind === 'standard').map((r) => r.id));
const to = (from: string, item: string, rate: number, dest: string): Flow => ({
  from: `recipe:${from}`,
  to: `recipe:${dest}`,
  item,
  rate,
  dest: { kind: 'recipe', recipe: recipe(dest) },
});
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('split by destination', () => {
  test('4 smelters sending 73.55 to rods and 46.45 to plates: 3 × 81.72% and 2 × 77.42%, one machine more', () => {
    const use = describeUse(recipe('Recipe_IngotIron_C'), NO_MOD, 4);
    const flows = [
      to('Recipe_IngotIron_C', 'Desc_IronIngot_C', 73.55, 'Recipe_IronRod_C'),
      to('Recipe_IngotIron_C', 'Desc_IronIngot_C', 46.45, 'Recipe_IronPlate_C'),
    ];
    const split = splitByDestination(use, flows, 9)!;
    expect(split.item).toBe('Desc_IronIngot_C');
    expect(split.groups.map((g) => g.use.built)).toEqual([3, 2]);
    expect(split.groups[0].use.clocks[0]).toBeCloseTo(73.55 / 90, 6);
    expect(split.groups[1].use.clocks[0]).toBeCloseTo(46.45 / 60, 6);
    expect(split.groups.map((g) => g.to[0].kind === 'recipe' && g.to[0].recipe.id)).toEqual(['Recipe_IronRod_C', 'Recipe_IronPlate_C']);
    expect(split.groups[0].use.outputs[0].rate).toBeCloseTo(73.55, 6);
    expect(split.groups[1].use.outputs[0].rate).toBeCloseTo(46.45, 6);
    // Each group rounds up on its own: never more than one machine per extra group.
    expect(split.extra).toBe(1);
    expect(sum(split.groups.map((g) => g.use.inputs[0].rate))).toBeCloseTo(use.inputs[0].rate, 6);
  });

  test('a line that splits evenly costs no extra machine', () => {
    const use = describeUse(recipe('Recipe_IngotIron_C'), NO_MOD, 4);
    const flows = [
      to('Recipe_IngotIron_C', 'Desc_IronIngot_C', 60, 'Recipe_IronRod_C'),
      to('Recipe_IngotIron_C', 'Desc_IronIngot_C', 60, 'Recipe_IronPlate_C'),
    ];
    const split = splitByDestination(use, flows, 9)!;
    expect(split.groups.map((g) => g.use.built)).toEqual([2, 2]);
    expect(split.extra).toBe(0);
  });

  test('a single destination is left as one line', () => {
    const r = solve(highs, {
      targets: [{ item: 'Desc_IronPlate_C', rate: 60 }],
      supplies: [],
      enabledRecipes: standard(),
      resourceCaps: {},
      objective: 'resources',
    });
    const flows = matchFlows(r);
    for (const u of r.recipes) expect(splitByDestination(u, flows, 9)).toBeUndefined();
  });

  test('one machine is never split', () => {
    const use = describeUse(recipe('Recipe_IngotIron_C'), NO_MOD, 0.9);
    const flows = [
      to('Recipe_IngotIron_C', 'Desc_IronIngot_C', 15, 'Recipe_IronRod_C'),
      to('Recipe_IngotIron_C', 'Desc_IronIngot_C', 12, 'Recipe_IronPlate_C'),
    ];
    expect(splitByDestination(use, flows, 9)).toBeUndefined();
  });

  test('byproducts go with each group in proportion', () => {
    const plastic = recipe('Recipe_Plastic_C');
    const use = describeUse(plastic, NO_MOD, 4);
    const main = use.outputs[0];
    const residue = use.outputs[1];
    const flows: Flow[] = [
      { from: 'recipe:Recipe_Plastic_C', to: 'target:Desc_Plastic_C', item: main.item, rate: main.rate * 0.75, dest: { kind: 'target' } },
      to('Recipe_Plastic_C', main.item, main.rate * 0.25, 'Recipe_Rubber_C'),
    ];
    const split = splitByDestination(use, flows, 9)!;
    expect(split.groups.map((g) => g.use.built)).toEqual([3, 1]);
    expect(split.groups[0].to[0].kind).toBe('target');
    expect(split.groups[0].use.outputs[1].rate).toBeCloseTo(residue.rate * 0.75, 6);
    expect(split.groups[1].use.outputs[1].rate).toBeCloseTo(residue.rate * 0.25, 6);
    expect(split.extra).toBe(0);
  });

  test('a destination too small for 1% of a machine rides with the biggest', () => {
    const use = describeUse(recipe('Recipe_IngotIron_C'), NO_MOD, 3);
    const flows: Flow[] = [
      to('Recipe_IngotIron_C', 'Desc_IronIngot_C', 59.8, 'Recipe_IronRod_C'),
      to('Recipe_IngotIron_C', 'Desc_IronIngot_C', 30, 'Recipe_IronPlate_C'),
      { from: 'recipe:Recipe_IngotIron_C', to: 'surplus:Desc_IronIngot_C', item: 'Desc_IronIngot_C', rate: 0.2, dest: { kind: 'surplus' } },
    ];
    const split = splitByDestination(use, flows, 9)!;
    expect(split.groups).toHaveLength(2);
    expect(split.groups[0].to.map((d) => d.kind)).toEqual(['recipe', 'surplus']);
    expect(split.groups[0].rate).toBeCloseTo(60, 6);
  });

  test('a solved factory: the ingot line is split by where its belts go, and the groups add up to it', () => {
    const r = solve(highs, {
      targets: [
        { item: 'Desc_IronRod_C', rate: 73.55 },
        { item: 'Desc_IronPlate_C', rate: (46.45 * 20) / 30 },
      ],
      supplies: [],
      enabledRecipes: standard(),
      resourceCaps: {},
      objective: 'resources',
    });
    const ingots = r.recipes.find((u) => u.recipe.id === 'Recipe_IngotIron_C')!;
    expect(ingots.built).toBe(4);
    const split = splitByDestination(ingots, matchFlows(r), 9)!;
    expect(split.groups.map((g) => g.rate)).toEqual([expect.closeTo(73.55, 4), expect.closeTo(46.45, 4)]);
    expect(split.extra).toBe(1);
    expect(sum(split.groups.map((g) => g.use.count))).toBeCloseTo(ingots.count, 6);
  });
});
