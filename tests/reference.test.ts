import { beforeAll, describe, expect, test } from 'bun:test';
import loadHighs, { type Highs } from 'highs';
import { data, recipeById } from '../src/lib/data';
import { type SolveInput, solve } from '../src/lib/solver';

/**
 * Numbers that come from outside this project. The alternate recipes below are copied from the Satisfactory wiki
 * (https://satisfactory.wiki.gg/wiki/Alternate_recipes, and the pages for Heavy_Modular_Frame, Computer and Motor,
 * read 2026-10-10); the plain recipes are the in-game sheets also used in golden.test.ts. Each plan is then worked out
 * here by a small recursion that knows only these sheets, never the game data or the solver, and compared with what
 * the solver plans. If the app and this file disagree, one of them has a wrong number or a wrong rule.
 */

let highs: Highs;
beforeAll(async () => {
  highs = await loadHighs();
});

type Sheet = { machine: string; inputs: Record<string, number>; outputs: Record<string, number> };

/** Per minute, one building at 100%. */
const SHEETS: Record<string, Sheet> = {
  // Plain recipes (in-game sheets).
  Recipe_IngotIron_C: { machine: 'Build_SmelterMk1_C', inputs: { OreIron: 30 }, outputs: { IronIngot: 30 } },
  Recipe_IngotCopper_C: { machine: 'Build_SmelterMk1_C', inputs: { OreCopper: 30 }, outputs: { CopperIngot: 30 } },
  Recipe_IngotCaterium_C: { machine: 'Build_SmelterMk1_C', inputs: { OreGold: 45 }, outputs: { GoldIngot: 15 } },
  Recipe_IngotSteel_C: { machine: 'Build_FoundryMk1_C', inputs: { OreIron: 45, Coal: 45 }, outputs: { SteelIngot: 45 } },
  Recipe_IronPlate_C: { machine: 'Build_ConstructorMk1_C', inputs: { IronIngot: 30 }, outputs: { IronPlate: 20 } },
  Recipe_IronRod_C: { machine: 'Build_ConstructorMk1_C', inputs: { IronIngot: 15 }, outputs: { IronRod: 15 } },
  Recipe_Screw_C: { machine: 'Build_ConstructorMk1_C', inputs: { IronRod: 10 }, outputs: { IronScrew: 40 } },
  Recipe_Wire_C: { machine: 'Build_ConstructorMk1_C', inputs: { CopperIngot: 15 }, outputs: { Wire: 30 } },
  Recipe_CopperSheet_C: { machine: 'Build_ConstructorMk1_C', inputs: { CopperIngot: 20 }, outputs: { CopperSheet: 10 } },
  Recipe_Concrete_C: { machine: 'Build_ConstructorMk1_C', inputs: { Stone: 45 }, outputs: { Cement: 15 } },
  Recipe_SteelBeam_C: { machine: 'Build_ConstructorMk1_C', inputs: { SteelIngot: 60 }, outputs: { SteelPlate: 15 } },
  Recipe_SteelPipe_C: { machine: 'Build_ConstructorMk1_C', inputs: { SteelIngot: 30 }, outputs: { SteelPipe: 20 } },
  Recipe_IronPlateReinforced_C: {
    machine: 'Build_AssemblerMk1_C',
    inputs: { IronPlate: 30, IronScrew: 60 },
    outputs: { IronPlateReinforced: 5 },
  },
  Recipe_ModularFrame_C: {
    machine: 'Build_AssemblerMk1_C',
    inputs: { IronPlateReinforced: 3, IronRod: 12 },
    outputs: { ModularFrame: 2 },
  },
  Recipe_EncasedIndustrialBeam_C: {
    machine: 'Build_AssemblerMk1_C',
    inputs: { SteelPlate: 18, Cement: 36 },
    outputs: { SteelPlateReinforced: 6 },
  },
  Recipe_ModularFrameHeavy_C: {
    machine: 'Build_ManufacturerMk1_C',
    inputs: { ModularFrame: 10, SteelPipe: 40, SteelPlateReinforced: 10, IronScrew: 240 },
    outputs: { ModularFrameHeavy: 2 },
  },
  // Alternates (wiki).
  Recipe_Alternate_PureIronIngot_C: {
    machine: 'Build_OilRefinery_C',
    inputs: { OreIron: 35, Water: 20 },
    outputs: { IronIngot: 65 },
  },
  Recipe_Alternate_IngotSteel_1_C: {
    machine: 'Build_FoundryMk1_C',
    inputs: { IronIngot: 40, Coal: 40 },
    outputs: { SteelIngot: 60 },
  },
  Recipe_Alternate_CoatedIronPlate_C: {
    machine: 'Build_AssemblerMk1_C',
    inputs: { IronIngot: 37.5, Plastic: 7.5 },
    outputs: { IronPlate: 75 },
  },
  Recipe_Alternate_SteelRod_C: { machine: 'Build_ConstructorMk1_C', inputs: { SteelIngot: 12 }, outputs: { IronRod: 48 } },
  Recipe_Alternate_Screw_C: { machine: 'Build_ConstructorMk1_C', inputs: { IronIngot: 12.5 }, outputs: { IronScrew: 50 } },
  Recipe_Alternate_BoltedFrame_C: {
    machine: 'Build_AssemblerMk1_C',
    inputs: { IronPlateReinforced: 7.5, IronScrew: 140 },
    outputs: { ModularFrame: 5 },
  },
  Recipe_Alternate_ReinforcedIronPlate_2_C: {
    machine: 'Build_AssemblerMk1_C',
    inputs: { IronPlate: 18.75, Wire: 37.5 },
    outputs: { IronPlateReinforced: 5.625 },
  },
  Recipe_Alternate_Rotor_C: {
    machine: 'Build_AssemblerMk1_C',
    inputs: { SteelPipe: 10, Wire: 30 },
    outputs: { Rotor: 5 },
  },
  Recipe_Alternate_Stator_C: {
    machine: 'Build_AssemblerMk1_C',
    inputs: { SteelPipe: 16, HighSpeedWire: 60 },
    outputs: { Stator: 8 },
  },
  Recipe_Alternate_CopperRotor_C: {
    machine: 'Build_AssemblerMk1_C',
    inputs: { CopperSheet: 22.5, IronScrew: 195 },
    outputs: { Rotor: 11.25 },
  },
  Recipe_Alternate_Cable_1_C: {
    machine: 'Build_AssemblerMk1_C',
    inputs: { Wire: 45, Rubber: 30 },
    outputs: { Cable: 100 },
  },
  Recipe_Alternate_Quickwire_C: {
    machine: 'Build_AssemblerMk1_C',
    inputs: { GoldIngot: 7.5, CopperIngot: 37.5 },
    outputs: { HighSpeedWire: 90 },
  },
  Recipe_Alternate_PureCateriumIngot_C: {
    machine: 'Build_OilRefinery_C',
    inputs: { OreGold: 24, Water: 24 },
    outputs: { GoldIngot: 12 },
  },
  Recipe_Alternate_ElectroAluminumScrap_C: {
    machine: 'Build_OilRefinery_C',
    inputs: { AluminaSolution: 180, PetroleumCoke: 60 },
    outputs: { AluminumScrap: 300, Water: 105 },
  },
  Recipe_Alternate_InstantScrap_C: {
    machine: 'Build_Blender_C',
    inputs: { OreBauxite: 150, Coal: 100, SulfuricAcid: 50, Water: 60 },
    outputs: { AluminumScrap: 300, Water: 50 },
  },
  Recipe_Alternate_HeavyOilResidue_C: {
    machine: 'Build_OilRefinery_C',
    inputs: { LiquidOil: 30 },
    outputs: { HeavyOilResidue: 40, PolymerResin: 20 },
  },
  Recipe_Alternate_DilutedFuel_C: {
    machine: 'Build_Blender_C',
    inputs: { HeavyOilResidue: 50, Water: 100 },
    outputs: { LiquidFuel: 100 },
  },
  Recipe_Alternate_WetConcrete_C: {
    machine: 'Build_OilRefinery_C',
    inputs: { Stone: 120, Water: 100 },
    outputs: { Cement: 80 },
  },
  Recipe_Alternate_FusedWire_C: {
    machine: 'Build_AssemblerMk1_C',
    inputs: { CopperIngot: 12, GoldIngot: 3 },
    outputs: { Wire: 90 },
  },
  Recipe_Alternate_Wire_1_C: { machine: 'Build_ConstructorMk1_C', inputs: { IronIngot: 12.5 }, outputs: { Wire: 22.5 } },
  Recipe_Alternate_ModularFrameHeavy_C: {
    machine: 'Build_ManufacturerMk1_C',
    inputs: { ModularFrame: 7.5, SteelPlateReinforced: 9.375, SteelPipe: 33.75, Cement: 20.625 },
    outputs: { ModularFrameHeavy: 2.8125 },
  },
  Recipe_Alternate_HeavyFlexibleFrame_C: {
    machine: 'Build_ManufacturerMk1_C',
    inputs: { ModularFrame: 18.75, SteelPlateReinforced: 11.25, Rubber: 75, IronScrew: 390 },
    outputs: { ModularFrameHeavy: 3.75 },
  },
  Recipe_Alternate_Computer_1_C: {
    machine: 'Build_ManufacturerMk1_C',
    inputs: { CircuitBoard: 15, HighSpeedWire: 52.5, Rubber: 22.5 },
    outputs: { Computer: 3.75 },
  },
  Recipe_Alternate_Computer_2_C: {
    machine: 'Build_AssemblerMk1_C',
    inputs: { CircuitBoard: 5, CrystalOscillator: 5 / 3 },
    outputs: { Computer: 10 / 3 },
  },
  Recipe_Alternate_ElectricMotor_C: {
    machine: 'Build_AssemblerMk1_C',
    inputs: { ElectromagneticControlRod: 3.75, Rotor: 7.5 },
    outputs: { Motor: 7.5 },
  },
  Recipe_Alternate_Motor_1_C: {
    machine: 'Build_ManufacturerMk1_C',
    inputs: { Rotor: 3.75, Stator: 3.75, CrystalOscillator: 1.25 },
    outputs: { Motor: 7.5 },
  },
};

const short = (id: string) => id.replace(/^Desc_/, '').replace(/_C$/, '');
const flows = (list: { item: string; rate: number }[]) => Object.fromEntries(list.map((s) => [short(s.item), s.rate]));

describe('recipe sheets from the wiki match the game data', () => {
  for (const [id, sheet] of Object.entries(SHEETS)) {
    test(id, () => {
      const r = recipeById.get(id);
      expect(r).toBeDefined();
      expect(r!.machine).toBe(sheet.machine);
      const near = (got: Record<string, number>, want: Record<string, number>) => {
        expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort());
        for (const [k, v] of Object.entries(want)) expect(got[k]).toBeCloseTo(v, 3);
      };
      near(flows(r!.inputs), sheet.inputs);
      near(flows(r!.outputs), sheet.outputs);
    });
  }
});

/** The raw input per minute of a chain, made with one named recipe per product and no choice left to the solver. */
function raw(item: string, rate: number, use: Record<string, string>, into: Record<string, number> = {}) {
  const id = use[item];
  if (!id) {
    into[item] = (into[item] ?? 0) + rate;
    return into;
  }
  const sheet = SHEETS[id];
  const scale = rate / sheet.outputs[item];
  for (const [inp, n] of Object.entries(sheet.inputs)) raw(inp, n * scale, use, into);
  return into;
}

const plan = (target: string, rate: number, use: Record<string, string>) => {
  const input: SolveInput = {
    targets: [{ item: `Desc_${target}_C`, rate }],
    supplies: [],
    enabledRecipes: new Set(Object.values(use)),
    resourceCaps: {},
    objective: 'resources',
  };
  return solve(highs, input);
};

const BASE = {
  IronIngot: 'Recipe_IngotIron_C',
  IronPlate: 'Recipe_IronPlate_C',
  IronRod: 'Recipe_IronRod_C',
  IronScrew: 'Recipe_Screw_C',
  CopperIngot: 'Recipe_IngotCopper_C',
  Wire: 'Recipe_Wire_C',
  CopperSheet: 'Recipe_CopperSheet_C',
  IronPlateReinforced: 'Recipe_IronPlateReinforced_C',
  SteelIngot: 'Recipe_IngotSteel_C',
  SteelPipe: 'Recipe_SteelPipe_C',
  SteelPlate: 'Recipe_SteelBeam_C',
  Cement: 'Recipe_Concrete_C',
};

/** [name, target, rate per minute, the recipe used for each product on the way]. */
const PLANS: [string, string, number, Record<string, string>][] = [
  ['reinforced iron plate, plain', 'IronPlateReinforced', 5, BASE],
  ['modular frame, plain', 'ModularFrame', 2, { ...BASE, ModularFrame: 'Recipe_ModularFrame_C' }],
  ['modular frame, Bolted Frame', 'ModularFrame', 5, { ...BASE, ModularFrame: 'Recipe_Alternate_BoltedFrame_C' }],
  [
    'reinforced iron plate, Stitched Iron Plate with Iron Wire',
    'IronPlateReinforced',
    5.625,
    { ...BASE, IronPlateReinforced: 'Recipe_Alternate_ReinforcedIronPlate_2_C', Wire: 'Recipe_Alternate_Wire_1_C' },
  ],
  ['rotor, Copper Rotor', 'Rotor', 11.25, { ...BASE, Rotor: 'Recipe_Alternate_CopperRotor_C' }],
  [
    'rotor, Steel Rotor with Solid Steel Ingot',
    'Rotor',
    5,
    { ...BASE, Rotor: 'Recipe_Alternate_Rotor_C', SteelIngot: 'Recipe_Alternate_IngotSteel_1_C' },
  ],
  [
    'stator, Quickwire Stator with Fused Quickwire and Pure Caterium Ingot',
    'Stator',
    8,
    {
      ...BASE,
      Stator: 'Recipe_Alternate_Stator_C',
      HighSpeedWire: 'Recipe_Alternate_Quickwire_C',
      GoldIngot: 'Recipe_Alternate_PureCateriumIngot_C',
    },
  ],
  ['iron ingot, Pure Iron Ingot', 'IronIngot', 65, { IronIngot: 'Recipe_Alternate_PureIronIngot_C' }],
  [
    'wire, Fused Wire with Caterium Ingot',
    'Wire',
    90,
    { Wire: 'Recipe_Alternate_FusedWire_C', CopperIngot: 'Recipe_IngotCopper_C', GoldIngot: 'Recipe_IngotCaterium_C' },
  ],
  [
    'heavy modular frame, plain',
    'ModularFrameHeavy',
    2,
    {
      ...BASE,
      ModularFrameHeavy: 'Recipe_ModularFrameHeavy_C',
      ModularFrame: 'Recipe_ModularFrame_C',
      SteelPlateReinforced: 'Recipe_EncasedIndustrialBeam_C',
    },
  ],
  [
    'heavy modular frame, Heavy Encased Frame with Wet Concrete',
    'ModularFrameHeavy',
    2.8125,
    {
      ...BASE,
      ModularFrameHeavy: 'Recipe_Alternate_ModularFrameHeavy_C',
      ModularFrame: 'Recipe_ModularFrame_C',
      SteelPlateReinforced: 'Recipe_EncasedIndustrialBeam_C',
      Cement: 'Recipe_Alternate_WetConcrete_C',
    },
  ],
  [
    'modular frame, Bolted Frame with Cast Screws and Steel Rod',
    'ModularFrame',
    10,
    {
      ...BASE,
      ModularFrame: 'Recipe_Alternate_BoltedFrame_C',
      IronScrew: 'Recipe_Alternate_Screw_C',
      IronRod: 'Recipe_Alternate_SteelRod_C',
    },
  ],
];

describe('plans worked out from the wiki sheets', () => {
  for (const [name, target, rate, use] of PLANS) {
    test(name, () => {
      const want = raw(target, rate, use);
      const got = flows(plan(target, rate, use).raw);
      expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort());
      for (const [k, v] of Object.entries(want)) expect(got[k]).toBeCloseTo(v, 3);
    });
  }
});

test('every recipe named here exists', () => {
  for (const id of Object.keys(SHEETS)) expect(data.recipes.some((r) => r.id === id)).toBe(true);
});
