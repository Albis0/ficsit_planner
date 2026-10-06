import { beforeAll, describe, expect, test } from 'bun:test';
import loadHighs, { type Highs } from 'highs';
import { data } from '../src/lib/data';
import { filledTo100, fixedAs, fuelRate, handFed, PLANT_OPTIONS, type Plant } from '../src/lib/power';
import { powerInput } from '../src/lib/solution';
import { solve } from '../src/lib/solver';
import { newPowerPlan, type PowerPlan } from '../src/store';

/**
 * Every generator with every fuel it takes, sized the three ways the power panel offers. Fix the count and Fill to 100%
 * once asked a plant for more fuel than there was (Packaged Rocket Fuel, 0.13.9); this runs them on all of them.
 */

let highs: Highs;
beforeAll(async () => {
  highs = await loadHighs();
});

const FUELS = PLANT_OPTIONS.filter((o) => o.fuel);
const plantOf = (generator: string, fuel: string): Plant => ({ id: 'p', generator, fuel, by: 'auto', amount: 0, clock: 1 });
// Turbofuel, rocket fuel and compacted coal are only made by alternate recipes, so every recipe is ticked.
const every = data.recipes.filter((r) => r.kind !== 'power').map((r) => r.id);
const make = (patch: Partial<PowerPlan>): PowerPlan => {
  const base = newPowerPlan('P');
  return { ...base, chain: { ...base.chain, enabled: every }, ...patch };
};
const run = (pp: PowerPlan, demand = 0) => solve(highs, powerInput(pp, demand, 9)!);
const powerUse = (r: ReturnType<typeof run>) => r.recipes.find((x) => x.recipe.kind === 'power')!;

describe('every generator and fuel', () => {
  test('there are plenty to try', () => expect(FUELS.length).toBeGreaterThan(8));

  for (const o of FUELS) {
    const fuel = o.fuel!;
    const name = `${o.generator.id} burning ${fuel}`;

    test(`${name}: sized to a load, it covers it`, () => {
      const pp = make({ sizeBy: 'want', ownLoad: false, plants: [plantOf(o.generator.id, fuel)] });
      const r = run(pp, 2000);
      // Only what nothing in the game makes (leaves, wood, mycelia are picked by hand) may be left for the player to bring.
      expect(r.missing.every((x) => handFed(x.item))).toBe(true);
      expect(r.grid!.generation).toBeGreaterThanOrEqual(2000 - 1e-3);
      expect(powerUse(r).built).toBeGreaterThan(0);
    });

    test(`${name}: sized to what I have, Fix the count and Fill to 100% still have an answer`, () => {
      // Enough fuel for a few dozen generators, in whatever form the game gives it: mined, or crafted and brought in.
      const rate = Math.max(1, fuelRate(o.generator, fuel) * 7.3);
      const pp = make({ sizeBy: 'have', ownLoad: false, have: [{ item: fuel, rate }], plants: [plantOf(o.generator.id, fuel)] });
      const r = run(pp);
      const use = powerUse(r);
      expect(use.built).toBeGreaterThan(0);
      expect(r.missing.every((x) => handFed(x.item))).toBe(true);
      const as = (patch: Partial<Plant>): PowerPlan => ({ ...pp, plants: pp.plants.map((p) => ({ ...p, ...patch })) });
      const fixed = run(as(fixedAs(use)));
      expect(fixed.grid!.generation).toBeCloseTo(r.grid!.generation, 3);
      const full = filledTo100(use, true);
      if (full) {
        const filled = run(as(full));
        expect(powerUse(filled).clocks.every((c) => Math.abs(c - 1) < 1e-6)).toBe(true);
        expect(filled.grid!.generation).toBeLessThanOrEqual(r.grid!.generation + 1e-3);
      }
      // Rounded up for a load, the generators still run at 100% and cover it.
      const up = filledTo100(use, false);
      if (up) {
        const loaded = run({ ...as(up), sizeBy: 'want' }, 1);
        expect(powerUse(loaded).clocks.every((c) => Math.abs(c - 1) < 1e-6)).toBe(true);
      }
    });
  }
});
