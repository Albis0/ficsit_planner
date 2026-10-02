import { describe, expect, test } from 'bun:test';
import { data, itemTier, recipeTier, recipeUnlocked, whyMissing } from '../src/lib/data';
import { usableRecipes } from '../src/lib/solution';

const standard = () => new Set(data.recipes.filter((r) => r.kind === 'standard').map((r) => r.id));

test('an item unlocks with its earliest standard recipe and that recipe’s building', () => {
  expect(itemTier('Desc_IronPlate_C')).toBe(0);
  expect(itemTier('Desc_SpaceElevatorPart_6_C')).toBe(8);
  expect(itemTier('Desc_OreIron_C')).toBeUndefined();
});

test('a missing item says whether the tier or a turned-off recipe is in the way', () => {
  expect(whyMissing('Desc_SpaceElevatorPart_6_C', 3, standard())).toEqual({ kind: 'tier', tier: 8 });
  const off = standard();
  off.delete('Recipe_IronPlate_C');
  expect(whyMissing('Desc_IronPlate_C', 9, off)).toEqual({ kind: 'off', recipe: 'Recipe_IronPlate_C' });
  expect(whyMissing('Desc_NothingMakesThis_C', 9, standard())).toEqual({ kind: 'none' });
});

test('no alternate unlocks before standard recipes can make everything it takes and gives', () => {
  for (const r of data.recipes.filter((x) => x.kind === 'alternate'))
    for (const s of [...r.inputs, ...r.outputs]) {
      const needs = itemTier(s.item);
      if (needs !== undefined)
        expect({ recipe: r.name, tier: recipeTier(r) }).toEqual({ recipe: r.name, tier: Math.max(recipeTier(r), needs) });
    }
});

test('aluminum and late-game alternates stay locked at tier 4 and open at their own tier', () => {
  const pure = data.recipes.find((r) => r.name === 'Alternate: Pure Aluminum Ingot')!;
  const oc = data.recipes.find((r) => r.name === 'Alternate: OC Supercomputer')!;
  expect(recipeUnlocked(pure, 4)).toBe(false);
  expect(recipeUnlocked(oc, 4)).toBe(false);
  expect(recipeUnlocked(pure, recipeTier(pure))).toBe(true);
  expect(recipeTier(pure)).toBe(7);
});

test('a ticked recipe above the tier never reaches the solver', () => {
  for (let tier = 0; tier <= 9; tier++) {
    const usable = usableRecipes({ enabled: data.recipes.map((r) => r.id) }, tier);
    for (const r of data.recipes)
      expect({ recipe: r.name, tier, used: usable.has(r.id) }).toEqual({ recipe: r.name, tier, used: recipeUnlocked(r, tier) });
  }
});

describe('transport data from the game files', () => {
  test('every solid has a stack size, from 1 to 500', () => {
    for (const i of Object.values(data.items).filter((x) => x.form === 'solid')) expect([1, 50, 100, 200, 500]).toContain(i.stack!);
    expect(data.items.Desc_Wire_C.stack).toBe(500);
    expect(data.items.Desc_OreIron_C.stack).toBe(100);
  });

  test('vehicles: slots and unlock tiers as the game has them', () => {
    const v = Object.fromEntries(data.vehicles.map((x) => [x.id, x]));
    expect(v.Desc_FreightWagon_C.slots).toBe(32);
    expect(v.Desc_Truck_C.slots).toBe(48);
    expect(v.Desc_Tractor_C.slots).toBe(25);
    expect(v.Desc_Explorer_C.slots).toBe(12);
    expect(v.Desc_DroneTransport_C.slots).toBe(9);
    expect(v.Desc_FluidTruck_C.fluid).toBe(true);
    expect(v.Desc_Locomotive_C.powerRange).toEqual([25, 110]);
    expect([v.Desc_Tractor_C.tier, v.Desc_Truck_C.tier, v.Desc_FreightWagon_C.tier, v.Desc_DroneTransport_C.tier]).toEqual([3, 5, 6, 8]);
  });

  test('stations: load times, power, and what a drone trip costs', () => {
    const s = Object.fromEntries(data.stations.map((x) => [x.id, x]));
    expect(s.Build_TrainDockingStation_C.load).toBe(27);
    expect(s.Build_TruckStation_C.load).toBe(8);
    expect(s.Build_DroneStation_C.power).toBe(100);
    expect(s.Build_DroneStation_C.trip).toEqual({ base: 24000, perMetre: 6, battery: 6000 });
  });
});
