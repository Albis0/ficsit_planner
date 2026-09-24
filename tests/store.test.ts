import { describe, expect, test } from 'bun:test';
import { data } from '../src/lib/data';
import { mergeState, migrateState, newPlan, useStore } from '../src/store';

const current = () => useStore.getState();
const realRecipe = data.recipes[0].id;
const realItem = 'Desc_IronPlate_C';

describe('saved state', () => {
  test('v1 kept one plan at the top level; it becomes the first factory', () => {
    const migrated = migrateState({ lang: 'en', view: 'table', targets: [{ item: realItem, rate: 30 }], objective: 'power' }, 1);
    expect(migrated.plans).toHaveLength(1);
    expect(migrated.plans![0].targets).toEqual([{ item: realItem, rate: 30 }]);
    expect(migrated.plans![0].objective).toBe('power');
    expect(migrated.active).toBe(migrated.plans![0].id);
    expect(migrated.view).toBe('table');
  });

  test('recipes, items and mods gone after a game update are dropped', () => {
    const plan = {
      ...newPlan('Factory 1'),
      enabled: [realRecipe, 'Recipe_Removed_C'],
      targets: [
        { item: realItem, rate: 10 },
        { item: 'Desc_Removed_C', rate: 5 },
      ],
      supplies: [{ item: 'Desc_Removed_C', rate: 1 }],
      mods: { [realRecipe]: { clock: 2, sloops: 0 }, Recipe_Removed_C: { clock: 1.5, sloops: 0 } },
    };
    const merged = mergeState({ plans: [plan], active: plan.id }, current());
    const p = merged.plans[0];
    expect(p.enabled).toEqual([realRecipe]);
    expect(p.targets).toEqual([{ item: realItem, rate: 10 }]);
    expect(p.supplies).toEqual([]);
    expect(Object.keys(p.mods)).toEqual([realRecipe]);
  });

  test('a saved language this build does not ship falls back to English', () => {
    expect(mergeState({ lang: 'tr' }, current()).lang).toBe('en');
    expect(mergeState({ lang: 'en' }, current()).lang).toBe('en');
  });

  test('an active id that no longer exists points at the first factory', () => {
    const plan = newPlan('Factory 1');
    expect(mergeState({ plans: [plan], active: 'gone' }, current()).active).toBe(plan.id);
  });

  test('fields added since the save was written get their defaults', () => {
    const { extraction, fixed, ...old } = newPlan('Old');
    const merged = mergeState({ plans: [old] }, current());
    expect(merged.plans[0].extraction).toEqual(extraction);
    expect(merged.plans[0].fixed).toEqual(fixed);
  });
});
