import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import loadHighs, { type Highs } from 'highs';
import { data } from '../src/lib/data';
import { DEFAULT_EXTRACTION } from '../src/lib/extraction';
import { adaptModel } from '../src/lib/model/calc/adapter';
import { calcKey, calcModel } from '../src/lib/model/calc';
import { builtTransport } from '../src/lib/model/calc/compile';
import { modelFromSolve } from '../src/lib/model/fromAuto';
import { applyArrangement, arrangeModel, arrangement } from '../src/lib/model/arrange';
import { openCards, openEnds, ruleFlags } from '../src/lib/model/checks';
import { choicesFor, choiceWords, placeChoice, wantAt } from '../src/lib/model/choices';
import { cardSize, endSpot, freeSpot } from '../src/lib/model/layout';
import { addNode, canConnect, connect, evenSpeed, fullSpeed, minerFor, moveNodes, removeNodes } from '../src/lib/model/ops';
import { mediumOf } from '../src/lib/model/ports';
import { cleanModel } from '../src/lib/model/sanitize';
import { type MLink, type MNode, type Model, MODEL_VERSION } from '../src/lib/model/types';
import { solve } from '../src/lib/solver';
import { layoutEngine } from './helpers/elk';

let highs: Highs;
let stopLayout: () => void;
beforeAll(async () => {
  highs = await loadHighs();
  stopLayout = layoutEngine();
});
afterAll(() => stopLayout());

const ORE = 'Desc_OreIron_C';
const INGOT = 'Desc_IronIngot_C';
const SMELT = 'Recipe_IngotIron_C';

const model = (nodes: MNode[], links: Omit<MLink, 'id'>[], extra: Partial<Model> = {}): Model => ({
  v: MODEL_VERSION,
  calc: 'basic',
  nodes,
  links: links.map((l, i) => ({ id: `l${i}`, ...l })),
  seq: 100,
  ...extra,
});
const at = { x: 0, y: 0 };
const miner = (id: string, n = 1): MNode => ({ id, ...at, k: 'extract', extractor: 'Build_MinerMk2_C', item: ORE, n });
const smelter = (id: string, n = 1): MNode => ({ id, ...at, k: 'machine', recipe: SMELT, n });
const out = (id: string, item?: string): MNode => ({ id, ...at, k: 'out', ...(item ? { item } : {}) });

const run = (m: Model, tier = 9) => calcModel(highs, m, tier);

describe('max flow', () => {
  test('a 120/min miner shares out to three smelters taking 30 each, and runs at 75%', () => {
    const m = model(
      [
        miner('m'),
        { id: 's', ...at, k: 'logistic', kind: 'splitter' },
        smelter('a'),
        smelter('b'),
        smelter('c'),
        out('x'),
        out('y'),
        out('z'),
      ],
      [
        { a: 'm', ap: 0, b: 's', bp: 0 },
        { a: 's', ap: 0, b: 'a', bp: 0 },
        { a: 's', ap: 1, b: 'b', bp: 0 },
        { a: 's', ap: 2, b: 'c', bp: 0 },
        { a: 'a', ap: 0, b: 'x', bp: 0 },
        { a: 'b', ap: 0, b: 'y', bp: 0 },
        { a: 'c', ap: 0, b: 'z', bp: 0 },
      ],
    );
    const r = run(m);
    for (const id of ['a', 'b', 'c']) expect(r.nodes[id].u).toBeCloseTo(1);
    expect(r.nodes.m.u).toBeCloseTo(0.75);
    expect(r.nodes.m.status).toBe('partial');
    expect(r.links.l0.rate).toBeCloseTo(90);
    const { result } = adaptModel(m, r);
    expect(result.targets[0]).toEqual({ item: INGOT, rate: expect.closeTo(90) });
    expect(result.raw[0].rate).toBeCloseTo(90);
  });

  test('a Mk.1 belt carries 60 a minute however much the miner could give', () => {
    const r = run(model([miner('m'), out('o')], [{ a: 'm', ap: 0, b: 'o', bp: 0, mk: 0 }]));
    expect(r.links.l0.rate).toBeCloseTo(60);
    expect(r.links.l0.status).toBe('capped');
    expect(r.nodes.m.u).toBeCloseTo(0.5);
  });

  test('what a machine makes on an open output is left over, unless open outputs back up as in the game', () => {
    const m = model([miner('m'), smelter('a')], [{ a: 'm', ap: 0, b: 'a', bp: 0 }]);
    const r = run(m);
    expect(r.nodes.a.u).toBeCloseTo(1);
    expect(r.nodes.a.spare?.[0]).toBeCloseTo(30);
    expect(adaptModel(m, r).result.surplus[0].rate).toBeCloseTo(30);
    const stalled = run({ ...m, stall: true });
    expect(stalled.nodes.a.status).toBe('noOutput');
    expect(stalled.nodes.a.u).toBe(0);
  });

  test('a line built by hand follows its miner: machines set to Auto take as many as it keeps busy', () => {
    // The miner → smelter → constructor line from the player's report, with nothing after the constructor.
    const m = model(
      [
        { ...miner('m'), n: 2 },
        { id: 's', ...at, k: 'machine', recipe: SMELT, auto: true },
        { id: 'c', ...at, k: 'machine', recipe: 'Recipe_IronPlate_C', auto: true },
      ],
      [
        { a: 'm', ap: 0, b: 's', bp: 0 },
        { a: 's', ap: 0, b: 'c', bp: 0 },
      ],
    );
    const r = run(m);
    expect(r.nodes.m.u).toBeCloseTo(1);
    expect(r.nodes.s.n).toBeCloseTo(8);
    expect(r.nodes.s.status).toBe('full');
    expect(r.nodes.c.n).toBeCloseTo(8);
    expect(r.nodes.c.spare?.[0]).toBeCloseTo(160);
    const { result } = adaptModel(m, r);
    expect(result.surplus).toEqual([{ item: 'Desc_IronPlate_C', rate: expect.closeTo(160) }]);
    expect(result.recipes.find((u) => u.node === 's')?.built).toBeCloseTo(8);
    // A slower miner: the line follows it down.
    const slow = run({ ...m, nodes: m.nodes.map((n) => (n.id === 'm' ? { ...n, clock: 0.5 } : n)) });
    expect(slow.nodes.s.n).toBeCloseTo(4);
    expect(slow.nodes.c.spare?.[0]).toBeCloseTo(80);
  });

  test('a splitter shares evenly between Auto machines, as in the game', () => {
    const auto = (id: string, recipe: string): MNode => ({ id, ...at, k: 'machine', recipe, auto: true });
    const m = model(
      [miner('m'), { id: 's', ...at, k: 'logistic', kind: 'splitter' }, auto('a', SMELT), auto('b', SMELT)],
      [
        { a: 'm', ap: 0, b: 's', bp: 0 },
        { a: 's', ap: 0, b: 'a', bp: 0 },
        { a: 's', ap: 1, b: 'b', bp: 0 },
      ],
    );
    const r = run(m);
    expect(r.links.l1.rate).toBeCloseTo(60);
    expect(r.links.l2.rate).toBeCloseTo(60);
    expect(r.nodes.a.n).toBeCloseTo(2);
    // Two different products: still half each, not all to whichever makes more items.
    const two = run(
      model(
        [
          miner('m'),
          { id: 's', ...at, k: 'logistic', kind: 'splitter' },
          auto('a', SMELT),
          { id: 't', ...at, k: 'logistic', kind: 'splitter' },
          auto('rod', 'Recipe_IronRod_C'),
          auto('plate', 'Recipe_IronPlate_C'),
          out('x'),
          out('y'),
        ],
        [
          { a: 'm', ap: 0, b: 'a', bp: 0 },
          { a: 'a', ap: 0, b: 't', bp: 0 },
          { a: 't', ap: 0, b: 'rod', bp: 0 },
          { a: 't', ap: 1, b: 'plate', bp: 0 },
          { a: 'rod', ap: 0, b: 'x', bp: 0 },
          { a: 'plate', ap: 0, b: 'y', bp: 0 },
        ],
      ),
    );
    expect(two.links.l2.rate).toBeCloseTo(60);
    expect(two.links.l3.rate).toBeCloseTo(60);
    // One side holding back (a single smelter at 30): the other takes the rest.
    const held = run({ ...m, nodes: m.nodes.map((n) => (n.id === 'b' ? smelter('b') : n)) });
    expect(held.links.l2.rate).toBeCloseTo(30);
    expect(held.links.l1.rate).toBeCloseTo(90);
  });

  test('an Auto machine fed from something with no limit takes all its belt carries, or the limit set', () => {
    const m = model(
      [{ id: 'i', ...at, k: 'in', item: ORE }, { id: 's', ...at, k: 'machine', recipe: SMELT, auto: true }, out('o')],
      [
        { a: 'i', ap: 0, b: 's', bp: 0 },
        { a: 's', ap: 0, b: 'o', bp: 0 },
      ],
    );
    const r = run(m);
    expect(r.links.l0.status).toBe('capped');
    expect(r.nodes.s.n).toBeCloseTo(40);
    expect(r.nodes.o.ins[0]).toBeCloseTo(1200);
    const capped = run({ ...m, nodes: m.nodes.map((n) => (n.k === 'in' ? { ...n, lim: 90 } : n)) });
    expect(capped.unbounded).toBeUndefined();
    expect(capped.nodes.s.n).toBeCloseTo(3);
  });

  test('two machines feeding each other with nothing from outside never start', () => {
    // Recycled rubber and recycled plastic each need the other's product, and fuel from outside here is missing.
    const rubber = data.recipes.find((r) => r.id === 'Recipe_Alternate_RecycledRubber_C')!;
    const plastic = data.recipes.find((r) => r.id === 'Recipe_Alternate_Plastic_1_C')!;
    expect(rubber && plastic).toBeTruthy();
    const nodes: MNode[] = [
      { id: 'r', ...at, k: 'machine', recipe: rubber.id },
      { id: 'p', ...at, k: 'machine', recipe: plastic.id },
    ];
    const links: Omit<MLink, 'id'>[] = [];
    const port = (id: string, item: string, side: 'inputs' | 'outputs') =>
      (id === 'r' ? rubber : plastic)[side].findIndex((s) => s.item === item);
    links.push({ a: 'r', ap: port('r', 'Desc_Rubber_C', 'outputs'), b: 'p', bp: port('p', 'Desc_Rubber_C', 'inputs') });
    links.push({ a: 'p', ap: port('p', 'Desc_Plastic_C', 'outputs'), b: 'r', bp: port('r', 'Desc_Plastic_C', 'inputs') });
    const r = run(model(nodes, links));
    expect(r.nodes.r.u).toBe(0);
    expect(['deadlock', 'noInput']).toContain(r.nodes.r.status);
  });

  test('a belt bringing the wrong item jams', () => {
    const copper: MNode = { id: 'cm', ...at, k: 'extract', extractor: 'Build_MinerMk2_C', item: 'Desc_OreCopper_C' };
    const m = model(
      [miner('m'), copper, { id: 'g', ...at, k: 'logistic', kind: 'merger' }, smelter('a'), out('o')],
      [
        { a: 'm', ap: 0, b: 'g', bp: 0 },
        { a: 'cm', ap: 0, b: 'g', bp: 1 },
        { a: 'g', ap: 0, b: 'a', bp: 0 },
        { a: 'a', ap: 0, b: 'o', bp: 0 },
      ],
    );
    const r = run(m);
    expect(r.links.l2.status).toBe('jam');
    expect(r.nodes.a.status).toBe('jam');
    expect(r.nodes.a.u).toBe(0);
  });

  test('switched off, nothing moves', () => {
    const r = run(model([miner('m'), out('o')], [{ a: 'm', ap: 0, b: 'o', bp: 0 }], { calc: 'off' }));
    expect(r.links.l0.rate).toBe(0);
  });
});

describe('from an Auto plan', () => {
  const standard = () => new Set(data.recipes.filter((r) => r.kind === 'standard').map((r) => r.id));
  for (const [item, rate] of [
    ['Desc_Motor_C', 10],
    ['Desc_ModularFrame_C', 10],
    ['Desc_Computer_C', 2],
    ['Desc_Plastic_C', 60],
    ['Desc_ComputerSuper_C', 10],
    ['Desc_MotorLightweight_C', 5],
  ] as const) {
    test(`${item}: the hand-built copy makes what the plan makes from what it mines`, async () => {
      const auto = solve(highs, {
        targets: [{ item, rate }],
        supplies: [],
        enabledRecipes: standard(),
        resourceCaps: {},
        objective: 'resources',
      });
      const m = await modelFromSolve(auto, 9, DEFAULT_EXTRACTION);
      expect(cleanModel(m)).toEqual(m);
      const r = run(m);
      const { result } = adaptModel(m, r);
      const made = result.targets.find((t) => t.item === item)?.rate ?? 0;
      expect(made).toBeCloseTo(rate, 4);
      for (const x of auto.raw) expect(result.raw.find((y) => y.item === x.item)?.rate ?? 0).toBeCloseTo(x.rate, 4);
      for (const n of m.nodes) if (n.k === 'machine') expect(r.nodes[n.id].u).toBeCloseTo(1, 6);
    });
  }

  test('machines whose recipe was ticked built on the Auto floor start ticked on the Manual floor', async () => {
    const auto = solve(highs, {
      targets: [{ item: 'Desc_Wire_C', rate: 60 }],
      supplies: [],
      enabledRecipes: standard(),
      resourceCaps: {},
      objective: 'resources',
    });
    const ticked = auto.recipes[0].recipe.id;
    const m = await modelFromSolve(auto, 9, DEFAULT_EXTRACTION, 'LR', [ticked]);
    for (const n of m.nodes) if (n.k === 'machine') expect(!!n.done).toBe(n.recipe === ticked);
    expect(m.nodes.some((n) => n.k === 'machine' && n.done)).toBe(true);
    const plain = await modelFromSolve(auto, 9, DEFAULT_EXTRACTION);
    expect(plain.nodes.some((n) => n.k === 'machine' && n.done)).toBe(false);
  });

  test('a target set lower afterwards takes fewer machines and slower belts, not machines running slower', async () => {
    const item = 'Desc_IronPlateReinforced_C';
    const auto = solve(highs, {
      targets: [{ item, rate: 30 }],
      supplies: [],
      enabledRecipes: standard(),
      resourceCaps: {},
      objective: 'resources',
    });
    const m = await modelFromSolve(auto, 9, DEFAULT_EXTRACTION);
    // Left to the load: no belt with a Mk picked, every machine sizing itself.
    expect(m.links.filter((l) => l.mk !== undefined)).toEqual([]);
    expect(m.nodes.filter((n) => n.k === 'machine' && !n.auto)).toEqual([]);
    const machines = (r: ReturnType<typeof run>) => m.nodes.reduce((s, n) => s + (n.k === 'machine' ? (r.nodes[n.id].n ?? 0) : 0), 0);
    const r30 = run(m);
    // As many as the plan builds, at its clocks.
    expect(Math.round(machines(r30))).toBe(auto.recipes.reduce((s, u) => s + u.built, 0));
    const belts = (mm: Model, r: ReturnType<typeof run>) =>
      mm.links.map((l) => builtTransport(mediumOf(item), l, 9, r.links[l.id].rate).id);
    expect(belts(m, r30)).toContain(data.belts[2].id);

    const product = m.nodes.find((n) => n.k === 'out' && n.item === item)!;
    const five: Model = { ...m, nodes: m.nodes.map((n) => (n.id === product.id ? { ...n, lim: 5 } : n)) };
    const r5 = run(five);
    expect(adaptModel(five, r5).result.targets.find((t) => t.item === item)?.rate).toBeCloseTo(5, 4);
    expect(machines(r5)).toBeCloseTo(machines(r30) / 6, 4);
    for (const n of five.nodes) if (n.k === 'machine') expect(r5.nodes[n.id].status).toBe('full');
    expect(new Set(belts(five, r5))).toEqual(new Set([data.belts[0].id]));
  });
});

describe('saved models', () => {
  test('cleaning twice changes nothing, and junk never throws', () => {
    const m = model(
      [miner('m'), smelter('a', 2.5), out('o'), { id: 'n', ...at, k: 'note', text: 'hi', w: 200, h: 100 }],
      [
        { a: 'm', ap: 0, b: 'a', bp: 0, mk: 2, pts: [[1, 2]] },
        { a: 'a', ap: 0, b: 'o', bp: 0, line: 'step' },
      ],
    );
    const once = cleanModel(m)!;
    expect(cleanModel(JSON.parse(JSON.stringify(once)))).toEqual(once);
    for (const junk of [null, 1, 'x', [], { nodes: 5 }, { nodes: [{ k: 'machine' }] }, { v: 99, nodes: [miner('m')] }]) {
      expect(() => cleanModel(junk)).not.toThrow();
    }
  });

  test('a recipe gone from the game keeps its node and belts', () => {
    const m = model(
      [miner('m'), { id: 'a', ...at, k: 'machine', recipe: 'Recipe_Gone_C' }, out('o')],
      [
        { a: 'm', ap: 0, b: 'a', bp: 0 },
        { a: 'a', ap: 0, b: 'o', bp: 0 },
      ],
    );
    const c = cleanModel(m)!;
    expect(c.nodes[1]).toMatchObject({ k: 'unknown', was: 'Recipe_Gone_C', ins: 1, outs: 1 });
    expect(c.links.length).toBe(2);
    expect(cleanModel(c)).toEqual(c);
    expect(run(c).nodes.a.status).toBe('unknown');
  });

  test('one belt per end, and only ends that exist', () => {
    const c = cleanModel(
      model(
        [miner('m'), smelter('a'), smelter('b')],
        [
          { a: 'm', ap: 0, b: 'a', bp: 0 },
          { a: 'm', ap: 0, b: 'b', bp: 0 },
          { a: 'a', ap: 5, b: 'b', bp: 0 },
        ],
      ),
    )!;
    expect(c.links.length).toBe(1);
  });
});

describe('editing', () => {
  test('joining ends checks the item, and replaces a belt already there', () => {
    const m = model([miner('m'), smelter('a'), smelter('b'), out('o')], [{ a: 'm', ap: 0, b: 'a', bp: 0 }]);
    expect(canConnect(m, 'a', 0, 'b', 0)).toBe('item');
    const { model: next, id } = connect(m, 'm', 0, 'b', 0);
    expect(id).toBeDefined();
    expect(next.links.map((l) => l.b)).toEqual(['b']);
    expect(removeNodes(next, ['b']).links).toEqual([]);
  });

  test('moving a card leaves the numbers alone', () => {
    const m = model([miner('m'), out('o')], [{ a: 'm', ap: 0, b: 'o', bp: 0 }]);
    const moved = { ...m, nodes: m.nodes.map((n) => ({ ...n, x: n.x + 40 })) };
    expect(calcKey(moved, 9)).toBe(calcKey(m, 9));
    expect(calcKey({ ...m, calc: 'off' }, 9)).not.toBe(calcKey(m, 9));
  });
});

describe('a manual factory tab', () => {
  const { newPlan, mergeState, persisted, useStore } = require('../src/store');
  const { pack, unpack } = require('../src/lib/share');
  const { cleanPlan } = require('../src/lib/sanitize');
  const built = () => ({
    ...newPlan('Hand built'),
    floor: 'manual' as const,
    model: model(
      [miner('m'), smelter('a'), out('o')],
      [
        { a: 'm', ap: 0, b: 'a', bp: 0 },
        { a: 'a', ap: 0, b: 'o', bp: 0, mk: 1 },
      ],
    ),
  });

  test('keeps its floor and model through a reload, twice', () => {
    const plan = built();
    const once = persisted(mergeState({ plans: [plan], active: plan.id }, useStore.getState()));
    const twice = persisted(mergeState(JSON.parse(JSON.stringify(once)), useStore.getState()));
    expect(twice.plans[0].floor).toBe('manual');
    expect(twice.plans[0].model).toEqual(cleanModel(plan.model));
    expect(twice).toEqual(once);
  });

  test('keeps them through a shared link', () => {
    const plan = built();
    const back = cleanPlan(unpack(JSON.parse(JSON.stringify(pack(plan)))), newPlan('x'));
    expect(back.floor).toBe('manual');
    expect(back.model).toEqual(cleanModel(plan.model));
  });

  test('the Auto floor’s built ticks survive a reload and a shared link, and come out as ticked cards', async () => {
    const { toggleBuilt } = require('../src/store');
    const id = 'Recipe_IngotCopper_C';
    const plan = { ...newPlan('Ticked'), ...toggleBuilt(id)(newPlan('Ticked')) };
    expect(plan.built).toEqual([id]);
    const reloaded = persisted(mergeState({ plans: [plan], active: plan.id }, useStore.getState()));
    expect(reloaded.plans[0].built).toEqual([id]);
    const shared = cleanPlan(unpack(JSON.parse(JSON.stringify(pack(plan)))), newPlan('x'));
    expect(shared.built).toEqual([id]);
    // A recipe the game no longer has, or the same one twice, doesn't come back.
    expect(cleanPlan({ ...plan, built: [id, id, 'Recipe_Gone_C', 7] }, newPlan('x')).built).toEqual([id]);
    // Ticking it again takes the tick (and the field) off.
    expect(toggleBuilt(id)(plan)).toEqual({ built: undefined });
    expect('built' in cleanPlan(newPlan('x'), newPlan('y'))).toBe(false);
  });

  test('an Auto tab saves neither', () => {
    const plain = cleanPlan(newPlan('x'), newPlan('y'));
    expect('floor' in plain).toBe(false);
    expect('model' in plain).toBe(false);
  });

  test('undo and redo step through edits, and quick edits of one field undo as one', () => {
    const plan = built();
    useStore.setState({ plans: [plan], active: plan.id });
    const s = useStore.getState();
    const before = s.plans[0].model;
    s.editModel(plan.id, (m: Model) => ({ ...m, calc: 'off' }));
    s.editModel(plan.id, (m: Model) => ({ ...m, stall: true }), 'stall');
    s.editModel(plan.id, (m: Model) => ({ ...m, stall: undefined }), 'stall');
    s.undoModel(plan.id);
    expect(useStore.getState().plans[0].model.calc).toBe('off');
    s.undoModel(plan.id);
    expect(useStore.getState().plans[0].model).toEqual(before);
    s.redoModel(plan.id);
    expect(useStore.getState().plans[0].model.calc).toBe('off');
  });
});

describe('the chooser', () => {
  test('a belt of iron ore let go on the floor lists what takes iron ore, and its end on each', () => {
    const m = model([miner('m')], []);
    const want = wantAt(m, 9, 'm', 'out', 0);
    expect(want).toEqual({ side: 'in', node: 'm', port: 0, item: ORE, medium: 'belt' });
    const list = choicesFor(want, 9);
    const make = list.filter((c) => c.tab === 'make');
    expect(make.length).toBeGreaterThan(1);
    for (const c of make) {
      if (c.init.k !== 'machine') throw new Error('not a machine');
      const r = data.recipes.find((x) => x.id === c.init.recipe)!;
      expect(r.inputs[c.port!].item).toBe(ORE);
    }
    expect(make.some((c) => c.init.k === 'machine' && c.init.recipe === SMELT)).toBe(true);
    // No miners for a belt that's already carrying something; a splitter, merger and sink. Outputs come from the
    // side panel, not the build menu.
    expect(list.some((c) => c.tab === 'raw')).toBe(false);
    expect(list.filter((c) => c.tab === 'logistic').map((c) => c.key)).toEqual(['l:splitter', 'l:merger', 'sink']);
    expect(list.some((c) => c.init.k === 'out' || c.init.k === 'in')).toBe(false);
  });

  test('an input wanting iron ore lists the miner and what makes it', () => {
    const m = model([smelter('s')], []);
    const list = choicesFor(wantAt(m, 9, 's', 'in', 0), 9);
    const raw = list.filter((c) => c.tab === 'raw');
    expect(raw).toHaveLength(1);
    expect(raw[0].init).toMatchObject({ k: 'extract', item: ORE, extractor: 'Build_MinerMk3_C' });
    // At tier 3 the best miner is Mk.1.
    expect(choicesFor(wantAt(m, 3, 's', 'in', 0), 3).find((c) => c.tab === 'raw')?.init).toMatchObject({ extractor: 'Build_MinerMk1_C' });
  });

  test('a resource nothing at the tier takes waits for that tier: no uranium before nuclear power', () => {
    const tierOf = (tier: number, item: string) =>
      choicesFor(undefined, tier).find((c) => c.tab === 'raw' && c.init.k === 'extract' && c.init.item === item)?.tier;
    expect(tierOf(4, 'Desc_OreUranium_C')).toBeGreaterThan(4);
    expect(tierOf(4, 'Desc_OreIron_C')).toBeLessThanOrEqual(4);
  });

  test("a splitter's output carries what reaches the splitter", () => {
    const m = model([miner('m'), { id: 's', ...at, k: 'logistic', kind: 'splitter' }], [{ a: 'm', ap: 0, b: 's', bp: 0 }]);
    expect(wantAt(m, 9, 's', 'out', 1)).toMatchObject({ side: 'in', item: ORE, medium: 'belt' });
    // Nothing on it yet: any belt item, no pipes.
    const bare = model([{ id: 's', ...at, k: 'logistic', kind: 'splitter' }], []);
    const want = wantAt(bare, 9, 's', 'out', 0);
    expect(want?.item).toBeUndefined();
    expect(choicesFor(want, 9).some((c) => c.key === 'l:junction')).toBe(false);
  });

  test('a water pipe lists pipe parts only', () => {
    const pump: MNode = { id: 'p', ...at, k: 'extract', extractor: 'Build_WaterPump_C', item: 'Desc_Water_C' };
    const list = choicesFor(wantAt(model([pump], []), 9, 'p', 'out', 0), 9);
    expect(list.filter((c) => c.tab === 'logistic').map((c) => c.key)).toEqual(['l:junction']);
  });

  test('with nothing waiting it lists everything, unlocked first', () => {
    const list = choicesFor(undefined, 2);
    const make = list.filter((c) => c.tab === 'make');
    expect(make.some((c) => c.init.k === 'machine' && c.init.recipe === SMELT)).toBe(true);
    const firstLocked = make.findIndex((c) => c.tier > 2);
    expect(make.slice(firstLocked).every((c) => c.tier > 2)).toBe(true);
    expect(list.some((c) => c.tab === 'raw' && c.init.k === 'extract' && c.init.item === 'Desc_Water_C')).toBe(true);
    expect(new Set(list.map((c) => c.key)).size).toBe(list.length);
    const smelt = make.find((c) => c.init.k === 'machine' && c.init.recipe === SMELT)!;
    expect(choiceWords(smelt)).toContain('Iron Ore');
  });

  test('recipes turned off in Recipes stay out, alternates and standard ones alike', () => {
    const want = wantAt(model([miner('m')], []), 9, 'm', 'out', 0);
    const recipes = (on?: Set<string>) =>
      choicesFor(want, 9, { on })
        .filter((c) => c.init.k === 'machine')
        .map((c) => (c.init.k === 'machine' ? c.init.recipe : ''));
    const kinds = (ids: string[]) => new Set(ids.map((id) => data.recipes.find((r) => r.id === id)?.kind));
    // Every alternate off: none listed, though some take iron ore.
    expect(kinds(recipes()).has('alternate')).toBe(true);
    const standard = new Set(data.recipes.filter((r) => r.kind === 'standard').map((r) => r.id));
    expect(kinds(recipes(standard))).toEqual(new Set(['standard']));
    // One alternate turned on: that one, and no other.
    const alt = data.recipes.find((r) => r.kind === 'alternate' && r.inputs.some((s) => s.item === ORE))!;
    const withAlt = recipes(new Set([...standard, alt.id]));
    expect(withAlt.filter((id) => !standard.has(id))).toEqual([alt.id]);
    // The standard iron ingot turned off too: gone from the list.
    expect(recipes(new Set([...standard].filter((id) => id !== SMELT)))).not.toContain(SMELT);
  });

  test('no recipe turned off ever shows: every item, either end, any mix of recipes on', () => {
    // A fixed spread of mixes: none, standard only, everything, and random halves.
    let seed = 7;
    const coin = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31 < 0.5;
    };
    const ids = data.recipes.map((r) => r.id);
    const mixes = [
      new Set<string>(),
      new Set(data.recipes.filter((r) => r.kind === 'standard').map((r) => r.id)),
      new Set(ids),
      ...Array.from({ length: 4 }, () => new Set(ids.filter(coin))),
    ];
    let checked = 0;
    for (const on of mixes) {
      const all = (want: Parameters<typeof choicesFor>[0]) =>
        choicesFor(want, 9, { on }).flatMap((c) => (c.init.k === 'machine' ? [c.init.recipe] : []));
      for (const id of all(undefined)) expect(on.has(id)).toBe(true);
      for (const item of Object.values(data.items))
        for (const side of ['in', 'out'] as const) {
          const want = { side, node: 'x', port: 0, item: item.id, medium: mediumOf(item.id) };
          for (const id of all(want)) {
            expect(on.has(id)).toBe(true);
            checked++;
          }
        }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  test('a new miner comes with the miner, purity and clock picked in Resources', () => {
    const want = wantAt(model([smelter('s')], []), 9, 's', 'in', 0);
    const ex = { miner: 'Build_MinerMk1_C', purity: 'impure' as const, clock: 1.5 };
    const minerOf = (tier: number, extraction = ex) => choicesFor(want, tier, { extraction }).find((c) => c.tab === 'raw')?.init;
    expect(minerOf(9)).toMatchObject({ k: 'extract', extractor: 'Build_MinerMk1_C', purity: 'impure', clock: 1.5 });
    // A Mk.3 picked, at a tier that hasn't one yet: the best there is.
    expect(minerOf(3, { ...ex, miner: 'Build_MinerMk3_C' })).toMatchObject({ extractor: 'Build_MinerMk1_C' });
    // A normal node at 100% stays unset, as on any card.
    const plain = minerOf(9, { miner: 'Build_MinerMk2_C', purity: 'normal', clock: 1 }) as Record<string, unknown>;
    expect(plain.extractor).toBe('Build_MinerMk2_C');
    expect('purity' in plain || 'clock' in plain).toBe(false);
    // A clock set for this resource beats the usual one.
    expect(minerOf(9, { ...ex, overclock: { [ORE]: 2 } } as never)).toMatchObject({ clock: 2 });
  });

  test('a new card sits with its end where the belt was let go, off the cards already there', () => {
    const m = model([miner('m')], []);
    const want = wantAt(m, 9, 'm', 'out', 0)!;
    const c = choicesFor(want, 9).find((x) => x.init.k === 'machine' && x.init.recipe === SMELT)!;
    const placed = placeChoice(m, c, { x: 500, y: 300 }, want);
    expect(placed.x).toBe(520);
    // One input: half way down the card, give or take half a grid square; the card on the grid.
    expect(Math.abs(placed.y + cardSize(placed).h / 2 - 300)).toBeLessThanOrEqual(20);
    expect(placed.x % 40 === 0 && placed.y % 40 === 0).toBe(true);
    // Let go on top of the miner: moved down off it.
    const over = placeChoice(m, c, { x: 100, y: 50 }, want);
    expect(over.y).toBeGreaterThanOrEqual(cardSize(m.nodes[0]).h + 20);
    const added = addNode(m, { ...over, id: undefined } as never);
    const joined = connect(added.model, 'm', 0, added.id, c.port!).model;
    expect(joined.links).toHaveLength(1);
  });

  test('a free spot is the spot itself on an empty floor, on the grid', () => {
    expect(freeSpot([], { x: 13, y: 27, w: 80, h: 160 })).toEqual({ x: 0, y: 40 });
    expect(freeSpot([], { x: 61, y: 99, w: 80, h: 160 })).toEqual({ x: 80, y: 80 });
  });
});

describe('going against the side panel', () => {
  test('a recipe turned off, a card above the tier, and a resource past its limit each say so', async () => {
    const alt = data.recipes.find((r) => r.kind === 'alternate' && r.inputs.some((s) => s.item === ORE))!;
    const m = model(
      [miner('m', 2), smelter('s'), { id: 'a', ...at, k: 'machine', recipe: alt.id }, out('o', INGOT)],
      [
        { a: 'm', ap: 0, b: 's', bp: 0 },
        { a: 's', ap: 0, b: 'o', bp: 0 },
      ],
    );
    const standard = new Set(data.recipes.filter((r) => r.kind === 'standard').map((r) => r.id));
    expect(ruleFlags(m, { tier: 9, on: standard }).get('a')).toEqual({ k: 'off' });
    expect(ruleFlags(m, { tier: 9, on: standard }).has('s')).toBe(false);
    // Nothing said about recipes when the home has no list.
    expect(ruleFlags(m, { tier: 9 }).size).toBe(0);
    // Mk.2 miners open at tier 4.
    expect(ruleFlags(m, { tier: 3 }).get('m')).toEqual({ k: 'tier', tier: 4 });
    // The smelter draws 30 a minute from the miners: over a limit of 20, under one of 500.
    const calc = await run(m);
    expect(ruleFlags(m, { tier: 9, caps: { [ORE]: 20 } }, calc).get('m')).toMatchObject({ k: 'cap', item: ORE, rate: 30, cap: 20 });
    expect(ruleFlags(m, { tier: 9, caps: { [ORE]: 500 } }, calc).has('m')).toBe(false);
  });
});

describe('the Mk a belt is built with', () => {
  test('left to itself: the slowest unlocked that carries the line; picked: the one picked', () => {
    const link = { id: 'l', a: 'a', ap: 0, b: 'b', bp: 0 };
    const name = (mk: number | undefined, rate: number | undefined, tier = 9, lanes?: number) =>
      builtTransport('belt', { ...link, ...(mk !== undefined ? { mk } : {}), ...(lanes ? { lanes } : {}) }, tier, rate).name;
    expect(name(undefined, 25)).toBe('Mk.1');
    expect(name(undefined, 60)).toBe('Mk.1');
    expect(name(undefined, 97.5)).toBe('Mk.2');
    expect(name(undefined, 270)).toBe('Mk.3');
    expect(name(undefined, 300)).toBe('Mk.4');
    // Two side by side: each carries half.
    expect(name(undefined, 200, 9, 2)).toBe('Mk.2');
    // More than the best unlocked carries, or no numbers yet: the best unlocked.
    expect(name(undefined, 5000, 3)).toBe(builtTransport('belt', link, 3).name);
    expect(name(undefined, undefined)).toBe('Mk.6');
    expect(name(2, 25)).toBe('Mk.3');
  });
});

describe('open ends', () => {
  test('a machine needs every end; a splitter one on each side', () => {
    const m = model(
      [miner('m'), { id: 's', ...at, k: 'logistic', kind: 'splitter' }, smelter('a'), out('o')],
      [
        { a: 'm', ap: 0, b: 's', bp: 0 },
        { a: 's', ap: 1, b: 'a', bp: 0 },
      ],
    );
    const open = openEnds(m);
    expect(open.get('s')).toEqual({ ins: [false], outs: [false, false, false] });
    // What the smelter makes is left over: its output needs no belt.
    expect(open.get('a')).toEqual({ ins: [false], outs: [false] });
    expect(open.get('o')).toEqual({ ins: [true], outs: [] });
    expect(open.get('m')).toEqual({ ins: [], outs: [false] });
    expect(openCards(m)).toEqual(['o']);
    // With open outputs backing up as in the game, it does.
    expect(openEnds({ ...m, stall: true }).get('a')).toEqual({ ins: [false], outs: [true] });
    // A splitter with nothing on it at all.
    expect(openEnds(model([{ id: 's', ...at, k: 'logistic', kind: 'splitter' }], [])).get('s')).toEqual({
      ins: [true],
      outs: [true, true, true],
    });
  });
});

describe('tidy up', () => {
  const standard = () => new Set(data.recipes.filter((r) => r.kind === 'standard').map((r) => r.id));
  for (const [item, rate, dir] of [
    ['Desc_Motor_C', 10, 'LR'],
    ['Desc_MotorLightweight_C', 2, 'LR'],
    ['Desc_SpaceElevatorPart_9_C', 2, 'LR'],
    ['Desc_Motor_C', 10, 'TB'],
    ['Desc_MotorLightweight_C', 2, 'TB'],
    ['Desc_SpaceElevatorPart_9_C', 2, 'TB'],
  ] as const)
    test(`${item}: no card on another, belts in square runs that meet their ends in order, ${dir === 'TB' ? 'top to bottom' : 'left to right'}`, async () => {
      const auto = solve(highs, {
        targets: [{ item, rate }],
        supplies: [],
        enabledRecipes: standard(),
        resourceCaps: {},
        objective: 'resources',
      });
      const m = await modelFromSolve(auto, 9, DEFAULT_EXTRACTION, dir);
      expect(m.dir).toBe(dir === 'TB' ? 'TB' : undefined);
      const box = (n: MNode) => ({ ...cardSize(n, dir), x: n.x, y: n.y });
      const hits = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
        a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      for (let i = 0; i < m.nodes.length; i++)
        for (let j = i + 1; j < m.nodes.length; j++) expect(hits(box(m.nodes[i]), box(m.nodes[j]))).toBe(false);
      const at = new Map(m.nodes.map((n) => [n.id, n]));
      // Every card on the grid, so every end is on a grid line; bends on a line or halfway.
      for (const n of m.nodes) expect([n.x % 40, n.y % 40]).toEqual([0, 0]);
      for (const l of m.links) for (const [x, y] of l.pts ?? []) expect([x % 20, y % 20]).toEqual([0, 0]);
      // Every belt has a spot for its label, on no card.
      for (const l of m.links) {
        expect(l.lbl).toBeDefined();
        const [x, y] = l.lbl!;
        for (const n of m.nodes) expect(hits({ x: x - 80, y: y - 18, w: 160, h: 36 }, box(n))).toBe(false);
      }
      // Each belt in straight runs with square turns, from its end on one card to its end on the other, over no card.
      const runs = m.links.map((l) => {
        const a = at.get(l.a)!;
        const b = at.get(l.b)!;
        const ea = endSpot(a, 'out', l.ap, dir);
        const eb = endSpot(b, 'in', l.bp, dir);
        const from = { x: a.x + ea.x, y: a.y + ea.y };
        const to = { x: b.x + eb.x, y: b.y + eb.y };
        const pts = [from, ...(l.pts ?? []).map(([x, y]) => ({ x, y })), to];
        return pts.slice(1).map((p, i) => [pts[i], p] as const);
      });
      for (const r of runs)
        for (const [p, q] of r) {
          expect(Math.abs(p.x - q.x) < 1 || Math.abs(p.y - q.y) < 1).toBe(true);
          const seg = { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(p.x - q.x), h: Math.abs(p.y - q.y) };
          for (const n of m.nodes) {
            const b = box(n);
            expect(hits(seg, { x: b.x + 2, y: b.y + 2, w: b.w - 4, h: b.h - 4 })).toBe(false);
          }
        }
      // Few belts cross: the cards in each column are ordered as the ends they feed.
      let cross = 0;
      for (let i = 0; i < runs.length; i++)
        for (let j = i + 1; j < runs.length; j++)
          for (const [a, b] of runs[i])
            for (const [c, d] of runs[j]) {
              const [h, v] =
                Math.abs(a.y - b.y) < 1 && Math.abs(c.x - d.x) < 1
                  ? [
                      [a, b],
                      [c, d],
                    ]
                  : Math.abs(a.x - b.x) < 1 && Math.abs(c.y - d.y) < 1
                    ? [
                        [c, d],
                        [a, b],
                      ]
                    : [];
              if (!h || !v) continue;
              if (
                v[0].x > Math.min(h[0].x, h[1].x) &&
                v[0].x < Math.max(h[0].x, h[1].x) &&
                h[0].y > Math.min(v[0].y, v[1].y) &&
                h[0].y < Math.max(v[0].y, v[1].y)
              )
                cross++;
            }
      expect(cross).toBeLessThanOrEqual(Math.ceil(m.links.length * 0.45));
      // Belts leaving one splitter, or reaching one merger, never cross each other.
      const meets = (i: number, j: number) => {
        let n = 0;
        for (const [a, b] of runs[i])
          for (const [c, d] of runs[j]) {
            const flat = Math.abs(a.y - b.y) < 1;
            const [h, v] =
              flat && Math.abs(c.x - d.x) < 1
                ? [
                    [a, b],
                    [c, d],
                  ]
                : !flat && Math.abs(c.y - d.y) < 1
                  ? [
                      [c, d],
                      [a, b],
                    ]
                  : [];
            if (!h || !v) continue;
            const inX = v[0].x > Math.min(h[0].x, h[1].x) && v[0].x < Math.max(h[0].x, h[1].x);
            const inY = h[0].y > Math.min(v[0].y, v[1].y) && h[0].y < Math.max(v[0].y, v[1].y);
            if (inX && inY) n++;
          }
        return n;
      };
      const crossed: string[] = [];
      for (const n of m.nodes) {
        if (n.k !== 'logistic') continue;
        for (const side of ['a', 'b'] as const) {
          const mine = m.links.flatMap((l, i) => (l[side] === n.id ? [i] : []));
          for (let x = 0; x < mine.length; x++)
            for (let y = x + 1; y < mine.length; y++) if (meets(mine[x], mine[y])) crossed.push(`${n.id} ${side}`);
        }
      }
      expect(crossed).toEqual([]);
      // The floor's way, but for a belt that loops back (a byproduct fed back in).
      const k = dir === 'TB' ? 'y' : 'x';
      const back = m.links.filter((l) => at.get(l.a)![k] >= at.get(l.b)![k]);
      expect(back.length).toBeLessThanOrEqual(Math.ceil(m.links.length * 0.05));
      // Tidying again changes nothing; a moved card goes back.
      expect(await arrangeModel(m)).toEqual(m);
      const moved = { ...m, nodes: m.nodes.map((n, i) => (i === 0 ? { ...n, x: n.x + 999 } : n)) };
      expect((await arrangeModel(moved)).nodes).toEqual(m.nodes);
      // Three layouts of a big factory.
    }, 30000);

  test('what changes on the floor while it is laid out stays: a card added, its belt, a card taken off', async () => {
    const auto = solve(highs, {
      targets: [{ item: 'Desc_Motor_C', rate: 10 }],
      supplies: [],
      enabledRecipes: standard(),
      resourceCaps: {},
      objective: 'resources',
    });
    const m = await modelFromSolve(auto, 9, DEFAULT_EXTRACTION);
    const moved = { ...m, nodes: m.nodes.map((n, i) => (i === 0 ? { ...n, x: n.x + 999 } : n)) };
    const laid = await arrangement(moved);
    // Meanwhile: a card put down and joined to the floor, and the last card taken off with its belts.
    const machine = m.nodes.find((n) => n.k === 'machine')!;
    const gone = m.nodes[m.nodes.length - 1].id;
    let now = addNode(moved, { k: 'out', item: 'Desc_Motor_C', x: 5000, y: 5000 }).model;
    const added = now.nodes[now.nodes.length - 1].id;
    now = { ...now, links: [...now.links, { id: 'late', a: machine.id, ap: 0, b: added, bp: 0, pts: [[1, 1]] }] };
    now = removeNodes(now, [gone]);
    const put = applyArrangement(now, laid);
    expect(put.nodes.find((n) => n.id === added)).toMatchObject({ x: 5000, y: 5000 });
    expect(put.nodes.some((n) => n.id === gone)).toBe(false);
    // The moved card goes back as Tidy up would put it; a belt the layout didn't know loses bends that lead nowhere.
    expect(put.nodes[0]).toEqual((await arrangeModel(m)).nodes[0]);
    expect(put.links.find((l) => l.id === 'late')?.pts).toBeUndefined();
    // Nothing changed meanwhile: the same as tidying at once.
    expect(applyArrangement(moved, laid)).toEqual(await arrangeModel(moved));
  }, 30000);
});

describe('the same output another way', () => {
  test('Fill to 100%: 7 × 95% become 6 × 100% and one at 65%', () => {
    expect(fullSpeed(7, 0.95)).toEqual({ n: 6.65, clock: undefined });
    // Overclocked: more machines at 100% instead of shards.
    expect(fullSpeed(4, 1.5)).toEqual({ n: 6, clock: undefined });
    expect(fullSpeed(2, 0.5)).toEqual({ n: undefined, clock: undefined });
  });
  test('Even out: 6 × 100% and one at 65% become 7 × 95%', () => {
    expect(evenSpeed(6.65, 1)).toEqual({ n: 7, clock: 0.95 });
    expect(evenSpeed(2.5, 1)).toEqual({ n: 3, clock: 0.833333 });
    expect(evenSpeed(0.5, 1)).toEqual({ n: undefined, clock: 0.5 });
  });
  test('a miner making a rate typed in: another clock, more miners only past 250%', () => {
    expect(minerFor(60, 120, 1)).toEqual({ n: undefined, clock: 0.5 });
    expect(minerFor(240, 120, 2)).toEqual({ n: 2, clock: undefined });
    expect(minerFor(600, 120, 1)).toEqual({ n: 2, clock: 2.5 });
    expect(minerFor(30, 120, 3)).toEqual({ n: 3, clock: 0.083333 });
  });
  test('there and back gives the same output', () => {
    for (const [n, c] of [
      [7, 0.95],
      [3, 0.888889],
      [13, 0.961538],
    ]) {
      const f = fullSpeed(n, c);
      const e = evenSpeed(f.n ?? 1, f.clock ?? 1);
      expect((e.n ?? 1) * (e.clock ?? 1)).toBeCloseTo(n * c, 5);
      expect(e.n ?? 1).toBe(n);
    }
  });
});

describe('belt label spots', () => {
  test('kept when saved, dropped when a card on the belt moves', () => {
    const m: Model = {
      v: MODEL_VERSION,
      calc: 'basic',
      seq: 3,
      nodes: [
        { id: '1', k: 'in', item: 'Desc_OreIron_C', x: 0, y: 0 },
        { id: '2', k: 'out', x: 500, y: 0 },
      ],
      links: [{ id: '3', a: '1', ap: 0, b: '2', bp: 0, pts: [[400, 50]], lbl: [420, 50] }],
    };
    expect(cleanModel(m)?.links[0].lbl).toEqual([420, 50]);
    expect(cleanModel({ ...m, links: [{ ...m.links[0], lbl: ['x', 1] }] })?.links[0].lbl).toBeUndefined();
    const moved = moveNodes(m, new Map([['2', { x: 600, y: 0 }]]));
    expect(moved.links[0].lbl).toBeUndefined();
    expect(moved.links[0].pts).toBeUndefined();
  });
});
