import { beforeAll, describe, expect, test } from 'bun:test';
import loadHighs, { type Highs } from 'highs';
import { data, generatorById } from '../src/lib/data';
import { fuelRate, geyserPower, gridBoost, type Plant, plantRecipe, unitPower } from '../src/lib/power';
import { gridInput } from '../src/lib/solution';
import { type PowerInput, type SolveInput, solve } from '../src/lib/solver';
import { newGrid } from '../src/store';

let highs: Highs;
beforeAll(async () => {
  highs = await loadHighs();
});

const standard = () => new Set(data.recipes.filter((r) => r.kind === 'standard').map((r) => r.id));
const grid = (plants: Plant[], power: Partial<PowerInput> = {}, patch: Partial<SolveInput> = {}) =>
  solve(highs, {
    targets: [],
    supplies: [],
    enabledRecipes: standard(),
    resourceCaps: {},
    objective: 'resources',
    power: { plants, demand: 0, headroom: 0, extraction: {}, ...power },
    ...patch,
  });
const rate = (list: { item: string; rate: number }[], id: string) => list.find((x) => x.item === id)?.rate ?? 0;
const plant = (p: Partial<Plant> & Pick<Plant, 'generator'>): Plant => ({ id: 'p', by: 'auto', amount: 0, clock: 1, ...p });
const COAL = 'Build_GeneratorCoal_C';
const NUCLEAR = 'Build_GeneratorNuclear_C';

describe('generator data', () => {
  test('ratings and fuel burn match the game', () => {
    const coal = generatorById.get(COAL)!;
    expect(coal.power).toBe(75);
    expect(fuelRate(coal, 'Desc_Coal_C')).toBeCloseTo(15);
    const fuel = generatorById.get('Build_GeneratorFuel_C')!;
    expect(fuel.power).toBe(250);
    expect(fuelRate(fuel, 'Desc_LiquidTurboFuel_C')).toBeCloseTo(7.5);
    expect(fuelRate(generatorById.get(NUCLEAR)!, 'Desc_NuclearFuelRod_C')).toBeCloseTo(0.2);
  });

  test('coal plants drink 45 m³ of water a minute, nuclear 240, and nuclear leaves waste', () => {
    const coal = plantRecipe(plant({ generator: COAL, fuel: 'Desc_Coal_C' }));
    expect(rate(coal.inputs, 'Desc_Water_C')).toBeCloseTo(45);
    const nuke = plantRecipe(plant({ generator: NUCLEAR, fuel: 'Desc_NuclearFuelRod_C' }));
    expect(rate(nuke.inputs, 'Desc_Water_C')).toBeCloseTo(240);
    expect(rate(nuke.outputs, 'Desc_NuclearWaste_C')).toBeCloseTo(10);
  });

  test('geysers average 100, 200 and 400 MW by purity', () => {
    const geo = generatorById.get('Build_GeneratorGeoThermal_C')!;
    expect([geyserPower(geo, 'impure'), geyserPower(geo, 'normal'), geyserPower(geo, 'pure')]).toEqual([100, 200, 400]);
  });

  test('overclocking scales output in a straight line', () => {
    expect(unitPower(plant({ generator: COAL, fuel: 'Desc_Coal_C', clock: 2.5 }))).toBeCloseTo(187.5);
  });
});

describe('sizing plants', () => {
  test('a set count runs exactly that many generators', () => {
    const r = grid([plant({ generator: COAL, fuel: 'Desc_Coal_C', by: 'count', amount: 4 })]);
    const u = r.recipes.find((x) => x.recipe.kind === 'power')!;
    expect(u.built).toBe(4);
    expect(r.grid?.generation).toBeCloseTo(300);
    expect(rate(r.raw, 'Desc_Coal_C')).toBeCloseTo(60);
    expect(rate(r.raw, 'Desc_Water_C')).toBeCloseTo(180);
  });

  test('a set output spreads over underclocked generators', () => {
    const r = grid([plant({ generator: COAL, fuel: 'Desc_Coal_C', by: 'power', amount: 1000 })]);
    const u = r.recipes.find((x) => x.recipe.kind === 'power')!;
    expect(u.count).toBeCloseTo(1000 / 75);
    expect(u.built).toBe(14);
    expect(r.grid?.generation).toBeCloseTo(1000);
  });

  test('auto covers the demand plus the power its own fuel chain uses', () => {
    const extraction = { Desc_Coal_C: 15 / 120, Desc_Water_C: 20 / 120 };
    const r = grid([plant({ generator: COAL, fuel: 'Desc_Coal_C' })], { demand: 750, extraction });
    const gen = r.grid!.generation;
    const chain = rate(r.raw, 'Desc_Coal_C') * extraction.Desc_Coal_C + rate(r.raw, 'Desc_Water_C') * extraction.Desc_Water_C;
    expect(gen).toBeCloseTo(750 + chain + r.power, 3);
    expect(gen).toBeGreaterThan(750);
  });

  test('auto still covers the chain when its lines are overclocked', () => {
    // Placed lines push a few machines far past 100% (fewest shards), which draws more than an even clock.
    const mods = Object.fromEntries([...standard()].map((id) => [id, { clock: 1.5, sloops: 0 }]));
    const r = grid([plant({ generator: 'Build_GeneratorFuel_C', fuel: 'Desc_LiquidFuel_C' })], { demand: 20000 }, { mods });
    expect(r.grid!.generation).toBeGreaterThan(20000 + r.power - 0.5);
    expect(r.grid!.generation).toBeLessThan((20000 + r.power) * 1.01);
  });

  test('spare capacity is kept on top', () => {
    const r = grid([plant({ generator: COAL, fuel: 'Desc_Coal_C' })], { demand: 1000, headroom: 0.1 });
    expect(r.grid!.generation).toBeCloseTo(1100, 3);
  });

  test('fuel is refined from oil by the chain, and its refineries count as load', () => {
    const r = grid([plant({ generator: 'Build_GeneratorFuel_C', fuel: 'Desc_LiquidFuel_C' })], { demand: 2500 });
    expect(r.raw.some((x) => x.item === 'Desc_LiquidOil_C')).toBe(true);
    expect(r.power).toBeGreaterThan(0);
    // The solver counts refineries at full clock; the placed ones run a little under, so a hair is left spare.
    expect(r.grid!.generation).toBeGreaterThanOrEqual(2500 + r.power);
    expect(r.grid!.generation).toBeLessThan(2500 + r.power * 1.1);
    expect(r.missing).toHaveLength(0);
  });
});

describe('augmenters and nuclear', () => {
  test('augmenters add 500 MW each and boost the whole grid, themselves included', () => {
    const coal = plant({ id: 'c', generator: COAL, fuel: 'Desc_Coal_C', by: 'count', amount: 10 });
    const aug = plant({ id: 'a', generator: 'Build_AlienPowerBuilding_C', by: 'count', amount: 1, fed: true });
    expect(gridBoost([coal, aug])).toBeCloseTo(0.3);
    const r = grid([coal, aug]);
    expect(r.grid!.generation).toBeCloseTo((750 + 500) * 1.3);
    // A fed augmenter burns 5 Alien Power Matrix a minute.
    expect(r.recipes.find((u) => u.recipe.id === 'power:a')!.inputs[0]).toEqual({ item: 'Desc_AlienPowerFuel_C', rate: 5 });
  });

  test('a set output is what the plant puts on the grid, boost included', () => {
    const coal = plant({ id: 'c', generator: COAL, fuel: 'Desc_Coal_C', by: 'power', amount: 1000 });
    const aug = plant({ id: 'a', generator: 'Build_AlienPowerBuilding_C', by: 'count', amount: 1 });
    const r = grid([coal, aug]);
    expect(r.grid!.plants.c).toBeCloseTo(1000);
    expect(r.grid!.generation).toBeCloseTo(1000 + 500 * 1.1);
  });

  test('uranium waste is left over, or feeds a plutonium plant when there is one', () => {
    const uranium = plant({ id: 'u', generator: NUCLEAR, fuel: 'Desc_NuclearFuelRod_C', by: 'count', amount: 1 });
    const alone = grid([uranium]);
    expect(rate(alone.surplus, 'Desc_NuclearWaste_C')).toBeCloseTo(10);

    const all = new Set(data.recipes.map((r) => r.id));
    const pu = plant({ id: 'pu', generator: NUCLEAR, fuel: 'Desc_PlutoniumFuelRod_C', by: 'count', amount: 1 });
    const both = grid([uranium, pu], {}, { enabledRecipes: all });
    expect(rate(both.missing, 'Desc_NuclearWaste_C')).toBe(0);
    expect(rate(both.surplus, 'Desc_PlutoniumWaste_C')).toBeCloseTo(1);
  });

  test('fuel with no fuel set is ignored rather than free power', () => {
    const r = grid([plant({ generator: COAL, by: 'count', amount: 3 })]);
    expect(r.grid!.generation).toBe(0);
  });

  test('plants above the unlocked tier sit out, like recipes do', () => {
    const nuke = plant({ id: 'n', generator: NUCLEAR, fuel: 'Desc_NuclearFuelRod_C', by: 'count', amount: 1 });
    const coal = plant({ id: 'c', generator: COAL, fuel: 'Desc_Coal_C', by: 'count', amount: 1 });
    const chain = newGrid().chain;
    expect(gridInput({ plants: [nuke, coal], headroom: 0, chain }, 0, 3)!.power!.plants.map((p) => p.id)).toEqual(['c']);
    expect(gridInput({ plants: [nuke, coal], headroom: 0, chain }, 0, 9)!.power!.plants).toHaveLength(2);
  });
});
