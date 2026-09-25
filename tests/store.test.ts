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

describe('damaged or hostile saves', () => {
  test('wrong types fall back instead of reaching a render', () => {
    const merged = mergeState(
      {
        plans: [
          {
            id: 'a',
            name: { x: 1 },
            targets: [
              { item: realItem, rate: 'lots' },
              { item: realItem, rate: 5 },
            ],
            enabled: 'all',
            mods: [],
          },
          { id: 'a', name: 'Twin' },
        ],
        tier: 99,
        view: 'poster',
        deckHeight: 'tall',
      },
      current(),
    );
    const [first, second] = merged.plans;
    expect(first.name).toBe('Factory');
    expect(first.targets).toEqual([{ item: realItem, rate: 5 }]);
    expect(Array.isArray(first.enabled)).toBe(true);
    expect(second.id).not.toBe(first.id);
    expect(merged.tier).toBeLessThanOrEqual(9);
    expect(merged.view).toBe(current().view);
    expect(merged.deckHeight).toBeUndefined();
  });

  test('power plants and settings keep only what makes sense', () => {
    const merged = mergeState(
      {
        grid: {
          plants: [
            { id: 'ok', generator: 'Build_GeneratorCoal_C', fuel: 'Desc_Coal_C', by: 'auto', amount: 1, clock: 9 },
            { id: 'bad', generator: 'Build_Nothing_C', by: 'count', amount: 2, clock: 1 },
            'junk',
          ],
          headroom: -1,
        },
        settings: { cardScale: 40, colors: { accent: 'red; background: url(x)' }, motion: 'wild', panel: 'left' },
      },
      current(),
    );
    expect(merged.grid.plants.map((p) => p.id)).toEqual(['ok']);
    expect(merged.grid.plants[0].clock).toBe(2.5);
    expect(merged.grid.headroom).toBe(0);
    expect(merged.settings.cardScale).toBe(1.6);
    expect(merged.settings.colors.accent).toBe('#fa9549');
    expect(merged.settings.motion).toBe('system');
    expect(merged.settings.panel).toBe('left');
  });

  test('two plants with one id get their own ids, so they cannot share a solver column', () => {
    const coal = { generator: 'Build_GeneratorCoal_C', fuel: 'Desc_Coal_C', by: 'count', amount: 4, clock: 1 };
    const merged = mergeState(
      {
        grid: {
          plants: [
            { ...coal, id: 'p' },
            { ...coal, id: 'p' },
            { ...coal, id: 'q' },
          ],
        },
      },
      current(),
    );
    const ids = merged.grid.plants.map((p) => p.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe('p');
  });
});
