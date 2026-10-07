import { beforeAll, describe, expect, test } from 'bun:test';
import loadHighs, { type Highs } from 'highs';
import { capsWithNodes, DEFAULT_EXTRACTION, nodeCaps } from '../src/lib/extraction';
import { cleanPlan } from '../src/lib/sanitize';
import { factoryInput } from '../src/lib/solution';
import { solve } from '../src/lib/solver';
import { aimOf, newPlan } from '../src/store';

let highs: Highs;
beforeAll(async () => {
  highs = await loadHighs();
});

const IRON = 'Desc_OreIron_C';
const COPPER_INGOT = 'Desc_CopperIngot_C';
const withNodes = { ...DEFAULT_EXTRACTION, nodes: { [IRON]: { pure: 1, normal: 1 } }, capByNodes: true };

describe('planning with your own nodes', () => {
  test('the limit is what the extractors on those nodes give together at the set clock', () => {
    // Miner Mk.2: 120 a minute on a normal node, 240 on a pure one.
    expect(nodeCaps(withNodes)).toEqual({ [IRON]: 360 });
    expect(nodeCaps({ ...withNodes, clock: 0.5 })).toEqual({ [IRON]: 180 });
    expect(nodeCaps({ ...withNodes, overclock: { [IRON]: 2 } })).toEqual({ [IRON]: 720 });
    expect(nodeCaps({ ...withNodes, capByNodes: undefined })).toEqual({});
    expect(nodeCaps(DEFAULT_EXTRACTION)).toEqual({});
  });

  test('the plan keeps the lower of its own limit and the nodes', () => {
    expect(capsWithNodes({}, withNodes)[IRON]).toBe(360);
    expect(capsWithNodes({ [IRON]: 100 }, withNodes)[IRON]).toBe(100);
    expect(capsWithNodes({ [IRON]: 900 }, withNodes)[IRON]).toBe(360);
    const caps = { Desc_Coal_C: 50 };
    expect(capsWithNodes(caps, DEFAULT_EXTRACTION)).toBe(caps);
  });

  test('a plan that needs more than the nodes give does not work out, and one that fits does', () => {
    const plan = (rate: number) => ({ ...newPlan('F'), targets: [{ item: 'Desc_IronPlate_C', rate }], extraction: withNodes });
    // Iron plates take 1.5 ore each: 360 ore is 240 plates.
    expect(solve(highs, factoryInput(plan(200), 9)!).raw.find((x) => x.item === IRON)?.rate).toBeCloseTo(300, 3);
    expect(() => solve(highs, factoryInput(plan(300), 9)!)).toThrow();
    expect(() => solve(highs, factoryInput({ ...plan(300), extraction: { ...withNodes, capByNodes: undefined } }, 9)!)).not.toThrow();
  });

  test('the setting is saved with the nodes, and only with nodes', () => {
    const plan = { ...newPlan('F'), extraction: withNodes };
    expect(cleanPlan(JSON.parse(JSON.stringify(plan)), newPlan('x')).extraction.capByNodes).toBe(true);
    const bare = { ...newPlan('F'), extraction: { ...DEFAULT_EXTRACTION, capByNodes: true } };
    expect(cleanPlan(JSON.parse(JSON.stringify(bare)), newPlan('x')).extraction.capByNodes).toBeUndefined();
  });
});

describe('what each resource costs', () => {
  // Two ways to smelt copper: on its own, or alloyed with iron ore, which costs less ore of the rarer kind.
  const base = {
    ...newPlan('F'),
    targets: [{ item: COPPER_INGOT, rate: 60 }],
    enabled: ['Recipe_IngotCopper_C', 'Recipe_Alternate_CopperAlloyIngot_C'],
  };

  test('with no weights set the plan costs resources by how rare they are', () => {
    const r = solve(highs, factoryInput(base, 9, [], 'custom')!);
    expect(r).toEqual(solve(highs, factoryInput(base, 9, [], 'rarity')!));
  });

  test('a resource set dear is used less: copper alloy needs iron ore, and costs too much with iron at 100', () => {
    const cheap = solve(highs, factoryInput(base, 9, [], 'rarity')!);
    expect(cheap.raw.find((x) => x.item === IRON)?.rate ?? 0).toBeGreaterThan(1);
    const dear = solve(highs, factoryInput({ ...base, weights: { [IRON]: 100 } }, 9, [], 'custom')!);
    expect(dear.raw.find((x) => x.item === IRON)?.rate ?? 0).toBeLessThan(1e-6);
    // The weights only count when Custom is chosen.
    expect(solve(highs, factoryInput({ ...base, weights: { [IRON]: 100 } }, 9, [], 'rarity')!).raw).toEqual(cheap.raw);
  });

  test('the choice and the weights are kept, the weights as typed', () => {
    expect(aimOf({ equalWeights: true, fewestBuildings: false, customWeights: true })).toBe('custom');
    expect(aimOf({ equalWeights: true, fewestBuildings: true, customWeights: true })).toBe('buildings');
    expect(aimOf({ equalWeights: true, fewestBuildings: false, customWeights: false })).toBe('equal');
    const plan = { ...base, weights: { [IRON]: 7.5, nope: 3 } };
    expect(cleanPlan(JSON.parse(JSON.stringify(plan)), newPlan('x')).weights).toEqual({ [IRON]: 7.5 });
  });
});
