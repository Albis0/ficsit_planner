import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import loadHighs, { type Highs } from 'highs';
import { data, recipeById } from '../src/lib/data';
import { applyGame, DEFAULT_GAME, elevatorAmount, PACKAGED } from '../src/lib/game';
import { cleanSettings } from '../src/lib/sanitize';
import { solve } from '../src/lib/solver';

let highs: Highs;
beforeAll(async () => {
  highs = await loadHighs();
});
// The multipliers change the shared game data; every test starts and ends with the game as shipped.
afterEach(() => applyGame(DEFAULT_GAME));

const input = (id: string, item: string) => recipeById.get(id)!.inputs.find((i) => i.item === item)!.rate;
const game = (parts: number, power = 1) => applyGame({ parts, power, elevator: 1 });

describe('part cost', () => {
  test('Cast Screws at 1.25×: 5 ingots a craft become 6 (15 a minute, from 12.5)', () => {
    game(1.25);
    expect(input('Recipe_Alternate_Screw_C', 'Desc_IronIngot_C')).toBeCloseTo(15);
  });

  test('one-item inputs round back to one: Iron Rod and Screws are unchanged at 1.25×', () => {
    game(1.25);
    expect(input('Recipe_IronRod_C', 'Desc_IronIngot_C')).toBeCloseTo(15);
    expect(input('Recipe_Screw_C', 'Desc_IronRod_C')).toBeCloseTo(10);
  });

  test('at 0.25× a solid input never drops below one item', () => {
    game(0.25);
    // Iron Rod: 1 ingot × 0.25 = 0.25, still 1.
    expect(input('Recipe_IronRod_C', 'Desc_IronIngot_C')).toBeCloseTo(15);
  });

  test('fluids are multiplied as they are', () => {
    game(1.25);
    expect(input('Recipe_Plastic_C', 'Desc_LiquidOil_C')).toBeCloseTo(37.5);
  });

  test('recipes with packaged fluids stay as they are, Diluted Packaged Fuel included', () => {
    expect(PACKAGED.has('Desc_PackagedWater_C')).toBe(true);
    game(2);
    expect(input('Recipe_Alternate_DilutedPackagedFuel_C', 'Desc_HeavyOilResidue_C')).toBeCloseTo(30);
  });

  test('outputs never change', () => {
    game(2);
    expect(recipeById.get('Recipe_Alternate_Screw_C')!.outputs[0].rate).toBeCloseTo(50);
  });

  test('going back to 1× gives the shipped numbers', () => {
    game(1.25);
    game(1);
    expect(input('Recipe_Alternate_Screw_C', 'Desc_IronIngot_C')).toBeCloseTo(12.5);
  });
});

describe('power use', () => {
  test('2× power doubles what the machines draw', () => {
    const std = new Set(data.recipes.filter((r) => r.kind === 'standard').map((r) => r.id));
    const plan = () =>
      solve(highs, {
        targets: [{ item: 'Desc_IronPlate_C', rate: 60 }],
        supplies: [],
        enabledRecipes: std,
        resourceCaps: {},
        objective: 'resources',
      });
    const base = plan().power;
    game(1, 2);
    expect(plan().power).toBeCloseTo(base * 2);
  });
});

describe('elevator and saved settings', () => {
  test('phase amounts scale and stay whole', () => {
    expect(elevatorAmount(50, { parts: 1, power: 1, elevator: 50 })).toBe(2500);
    expect(elevatorAmount(50, { parts: 1, power: 1, elevator: 0.25 })).toBe(13);
    expect(elevatorAmount(50, undefined)).toBe(50);
  });

  test('saved multipliers outside the game’s range fall back to 1', () => {
    expect(cleanSettings({ game: { parts: 2, power: -1, elevator: 'x' } }).game).toEqual({ parts: 2, power: 1, elevator: 1 });
    expect(cleanSettings({}).game).toEqual(DEFAULT_GAME);
  });
});
