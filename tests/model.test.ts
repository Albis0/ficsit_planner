import { beforeAll, describe, expect, test } from 'bun:test';
import loadHighs, { type Highs } from 'highs';
import { data } from '../src/lib/data';
import { DEFAULT_EXTRACTION } from '../src/lib/extraction';
import { adaptModel } from '../src/lib/model/calc/adapter';
import { calcKey, calcModel } from '../src/lib/model/calc';
import { modelFromSolve } from '../src/lib/model/fromAuto';
import { arrangeModel } from '../src/lib/model/arrange';
import { openCards, openEnds } from '../src/lib/model/checks';
import { choicesFor, choiceWords, placeChoice, wantAt } from '../src/lib/model/choices';
import { cardSize, freeSpot } from '../src/lib/model/layout';
import { addNode, canConnect, connect, removeNodes } from '../src/lib/model/ops';
import { cleanModel } from '../src/lib/model/sanitize';
import { type MLink, type MNode, type Model, MODEL_VERSION } from '../src/lib/model/types';
import { solve } from '../src/lib/solver';

let highs: Highs;
beforeAll(async () => {
  highs = await loadHighs();
});

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

  test('a machine with nothing on its output stops, unless the model counts it as left over', () => {
    const m = model([miner('m'), smelter('a')], [{ a: 'm', ap: 0, b: 'a', bp: 0 }]);
    expect(run(m).nodes.a.status).toBe('noOutput');
    expect(run(m).nodes.a.u).toBe(0);
    const drained = run({ ...m, drain: true });
    expect(drained.nodes.a.u).toBeCloseTo(1);
    expect(adaptModel({ ...m, drain: true }, drained).result.surplus[0].rate).toBeCloseTo(30);
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
    const r = run(model(nodes, links, { drain: true }));
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
    test(`${item}: the hand-built copy makes what the plan makes from what it mines`, () => {
      const auto = solve(highs, {
        targets: [{ item, rate }],
        supplies: [],
        enabledRecipes: standard(),
        resourceCaps: {},
        objective: 'resources',
      });
      const m = modelFromSolve(auto, 9, DEFAULT_EXTRACTION);
      expect(cleanModel(m)).toEqual(m);
      const r = run(m);
      const { result } = adaptModel(m, r);
      const made = result.targets.find((t) => t.item === item)?.rate ?? 0;
      expect(made).toBeCloseTo(rate, 4);
      for (const x of auto.raw) expect(result.raw.find((y) => y.item === x.item)?.rate ?? 0).toBeCloseTo(x.rate, 4);
      for (const n of m.nodes) if (n.k === 'machine') expect(r.nodes[n.id].u).toBeCloseTo(1, 6);
    });
  }
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
    s.editModel(plan.id, (m: Model) => ({ ...m, drain: true }), 'drain');
    s.editModel(plan.id, (m: Model) => ({ ...m, drain: undefined }), 'drain');
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
    // No miners for a belt that's already carrying something; a splitter, merger, sink and an output.
    expect(list.some((c) => c.tab === 'raw')).toBe(false);
    expect(list.filter((c) => c.tab === 'logistic').map((c) => c.key)).toEqual(['l:splitter', 'l:merger', 'sink']);
    expect(list.find((c) => c.tab === 'io')?.init).toEqual({ k: 'out', item: ORE, x: 0, y: 0 });
  });

  test('an input wanting iron ore lists the miner and what makes it', () => {
    const m = model([smelter('s')], []);
    const list = choicesFor(wantAt(m, 9, 's', 'in', 0), 9);
    const raw = list.filter((c) => c.tab === 'raw');
    expect(raw).toHaveLength(1);
    expect(raw[0].init).toMatchObject({ k: 'extract', item: ORE, extractor: 'Build_MinerMk3_C' });
    // At tier 3 the best miner is Mk.1.
    expect(choicesFor(wantAt(m, 3, 's', 'in', 0), 3).find((c) => c.tab === 'raw')?.init).toMatchObject({ extractor: 'Build_MinerMk1_C' });
    expect(list.find((c) => c.tab === 'io')?.init).toEqual({ k: 'in', item: ORE, x: 0, y: 0 });
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

  test('with nothing waiting it lists everything, turned on and unlocked first', () => {
    const list = choicesFor(undefined, 2, new Set([SMELT]));
    const make = list.filter((c) => c.tab === 'make');
    expect(make[0].init).toMatchObject({ recipe: SMELT });
    const firstLocked = make.findIndex((c) => c.tier > 2);
    expect(make.slice(firstLocked).every((c) => c.tier > 2)).toBe(true);
    expect(list.some((c) => c.tab === 'raw' && c.init.k === 'extract' && c.init.item === 'Desc_Water_C')).toBe(true);
    expect(new Set(list.map((c) => c.key)).size).toBe(list.length);
    expect(choiceWords(make[0])).toContain('Iron Ore');
  });

  test('a new card sits with its end where the belt was let go, off the cards already there', () => {
    const m = model([miner('m')], []);
    const want = wantAt(m, 9, 'm', 'out', 0)!;
    const c = choicesFor(want, 9).find((x) => x.init.k === 'machine' && x.init.recipe === SMELT)!;
    const placed = placeChoice(m, c, { x: 500, y: 300 }, want);
    expect(placed.x).toBe(520);
    // One input: half way down the card, give or take the grid.
    expect(Math.abs(placed.y + cardSize(placed).h / 2 - 300)).toBeLessThanOrEqual(10);
    // Let go on top of the miner: moved down off it.
    const over = placeChoice(m, c, { x: 100, y: 50 }, want);
    expect(over.y).toBeGreaterThanOrEqual(cardSize(m.nodes[0]).h + 20);
    const added = addNode(m, { ...over, id: undefined } as never);
    const joined = connect(added.model, 'm', 0, added.id, c.port!).model;
    expect(joined.links).toHaveLength(1);
  });

  test('a free spot is the spot itself on an empty floor, on the grid', () => {
    expect(freeSpot([], { x: 13, y: 27, w: 96, h: 96 })).toEqual({ x: 20, y: 20 });
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
    expect(open.get('a')).toEqual({ ins: [false], outs: [true] });
    expect(open.get('o')).toEqual({ ins: [true], outs: [] });
    expect(open.get('m')).toEqual({ ins: [], outs: [false] });
    expect(openCards(m)).toEqual(['a', 'o'].sort((x, y) => m.nodes.findIndex((n) => n.id === x) - m.nodes.findIndex((n) => n.id === y)));
    // Counting open outputs as left over: the smelter's output no longer needs a belt.
    expect(openEnds({ ...m, drain: true }).get('a')).toEqual({ ins: [false], outs: [false] });
    // A splitter with nothing on it at all.
    expect(openEnds(model([{ id: 's', ...at, k: 'logistic', kind: 'splitter' }], [])).get('s')).toEqual({
      ins: [true],
      outs: [true, true, true],
    });
  });
});

describe('tidy up', () => {
  const standard = () => new Set(data.recipes.filter((r) => r.kind === 'standard').map((r) => r.id));
  for (const [item, rate] of [
    ['Desc_Motor_C', 10],
    ['Desc_MotorLightweight_C', 2],
    ['Desc_SpaceElevatorPart_9_C', 2],
  ] as const)
    test(`${item}: no card on another, every belt routed, left to right`, () => {
      const auto = solve(highs, {
        targets: [{ item, rate }],
        supplies: [],
        enabledRecipes: standard(),
        resourceCaps: {},
        objective: 'resources',
      });
      const m = modelFromSolve(auto, 9, DEFAULT_EXTRACTION);
      const box = (n: MNode) => ({ ...cardSize(n), x: n.x, y: n.y });
      for (let i = 0; i < m.nodes.length; i++)
        for (let j = i + 1; j < m.nodes.length; j++) {
          const a = box(m.nodes[i]);
          const b = box(m.nodes[j]);
          expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false);
        }
      expect(m.links.every((l) => (l.pts?.length ?? 0) > 0)).toBe(true);
      const at = new Map(m.nodes.map((n) => [n.id, n]));
      // Left to right, but for a belt that loops back (a byproduct fed back in).
      const back = m.links.filter((l) => at.get(l.a)!.x >= at.get(l.b)!.x);
      expect(back.length).toBeLessThanOrEqual(Math.ceil(m.links.length * 0.05));
      // Tidying again changes nothing; a moved card goes back.
      expect(arrangeModel(m)).toEqual(m);
      const moved = { ...m, nodes: m.nodes.map((n, i) => (i === 0 ? { ...n, x: n.x + 999 } : n)) };
      expect(arrangeModel(moved).nodes).toEqual(m.nodes);
    });
});
