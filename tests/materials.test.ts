import { beforeAll, describe, expect, test } from 'bun:test';
import loadHighs, { type Highs } from 'highs';
import { data } from '../src/lib/data';
import { DEFAULT_EXTRACTION, planExtraction } from '../src/lib/extraction';
import { allMaterials, buildBill } from '../src/lib/materials';
import { solve } from '../src/lib/solver';

let highs: Highs;
beforeAll(async () => {
  highs = await loadHighs();
});

const standard = () => new Set(data.recipes.filter((r) => r.kind === 'standard').map((r) => r.id));
const make = (item: string, rate: number) => {
  const result = solve(highs, {
    targets: [{ item, rate }],
    supplies: [],
    enabledRecipes: standard(),
    resourceCaps: {},
    objective: 'resources',
  });
  return { result, extraction: planExtraction(result.raw, DEFAULT_EXTRACTION) };
};

describe('materials of all the factories', () => {
  let motors: ReturnType<typeof make>;
  let plates: ReturnType<typeof make>;
  let sources: { id: string; name: string; result: ReturnType<typeof make>['result']; extraction: ReturnType<typeof make>['extraction'] }[];
  beforeAll(() => {
    motors = make('Desc_MotorLightweight_C', 10);
    plates = make('Desc_IronPlateReinforced_C', 5);
    sources = [
      { id: 'a', name: 'Motors', ...motors },
      { id: 'b', name: 'Plates', ...plates },
    ];
  });

  test('a part is the sum of what each factory needs, and says who needs how much', () => {
    const { parts } = allMaterials(sources, true);
    const one = new Map(buildBill(motors.result, motors.extraction).parts);
    const two = new Map(buildBill(plates.result, plates.extraction).parts);
    for (const line of parts) {
      expect(line.total).toBeCloseTo((one.get(line.id) ?? 0) + (two.get(line.id) ?? 0), 9);
      expect(line.by.reduce((s, b) => s + b.amount, 0)).toBeCloseTo(line.total, 9);
    }
    // Both factories need iron plates for their machines, so that part names both.
    const shared = parts.find((l) => l.by.length === 2);
    expect(shared).toBeDefined();
    expect(parts.map((l) => l.total)).toEqual([...parts.map((l) => l.total)].sort((x, y) => y - x));
  });

  test('machines ticked as built are left out until asked for', () => {
    const done = { ...sources[0], done: () => true };
    const left = allMaterials([done, sources[1]], false);
    // Only the extractors of the ticked factory are still to get; its machines are not.
    const machines = new Set(motors.result.recipes.map((u) => u.recipe.machine));
    const own = new Set(motors.extraction.map((e) => e.extractor.id));
    for (const m of machines) {
      if (own.has(m)) continue;
      const line = left.buildings.find((l) => l.id === m);
      expect(line?.by.some((b) => b.id === 'a') ?? false).toBe(false);
    }
    const all = allMaterials([done, sources[1]], true);
    expect(all.buildings.reduce((s, l) => s + l.total, 0)).toBeGreaterThan(left.buildings.reduce((s, l) => s + l.total, 0));
  });

  test('a factory that is still being worked out adds nothing', () => {
    const { parts } = allMaterials([{ id: 'c', name: 'Soon' }, sources[1]], true);
    expect(parts.every((l) => l.by.every((b) => b.id === 'b'))).toBe(true);
  });
});
