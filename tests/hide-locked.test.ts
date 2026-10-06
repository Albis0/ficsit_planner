import { describe, expect, test } from 'bun:test';
import { craftableItems, itemLocked, itemTier, sinkPerMin } from '../src/lib/data';
import { choicesFor } from '../src/lib/model/choices';
import { laterMatches } from '../src/lib/later';
import { cleanSettings } from '../src/lib/sanitize';
import { DEFAULT_SETTINGS } from '../src/lib/settings';

describe('hiding what the tier can’t make', () => {
  test('hidden unless shown in Settings, and the add choice defaults to a right click', () => {
    expect(DEFAULT_SETTINGS.showLocked).toBe(false);
    expect(cleanSettings({}).showLocked).toBe(false);
    expect(cleanSettings({ showLocked: true }).showLocked).toBe(true);
    expect(cleanSettings({ showLocked: 'yes' }).showLocked).toBe(false);
    // The 0.13.1 preview's setting, saved off, doesn't bring them back.
    expect(cleanSettings({ hideLocked: false }).showLocked).toBe(false);
    expect(cleanSettings({}).addWith).toBe('right');
    expect(cleanSettings({ addWith: 'double' }).addWith).toBe('double');
    expect(cleanSettings({ addWith: 'middle' }).addWith).toBe('right');
  });

  test('an item is locked until its first standard recipe opens up', () => {
    expect(itemLocked('Desc_IronPlate_C', 0)).toBe(false);
    const motor = itemTier('Desc_Motor_C')!;
    expect(itemLocked('Desc_Motor_C', motor - 1)).toBe(true);
    expect(itemLocked('Desc_Motor_C', motor)).toBe(false);
    // At the last tier nothing is locked.
    expect(craftableItems.filter((i) => itemLocked(i.id, 9))).toEqual([]);
    // Low tiers leave plenty out.
    expect(craftableItems.filter((i) => itemLocked(i.id, 1)).length).toBeGreaterThan(50);
  });

  test('the build menu has something to hide below the last tier', () => {
    expect(choicesFor(undefined, 2).some((c) => c.tier > 2)).toBe(true);
  });

  test('a search that finds nothing at the tier says when what it found opens up; a made-up word says nothing', () => {
    const hidden = craftableItems.filter((i) => itemLocked(i.id, 2));
    const name = (i: { name: string }) => i.name;
    const found = laterMatches('motor', hidden, name);
    expect(found.length).toBeGreaterThan(0);
    expect(found.length).toBeLessThanOrEqual(3);
    for (const x of found) expect(x.tier).toBeGreaterThan(2);
    expect(laterMatches('qwzx', hidden, name)).toEqual([]);
    expect(laterMatches('  ', hidden, name)).toEqual([]);
  });

  test('sink points: parts count, fluids and empty lists add nothing', () => {
    expect(sinkPerMin([])).toBe(0);
    expect(sinkPerMin([{ item: 'Desc_IronPlate_C', rate: 10 }])).toBeGreaterThan(0);
    expect(sinkPerMin([{ item: 'Desc_Water_C', rate: 100 }])).toBe(0);
  });
});
