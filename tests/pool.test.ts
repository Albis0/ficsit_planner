import { describe, expect, test } from 'bun:test';
import { plantTakesFromPool, poolLines, takesFromPool } from '../src/lib/pool';
import { cleanPlan, cleanPowerPlan } from '../src/lib/sanitize';
import { powerInput } from '../src/lib/solution';
import { dropSource, exportsOf, newPlan, newPowerPlan, POOL, type Plan } from '../src/store';

const plan = (name: string, patch: Partial<Plan> = {}): Plan => ({ ...newPlan(name), ...patch });

describe('the shared pool', () => {
  test('what factories and plants leave over is added up per item, less what is taken, and can run short', () => {
    const lines = poolLines(
      [
        [{ item: 'HOR', rate: 30 }],
        [
          { item: 'HOR', rate: 20 },
          { item: 'Waste', rate: 4 },
        ],
        [],
      ],
      [[{ item: 'HOR', rate: 60 }], [{ item: 'Waste', rate: 1 }]],
    );
    expect(lines).toEqual([
      { item: 'Waste', made: 4, taken: 1, left: 3 },
      { item: 'HOR', made: 50, taken: 60, left: -10 },
    ]);
  });

  test('only supplies taken from the pool count as taking from it', () => {
    const a = plan('A', {
      supplies: [
        { item: 'HOR', rate: 5, from: POOL },
        { item: 'Plastic', rate: 9, from: 'other' },
        { item: 'Rubber', rate: 2 },
      ],
    });
    expect(takesFromPool([a])).toEqual([[{ item: 'HOR', rate: 5 }]]);
  });

  test('taking from the pool makes no factory produce more: nothing is exported to it', () => {
    const a = plan('A', { targets: [{ item: 'Desc_Plastic_C', rate: 60 }] });
    const b = plan('B', { supplies: [{ item: 'Desc_HeavyOilResidue_C', rate: 40, from: POOL }] });
    expect(exportsOf([a, b], a.id)).toEqual([]);
    expect(exportsOf([a, b], b.id)).toEqual([]);
  });

  test('a supply from the pool stays when a tab is closed, one from the closed tab becomes plain', () => {
    const a = plan('A');
    const b = plan('B', {
      supplies: [
        { item: 'Desc_Plastic_C', rate: 9, from: a.id },
        { item: 'Desc_HeavyOilResidue_C', rate: 40, from: POOL },
      ],
    });
    const [, after] = dropSource([a, b], a.id);
    expect(after.supplies).toEqual([
      { item: 'Desc_Plastic_C', rate: 9 },
      { item: 'Desc_HeavyOilResidue_C', rate: 40, from: POOL },
    ]);
    // Reading a save or a link: a source that isn't there goes, the pool never does.
    const [kept] = dropSource([b], () => true);
    expect(kept.supplies.map((x) => x.from)).toEqual([undefined, POOL]);
  });

  test('a saved plan keeps what it takes from the pool', () => {
    const b = plan('B', { supplies: [{ item: 'Desc_HeavyOilResidue_C', rate: 40, from: POOL }] });
    expect(cleanPlan(JSON.parse(JSON.stringify(b)), newPlan('x')).supplies).toEqual(b.supplies);
  });

  test('a power plant takes fuel from the pool the same way: the pool is counted, the solver sees plain fuel on hand', () => {
    const coal = { id: 'c', generator: 'Build_GeneratorCoal_C', fuel: 'Desc_Coal_C', by: 'auto' as const, amount: 0, clock: 1 };
    const fromPool = {
      ...newPowerPlan('P'),
      sizeBy: 'have' as const,
      plants: [coal],
      have: [{ item: 'Desc_CompactedCoal_C', rate: 30, from: POOL }],
    };
    const plain = { ...fromPool, have: [{ item: 'Desc_CompactedCoal_C', rate: 30 }] };
    expect(plantTakesFromPool([fromPool, plain])).toEqual([[{ item: 'Desc_CompactedCoal_C', rate: 30 }], []]);
    const a = powerInput(fromPool, 0, 9)!;
    const b = powerInput(plain, 0, 9)!;
    expect(a.supplies.map(({ item, rate }) => ({ item, rate }))).toEqual(b.supplies.map(({ item, rate }) => ({ item, rate })));
  });

  test('a saved power plant keeps what it takes from the pool and drops any other source', () => {
    const pp = {
      ...newPowerPlan('P'),
      have: [
        { item: 'Desc_CompactedCoal_C', rate: 30, from: POOL },
        { item: 'Desc_Coal_C', rate: 10, from: 'some-tab' },
      ],
    };
    const clean = cleanPowerPlan(JSON.parse(JSON.stringify(pp)), newPowerPlan('x'));
    expect(clean.have).toEqual([
      { item: 'Desc_CompactedCoal_C', rate: 30, from: POOL },
      { item: 'Desc_Coal_C', rate: 10 },
    ]);
  });
});
