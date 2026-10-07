import { describe, expect, test } from 'bun:test';
import { poolLines, takesFromPool } from '../src/lib/pool';
import { cleanPlan } from '../src/lib/sanitize';
import { dropSource, exportsOf, newPlan, POOL, type Plan } from '../src/store';

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
});
