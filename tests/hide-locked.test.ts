import { describe, expect, test } from 'bun:test';
import { craftableItems, itemLocked, itemTier } from '../src/lib/data';
import { choicesFor } from '../src/lib/model/choices';
import { cleanSettings } from '../src/lib/sanitize';
import { DEFAULT_SETTINGS } from '../src/lib/settings';

describe('hiding what the tier can’t make', () => {
  test('off unless turned on, and the add choice defaults to a right click', () => {
    expect(DEFAULT_SETTINGS.hideLocked).toBe(false);
    expect(cleanSettings({}).hideLocked).toBe(false);
    expect(cleanSettings({ hideLocked: true }).hideLocked).toBe(true);
    expect(cleanSettings({ hideLocked: 'yes' }).hideLocked).toBe(false);
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
});
