import { beforeAll, describe, expect, test } from 'bun:test';
import loadHighs, { type Highs } from 'highs';
import saved from '../src/data/insights.json';
import { buildInsights, type Insights, versusStandard } from '../src/lib/insights';

let highs: Highs;
beforeAll(async () => {
  highs = await loadHighs();
});

const file = saved as unknown as Insights;

describe('Codex insights', () => {
  test('the saved file matches the game data and the solver (run bun scripts/codex-insights.ts when it doesn’t)', () => {
    expect(buildInsights(highs)).toEqual(file);
  }, 60_000);

  test('the motor line matches the one worked out by hand', () => {
    const { line } = file.items.Desc_Motor_C;
    expect(line.rate).toBe(5);
    expect(line.rawTotal).toBeCloseTo(242.5);
    expect(line.buildings).toBe(33);
  });

  test('biomass is made from plants, not hunted', () => {
    const { line } = file.items.Desc_GenericBiomass_C;
    expect(line.missing.some((m) => m.item.endsWith('Parts_C'))).toBe(false);
  });

  test('an alternate that saves resources shows as a saving', () => {
    // Steel Screw: one steel beam makes 52 screws, far less ore than iron rods.
    const vs = versusStandard(file.items.Desc_IronScrew_C, 'Recipe_Alternate_Screw_2_C')!;
    expect(vs.raw).toBeLessThan(-0.3);
    expect(vs.needsMore).toBe(false);
  });

  test('every fuel has a line, and coal is 15 a minute per generator', () => {
    const coal = file.fuels.find((f) => f.generator === 'Build_GeneratorCoal_C' && f.fuel === 'Desc_Coal_C')!;
    expect(coal.raw.find((r) => r.item === 'Desc_Coal_C')?.rate).toBeCloseTo(15);
    expect(coal.raw.find((r) => r.item === 'Desc_Water_C')?.rate).toBeCloseTo(45);
  });
});
