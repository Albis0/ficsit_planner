import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import names from '../src/data/world-names.json';
import world from '../src/data/world.json';
import { clusters, LONG_LINE, NEAR } from '../src/lib/save/cluster';
import { readSave } from '../src/lib/save/extract';
import { cleanSaveMap } from '../src/lib/save/map';
import { toMap, toPx } from '../src/lib/save/toMap';
import type { SaveBuilding, SaveData, SaveLink } from '../src/lib/save/types';

const at = (id: string, kind: SaveBuilding['kind'], x: number, more: Partial<SaveBuilding> = {}): SaveBuilding => ({
  id,
  cls: kind === 'machine' ? 'Build_ConstructorMk1_C' : `Build_${kind}_C`,
  kind,
  x,
  y: 0,
  z: 0,
  yaw: 0,
  ...more,
});
const link = (a: string, b: string): SaveLink => ({ a, ap: 'Output0', b, bp: 'Input0', pipe: false });
const ids = (groups: SaveBuilding[][]) => groups.map((g) => g.map((b) => b.id).sort()).sort();

describe('splitting a save into factories', () => {
  test('a short belt joins two buildings, a long one does not', () => {
    const far = (NEAR + 10_000) * 2;
    const short = [at('a', 'machine', 0), at('b', 'machine', far), at('belt', 'belt', 0, { length: LONG_LINE - 1 })];
    expect(ids(clusters(short, [link('a', 'belt'), link('belt', 'b')]))).toEqual([['a', 'b']]);
    // The same run in two pieces that together are too long.
    const long = [
      at('a', 'machine', 0),
      at('b', 'machine', far),
      at('belt1', 'belt', 0, { length: LONG_LINE / 2 + 1 }),
      at('lift', 'lift', 0, { length: LONG_LINE / 2 }),
    ];
    expect(ids(clusters(long, [link('a', 'belt1'), link('belt1', 'lift'), link('lift', 'b')]))).toEqual([['a'], ['b']]);
  });

  test('buildings standing close are one factory, belts and pipes are not part of it', () => {
    const b = [at('a', 'machine', 0), at('b', 'storage', NEAR - 1), at('c', 'machine', NEAR * 3), at('belt', 'belt', 0, { length: 5 })];
    expect(ids(clusters(b, [link('a', 'belt')]))).toEqual([['a', 'b'], ['c']]);
  });

  test('links to things that are not buildings are left alone', () => {
    expect(ids(clusters([at('a', 'machine', 0)], [link('a', 'BP_Train_C_1')]))).toEqual([['a']]);
  });
});

const save = (over: Partial<SaveData>): SaveData =>
  ({
    recipes: [],
    schematics: [],
    buildings: [],
    links: [],
    circuits: [],
    sloops: { free: 0, inMachines: 0, inDepot: 0 },
    shards: { free: 0, inMachines: 0, inDepot: 0 },
    collected: [],
    other: {},
    landmarks: [],
    unknown: {},
    objects: 0,
    ...over,
  }) as SaveData;

describe('a save on the map', () => {
  test('pickups and mined nodes by their names; names the map does not have are counted', () => {
    const node = names.node[5];
    const m = toMap(
      save({
        collected: [names.sloop[3], names.pod[0], names.slug2[1], 'BP_WAT1_C_nowhere'],
        buildings: [
          at('m1', 'extractor', 0, { cls: 'Build_MinerMk2_C', node, clock: 1.5 }),
          at('w1', 'extractor', 0, { cls: 'Build_WaterPump_C' }),
          at('p1', 'pressurizer', 0, { node: names.well[0] }),
          at('m2', 'extractor', 0, { node: 'BP_ResourceNode_mod' }),
        ],
        landmarks: [{ cls: 'Build_TradingPost_C', x: world.bounds.x0, y: world.bounds.y1 }],
      }),
      true,
    );
    expect(m.picked).toEqual({ sloop: [3], pod: [0], slug2: [1] });
    expect(m.miners).toEqual([[5, 'Build_MinerMk2_C', 1.5]]);
    expect(m.missed).toBe(2);
    expect(m.landmarks).toEqual([['Build_TradingPost_C', 0, world.size]]);
  });

  test('a factory is named after what it makes and does not use itself; a power plant after its generator', () => {
    const b = [
      at('s', 'machine', 0, { cls: 'Build_SmelterMk1_C', recipe: 'Recipe_IngotIron_C' }),
      at('c', 'machine', 100, { recipe: 'Recipe_IronRod_C' }),
      at('c2', 'machine', 200, { recipe: 'Recipe_IronRod_C' }),
      at('g', 'generator', NEAR * 10, { cls: 'Build_GeneratorCoal_C' }),
      at('x', 'extractor', NEAR * 20),
    ];
    const m = toMap(save({ buildings: b }), true);
    expect(m.factories.map((f) => [f.item, f.count])).toEqual([
      ['Desc_IronRod_C', { Build_SmelterMk1_C: 1, Build_ConstructorMk1_C: 2 }],
      ['Build_GeneratorCoal_C', { Build_GeneratorCoal_C: 1 }],
    ]);
    const [x0, y0] = toPx(-1500, -1500);
    expect(m.factories[0].box.slice(0, 2)).toEqual([x0, y0]);
    expect(toMap(save({ buildings: b }), false).factories).toEqual([]);
  });

  test('a stored save map is checked', () => {
    expect(cleanSaveMap(undefined)).toBeUndefined();
    expect(
      cleanSaveMap({
        picked: { sloop: [1, 1, -2, 'x'], nope: [1] },
        miners: [
          [0, 'Build_MinerMk1_C', 1],
          [99999, 'Build_MinerMk1_C', 1],
          [1, 'bad id!', 1],
          [2, 'Build_MinerMk1_C', 9],
        ],
        landmarks: [
          ['Build_Mam_C', 1, 2],
          ['Build_Lamp_C', 1, 2],
        ],
        factories: [{ id: 'a', item: 'Desc_IronRod_C', box: [0, 0, 1, 1], count: { Build_ConstructorMk1_C: 2 } }, { id: 'b' }],
        missed: -1,
      }),
    ).toEqual({
      picked: { sloop: [1] },
      miners: [[0, 'Build_MinerMk1_C', 1]],
      landmarks: [['Build_Mam_C', 1, 2]],
      factories: [{ id: 'a', item: 'Desc_IronRod_C', box: [0, 0, 1, 1], count: { Build_ConstructorMk1_C: 2 } }],
      missed: 0,
    });
  });
});

const SPACE = 'C:/code/ficsit-saves/ela/SPACEDELAELEVATORE.sav';

describe.skipIf(!existsSync(SPACE))('the player save on the map', () => {
  test('SPACEDELAELEVATORE: every miner on a node, what was picked up, three factories', async () => {
    const m = toMap(await readSave(new Uint8Array(readFileSync(SPACE))), true);
    expect(m.miners).toHaveLength(21);
    expect(m.missed).toBe(0);
    expect(Object.fromEntries(Object.entries(m.picked).map(([l, i]) => [l, i.length]))).toEqual({
      slug1: 15,
      slug2: 5,
      slug3: 1,
      sphere: 9,
      sloop: 3,
      pod: 3,
    });
    expect(m.factories.map((f) => f.item).sort()).toEqual(['Build_GeneratorCoal_C', 'Desc_ModularFrame_C', 'Desc_SteelPlateReinforced_C']);
    expect(m.landmarks.map((l) => l[0])).toContain('Build_TradingPost_C');
  });
});
