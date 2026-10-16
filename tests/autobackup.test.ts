import { describe, expect, test } from 'bun:test';
import { EVERY, fingerprint, isDue, MAX_BACKUPS, surplus } from '../src/lib/autobackup';
import { buildExport, hasPlans, importData, wipeLocal } from '../src/lib/backup';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import { newPlan, newPowerPlan, useStore } from '../src/store';

const DAY = EVERY;
const worked = () => ({ ...newPlan('A'), targets: [{ item: 'Desc_IronPlate_C', rate: 10 }] });

describe('automatic copies', () => {
  test('the first copy is due at once; later ones only after a day and only when the plans changed', () => {
    expect(isDue([], 1000, 'x')).toBe(true);
    const list = [{ at: 1000, hash: 'x' }];
    expect(isDue(list, 1000 + DAY - 1, 'y')).toBe(false);
    expect(isDue(list, 1000 + DAY, 'x')).toBe(false);
    expect(isDue(list, 1000 + DAY, 'y')).toBe(true);
  });

  test('the newest copy decides, whatever the order of the list', () => {
    const list = [
      { at: 5 * DAY, hash: 'new' },
      { at: 1 * DAY, hash: 'old' },
    ];
    expect(isDue(list, 6 * DAY + 1, 'new')).toBe(false);
    expect(isDue(list, 6 * DAY + 1, 'old')).toBe(true);
  });

  test('a fourth copy pushes out the oldest', () => {
    const at = [1, 2, 3, 4].map((n) => n * DAY);
    expect(MAX_BACKUPS).toBe(3);
    expect(surplus(at.slice(0, 3).map((a) => ({ at: a })))).toEqual([]);
    expect(surplus(at.map((a) => ({ at: a })))).toEqual([1 * DAY]);
  });

  test('the fingerprint follows the plans and plants, not the clock or the settings', () => {
    const a = { plans: [worked()], power: [] };
    const same = { ...buildExport(), ...a };
    expect(fingerprint(a)).toBe(fingerprint({ plans: [...a.plans], power: [] }));
    expect(fingerprint(same)).toBe(fingerprint(a));
    expect(fingerprint({ plans: [{ ...a.plans[0], name: 'B' }], power: [] })).not.toBe(fingerprint(a));
  });

  test('an untouched session has nothing worth a copy', () => {
    expect(hasPlans({ plans: [newPlan('A')], power: [newPowerPlan('Plant 1')] })).toBe(false);
    expect(hasPlans({ plans: [worked()], power: [] })).toBe(true);
  });

  test('a copy loads back as new tabs and leaves what you have', () => {
    const mine = worked();
    useStore.setState({ plans: [mine], power: [newPowerPlan('Plant 1')], settings: DEFAULT_SETTINGS });
    const file = buildExport();
    const r = importData(JSON.parse(JSON.stringify(file)));
    expect(r).toMatchObject({ ok: true, count: 1 });
    const plans = useStore.getState().plans;
    expect(plans).toHaveLength(2);
    expect(plans[0].id).toBe(mine.id);
  });

  test('deleting everything leaves no key of ours behind', async () => {
    const kept = new Map<string, string>([
      ['ficsit-planner', '{}'],
      ['ficsit-polls', '{}'],
      ['ficsit-codex-recent', '[]'],
      ['ficsit-moved-later', '1'],
      ['other-app', 'stays'],
    ]);
    const fake = {
      get length() {
        return kept.size;
      },
      key: (i: number) => [...kept.keys()][i] ?? null,
      getItem: (k: string) => kept.get(k) ?? null,
      setItem: (k: string, v: string) => void kept.set(k, v),
      removeItem: (k: string) => void kept.delete(k),
    };
    // Object.keys needs the keys as own properties, like a real Storage.
    const proxy = new Proxy(fake, {
      ownKeys: () => [...kept.keys()],
      getOwnPropertyDescriptor: (_, k) =>
        kept.has(String(k)) ? { enumerable: true, configurable: true, value: kept.get(String(k)) } : undefined,
    });
    (globalThis as { localStorage?: unknown }).localStorage = proxy;
    await wipeLocal();
    expect([...kept.keys()]).toEqual(['other-app']);
  });
});
