import { beforeEach, describe, expect, test } from 'bun:test';
import { data } from '../src/lib/data';
import { planStorage } from '../src/lib/safeStorage';
import { defaultEnabled, mergeState, newPlan, useStore } from '../src/store';

const alternates = data.recipes.filter((r) => r.kind === 'alternate').map((r) => r.id);
const converters = data.recipes.filter((r) => r.kind === 'converter').map((r) => r.id);
const standard = data.recipes.find((r) => r.kind === 'standard')!.id;
const current = () => useStore.getState();

/** An item with at least two alternate recipes, to see what a build "with one recipe" turns off. */
const rivalItem = (() => {
  const count = new Map<string, number>();
  for (const r of data.recipes) if (r.kind === 'alternate') count.set(r.outputs[0].item, (count.get(r.outputs[0].item) ?? 0) + 1);
  return [...count].find(([, n]) => n >= 2)![0];
})();

beforeEach(() => {
  const plan = newPlan('Factory 1');
  useStore.setState({ unlocked: [], plans: [plan], active: plan.id });
});

describe('unlocked recipes', () => {
  test('a new factory starts with the standard recipes and the unlocked ones', () => {
    current().setUnlocked([alternates[0], converters[0]], true);
    current().addPlan('Factory 2');
    const made = current().plans.at(-1)!;
    expect(made.enabled).toEqual([...defaultEnabled(), alternates[0], converters[0]]);
  });

  test('with nothing marked, a new factory starts as it always did', () => {
    current().addPlan('Factory 2');
    expect(current().plans.at(-1)!.enabled).toEqual(defaultEnabled());
  });

  test('marking more changes no factory that is already open', () => {
    const before = current().plans[0].enabled;
    current().setUnlocked([alternates[0]], true);
    expect(current().plans[0].enabled).toEqual(before);
  });

  test('turning on in all factories adds them everywhere and removes nothing', () => {
    current().addPlan('Factory 2');
    current().toggleRecipe(standard, false);
    current().setUnlocked([alternates[0], alternates[1]], true);
    current().applyUnlocked();
    for (const p of current().plans) {
      expect(p.enabled).toContain(alternates[0]);
      expect(p.enabled).toContain(alternates[1]);
    }
    expect(current().plans[1].enabled).not.toContain(standard);
  });

  test('turning on twice adds nothing twice', () => {
    current().setUnlocked([alternates[0]], true);
    current().applyUnlocked();
    current().applyUnlocked();
    expect(current().plans[0].enabled.filter((id) => id === alternates[0])).toHaveLength(1);
  });

  test('an unticked recipe leaves the list and the next new factory', () => {
    current().setUnlocked([alternates[0], alternates[1]], true);
    current().setUnlocked([alternates[0]], false);
    current().addPlan('Factory 2');
    const made = current().plans.at(-1)!;
    expect(made.enabled).not.toContain(alternates[0]);
    expect(made.enabled).toContain(alternates[1]);
  });

  test('a factory built from the Codex with one recipe leaves that item’s other recipes off', () => {
    const makers = data.recipes.filter((r) => r.outputs[0]?.item === rivalItem);
    const pick = makers.find((r) => r.kind === 'alternate')!;
    current().setUnlocked(
      makers.filter((r) => r.kind === 'alternate').map((r) => r.id),
      true,
    );
    current().buildFactory(rivalItem, 'Made', pick.id);
    const made = current().plans.find((p) => p.name === 'Made')!;
    expect(made.enabled).toContain(pick.id);
    for (const r of makers.filter((r) => r.id !== pick.id)) expect(made.enabled).not.toContain(r.id);
  });

  test('saved: unknown, standard and repeated ids are dropped', () => {
    const merged = mergeState({ unlocked: [alternates[0], alternates[0], standard, 'Recipe_Removed_C', 7] }, current());
    expect(merged.unlocked).toEqual([alternates[0]]);
    expect(mergeState({}, current()).unlocked).toEqual([]);
    expect(mergeState({ unlocked: 'all' } as never, current()).unlocked).toEqual([]);
  });
});

describe('reading the saved state when the app opens', () => {
  test('a saved tier and unlocked list come back as they were', async () => {
    const saved = JSON.stringify({ state: { onboarded: true, tier: 3, unlocked: [alternates[0], 'Recipe_Removed_C'] }, version: 3 });
    const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: (k: string) => (k === 'ficsit-planner' ? saved : null), setItem: () => {}, removeItem: () => {} },
    });
    try {
      // Writes the earlier tests left waiting would be read back before the stored state.
      planStorage.flush();
      // A fresh copy of the store, as when the page loads: it reads the saved state while it is being made.
      const fresh = (await import(`../src/store.ts?opening=${Date.now()}`)) as typeof import('../src/store');
      expect(fresh.useStore.getState().onboarded).toBe(true);
      expect(fresh.useStore.getState().tier).toBe(3);
      expect(fresh.useStore.getState().unlocked).toEqual([alternates[0]]);
    } finally {
      if (had) Object.defineProperty(globalThis, 'localStorage', had);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});
