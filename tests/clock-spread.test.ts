import { describe, expect, test } from 'bun:test';
import { data } from '../src/lib/data';
import { describeUse, NO_MOD } from '../src/lib/solver';

const smelter = data.recipes.find((r) => r.id === 'Recipe_IngotIron_C')!;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('whole machines at 100% and one slower', () => {
  test('6.65 machines: 6 at 100% and one at 65%, the same output as 7 at 95%', () => {
    const even = describeUse(smelter, NO_MOD, 6.65);
    const full = describeUse(smelter, NO_MOD, 6.65, false, true);
    expect(even.built).toBe(7);
    expect(full.built).toBe(7);
    expect(full.clocks.slice(0, 6)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(full.clocks[6]).toBeCloseTo(0.65, 6);
    expect(sum(full.clocks)).toBeCloseTo(sum(even.clocks), 6);
    expect(full.full).toBe(true);
    expect(even.full).toBeUndefined();
  });

  test('a clock the player set stays on every machine', () => {
    const use = describeUse(smelter, { clock: 0.5, sloops: 0 }, 7, false, true);
    expect(use.clocks).toEqual(Array(7).fill(0.5));
    expect(use.full).toBeUndefined();
  });

  test('a line that fills its machines is the same either way', () => {
    expect(describeUse(smelter, NO_MOD, 4, false, true).clocks).toEqual([1, 1, 1, 1]);
    expect(describeUse(smelter, NO_MOD, 0.4, false, true).clocks).toEqual([0.4]);
  });
});
