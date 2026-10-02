import { beforeAll, describe, expect, test } from 'bun:test';
import loadHighs, { type Highs } from 'highs';
import { data, generatorById, recipeById, transportFor } from '../src/lib/data';
import { DEFAULT_EXTRACTION, planExtraction } from '../src/lib/extraction';
import { fuelRate } from '../src/lib/power';
import { type SolveInput, type SolveResult, solve } from '../src/lib/solver';

/**
 * Hand-checked numbers from the game (1.0): what one building makes a minute at 100%, and whole
 * production lines worked out on paper. Any change to the game data or the solver that moves one of
 * these is either a game update or a wrong number on screen.
 */

let highs: Highs;
beforeAll(async () => {
  highs = await loadHighs();
});

const standard = () => new Set(data.recipes.filter((r) => r.kind === 'standard').map((r) => r.id));
const plan = (patch: Partial<SolveInput>) =>
  solve(highs, { targets: [], supplies: [], enabledRecipes: standard(), resourceCaps: {}, objective: 'resources', ...patch });
const rate = (list: { item: string; rate: number }[], id: string) => list.find((x) => x.item === id)?.rate ?? 0;
const E = 1.321928;

/** In-game recipe sheets: building MW, inputs and outputs per minute for one building at 100%. */
const SHEETS: [string, number, Record<string, number>, Record<string, number>][] = [
  ['Recipe_IngotIron_C', 4, { OreIron: 30 }, { IronIngot: 30 }],
  ['Recipe_IngotCopper_C', 4, { OreCopper: 30 }, { CopperIngot: 30 }],
  ['Recipe_IngotCaterium_C', 4, { OreGold: 45 }, { GoldIngot: 15 }],
  ['Recipe_IngotSteel_C', 16, { OreIron: 45, Coal: 45 }, { SteelIngot: 45 }],
  ['Recipe_IronPlate_C', 4, { IronIngot: 30 }, { IronPlate: 20 }],
  ['Recipe_IronRod_C', 4, { IronIngot: 15 }, { IronRod: 15 }],
  ['Recipe_Screw_C', 4, { IronRod: 10 }, { IronScrew: 40 }],
  ['Recipe_Wire_C', 4, { CopperIngot: 15 }, { Wire: 30 }],
  ['Recipe_Cable_C', 4, { Wire: 60 }, { Cable: 30 }],
  ['Recipe_Concrete_C', 4, { Stone: 45 }, { Cement: 15 }],
  ['Recipe_CopperSheet_C', 4, { CopperIngot: 20 }, { CopperSheet: 10 }],
  ['Recipe_SteelBeam_C', 4, { SteelIngot: 60 }, { SteelPlate: 15 }],
  ['Recipe_SteelPipe_C', 4, { SteelIngot: 30 }, { SteelPipe: 20 }],
  ['Recipe_Quickwire_C', 4, { GoldIngot: 12 }, { HighSpeedWire: 60 }],
  ['Recipe_QuartzCrystal_C', 4, { RawQuartz: 37.5 }, { QuartzCrystal: 22.5 }],
  ['Recipe_Silica_C', 4, { RawQuartz: 22.5 }, { Silica: 37.5 }],
  ['Recipe_Biomass_Leaves_C', 4, { Leaves: 120 }, { GenericBiomass: 60 }],
  ['Recipe_IronPlateReinforced_C', 15, { IronPlate: 30, IronScrew: 60 }, { IronPlateReinforced: 5 }],
  ['Recipe_ModularFrame_C', 15, { IronPlateReinforced: 3, IronRod: 12 }, { ModularFrame: 2 }],
  ['Recipe_Rotor_C', 15, { IronRod: 20, IronScrew: 100 }, { Rotor: 4 }],
  ['Recipe_Stator_C', 15, { SteelPipe: 15, Wire: 40 }, { Stator: 5 }],
  ['Recipe_Motor_C', 15, { Rotor: 10, Stator: 10 }, { Motor: 5 }],
  ['Recipe_EncasedIndustrialBeam_C', 15, { SteelPlate: 18, Cement: 36 }, { SteelPlateReinforced: 6 }],
  ['Recipe_CircuitBoard_C', 15, { CopperSheet: 15, Plastic: 30 }, { CircuitBoard: 7.5 }],
  ['Recipe_AILimiter_C', 15, { CopperSheet: 25, HighSpeedWire: 100 }, { CircuitBoardHighSpeed: 5 }],
  ['Recipe_Computer_C', 55, { CircuitBoard: 10, Cable: 20, Plastic: 40 }, { Computer: 2.5 }],
  [
    'Recipe_ModularFrameHeavy_C',
    55,
    { ModularFrame: 10, SteelPipe: 40, SteelPlateReinforced: 10, IronScrew: 240 },
    { ModularFrameHeavy: 2 },
  ],
  ['Recipe_Plastic_C', 30, { LiquidOil: 30 }, { Plastic: 20, HeavyOilResidue: 10 }],
  ['Recipe_Rubber_C', 30, { LiquidOil: 30 }, { Rubber: 20, HeavyOilResidue: 20 }],
  ['Recipe_LiquidFuel_C', 30, { LiquidOil: 60 }, { LiquidFuel: 40, PolymerResin: 30 }],
  ['Recipe_ResidualFuel_C', 30, { HeavyOilResidue: 60 }, { LiquidFuel: 40 }],
  ['Recipe_ResidualRubber_C', 30, { PolymerResin: 40, Water: 40 }, { Rubber: 20 }],
  ['Recipe_ResidualPlastic_C', 30, { PolymerResin: 60, Water: 20 }, { Plastic: 20 }],
  ['Recipe_PetroleumCoke_C', 30, { HeavyOilResidue: 40 }, { PetroleumCoke: 120 }],
  ['Recipe_AluminaSolution_C', 30, { OreBauxite: 120, Water: 180 }, { AluminaSolution: 120, Silica: 50 }],
  ['Recipe_AluminumScrap_C', 30, { AluminaSolution: 240, Coal: 120 }, { AluminumScrap: 360, Water: 120 }],
  ['Recipe_IngotAluminum_C', 16, { AluminumScrap: 90, Silica: 75 }, { AluminumIngot: 60 }],
  ['Recipe_SulfuricAcid_C', 30, { Sulfur: 50, Water: 50 }, { SulfuricAcid: 50 }],
  ['Recipe_Battery_C', 75, { SulfuricAcid: 50, AluminaSolution: 40, AluminumCasing: 20 }, { Battery: 20, Water: 30 }],
  ['Recipe_Fuel_C', 10, { LiquidFuel: 40, FluidCanister: 40 }, { Fuel: 40 }],
  // Alternates.
  ['Recipe_Alternate_IngotSteel_1_C', 16, { IronIngot: 40, Coal: 40 }, { SteelIngot: 60 }],
  ['Recipe_Alternate_PureIronIngot_C', 30, { OreIron: 35, Water: 20 }, { IronIngot: 65 }],
  ['Recipe_Alternate_Screw_C', 4, { IronIngot: 12.5 }, { IronScrew: 50 }],
  ['Recipe_Alternate_Screw_2_C', 4, { SteelPlate: 5 }, { IronScrew: 260 }],
  ['Recipe_Alternate_WetConcrete_C', 30, { Stone: 120, Water: 100 }, { Cement: 80 }],
  ['Recipe_Alternate_Turbofuel_C', 30, { LiquidFuel: 22.5, CompactedCoal: 15 }, { LiquidTurboFuel: 18.75 }],
];

const flows = (list: { item: string; rate: number }[]) =>
  Object.fromEntries(list.map((s) => [s.item.replace(/^Desc_/, '').replace(/_C$/, ''), s.rate]));

describe('recipe sheets match the game', () => {
  for (const [id, mw, inputs, outputs] of SHEETS) {
    test(id, () => {
      const r = recipeById.get(id);
      expect(r).toBeDefined();
      expect(r!.power).toBe(mw);
      expect(flows(r!.inputs)).toEqual(inputs);
      expect(flows(r!.outputs)).toEqual(outputs);
    });
  }
});

describe('buildings', () => {
  test('clock speed raises power by the 1.321928 exponent', () => {
    for (const m of Object.values(data.machines)) expect(m.powerExp).toBeCloseTo(E, 5);
    for (const e of data.extractors) expect(e.powerExp).toBeCloseTo(E, 5);
  });

  test('somersloop slots: constructor 1, assembler, foundry and refinery 2, manufacturer and blender 4', () => {
    const slots = (id: string) => data.machines[id].somersloopSlots;
    expect(slots('Build_ConstructorMk1_C')).toBe(1);
    expect([slots('Build_AssemblerMk1_C'), slots('Build_FoundryMk1_C'), slots('Build_OilRefinery_C')]).toEqual([2, 2, 2]);
    expect([slots('Build_ManufacturerMk1_C'), slots('Build_Blender_C')]).toEqual([4, 4]);
    expect([slots('Build_SmelterMk1_C'), slots('Build_Packager_C')]).toEqual([0, 0]);
  });

  test('miners and pumps: 60/120/240 ore a minute on a normal node, 5/15/45 MW', () => {
    const ex = (id: string) => data.extractors.find((e) => e.id === id)!;
    expect([ex('Build_MinerMk1_C').rate, ex('Build_MinerMk2_C').rate, ex('Build_MinerMk3_C').rate]).toEqual([60, 120, 240]);
    expect([ex('Build_MinerMk1_C').power, ex('Build_MinerMk2_C').power, ex('Build_MinerMk3_C').power]).toEqual([5, 15, 45]);
    expect([ex('Build_OilPump_C').rate, ex('Build_OilPump_C').power]).toEqual([120, 40]);
    expect([ex('Build_WaterPump_C').rate, ex('Build_WaterPump_C').power]).toEqual([120, 20]);
  });
});

describe('buildings with a power range use its middle', () => {
  test('particle accelerator: diamonds 250–750 MW, plutonium pellets 250–750, nuclear pasta 500–1500', () => {
    expect(recipeById.get('Recipe_Diamond_C')!.power).toBe(500);
    expect(recipeById.get('Recipe_Plutonium_C')!.power).toBe(500);
    expect(recipeById.get('Recipe_SpaceElevatorPart_9_C')!.power).toBe(1000);
  });
  test('converter 100–400 MW, quantum encoder 0–2000 MW', () => {
    expect(recipeById.get('Recipe_Coal_Iron_C')!.power).toBe(250);
    expect(recipeById.get('Recipe_TemporalProcessor_C')!.power).toBe(1000);
  });
  test('alien power augmenter: 500 MW and +10% to the grid, +30% when fed', () => {
    const aug = generatorById.get('Build_AlienPowerBuilding_C')!;
    expect(aug.power).toBe(500);
    expect(aug.boost).toBeCloseTo(0.1);
    expect(aug.boost! + aug.booster!.boost).toBeCloseTo(0.3);
  });
});

describe('generators burn fuel at the in-game rate', () => {
  const coal = generatorById.get('Build_GeneratorCoal_C')!;
  const fuel = generatorById.get('Build_GeneratorFuel_C')!;
  const bio = generatorById.get('Build_GeneratorBiomass_Automated_C')!;
  test('coal generator, 75 MW: 15 coal, 7.14 compacted coal or 25 petroleum coke a minute', () => {
    expect(fuelRate(coal, 'Desc_Coal_C')).toBeCloseTo(15);
    expect(fuelRate(coal, 'Desc_CompactedCoal_C')).toBeCloseTo(75 / 10.5);
    expect(fuelRate(coal, 'Desc_PetroleumCoke_C')).toBeCloseTo(25);
  });
  test('fuel generator, 250 MW: 20 m³ of fuel a minute', () => {
    expect(fuel.power).toBe(250);
    expect(fuelRate(fuel, 'Desc_LiquidFuel_C')).toBeCloseTo(20);
  });
  test('biomass burner, 30 MW: 10 biomass or 4 solid biofuel a minute', () => {
    expect(bio.power).toBe(30);
    expect(fuelRate(bio, 'Desc_GenericBiomass_C')).toBeCloseTo(10);
    expect(fuelRate(bio, 'Desc_Biofuel_C')).toBeCloseTo(4);
  });
});

/** Machines per recipe, the raw input per minute and the MW, compared with a line worked out by hand. */
function expectLine(r: SolveResult, machines: Record<string, number>, raw: Record<string, number>, mw?: number) {
  const counts = Object.fromEntries(r.recipes.map((u) => [u.recipe.id, u.count]));
  expect(Object.keys(counts).sort()).toEqual(Object.keys(machines).sort());
  for (const [id, n] of Object.entries(machines)) expect(counts[id]).toBeCloseTo(n, 4);
  expect(Object.keys(flows(r.raw)).sort()).toEqual(Object.keys(raw).sort());
  for (const [id, x] of Object.entries(raw)) expect(flows(r.raw)[id]).toBeCloseTo(x, 3);
  if (mw !== undefined) expect(r.power).toBeCloseTo(mw, 3);
}

/** MW of `n` machines' worth of work placed on whole buildings: every one at 100% but the last, at what's left. */
const line = (base: number, n: number) => {
  const whole = Math.floor(n + 1e-9);
  const part = n - whole;
  return whole * base + (part > 1e-9 ? base * part ** E : 0);
};

describe('production lines worked out by hand', () => {
  test('5 reinforced plates a minute', () => {
    const r = plan({ targets: [{ item: 'Desc_IronPlateReinforced_C', rate: 5 }] });
    expectLine(
      r,
      {
        Recipe_IronPlateReinforced_C: 1,
        Recipe_IronPlate_C: 1.5,
        Recipe_Screw_C: 1.5,
        Recipe_IronRod_C: 1,
        Recipe_IngotIron_C: 2,
      },
      { OreIron: 60 },
      15 + line(4, 1.5) * 2 + 4 + 8,
    );
  });

  test('5 motors a minute', () => {
    const r = plan({ targets: [{ item: 'Desc_Motor_C', rate: 5 }] });
    expectLine(
      r,
      {
        Recipe_Motor_C: 1,
        Recipe_Rotor_C: 2.5,
        Recipe_Stator_C: 2,
        Recipe_IronRod_C: 7.5,
        Recipe_Screw_C: 6.25,
        Recipe_SteelPipe_C: 1.5,
        Recipe_IngotSteel_C: 1,
        Recipe_Wire_C: 8 / 3,
        Recipe_IngotCopper_C: 4 / 3,
        Recipe_IngotIron_C: 3.75,
      },
      { OreIron: 157.5, Coal: 45, OreCopper: 40 },
      15 + line(15, 2.5) + 2 * 15 + line(4, 7.5) + line(4, 6.25) + line(4, 1.5) + 16 + line(4, 8 / 3) + line(4, 4 / 3) + line(4, 3.75),
    );
  });

  test('2.5 computers a minute, with the plastic refineries leaving heavy oil residue', () => {
    const r = plan({ targets: [{ item: 'Desc_Computer_C', rate: 2.5 }] });
    expectLine(
      r,
      {
        Recipe_Computer_C: 1,
        Recipe_CircuitBoard_C: 4 / 3,
        Recipe_Cable_C: 2 / 3,
        Recipe_Plastic_C: 4,
        Recipe_CopperSheet_C: 2,
        Recipe_Wire_C: 4 / 3,
        Recipe_IngotCopper_C: 2,
      },
      { LiquidOil: 120, OreCopper: 60 },
      55 + line(15, 4 / 3) + line(4, 2 / 3) + 4 * 30 + 2 * 4 + line(4, 4 / 3) + 2 * 4,
    );
    expect(rate(r.surplus, 'Desc_HeavyOilResidue_C')).toBeCloseTo(40);
  });

  test('2 heavy modular frames a minute', () => {
    const r = plan({ targets: [{ item: 'Desc_ModularFrameHeavy_C', rate: 2 }] });
    expectLine(
      r,
      {
        Recipe_ModularFrameHeavy_C: 1,
        Recipe_ModularFrame_C: 5,
        Recipe_IronPlateReinforced_C: 3,
        Recipe_IronPlate_C: 4.5,
        Recipe_Screw_C: 10.5,
        Recipe_IronRod_C: 11,
        Recipe_SteelPipe_C: 2,
        Recipe_EncasedIndustrialBeam_C: 10 / 6,
        Recipe_SteelBeam_C: 2,
        Recipe_Concrete_C: 4,
        Recipe_IngotSteel_C: 4,
        Recipe_IngotIron_C: 10,
      },
      { OreIron: 480, Coal: 180, Stone: 180 },
    );
  });

  test('40 m³ of fuel leaves 30 polymer resin over', () => {
    const r = plan({ targets: [{ item: 'Desc_LiquidFuel_C', rate: 40 }] });
    expectLine(r, { Recipe_LiquidFuel_C: 1 }, { LiquidOil: 60 }, 30);
    expect(rate(r.surplus, 'Desc_PolymerResin_C')).toBeCloseTo(30);
  });

  test('60 aluminum ingots: the alumina byproduct silica counts toward the ingots', () => {
    const r = plan({ targets: [{ item: 'Desc_AluminumIngot_C', rate: 60 }] });
    const counts = Object.fromEntries(r.recipes.map((u) => [u.recipe.id, u.count]));
    expect(counts.Recipe_IngotAluminum_C).toBeCloseTo(1);
    expect(counts.Recipe_AluminumScrap_C).toBeCloseTo(0.25);
    // 90 scrap need 60 alumina solution (half a refinery), which also gives 25 of the 75 silica.
    expect(counts.Recipe_AluminaSolution_C).toBeCloseTo(0.5);
    expect(counts.Recipe_Silica_C).toBeCloseTo(50 / 37.5);
    expect(rate(r.raw, 'Desc_OreBauxite_C')).toBeCloseTo(60);
    expect(rate(r.raw, 'Desc_Coal_C')).toBeCloseTo(30);
    expect(rate(r.raw, 'Desc_RawQuartz_C')).toBeCloseTo(30);
    // The scrap refinery's 30 m³ of water goes back into the alumina, so only 60 is pumped.
    expect(rate(r.raw, 'Desc_Water_C')).toBeCloseTo(60);
  });

  test('an alternate: solid steel ingot turns 40 iron ingots and 40 coal into 60 steel', () => {
    const enabled = standard();
    enabled.add('Recipe_Alternate_IngotSteel_1_C');
    enabled.delete('Recipe_IngotSteel_C');
    const r = plan({ targets: [{ item: 'Desc_SteelIngot_C', rate: 60 }], enabledRecipes: enabled });
    expectLine(r, { Recipe_Alternate_IngotSteel_1_C: 1, Recipe_IngotIron_C: 4 / 3 }, { OreIron: 40, Coal: 40 }, 16 + line(4, 4 / 3));
  });
});

describe('clock speed and somersloops by hand', () => {
  const one = (clock: number, sloops: number, item = 'Desc_IronPlate_C', id = 'Recipe_IronPlate_C', out = 20) => {
    const amp = 1 + sloops / data.machines[recipeById.get(id)!.machine].somersloopSlots;
    const r = plan({ targets: [{ item, rate: out * clock * amp }], mods: { [id]: { clock, sloops } } });
    return r.recipes.find((u) => u.recipe.id === id)!;
  };

  test('a constructor at 200% draws 2.5 times the power; at 250%, about 3.36 times', () => {
    const u = one(2, 0);
    expect(u.built).toBe(1);
    expect(u.shards).toBe(2);
    expect(u.power).toBeCloseTo(10, 3);
    expect(one(2.5, 0).power).toBeCloseTo(4 * 2.5 ** E, 3);
    expect(one(2.5, 0).shards).toBe(3);
  });

  test('a constructor at 50% draws about 40% of its power', () => {
    expect(one(0.5, 0).power).toBeCloseTo(4 * 0.5 ** E, 3);
    expect(one(0.5, 0).power / 4).toBeCloseTo(0.4, 1);
  });

  test('an assembler with both somersloops makes 10 reinforced plates from 5 plates’ worth of input, at 60 MW', () => {
    const u = one(1, 2, 'Desc_IronPlateReinforced_C', 'Recipe_IronPlateReinforced_C', 5);
    expect(u.built).toBe(1);
    expect(rate(u.outputs, 'Desc_IronPlateReinforced_C')).toBeCloseTo(10);
    expect(rate(u.inputs, 'Desc_IronPlate_C')).toBeCloseTo(30);
    expect(u.power).toBeCloseTo(60);
  });

  test('half the slots filled: 1.5× output and 2.25× power', () => {
    const u = one(1, 1, 'Desc_IronPlateReinforced_C', 'Recipe_IronPlateReinforced_C', 5);
    expect(rate(u.outputs, 'Desc_IronPlateReinforced_C')).toBeCloseTo(7.5);
    expect(u.power).toBeCloseTo(15 * 2.25);
  });
});

describe('belts, pipes and extraction by hand', () => {
  const ore = data.items.Desc_OreIron_C;
  const oil = data.items.Desc_LiquidOil_C;
  const belt = (x: number, tier?: number) => {
    const t = transportFor(ore, x, tier);
    return [data.belts.indexOf(t.transport) + 1, t.lanes];
  };
  test('the slowest belt that carries the rate, then extra lanes of the fastest', () => {
    expect(belt(60)).toEqual([1, 1]);
    expect(belt(61)).toEqual([2, 1]);
    expect(belt(480)).toEqual([4, 1]);
    expect(belt(780)).toEqual([5, 1]);
    expect(belt(1200)).toEqual([6, 1]);
    expect(belt(2400)).toEqual([6, 2]);
    expect(belt(2401)).toEqual([6, 3]);
  });
  test('an early tier only offers the belts it has unlocked', () => {
    const [mk, lanes] = belt(480, 0);
    expect(data.belts[mk - 1].tier).toBe(0);
    expect(lanes).toBe(Math.ceil(480 / data.belts[mk - 1].rate));
  });
  test('pipes: Mk.1 up to 300 m³, Mk.2 up to 600, then two pipes', () => {
    expect(transportFor(oil, 300).transport.rate).toBe(300);
    expect(transportFor(oil, 301).transport.rate).toBe(600);
    expect(transportFor(oil, 601)).toMatchObject({ lanes: 2 });
  });
  test('Mk.3 miners: 480 ore on a pure node, 1200 at 250%, drawing 45 × 2.5^1.32 MW', () => {
    const [pure] = planExtraction([{ item: 'Desc_OreIron_C', rate: 480 }], { miner: 'Build_MinerMk3_C', purity: 'pure', clock: 1 });
    expect(pure.built).toBe(1);
    expect(pure.power).toBeCloseTo(45);
    const [fast] = planExtraction([{ item: 'Desc_OreIron_C', rate: 1200 }], {
      miner: 'Build_MinerMk3_C',
      purity: 'pure',
      clock: 2.5,
    });
    expect(fast.built).toBe(1);
    expect(fast.shards).toBe(3);
    expect(fast.power).toBeCloseTo(45 * 2.5 ** E, 3);
  });
  test('a Mk.1 miner on an impure node gives 30 a minute', () => {
    const [u] = planExtraction([{ item: 'Desc_OreIron_C', rate: 90 }], {
      ...DEFAULT_EXTRACTION,
      miner: 'Build_MinerMk1_C',
      purity: 'impure',
    });
    expect(u.built).toBe(3);
    expect(u.power).toBeCloseTo(15);
  });
});
