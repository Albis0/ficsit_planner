import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import names from '../src/data/world-names.json';
import world from '../src/data/world.json';
import { clusters, LONG_LINE, NEAR } from '../src/lib/save/cluster';
import { readSave } from '../src/lib/save/extract';
import { findFactories } from '../src/lib/save/factories';
import { cleanSaveMap } from '../src/lib/save/map';
import { toMap, toPx } from '../src/lib/save/toMap';
import type { SaveBuilding, SaveData, SaveLink } from '../src/lib/save/types';
import { NODES, nodesUnknown, WELLS, worldNodes, worldWells } from '../src/lib/world';

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
    nodes: {},
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
      [],
    );
    expect(m.picked).toEqual({ sloop: [3], pod: [0], slug2: [1] });
    expect(m.miners).toEqual([[5, 'Build_MinerMk2_C', 1.5]]);
    expect(m.missed).toBe(2);
    expect(m.landmarks).toEqual([['Build_TradingPost_C', 0, world.size]]);
  });

  test('a random-nodes save keeps only the nodes and wells that differ from the planner map, and says it was random', () => {
    const [a, b, c] = [names.node[0], names.node[1], names.node[2]];
    const other = NODES[0].item === 'Desc_Coal_C' ? 'Desc_OreIron_C' : 'Desc_Coal_C';
    const m = toMap(
      save({
        random: true,
        nodes: {
          // Same item, no purity given: as the map has it.
          [a]: { item: NODES[0].item },
          // Another item, no purity given: keeps the map's purity.
          [b]: { item: other },
          // Same item, another purity.
          [c]: { item: NODES[2].item, purity: ((NODES[2].purity + 1) % 3) as 0 | 1 | 2 },
          [names.well[0]]: { item: WELLS[0].item === 'Desc_Water_C' ? 'Desc_LiquidOil_C' : 'Desc_Water_C' },
          [names.well[1]]: { item: WELLS[1].item },
          BP_ResourceNode_mod: { item: other },
        },
      }),
      [],
    );
    expect(m.nodes).toEqual([
      [1, other, NODES[1].purity],
      [2, NODES[2].item, (NODES[2].purity + 1) % 3],
    ]);
    expect(m.wells).toEqual([[0, WELLS[0].item === 'Desc_Water_C' ? 'Desc_LiquidOil_C' : 'Desc_Water_C']]);
    expect(m.random).toBe(true);
    // Randomized, but every node happens to match: still known as random.
    const same = toMap(save({ random: true, nodes: { [a]: { item: NODES[0].item } } }), []);
    expect([same.nodes, same.wells, same.random]).toEqual([undefined, undefined, true]);
    // A normal save has none of it.
    const plain = toMap(save({}), []);
    expect([plain.nodes, plain.wells, plain.random]).toEqual([undefined, undefined, undefined]);
  });

  test('the nodes of the world on screen: the overrides applied, the same list for the same map, the planner map without one', () => {
    const other = NODES[3].item === 'Desc_Coal_C' ? 'Desc_OreIron_C' : 'Desc_Coal_C';
    const map = cleanSaveMap({
      picked: {},
      miners: [],
      landmarks: [],
      factories: [],
      nodes: [[3, other, 0]],
      wells: [[2, other]],
      random: true,
    })!;
    const list = worldNodes(map);
    expect(list).toHaveLength(NODES.length);
    expect(list[3]).toEqual({ ...NODES[3], item: other, purity: 0 });
    expect(list[4]).toBe(NODES[4]);
    expect(worldNodes(map)).toBe(list);
    expect(worldWells(map)[2]).toEqual({ ...WELLS[2], item: other });
    expect(worldWells(map)).toBe(worldWells(map));
    expect(worldNodes(undefined)).toBe(NODES);
    expect(worldNodes({ ...map, nodes: undefined })).toBe(NODES);
    expect(worldWells(undefined)).toBe(WELLS);
    // A random-nodes world without its save has only its geysers to show; with one, its own.
    expect(worldNodes(undefined, true)).toEqual(NODES.filter((n) => n.kind === 'geyser'));
    expect(nodesUnknown(undefined, true)).toBe(true);
    expect(nodesUnknown(map, true)).toBe(false);
    expect(nodesUnknown(undefined, false)).toBe(false);
    expect(worldNodes(map, true)).toBe(list);
    expect(worldNodes(undefined, false)).toBe(NODES);
  });

  test('a factory is named after what it makes and does not use itself; a power plant on its own is not a factory', () => {
    const b = [
      at('s', 'machine', 0, { cls: 'Build_SmelterMk1_C', recipe: 'Recipe_IngotIron_C' }),
      at('c', 'machine', 100, { recipe: 'Recipe_IronRod_C' }),
      at('c2', 'machine', 200, { recipe: 'Recipe_IronRod_C' }),
      at('g', 'generator', NEAR * 10, { cls: 'Build_GeneratorCoal_C' }),
      at('x', 'extractor', NEAR * 20),
    ];
    const { list } = findFactories({ buildings: b, links: [] });
    expect(list.map((f) => [f.item, f.count, f.recipes])).toEqual([
      ['Desc_IronRod_C', { Build_SmelterMk1_C: 1, Build_ConstructorMk1_C: 2 }, { Recipe_IngotIron_C: 1, Recipe_IronRod_C: 2 }],
    ]);
    const [x0, y0] = toPx(-1500, -1500);
    expect(list[0].box.slice(0, 2)).toEqual([x0, y0]);
    expect(toMap(save({ buildings: b }), list).factories).toBe(list);
  });

  test('a stored map keeps good nodes, wells and the random mark, drops broken ones, and loads without them', () => {
    const base = { picked: {}, miners: [], landmarks: [], factories: [], missed: 0 };
    const ore = 'Desc_OreIron_C';
    expect(
      cleanSaveMap({
        ...base,
        nodes: [[0, ore, 2], [99999, ore, 1], [1, 'Desc_Nope_C', 1], [2, ore, 3], [3, ore, 1.5], [4, 'Desc_Geyser_C', 1], 'x', [5, ore, 0]],
        wells: [
          [0, 'Desc_Water_C'],
          [99, 'Desc_Water_C'],
          [1, 'bad'],
          [-1, ore],
        ],
        random: true,
      }),
    ).toEqual({
      ...base,
      nodes: [
        [0, ore, 2],
        [5, ore, 0],
      ],
      wells: [[0, 'Desc_Water_C']],
      random: true,
    });
    expect(cleanSaveMap({ ...base, random: 'yes', nodes: 'x' })).toEqual(base);
    expect(cleanSaveMap(base)).toEqual(base);
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
        factories: [
          { id: 'a', item: 'Desc_IronRod_C', box: [0, 0, 1, 1], count: { Build_ConstructorMk1_C: 2 }, recipes: { Recipe_IronRod_C: 2 } },
          // Kept before recipes were counted.
          { id: 'c', item: 'Desc_IronRod_C', box: [0, 0, 1, 1], count: {} },
          { id: 'b' },
          { id: 'd', item: 'Desc_IronRod_C', box: [0, 0, 1, 1], count: {}, recipes: { 'bad id': 1 } },
        ],
        missed: -1,
      }),
    ).toEqual({
      picked: { sloop: [1] },
      miners: [[0, 'Build_MinerMk1_C', 1]],
      landmarks: [['Build_Mam_C', 1, 2]],
      factories: [
        { id: 'a', item: 'Desc_IronRod_C', box: [0, 0, 1, 1], count: { Build_ConstructorMk1_C: 2 }, recipes: { Recipe_IronRod_C: 2 } },
        { id: 'c', item: 'Desc_IronRod_C', box: [0, 0, 1, 1], count: {}, recipes: {} },
      ],
      missed: 0,
    });
  });
});

const SPACE = 'C:/code/ficsit-ekler/ficsit-saves/ela/SPACEDELAELEVATORE.sav';

const RANDOM = 'C:/code/ficsit-ekler/ficsit-saves/random/as.sav';

describe.skipIf(!existsSync(RANDOM))('the random-nodes save on the map', () => {
  test('as.sav: 577 node and satellite overrides and 17 cores read, the differing ones kept, marked random', async () => {
    const data = await readSave(new Uint8Array(readFileSync(RANDOM)));
    expect(Object.keys(data.nodes)).toHaveLength(577 + 17);
    expect(data.random).toBe(true);
    expect(data.nodes.BP_ResourceNode13.item).toBe('Desc_OreCopper_C');
    const m = toMap(data, []);
    expect(m.random).toBe(true);
    // 462 of the 577 hold another item than the planner's map; 29 more differ only in purity.
    expect(m.nodes?.filter(([i, item]) => item !== NODES[i].item)).toHaveLength(462);
    expect(m.nodes).toHaveLength(491);
    expect(m.wells).toHaveLength(10);
    expect(m.nodes?.find(([i]) => i === names.node.indexOf('BP_ResourceNode13'))?.[1]).toBe('Desc_OreCopper_C');
    // Everything it keeps is valid.
    expect(cleanSaveMap(m)).toEqual(m);
    const shown = worldNodes(m);
    expect(shown.filter((n) => n.kind !== 'geyser')).toHaveLength(NODES.filter((n) => n.kind !== 'geyser').length);
  });
});

describe.skipIf(!existsSync(SPACE))('the player save on the map', () => {
  test('SPACEDELAELEVATORE: every miner on a node, what was picked up, three factories', async () => {
    const data = await readSave(new Uint8Array(readFileSync(SPACE)));
    const m = toMap(data, findFactories(data).list);
    expect(m.miners).toHaveLength(21);
    expect(m.missed).toBe(0);
    expect([m.nodes, m.wells, m.random]).toEqual([undefined, undefined, undefined]);
    expect(Object.fromEntries(Object.entries(m.picked).map(([l, i]) => [l, i.length]))).toEqual({
      slug1: 15,
      slug2: 5,
      slug3: 1,
      sphere: 9,
      sloop: 3,
      pod: 3,
    });
    expect(m.factories.map((f) => f.item).sort()).toEqual(['Desc_ModularFrame_C', 'Desc_SAMIngot_C', 'Desc_SteelPlateReinforced_C']);
    expect(m.landmarks.map((l) => l[0])).toContain('Build_TradingPost_C');
  });
});
