import { expect, test } from 'bun:test';
import { data, itemTier, whyMissing } from '../src/lib/data';

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
