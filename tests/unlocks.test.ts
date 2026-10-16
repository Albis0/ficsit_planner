import { afterEach, describe, expect, test } from 'bun:test';
import {
  craftableItems,
  data,
  itemLock,
  itemLocked,
  itemTier,
  recipeById,
  recipeTier,
  recipeUnlocked,
  transportFor,
  whyMissing,
} from '../src/lib/data';
import { effectiveExtraction } from '../src/lib/extraction';
import { transportOf } from '../src/lib/model/calc/compile';
import { plantUnlocked } from '../src/lib/power';
import { usableRecipes } from '../src/lib/solution';
import { DEFAULT_EXTRACTION } from '../src/lib/extraction';
import { carriersFor } from '../src/lib/transport';
import { useStore } from '../src/store';
import { blockedBy, cleanSkipped, isOpen, lockOf, MILESTONES, setSkipped, skipKey } from '../src/lib/unlocks';

const LOGISTICS_4 = 'Schematic_6-1_C';
const OIL = 'Schematic_5-1_C';
const iron = data.items.Desc_IronPlate_C;
const standard = () => new Set(data.recipes.filter((r) => r.kind === 'standard').map((r) => r.id));

afterEach(() => setSkipped([]));

describe('milestones that are not bought', () => {
  test('with none skipped nothing changes: every lock is the game tier', () => {
    for (let tier = 0; tier <= 9; tier++) {
      for (const r of data.recipes) expect(recipeUnlocked(r, tier)).toBe(recipeTier(r) <= tier);
      for (const i of craftableItems) expect(itemLocked(i.id, tier)).toBe((itemTier(i.id) ?? 0) > tier);
    }
  });

  test('each milestone opens things the planner knows, and no thing has two', () => {
    const seen = new Set<string>();
    for (const m of MILESTONES) {
      expect(m.unlocks.length).toBeGreaterThan(0);
      for (const u of m.unlocks) {
        expect(seen.has(u)).toBe(false);
        seen.add(u);
      }
    }
    expect(MILESTONES.find((m) => m.id === LOGISTICS_4)?.unlocks).toContain('Build_ConveyorBeltMk4_C');
  });

  test('without Logistics Mk.4 a belt line stays on Mk.3 and a second lane is added', () => {
    expect(transportFor(iron, 600, 5)).toMatchObject({ lanes: 2 });
    expect(transportFor(iron, 600, 5).transport.id).toBe('Build_ConveyorBeltMk4_C');
    setSkipped([LOGISTICS_4]);
    const t = transportFor(iron, 600, 5);
    expect(t.transport.id).toBe('Build_ConveyorBeltMk3_C');
    expect(t.lanes).toBe(3);
    // A hand-built floor picks the best belt the same way.
    expect(transportOf('belt', undefined, 5).id).toBe('Build_ConveyorBeltMk3_C');
    // The trucks come with it.
    expect(carriersFor(iron, 5)).not.toContain('truck');
    setSkipped([]);
    expect(carriersFor(iron, 5)).toContain('truck');
  });

  test('without Oil Processing plastic is locked, its recipes and the refinery are out, and the reason is the milestone', () => {
    setSkipped([OIL]);
    expect(itemLocked('Desc_Plastic_C', 9)).toBe(true);
    expect(recipeUnlocked(recipeById.get('Recipe_Plastic_C')!, 9)).toBe(false);
    // A recipe of another milestone that runs in the refinery is out as well.
    const refinery = data.recipes.filter((r) => r.machine === 'Build_OilRefinery_C' && r.kind === 'alternate');
    expect(refinery.length).toBeGreaterThan(0);
    for (const r of refinery) expect(recipeUnlocked(r, 9)).toBe(false);
    expect(whyMissing('Desc_Plastic_C', 9, standard())).toEqual({ kind: 'milestone', id: OIL });
    expect(itemLock('Desc_Plastic_C', 9)).toMatchObject({ milestone: { id: OIL } });
    // The solver is handed only what is open.
    expect(usableRecipes({ enabled: [...standard()] }, 9).has('Recipe_Plastic_C')).toBe(false);
    expect(usableRecipes({ enabled: [...standard()] }, 9).has('Recipe_IronPlate_C')).toBe(true);
    // Something below the tier it belongs to still says the tier.
    expect(whyMissing('Desc_Plastic_C', 2, standard())).toEqual({ kind: 'tier', tier: itemTier('Desc_Plastic_C') as number });
  });

  test('a skipped milestone above the tier changes nothing, and lowering the tier keeps the list', () => {
    setSkipped(['Schematic_8-4_C']);
    expect(effectiveExtraction(DEFAULT_EXTRACTION, 5).miner).toBe('Build_MinerMk2_C');
    expect(effectiveExtraction({ ...DEFAULT_EXTRACTION, miner: 'Build_MinerMk3_C' }, 9).miner).toBe('Build_MinerMk2_C');
    expect(lockOf({ id: 'Build_MinerMk3_C', tier: 8 }, 5)).toEqual({ tier: 8 });
    expect(lockOf({ id: 'Build_MinerMk3_C', tier: 8 }, 9)).toMatchObject({ milestone: { id: 'Schematic_8-4_C' } });
  });

  test('a plant waits for its milestone', () => {
    const plant = { id: 'p', generator: 'Build_GeneratorFuel_C', by: 'count', amount: 1 } as never;
    expect(plantUnlocked(plant, 5)).toBe(true);
    setSkipped(['Schematic_5-5_C']);
    expect(plantUnlocked(plant, 5)).toBe(false);
    expect(blockedBy('Build_GeneratorFuel_C')?.name).toBe('Petroleum Power');
    expect(isOpen({ id: 'Build_GeneratorFuel_C', tier: 5 }, 9)).toBe(false);
  });

  test('the cache key follows the list, in any order', () => {
    setSkipped([OIL, LOGISTICS_4]);
    const key = skipKey();
    setSkipped([LOGISTICS_4, OIL]);
    expect(skipKey()).toBe(key);
    setSkipped([]);
    expect(skipKey()).not.toBe(key);
  });

  test('a saved list keeps only milestones this build knows, each once', () => {
    expect(cleanSkipped([OIL, OIL, 'Schematic_Nope_C', 7, null])).toEqual([OIL]);
    expect(cleanSkipped('x')).toEqual([]);
    expect(cleanSkipped(undefined)).toEqual([]);
  });
});

describe('the store keeps the unlocks module in step', () => {
  test('marking a milestone skipped locks what it opens, buying it back opens it again', () => {
    const { markSkipped } = useStore.getState();
    markSkipped([OIL, 'Schematic_Nope_C'], true);
    expect(useStore.getState().skipped).toEqual([OIL]);
    expect(itemLocked('Desc_Plastic_C', 9)).toBe(true);
    markSkipped([OIL], false);
    expect(useStore.getState().skipped).toEqual([]);
    expect(itemLocked('Desc_Plastic_C', 9)).toBe(false);
  });
});
