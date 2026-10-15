import { beforeAll, describe, expect, test } from 'bun:test';
import loadHighs, { type Highs } from 'highs';
import { data } from '../src/lib/data';
import { DEFAULT_EXTRACTION, planExtraction } from '../src/lib/extraction';
import { factoryPower } from '../src/lib/solution';
import { solve } from '../src/lib/solver';
import { splitOf } from '../src/lib/split';

let highs: Highs;
beforeAll(async () => {
  highs = await loadHighs();
});

const standard = () => new Set(data.recipes.filter((r) => r.kind === 'standard').map((r) => r.id));

describe('one figure for what a factory draws', () => {
  test('the strip, the factory menu and the All page count the cards built for each destination', () => {
    const r = solve(highs, {
      targets: [{ item: 'Desc_MotorLightweight_C', rate: 10 }],
      supplies: [],
      enabledRecipes: standard(),
      resourceCaps: {},
      objective: 'resources',
    });
    const extraction = planExtraction(r.raw, DEFAULT_EXTRACTION);
    const mined = extraction.reduce((s, u) => s + u.power, 0);

    const one = factoryPower(r, extraction, splitOf(r, 9, false));
    const each = factoryPower(r, extraction, splitOf(r, 9, true));

    // The split is real here: a card per destination changes the MW, so the two readings can part ways.
    const split = splitOf(r, 9, true)!;
    expect(Math.abs(split.power)).toBeGreaterThan(1e-6);
    expect(one.total).toBeCloseTo(r.power + mined, 9);
    expect(each.total).toBeCloseTo(r.power + split.power + mined, 9);
    expect(each.total).not.toBeCloseTo(one.total, 3);

    // The machines too: the extra ones a split line takes are counted wherever the factory's machines are.
    const built = r.recipes.reduce((n, u) => n + u.built, 0);
    expect(one.count).toBe(built);
    expect(each.count).toBe(built + [...split.machines.values()].reduce((a, b) => a + b, 0));
    expect(each.count).toBeGreaterThan(built);
  });
});
