import { describe, expect, test } from 'bun:test';
import { data } from '../src/lib/data';
import { mergeState, migrateState, newPlan, newPowerPlan, poweredBy, useStore } from '../src/store';

const current = () => useStore.getState();
const realRecipe = data.recipes[0].id;
const realItem = 'Desc_IronPlate_C';

describe('saved state', () => {
  test('v1 kept one plan at the top level; it becomes the first factory', () => {
    const migrated = migrateState({ lang: 'en', view: 'table', targets: [{ item: realItem, rate: 30 }], objective: 'power' }, 1);
    expect(migrated.plans).toHaveLength(1);
    expect(migrated.plans![0].targets).toEqual([{ item: realItem, rate: 30 }]);
    expect(migrated.active).toBe(migrated.plans![0].id);
    expect(migrated.view).toBe('table');
  });

  test('recipes, items and mods gone after a game update are dropped', () => {
    const plan = {
      ...newPlan('Factory 1'),
      enabled: [realRecipe, 'Recipe_Removed_C'],
      targets: [
        { item: realItem, rate: 10 },
        { item: 'Desc_Removed_C', rate: 5 },
      ],
      supplies: [{ item: 'Desc_Removed_C', rate: 1 }],
      mods: { [realRecipe]: { clock: 2, sloops: 0 }, Recipe_Removed_C: { clock: 1.5, sloops: 0 } },
    };
    const merged = mergeState({ plans: [plan], active: plan.id }, current());
    const p = merged.plans[0];
    expect(p.enabled).toEqual([realRecipe]);
    expect(p.targets).toEqual([{ item: realItem, rate: 10 }]);
    expect(p.supplies).toEqual([]);
    expect(Object.keys(p.mods)).toEqual([realRecipe]);
  });

  test('a saved language this build does not ship falls back to English', () => {
    expect(mergeState({ lang: 'tr' }, current()).lang).toBe('en');
    expect(mergeState({ lang: 'en' }, current()).lang).toBe('en');
  });

  test('equal resource weights survive a reload; saves from before it start by rarity', () => {
    expect(mergeState({ equalWeights: true }, current()).equalWeights).toBe(true);
    expect(mergeState({}, current()).equalWeights).toBe(false);
    expect(mergeState({ equalWeights: 'yes' } as never, current()).equalWeights).toBe(false);
  });

  test('fewest buildings survives a reload; older saves plan for resources', () => {
    expect(mergeState({ fewestBuildings: true }, current()).fewestBuildings).toBe(true);
    expect(mergeState({}, current()).fewestBuildings).toBe(false);
    expect(mergeState({ fewestBuildings: 1 } as never, current()).fewestBuildings).toBe(false);
  });

  test('folded totals stay folded after a reload', () => {
    expect(mergeState({ summaryClosed: true }, current()).summaryClosed).toBe(true);
    expect(mergeState({}, current()).summaryClosed).toBe(false);
  });

  test('an active id that no longer exists points at the first factory', () => {
    const plan = newPlan('Factory 1');
    expect(mergeState({ plans: [plan], active: 'gone' }, current()).active).toBe(plan.id);
  });

  test('fields added since the save was written get their defaults', () => {
    const { extraction, fixed, ...old } = newPlan('Old');
    const merged = mergeState({ plans: [old] }, current());
    expect(merged.plans[0].extraction).toEqual(extraction);
    expect(merged.plans[0].fixed).toEqual(fixed);
  });
});

describe('damaged or hostile saves', () => {
  test('wrong types fall back instead of reaching a render', () => {
    const merged = mergeState(
      {
        plans: [
          {
            id: 'a',
            name: { x: 1 },
            targets: [
              { item: realItem, rate: 'lots' },
              { item: realItem, rate: 5 },
            ],
            enabled: 'all',
            mods: [],
          },
          { id: 'a', name: 'Twin' },
        ],
        tier: 99,
        view: 'poster',
        deckHeight: 'tall',
      },
      current(),
    );
    const [first, second] = merged.plans;
    expect(first.name).toBe('Factory');
    expect(first.targets).toEqual([{ item: realItem, rate: 5 }]);
    expect(Array.isArray(first.enabled)).toBe(true);
    expect(second.id).not.toBe(first.id);
    expect(merged.tier).toBeLessThanOrEqual(9);
    expect(merged.view).toBe(current().view);
    expect(merged.deckHeight).toBeUndefined();
  });

  test('power plants and settings keep only what makes sense', () => {
    const merged = mergeState(
      {
        power: [
          {
            id: 'x',
            name: 'Coal',
            sizeBy: 'sideways',
            want: -5,
            factories: ['a', 3, 'a'],
            plants: [
              { id: 'ok', generator: 'Build_GeneratorCoal_C', fuel: 'Desc_Coal_C', by: 'auto', amount: 1, clock: 9 },
              { id: 'bad', generator: 'Build_Nothing_C', by: 'count', amount: 2, clock: 1 },
              'junk',
            ],
            headroom: -1,
          },
        ],
        settings: { cardScale: 40, colors: { accent: 'red; background: url(x)' }, motion: 'wild', panel: 'left' },
      },
      current(),
    );
    const pp = merged.power[0];
    expect(pp.plants.map((p) => p.id)).toEqual(['ok']);
    expect(pp.plants[0].clock).toBe(2.5);
    expect(pp.headroom).toBe(0);
    expect(pp.sizeBy).toBe('factories');
    expect(pp.want).toBe(0);
    expect(pp.factories).toEqual(['a']);
    expect(merged.activePower).toBe('x');
    expect(merged.settings.cardScale).toBe(1.6);
    expect(merged.settings.colors.accent).toBe('#fa9549');
    expect(merged.settings.motion).toBe('system');
    expect(merged.settings.panel).toBe('left');
  });

  test('two plants with one id get their own ids, so they cannot share a solver column', () => {
    const coal = { generator: 'Build_GeneratorCoal_C', fuel: 'Desc_Coal_C', by: 'count', amount: 4, clock: 1 };
    const merged = mergeState(
      {
        power: [
          {
            plants: [
              { ...coal, id: 'p' },
              { ...coal, id: 'p' },
              { ...coal, id: 'q' },
            ],
          },
        ],
      },
      current(),
    );
    const ids = merged.power[0].plants.map((p) => p.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe('p');
  });
});

describe('power plant tabs', () => {
  const coal = { id: 'c', generator: 'Build_GeneratorCoal_C', fuel: 'Desc_Coal_C', by: 'auto', amount: 1, clock: 1 };

  test('the one power grid saved before plant tabs becomes the first plant', () => {
    const a = { ...newPlan('A'), id: 'a' };
    const b = { ...newPlan('B'), id: 'b' };
    const merged = mergeState(
      { plans: [a, b], active: 'a', grid: { plants: [coal], exclude: ['b'], extra: 40, headroom: 0.2, backup: 5 } },
      current(),
    );
    expect(merged.power).toHaveLength(1);
    const pp = merged.power[0];
    expect(pp.name).toBe('Coal plant');
    expect(pp.sizeBy).toBe('factories');
    expect(pp.factories).toEqual(['a']);
    expect(pp.plants.map((p) => p.id)).toEqual(['c']);
    expect([pp.extra, pp.headroom, pp.backup]).toEqual([40, 0.2, 5]);
    expect(merged.activePower).toBe(pp.id);

    // Nothing left out meant every factory, including ones added later.
    const all = mergeState({ plans: [a, b], grid: { plants: [coal], exclude: [] } }, current());
    expect(all.power[0].factories).toBe('all');
  });

  test('a factory ticked on one plant comes off the others, so it is never counted twice', () => {
    const a = { ...newPlan('A'), id: 'a' };
    const b = { ...newPlan('B'), id: 'b' };
    const first = { ...newPowerPlan('Coal'), id: 'p1' };
    useStore.setState({ plans: [a, b], power: [first], activePower: 'p1' });
    useStore.getState().addPowerPlan('Fuel');
    const s1 = useStore.getState();
    // Every factory is on the first plant, so the new one starts with none.
    expect(s1.power[1].factories).toEqual([]);
    s1.setPowered('b', true);
    const s2 = useStore.getState();
    expect([...poweredBy(s2.power[0], s2.plans)]).toEqual(['a']);
    expect([...poweredBy(s2.power[1], s2.plans)]).toEqual(['b']);
    // Deleting a factory takes it off the plant too.
    s2.removePlan('b');
    expect(useStore.getState().power[1].factories).toEqual([]);
  });

  test('a new plant takes its name from its first generator', () => {
    const pp = newPowerPlan('Plant 1');
    useStore.setState({ power: [pp], activePower: pp.id, mode: 'power' });
    useStore.getState().addPlant('Build_GeneratorFuel_C', 'Desc_LiquidFuel_C');
    useStore.getState().addPlant('Build_GeneratorCoal_C', 'Desc_Coal_C');
    const s = useStore.getState();
    expect(s.power[0].name).toBe('Fuel plant');
    expect(s.power[0].plants).toHaveLength(2);
    // Renamed by hand, it keeps its name.
    s.duplicatePowerPlan(pp.id);
    expect(useStore.getState().power.map((p) => p.name)).toEqual(['Fuel plant', 'Fuel plant 2']);
    useStore.setState({ mode: 'factory' });
  });
});

describe('building from the Codex', () => {
  test('a blank tab takes the factory; after that each build gets its own tab named after the item', () => {
    const blank = newPlan('Factory 1');
    useStore.setState({ mode: 'codex', plans: [blank], active: blank.id });
    current().buildFactory('Desc_Motor_C', 'Motor');
    let s = current();
    expect(s.plans).toHaveLength(1);
    expect(s.plans[0]).toMatchObject({ id: blank.id, name: 'Motor', targets: [{ item: 'Desc_Motor_C', rate: 10 }] });
    expect(s.mode).toBe('factory');

    current().buildFactory('Desc_Motor_C', 'Motor', 'Recipe_Alternate_Motor_1_C');
    s = current();
    expect(s.plans.map((p) => p.name)).toEqual(['Motor', 'Motor 2']);
    expect(s.active).toBe(s.plans[1].id);
    // That recipe is the only way the new tab makes motors.
    expect(s.plans[1].enabled).toContain('Recipe_Alternate_Motor_1_C');
    expect(s.plans[1].enabled).not.toContain('Recipe_Motor_C');
    expect(s.plans[1].enabled).toContain('Recipe_Rotor_C');
  });

  test('a fuel goes to the plant on screen while it has no generators, then to a new plant', () => {
    const empty = newPowerPlan('Plant 1');
    useStore.setState({ mode: 'codex', power: [empty], activePower: empty.id });
    current().buildPlant('Build_GeneratorCoal_C', 'Desc_Coal_C');
    expect(current().power).toHaveLength(1);
    expect(current().mode).toBe('power');
    current().buildPlant('Build_GeneratorFuel_C', 'Desc_LiquidFuel_C');
    const s = current();
    expect(s.power).toHaveLength(2);
    expect(s.activePower).toBe(s.power[1].id);
    expect(s.power[1].plants[0]).toMatchObject({ generator: 'Build_GeneratorFuel_C', fuel: 'Desc_LiquidFuel_C' });
  });
});

describe('taking from another factory', () => {
  test('the source makes what others take on top of its own targets; deleting it leaves the item on hand', async () => {
    const { exportsOf } = await import('../src/store');
    const { factoryInput } = await import('../src/lib/solution');
    const a = { ...newPlan('Plates'), targets: [{ item: 'Desc_IronPlate_C', rate: 20 }] };
    const b = { ...newPlan('Frames'), targets: [{ item: 'Desc_ModularFrame_C', rate: 5 }] };
    useStore.setState({ mode: 'factory', plans: [a, b], active: b.id });
    current().addSupply('Desc_IronPlateReinforced_C', 15, a.id);
    current().addSupply('Desc_IronPlate_C', 30);
    current().setSupplyFrom(1, a.id);
    expect(exportsOf(current().plans, a.id)).toEqual([
      { item: 'Desc_IronPlateReinforced_C', rate: 15, to: b.id },
      { item: 'Desc_IronPlate_C', rate: 30, to: b.id },
    ]);
    const input = factoryInput(current().plans[0], 9, exportsOf(current().plans, a.id))!;
    expect(input.targets).toEqual([
      { item: 'Desc_IronPlate_C', rate: 50 },
      { item: 'Desc_IronPlateReinforced_C', rate: 15 },
    ]);
    current().setSupplyFrom(1, undefined);
    expect(current().plans[1].supplies[1]).toEqual({ item: 'Desc_IronPlate_C', rate: 30 });
    current().removePlan(a.id);
    expect(current().plans[0].supplies).toEqual([
      { item: 'Desc_IronPlateReinforced_C', rate: 15 },
      { item: 'Desc_IronPlate_C', rate: 30 },
    ]);
  });

  test('a saved source that is gone, or the factory itself, is dropped on load', () => {
    const a = {
      ...newPlan('A'),
      id: 'a',
      supplies: [
        { item: 'Desc_IronPlate_C', rate: 5, from: 'b' },
        { item: 'Desc_IronRod_C', rate: 5, from: 'a' },
      ],
    };
    const b = { ...newPlan('B'), id: 'b', supplies: [{ item: 'Desc_IronPlate_C', rate: 5, from: 'gone' }] };
    const merged = mergeState({ plans: [a, b], active: 'a' }, current());
    expect(merged.plans[0].supplies).toEqual([
      { item: 'Desc_IronPlate_C', rate: 5, from: 'b' },
      { item: 'Desc_IronRod_C', rate: 5 },
    ]);
    expect(merged.plans[1].supplies).toEqual([{ item: 'Desc_IronPlate_C', rate: 5 }]);
  });
});

describe('Auto and Manual share their targets', () => {
  const at = { x: 0, y: 0 };
  const plateModel = (lim?: number) => ({
    v: 1 as const,
    calc: 'basic' as const,
    seq: 10,
    nodes: [
      { id: 'm', ...at, k: 'machine' as const, recipe: 'Recipe_IronPlate_C', auto: true as const },
      { id: 'o', x: 400, y: 0, k: 'out' as const, item: 'Desc_IronPlate_C', ...(lim !== undefined ? { lim } : {}) },
    ],
    links: [{ id: 'l', a: 'm', ap: 0, b: 'o', bp: 0 }],
  });
  const setUp = (lim?: number) => {
    const p = { ...newPlan('Plates'), targets: [{ item: 'Desc_IronPlate_C', rate: 30 }], floor: 'manual' as const, model: plateModel(lim) };
    useStore.setState({ mode: 'factory', plans: [p], active: p.id });
    return p.id;
  };
  const plan = () => current().plans[0];

  test('a target changed on the Auto side reaches the floor’s output card, one undo puts it back', () => {
    const id = setUp(30);
    current().setTarget(0, 5);
    expect(plan().model?.nodes.find((n) => n.id === 'o')).toMatchObject({ lim: 5 });
    current().undoModel(id);
    expect(plan().model?.nodes.find((n) => n.id === 'o')).toMatchObject({ lim: 30 });
  });

  test('an output card’s amount set on the floor is the factory’s target', () => {
    const id = setUp(30);
    current().editModel(id, (m) => ({ ...m, nodes: m.nodes.map((n) => (n.id === 'o' ? { ...n, lim: 12 } : n)) }));
    expect(plan().targets).toEqual([{ item: 'Desc_IronPlate_C', rate: 12 }]);
  });

  test('a new target gets an output card; a removed one takes its card off; a floor without limits keeps its amounts', () => {
    const id = setUp();
    // Moving a card on a floor converted before limits were kept changes no target.
    current().editModel(id, (m) => ({ ...m, nodes: m.nodes.map((n) => (n.id === 'm' ? { ...n, x: 40 } : n)) }));
    expect(plan().targets).toEqual([{ item: 'Desc_IronPlate_C', rate: 30 }]);
    current().addTarget('Desc_IronRod_C');
    expect(
      plan()
        .model?.nodes.filter((n) => n.k === 'out')
        .map((n) => n.k === 'out' && [n.item, n.lim]),
    ).toEqual([
      ['Desc_IronPlate_C', 30],
      ['Desc_IronRod_C', 10],
    ]);
    current().removeTarget(0);
    expect(plan().model?.nodes.some((n) => n.id === 'o')).toBe(false);
    expect(plan().model?.links).toEqual([]);
  });
});
