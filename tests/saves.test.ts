import { describe, expect, test } from 'bun:test';
import { mergeState, persisted, useStore } from '../src/store';
import save from './fixtures/save-0.12.json';

// A save as 0.12 writes it: two factories with every setting a player can change, a power plant and the
// inventory. Any later version has to load it with nothing lost. If a change means it has to be rewritten,
// that change needs a migration instead.
const load = (state: unknown) => mergeState(state, useStore.getState());

describe('saves from earlier versions keep working', () => {
  test('a 0.12 save loads with nothing dropped or changed', () => {
    // Settings added since only add keys; every value the save had comes back as it was.
    expect(persisted(load(save.state))).toMatchObject(save.state as never);
  });

  test('loading it again changes nothing', () => {
    const once = persisted(load(save.state));
    expect(persisted(load(JSON.parse(JSON.stringify(once))))).toEqual(once);
  });

  test('the parts a player typed in are all there', () => {
    const s = load(save.state);
    const iron = s.plans.find((p) => p.id === 'plan-a')!;
    expect(iron.targets).toEqual([
      { item: 'Desc_IronPlate_C', rate: 120 },
      { item: 'Desc_ModularFrame_C', rate: 7.5 },
    ]);
    expect(iron.caps.Desc_OreIron_C).toBe(600);
    expect(iron.fixed.Desc_OreIron_C).toBe(480);
    expect(iron.mods.Recipe_IronPlate_C).toEqual({ clock: 1.5, sloops: 1 });
    expect(iron.enabled).toContain('Recipe_Alternate_PureIronIngot_C');
    expect(iron.extraction.nodes).toEqual({ Desc_OreIron_C: { impure: 1, pure: 2 } });
    expect(s.active).toBe('plan-b');
    expect(s.power[0].plants).toHaveLength(1);
    expect(s.inventory).toEqual({ sloops: 3, shards: 10 });
    expect(s.equalWeights).toBe(true);
  });

  test('what a reload keeps survives being written as JSON', () => {
    const state = persisted(load(save.state));
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  test('a broken save falls back to a fresh start instead of crashing', () => {
    for (const bad of [null, 'nonsense', 42, [], { plans: 'x' }, { plans: [null, 7] }]) {
      const s = load(bad);
      expect(s.plans.length).toBeGreaterThan(0);
      expect(s.plans.some((p) => p.id === s.active)).toBe(true);
    }
  });
});
