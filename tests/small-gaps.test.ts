import { describe, expect, test } from 'bun:test';
import { factoryPower, withExports } from '../src/lib/solution';
import { gameKey } from '../src/lib/save/files';
import type { SolveResult } from '../src/lib/solver';

// Small pure functions that no other test reached (found with `bun run coverage`).

describe('what other tabs take from a factory', () => {
  test('its own targets and the exports are added up per item', () => {
    const out = withExports(
      [{ item: 'Desc_Cement_C', rate: 30 }],
      [
        { item: 'Desc_Cement_C', rate: 20, to: 'a' },
        { item: 'Desc_IronPlate_C', rate: 15, to: 'b' },
      ],
    );
    expect(out).toEqual([
      { item: 'Desc_Cement_C', rate: 50 },
      { item: 'Desc_IronPlate_C', rate: 15 },
    ]);
  });

  test('a rate of zero or less is dropped, and no exports leaves the targets as they are', () => {
    expect(withExports([{ item: 'Desc_Cement_C', rate: 0 }], [{ item: 'Desc_IronPlate_C', rate: -5, to: 'a' }])).toEqual([]);
    expect(withExports([{ item: 'Desc_Cement_C', rate: 12 }])).toEqual([{ item: 'Desc_Cement_C', rate: 12 }]);
  });
});

describe('a game is told apart by its session', () => {
  test('the session id when the save has one, else its name', () => {
    expect(gameKey({ sessionId: 'abc', sessionName: 'ela' })).toBe('abc');
    expect(gameKey({ sessionId: '', sessionName: 'ela' })).toBe('name:ela');
  });
});

describe('a factory’s power', () => {
  const result = { power: 100, recipes: [{ built: 3 }, { built: 2 }] } as unknown as SolveResult;

  test('machines, miners and pumps are added, and the buildings counted', () => {
    expect(factoryPower(result, [{ power: 40 }, { power: 10 }] as never)).toEqual({ machines: 100, extractors: 50, total: 150, count: 5 });
  });

  test('the split-off machines add their power and their count', () => {
    const split = {
      power: 25,
      machines: new Map([
        ['a', 4],
        ['b', 1],
      ]),
    };
    expect(factoryPower(result, [], split)).toEqual({ machines: 125, extractors: 0, total: 125, count: 10 });
  });
});
