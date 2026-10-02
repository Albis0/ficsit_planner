import { beforeAll, describe, expect, test } from 'bun:test';
import loadHighs, { type Highs } from 'highs';
import { data } from '../src/lib/data';
import { toFailure } from '../src/lib/solveFailure';
import { DEFAULT_EXTRACTION, extractorCost, planExtraction } from '../src/lib/extraction';
import { fewerLines, fewestBuildings, heldByPins, SolverError, type SolveInput, solve } from '../src/lib/solver';

let highs: Highs;
beforeAll(async () => {
  highs = await loadHighs();
});

const standard = () => new Set(data.recipes.filter((r) => r.kind === 'standard').map((r) => r.id));
const plan = (patch: Partial<SolveInput>) =>
  solve(highs, { targets: [], supplies: [], enabledRecipes: standard(), resourceCaps: {}, objective: 'resources', ...patch });
const count = (r: ReturnType<typeof plan>, id: string) => r.recipes.find((u) => u.recipe.id === id)?.count ?? 0;
const rate = (list: { item: string; rate: number }[], id: string) => list.find((x) => x.item === id)?.rate ?? 0;

describe('standard chains', () => {
  test('60 iron plates = 3 smelters + 3 constructors on 90 ore', () => {
    const r = plan({ targets: [{ item: 'Desc_IronPlate_C', rate: 60 }] });
    expect(count(r, 'Recipe_IngotIron_C')).toBeCloseTo(3);
    expect(count(r, 'Recipe_IronPlate_C')).toBeCloseTo(3);
    expect(rate(r.raw, 'Desc_OreIron_C')).toBeCloseTo(90);
    // Smelter 4 MW + constructor 4 MW, all at 100%.
    expect(r.power).toBeCloseTo(24);
  });

  test('10 modular frames need 5 assemblers', () => {
    const r = plan({ targets: [{ item: 'Desc_ModularFrame_C', rate: 10 }] });
    expect(count(r, 'Recipe_ModularFrame_C')).toBeCloseTo(5);
  });

  test('plastic leaves heavy oil residue as surplus', () => {
    const r = plan({ targets: [{ item: 'Desc_Plastic_C', rate: 60 }] });
    expect(rate(r.raw, 'Desc_LiquidOil_C')).toBeCloseTo(90);
    expect(rate(r.surplus, 'Desc_HeavyOilResidue_C')).toBeCloseTo(30);
  });

  test('underclocking lowers power below linear', () => {
    // 45 plates = 2.25 constructors -> 2 built at 100% and 1 at 25%.
    const r = plan({ targets: [{ item: 'Desc_IronPlate_C', rate: 45 }] });
    const plates = r.recipes.find((u) => u.recipe.id === 'Recipe_IronPlate_C')!;
    expect(plates.clocks).toEqual([1, 1, expect.closeTo(0.25, 6)]);
    expect(plates.power).toBeCloseTo(2 * 4 + 4 * 0.25 ** 1.321929);
    expect(plates.power).toBeLessThan(2.25 * 4);
  });

  test('average clocks: every machine at the same clock, for a little less power than all full and a single one', () => {
    // 45 plates = 2.25 constructors -> 3 built at 75%.
    const target = { targets: [{ item: 'Desc_IronPlate_C', rate: 45 }] };
    const average = plan({ ...target, clocks: 'average' }).recipes.find((u) => u.recipe.id === 'Recipe_IronPlate_C')!;
    const single = plan(target).recipes.find((u) => u.recipe.id === 'Recipe_IronPlate_C')!;
    expect(average.clocks).toEqual([0.75, 0.75, 0.75]);
    expect(average.power).toBeCloseTo(3 * 4 * 0.75 ** 1.321929);
    expect(average.power).toBeLessThan(single.power);
    expect(average.inputs).toEqual(single.inputs);
  });
});

describe('inputs and limits', () => {
  test('on-hand supply replaces production', () => {
    const r = plan({ targets: [{ item: 'Desc_IronPlate_C', rate: 60 }], supplies: [{ item: 'Desc_IronPlate_C', rate: 60 }] });
    expect(r.recipes).toHaveLength(0);
    expect(r.raw).toHaveLength(0);
  });

  test('disabled recipe shows up as a missing input', () => {
    const enabled = standard();
    enabled.delete('Recipe_IngotIron_C');
    const r = plan({ targets: [{ item: 'Desc_IronPlate_C', rate: 60 }], enabledRecipes: enabled });
    expect(rate(r.missing, 'Desc_IronIngot_C')).toBeCloseTo(90);
  });

  test('a resource cap below demand is infeasible', () => {
    expect(() => plan({ targets: [{ item: 'Desc_IronPlate_C', rate: 60 }], resourceCaps: { Desc_OreIron_C: 10 } })).toThrow();
  });

  const failure = (patch: Partial<SolveInput>) => {
    try {
      plan(patch);
    } catch (e) {
      return e;
    }
  };

  test('a failed solve says why with a code the UI can translate', () => {
    const capped = failure({ targets: [{ item: 'Desc_IronPlate_C', rate: 60 }], resourceCaps: { Desc_OreIron_C: 10 } });
    expect(capped).toBeInstanceOf(SolverError);
    expect(toFailure(capped)).toEqual({ code: 'infeasible', status: 'Infeasible' });

    // With the ingot recipe off, pinned ore can't reach the plates, so there is nothing to scale.
    const enabled = standard();
    enabled.delete('Recipe_IngotIron_C');
    const pinned = failure({ targets: [{ item: 'Desc_IronPlate_C', rate: 10 }], enabledRecipes: enabled, fixed: { Desc_OreIron_C: 60 } });
    expect(toFailure(pinned)).toEqual({ code: 'pinnedInfeasible', status: undefined });
  });

  test('an item whose only recipes loop back to it is brought in, not a dead end', () => {
    // At tier 5 rocket fuel only comes from unpacking packaged rocket fuel, and compacted coal only off ionized fuel.
    const { recipeUnlocked } = require('../src/lib/data');
    const tier5 = new Set(data.recipes.filter((r) => r.kind === 'standard' && recipeUnlocked(r, 5)).map((r) => r.id));
    const coal = plan({ targets: [{ item: 'Desc_CompactedCoal_C', rate: 10 }], enabledRecipes: tier5 });
    expect(rate(coal.missing, 'Desc_CompactedCoal_C')).toBeCloseTo(10);
    const rocket = plan({ targets: [{ item: 'Desc_RocketFuel_C', rate: 10 }], enabledRecipes: tier5 });
    expect(rocket.missing.length).toBeGreaterThan(0);
  });

  test('unexpected errors become a generic stop', () => {
    expect(toFailure(new Error('wasm abort'))).toEqual({ code: 'stopped', status: 'wasm abort' });
  });

  test('alternates get used when they save scarce resources', () => {
    const all = new Set(data.recipes.filter((r) => r.kind !== 'converter').map((r) => r.id));
    const base = plan({ targets: [{ item: 'Desc_Computer_C', rate: 5 }] });
    const alt = plan({ targets: [{ item: 'Desc_Computer_C', rate: 5 }], enabledRecipes: all });
    const weight = (r: typeof base) => r.raw.reduce((s, x) => s + x.rate * (x.item === 'Desc_Water_C' ? 0 : 1), 0);
    expect(weight(alt)).toBeLessThan(weight(base));
    expect(alt.recipes.some((u) => u.recipe.kind === 'alternate')).toBe(true);
  });
});

describe('game data', () => {
  test('belt and pipe tiers match the game', () => {
    expect(data.belts.map((b) => b.rate)).toEqual([60, 120, 270, 480, 780, 1200]);
    expect(data.pipes.map((p) => p.rate)).toEqual([300, 600]);
  });

  test('fluids are in m³ per minute', () => {
    const plastic = data.recipes.find((r) => r.id === 'Recipe_Plastic_C')!;
    expect(plastic.inputs[0]).toEqual({ item: 'Desc_LiquidOil_C', rate: 30 });
  });
});

describe('clock speed and somersloops', () => {
  const plates = (mods: SolveInput['mods']) => plan({ targets: [{ item: 'Desc_IronPlate_C', rate: 60 }], mods });
  const use = (r: ReturnType<typeof plan>, id: string) => r.recipes.find((u) => u.recipe.id === id)!;

  test('250% overclock evens out to fewer machines', () => {
    const r = plates({ Recipe_IronPlate_C: { clock: 2.5, sloops: 0 } });
    const u = use(r, 'Recipe_IronPlate_C');
    // 60 plates / (20 × 2.5) = 1.2 machines -> 2 built at 150%, which needs just 1 shard each.
    expect(u.count).toBeCloseTo(1.2);
    expect(u.built).toBe(2);
    expect(u.shards).toBe(2);
    expect(u.clock).toBeCloseTo(1.5);
  });

  test('a full somersloop doubles output with the same input and 4x power', () => {
    const base = use(plates({}), 'Recipe_IronPlate_C');
    const looped = plates({ Recipe_IronPlate_C: { clock: 1, sloops: 1 } });
    const u = use(looped, 'Recipe_IronPlate_C');
    expect(u.count).toBeCloseTo(1.5);
    expect(rate(u.inputs, 'Desc_IronIngot_C')).toBeCloseTo(45);
    expect(rate(looped.raw, 'Desc_OreIron_C')).toBeCloseTo(45);
    // 1.5 machines -> 1 built at 100% and 1 at 50%, each at 4 MW × 2² × its clock^1.321928.
    expect(u.power).toBeCloseTo(4 * 4 * (1 + 0.5 ** 1.321929), 3);
    expect(base.sloops).toBe(0);
    expect(u.sloops).toBe(2);
  });

  test('sloops are clamped to the building slot count', () => {
    const u = use(plates({ Recipe_IronPlate_C: { clock: 1, sloops: 4 } }), 'Recipe_IronPlate_C');
    expect(u.sloops / u.built).toBe(data.machines.Build_ConstructorMk1_C.somersloopSlots);
  });
});

describe('extraction', () => {
  const { planExtraction } = require('../src/lib/extraction');
  test('240 iron ore = 2 Mk.2 miners on normal nodes, 1 on pure', () => {
    const [u] = planExtraction([{ item: 'Desc_OreIron_C', rate: 240 }], { miner: 'Build_MinerMk2_C', purity: 'normal', clock: 1 });
    expect(u.extractor.id).toBe('Build_MinerMk2_C');
    expect(u.counts).toEqual({ impure: 4, normal: 2, pure: 1 });
    expect(u.power).toBeCloseTo(30);
  });

  test('fluids use their own pumps; water ignores purity', () => {
    const [oil, water, n2] = planExtraction(
      [
        { item: 'Desc_LiquidOil_C', rate: 300 },
        { item: 'Desc_Water_C', rate: 240 },
        { item: 'Desc_NitrogenGas_C', rate: 60 },
      ],
      { miner: 'Build_MinerMk1_C', purity: 'normal', clock: 1 },
    );
    expect(oil.extractor.id).toBe('Build_OilPump_C');
    expect(oil.built).toBe(3);
    expect(water.extractor.id).toBe('Build_WaterPump_C');
    expect(water.counts.impure).toBe(2);
    expect(n2.extractor.id).toBe('Build_FrackingExtractor_C');
  });
});

describe('pinned inputs', () => {
  test('pinning iron ore scales the targets to fit', () => {
    // 10 modular frames need 240 ore; with 480 ore pinned the plan doubles.
    const r = plan({ targets: [{ item: 'Desc_ModularFrame_C', rate: 10 }], fixed: { Desc_OreIron_C: 480 } });
    expect(r.scale).toBeCloseTo(2, 5);
    expect(rate(r.targets, 'Desc_ModularFrame_C')).toBeCloseTo(20, 4);
    expect(rate(r.raw, 'Desc_OreIron_C')).toBeCloseTo(480, 3);
  });

  test('pinning below demand scales down', () => {
    const r = plan({ targets: [{ item: 'Desc_IronPlate_C', rate: 60 }], fixed: { Desc_OreIron_C: 45 } });
    expect(rate(r.targets, 'Desc_IronPlate_C')).toBeCloseTo(30, 4);
  });
});

describe('auto placement', () => {
  const { autoAssign } = require('../src/lib/solver');
  test('stays within the somersloop and shard stock', () => {
    const input = {
      targets: [{ item: 'Desc_ModularFrame_C', rate: 10 }],
      supplies: [],
      enabledRecipes: standard(),
      resourceCaps: {},
      objective: 'resources' as const,
    };
    const mods = autoAssign(highs, input, { sloops: 5, shards: 6 });
    const r = solve(highs, { ...input, mods });
    expect(r.sloops).toBeLessThanOrEqual(5);
    expect(r.shards).toBeLessThanOrEqual(6);
    expect(r.sloops).toBeGreaterThan(0);
    // Somersloops cut raw ore below the plain 240.
    expect(rate(r.raw, 'Desc_OreIron_C')).toBeLessThan(240);
  });
});

describe('auto placement fills leftovers', () => {
  const { autoAssign } = require('../src/lib/solver');
  test('uses the whole somersloop stock when machines can take it', () => {
    const input = {
      targets: [
        { item: 'Desc_ModularFrame_C', rate: 10 },
        { item: 'Desc_Rotor_C', rate: 4 },
      ],
      supplies: [],
      enabledRecipes: standard(),
      resourceCaps: {},
      objective: 'resources' as const,
    };
    const mods = autoAssign(highs, input, { sloops: 4, shards: 0 });
    const r = solve(highs, { ...input, mods });
    expect(r.sloops).toBe(4);
  });
});

describe('small shard stock', () => {
  const { autoAssign } = require('../src/lib/solver');
  const { recipeUnlocked } = require('../src/lib/data');
  test('2 shards still get placed: a couple of machines overclock, the rest stay at 100%', () => {
    const input = {
      targets: [{ item: 'Desc_ModularFrame_C', rate: 10 }],
      supplies: [],
      enabledRecipes: new Set(data.recipes.filter((r) => r.kind === 'standard' && recipeUnlocked(r, 3)).map((r) => r.id)),
      resourceCaps: {},
      objective: 'power' as const,
    };
    const before = solve(highs, input);
    const mods = autoAssign(highs, input, { sloops: 0, shards: 2 });
    const after = solve(highs, { ...input, mods });
    expect(after.shards).toBeGreaterThan(0);
    expect(after.shards).toBeLessThanOrEqual(2);
    const machines = (r: typeof after) => r.recipes.reduce((s, u) => s + u.built, 0);
    expect(machines(after)).toBeLessThan(machines(before));
    const boosted = after.recipes.find((u) => u.shards > 0)!;
    expect(boosted.clocks.some((c) => c === 1)).toBe(true);
  });
});

describe('shards on a big line', () => {
  const { autoAssign } = require('../src/lib/solver');
  const { recipeUnlocked } = require('../src/lib/data');
  test('30 frames/min at tier 3: 2 shards get used and take a machine off the biggest line', () => {
    const input = {
      targets: [{ item: 'Desc_ModularFrame_C', rate: 30 }],
      supplies: [],
      enabledRecipes: new Set(data.recipes.filter((r) => r.kind === 'standard' && recipeUnlocked(r, 3)).map((r) => r.id)),
      resourceCaps: {},
      objective: 'power' as const,
    };
    const before = solve(highs, input);
    const mods = autoAssign(highs, input, { sloops: 0, shards: 2 });
    const after = solve(highs, { ...input, mods });
    expect(after.shards).toBe(2);
    const machines = (r: typeof after) => r.recipes.reduce((s, u) => s + u.built, 0);
    expect(machines(after)).toBe(machines(before) - 1);
    expect(rate(after.targets, 'Desc_ModularFrame_C')).toBeCloseTo(30);
  });
});

describe('use all', () => {
  const { autoAssign } = require('../src/lib/solver');
  const { overclockExtractors, planExtraction, DEFAULT_EXTRACTION } = require('../src/lib/extraction');
  const input = (item: string, rate: number): SolveInput => ({
    targets: [{ item, rate }],
    supplies: [],
    enabledRecipes: standard(),
    resourceCaps: {},
    objective: 'resources',
  });

  test('fills free somersloop slots that best-places-only leaves empty, never above the stock', () => {
    const best = solve(highs, {
      ...input('Desc_ModularFrame_C', 10),
      mods: autoAssign(highs, input('Desc_ModularFrame_C', 10), { sloops: 10, shards: 0 }),
    });
    const all = solve(highs, {
      ...input('Desc_ModularFrame_C', 10),
      mods: autoAssign(highs, input('Desc_ModularFrame_C', 10), { sloops: 10, shards: 0 }, true),
    });
    expect(all.sloops).toBeGreaterThanOrEqual(best.sloops);
    expect(all.sloops).toBeLessThanOrEqual(10);
  });

  test('spare shards go into the extractors with the most buildings, cutting their count', () => {
    const r = solve(highs, input('Desc_IronPlate_C', 120));
    const before = planExtraction(r.raw, DEFAULT_EXTRACTION);
    const clocks = overclockExtractors(r.raw, DEFAULT_EXTRACTION, 6);
    const after = planExtraction(r.raw, { ...DEFAULT_EXTRACTION, overclock: clocks });
    const ore = (list: { item: string; built: number; shards: number }[]) => list.find((u) => u.item === 'Desc_OreIron_C')!;
    // 180 ore on Mk.2 normal (120 each): 2 miners, one of them half idle; 1 at 150% takes 1 shard.
    expect(ore(before)).toMatchObject({ built: 2, shards: 0 });
    expect(ore(after)).toMatchObject({ built: 1, shards: 1 });
    expect(after.reduce((n: number, u: { shards: number }) => n + u.shards, 0)).toBeLessThanOrEqual(6);
  });
});

describe('pinned inputs and ticked alternates', () => {
  const withPure = () => new Set([...standard(), 'Recipe_PureAluminumIngot_C']);
  const ingots = [{ item: 'Desc_AluminumIngot_C', rate: 60 }];

  test('unpinned, the plan takes Pure Aluminum Ingot and nothing is held back', () => {
    const r = plan({ targets: ingots, enabledRecipes: withPure() });
    expect(count(r, 'Recipe_PureAluminumIngot_C')).toBeGreaterThan(0);
    expect(
      heldByPins(highs, { targets: ingots, supplies: [], enabledRecipes: withPure(), resourceCaps: {}, objective: 'resources' }, r),
    ).toEqual([]);
  });

  test("pinning bauxite scales the plan's own recipe instead of pulling in quartz to stretch it", () => {
    const input: SolveInput = {
      targets: ingots,
      supplies: [],
      enabledRecipes: withPure(),
      resourceCaps: {},
      objective: 'resources',
      fixed: { Desc_OreBauxite_C: 120 },
    };
    const r = solve(highs, input);
    expect(count(r, 'Recipe_PureAluminumIngot_C')).toBeGreaterThan(0);
    expect(rate(r.raw, 'Desc_RawQuartz_C')).toBe(0);
    expect(heldByPins(highs, input, r)).toEqual([]);
  });

  test("a pin isn't swapped for an unpinned resource: copper and iron pinned for automated wiring", () => {
    const ticked = new Set(data.recipes.filter((x) => x.kind === 'standard' || x.kind === 'alternate').map((x) => x.id));
    const targets = [{ item: 'Desc_SpaceElevatorPart_3_C', rate: 5 }];
    const free = plan({ targets, enabledRecipes: ticked });
    const r = plan({ targets, enabledRecipes: ticked, fixed: { Desc_OreCopper_C: 60, Desc_OreIron_C: 60 } });
    // Every other resource stays within what the unpinned plan takes per unit of wiring.
    for (const x of r.raw) {
      if (x.item === 'Desc_OreCopper_C' || x.item === 'Desc_OreIron_C' || x.item === 'Desc_Water_C') continue;
      expect(x.rate).toBeLessThanOrEqual(rate(free.raw, x.item) * r.scale + 1e-4);
    }
    expect(r.scale).toBeLessThan(2);
    expect(rate(r.raw, 'Desc_OreGold_C')).toBe(0);
  });

  test('a pin that changes nothing names nothing', () => {
    const input: SolveInput = {
      targets: [{ item: 'Desc_IronPlate_C', rate: 60 }],
      supplies: [],
      enabledRecipes: withPure(),
      resourceCaps: {},
      objective: 'resources',
      fixed: { Desc_OreIron_C: 90 },
    };
    expect(heldByPins(highs, input, solve(highs, input))).toEqual([]);
  });
});

describe('equal resource weights', () => {
  test('Silica: by rarity Cheap Silica spares quartz with limestone; all equal, the standard recipe needs less in all', () => {
    const base = { targets: [{ item: 'Desc_Silica_C', rate: 60 }], enabledRecipes: new Set([...standard(), 'Recipe_Alternate_Silica_C']) };
    const rarity = plan(base);
    const equal = plan({ ...base, equalWeights: true });
    expect(count(rarity, 'Recipe_Alternate_Silica_C')).toBeGreaterThan(0);
    expect(rate(rarity.raw, 'Desc_Stone_C')).toBeGreaterThan(0);
    expect(count(equal, 'Recipe_Alternate_Silica_C')).toBe(0);
    expect(rate(equal.raw, 'Desc_Stone_C')).toBe(0);
  });

  test('uranium stops being avoided when every resource costs the same', () => {
    const weigh = (equalWeights: boolean) =>
      plan({ targets: [{ item: 'Desc_IronPlate_C', rate: 60 }], equalWeights }).prices.get('Desc_OreIron_C') ?? 0;
    expect(weigh(true)).toBeCloseTo(1);
    expect(weigh(false)).toBeCloseTo(1);
    const uranium = (equalWeights: boolean) =>
      plan({ targets: [{ item: 'Desc_OreUranium_C', rate: 1 }], equalWeights }).prices.get('Desc_OreUranium_C');
    expect(uranium(true)).toBeCloseTo(1);
    expect(uranium(false)).toBeGreaterThan(40);
  });

  test('water stays free with equal weights', () => {
    const r = plan({ targets: [{ item: 'Desc_Water_C', rate: 120 }], equalWeights: true });
    expect(r.prices.get('Desc_Water_C') ?? 0).toBeLessThan(1e-3);
  });
});

describe('fewest buildings', () => {
  const all = () => new Set(data.recipes.filter((r) => r.kind !== 'power').map((r) => r.id));
  const machines = (r: ReturnType<typeof plan>) => r.recipes.reduce((n, u) => n + u.built, 0);

  test('picks the alternate that needs fewer machines even when it uses more of the rarer ore', () => {
    const enabledRecipes = new Set([...standard(), 'Recipe_Alternate_AdheredIronPlate_C']);
    const targets = [{ item: 'Desc_IronPlateReinforced_C', rate: 60 }];
    const byOre = plan({ targets, enabledRecipes });
    const byMachines = plan({ targets, enabledRecipes, objective: 'buildings' });
    expect(count(byOre, 'Recipe_Alternate_AdheredIronPlate_C')).toBe(0);
    expect(count(byMachines, 'Recipe_Alternate_AdheredIronPlate_C')).toBeGreaterThan(0);
    expect(machines(byMachines)).toBeLessThan(machines(byOre));
  });

  test('with every alternate on, tidying keeps the machines down without a recipe for every sliver', () => {
    const input = { targets: [{ item: 'Desc_Motor_C', rate: 10 }], enabledRecipes: all(), objective: 'buildings' as const };
    const spread = plan(input);
    const tidy = fewerLines(highs, { supplies: [], resourceCaps: {}, ...input }, spread);
    expect(tidy.recipes.length).toBeLessThan(spread.recipes.length);
    expect(machines(tidy)).toBeLessThanOrEqual(machines(spread));
    expect(machines(tidy)).toBeLessThan(machines(plan({ ...input, objective: 'resources' })));
    expect(rate(tidy.targets, 'Desc_Motor_C')).toBeCloseTo(10);
  });

  // The old way: machines only, tidied. The new one counts miners and pumps and weighs the kinds of raw resource.
  const kinds = (r: ReturnType<typeof plan>) => r.raw.filter((x) => x.item !== 'Desc_Water_C').length;
  const cost = extractorCost(DEFAULT_EXTRACTION);
  const buildings = (r: ReturnType<typeof plan>) =>
    machines(r) + planExtraction(r.raw, DEFAULT_EXTRACTION).reduce((n, u) => n + u.built, 0);
  const both = (targets: { item: string; rate: number }[], patch: Partial<SolveInput> = {}) => {
    const input: SolveInput = { targets, supplies: [], enabledRecipes: all(), resourceCaps: {}, objective: 'buildings', ...patch };
    return {
      byRarity: plan({ ...input, objective: 'resources' }),
      old: fewerLines(highs, input, solve(highs, input)),
      now: fewestBuildings(highs, { ...input, extractorCost: cost }),
    };
  };

  test('5 computers: no more kinds of raw resource than by rarity, and no more buildings than before', () => {
    const { byRarity, old, now } = both([{ item: 'Desc_Computer_C', rate: 5 }]);
    expect(kinds(now)).toBeLessThanOrEqual(kinds(byRarity));
    expect(kinds(now)).toBeLessThan(kinds(old));
    expect(buildings(now)).toBeLessThanOrEqual(buildings(old));
    expect(rate(now.targets, 'Desc_Computer_C')).toBeCloseTo(5);
    expect(now.missing).toHaveLength(0);
  });

  test('stators, where fewer kinds would take more buildings, keep the plain plan', () => {
    const { old, now } = both([{ item: 'Desc_Stator_C', rate: 10 }]);
    expect(buildings(now)).toBeLessThanOrEqual(buildings(old));
  });

  test("ore isn't swapped in converters just to mine fewer kinds", () => {
    const { now } = both([{ item: 'Desc_Motor_C', rate: 10 }]);
    expect(now.recipes.some((u) => u.recipe.kind === 'converter')).toBe(false);
  });

  test('a pinned raw resource stays in the plan', () => {
    const { now } = both([{ item: 'Desc_Computer_C', rate: 5 }], { fixed: { Desc_RawQuartz_C: 30 } });
    expect(rate(now.raw, 'Desc_RawQuartz_C')).toBeGreaterThan(0);
  });

  test('when the kind search finds nothing, the plain plan comes back', () => {
    const input: SolveInput = {
      targets: [{ item: 'Desc_Computer_C', rate: 5 }],
      supplies: [],
      enabledRecipes: all(),
      resourceCaps: {},
      objective: 'buildings',
      extractorCost: cost,
    };
    // A solver that runs out of time on the search without a plan, and solves everything else as usual.
    const stuck = new Proxy(highs, {
      get: (target, key) =>
        key === 'solve'
          ? (lp: string, options: object) =>
              lp.includes('Binary') ? { Status: 'Time limit reached', Columns: {}, Rows: [] } : target.solve(lp, options)
          : Reflect.get(target, key),
    });
    const plain = fewerLines(highs, input, solve(highs, input));
    const now = fewestBuildings(stuck, input);
    expect(now.recipes.map((u) => u.recipe.id)).toEqual(plain.recipes.map((u) => u.recipe.id));
    expect(now.raw.map((x) => x.item)).toEqual(plain.raw.map((x) => x.item));
  });
});
