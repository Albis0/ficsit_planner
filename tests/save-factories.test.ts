import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import names from '../src/data/world-names.json';
import type { MNode } from '../src/lib/model/types';
import { readSave } from '../src/lib/save/extract';
import { findFactories } from '../src/lib/save/factories';
import { saveTicks } from '../src/lib/save/ticks';
import type { SaveBuilding, SaveLink } from '../src/lib/save/types';
import type { SolveResult } from '../src/lib/solver';
import { NODES } from '../src/lib/world';

const IRON = NODES.findIndex((n) => n.item === 'Desc_OreIron_C' && n.kind === 'node' && n.purity === 2);

const at = (id: string, kind: SaveBuilding['kind'], cls: string, more: Partial<SaveBuilding> = {}): SaveBuilding => ({
  id,
  cls,
  kind,
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
  ...more,
});
const machine = (id: string, cls: string, recipe: string) => at(id, 'machine', cls, { recipe });
const belt = (id: string, mk = 1, length = 10) => at(id, 'belt', `Build_ConveyorBeltMk${mk}_C`, { length });
const join = (a: string, ap: string, b: string, bp: string, pipe = false): SaveLink => ({ a, ap, b, bp, pipe });
/** A run from one port through belt pieces to another. */
const run = (a: string, ap: string, pieces: string[], b: string, bp: string, pipe = false): SaveLink[] => {
  const ends = [
    [a, ap],
    ...pieces.flatMap((p) => [
      [p, pipe ? 'PipelineConnection0' : 'ConveyorAny0'],
      [p, pipe ? 'PipelineConnection1' : 'ConveyorAny1'],
    ]),
    [b, bp],
  ];
  const out: SaveLink[] = [];
  for (let i = 0; i < ends.length; i += 2) out.push(join(ends[i][0], ends[i][1], ends[i + 1][0], ends[i + 1][1], pipe));
  return out;
};

/*
  An iron line: a miner and a smelter, a splitter to plates and rods, rods to screws, plates and screws into an
  assembler whose plates leave on a train; limestone comes in on a train for concrete; a water extractor and coal on
  a train feed a coal generator through a pipe junction.
*/
const buildings: SaveBuilding[] = [
  at('m', 'extractor', 'Build_MinerMk2_C', { node: names.node[IRON] }),
  machine('s', 'Build_SmelterMk1_C', 'Recipe_IngotIron_C'),
  at('sp', 'splitter', 'Build_ConveyorAttachmentSplitter_C'),
  machine('c1', 'Build_ConstructorMk1_C', 'Recipe_IronPlate_C'),
  machine('c2', 'Build_ConstructorMk1_C', 'Recipe_IronRod_C'),
  machine('c3', 'Build_ConstructorMk1_C', 'Recipe_Screw_C'),
  machine('a', 'Build_AssemblerMk1_C', 'Recipe_IronPlateReinforced_C'),
  machine('c4', 'Build_ConstructorMk1_C', 'Recipe_Concrete_C'),
  at('w', 'extractor', 'Build_WaterPump_C'),
  at('j', 'junction', 'Build_PipelineJunction_Cross_C'),
  at('g', 'generator', 'Build_GeneratorCoal_C', { fuel: 'Desc_Coal_C' }),
  machine('idle', 'Build_ConstructorMk1_C', ''),
  ...['b1', 'b2', 'b3', 'b4', 'b5', 'b6'].map((id, i) => belt(id, i < 2 ? i + 2 : 1)),
  at('p1', 'pipe', 'Build_Pipeline_C', { length: 5 }),
  at('p2', 'pipe', 'Build_PipelineMK2_C', { length: 5 }),
];
buildings.find((b) => b.id === 'idle')!.recipe = undefined;
const links: SaveLink[] = [
  ...run('m', 'Output0', ['b1'], 's', 'Input0'),
  ...run('s', 'Output0', ['b2'], 'sp', 'Input1'),
  join('sp', 'Output1', 'c1', 'Input0'),
  ...run('sp', 'Output2', ['b3'], 'c2', 'Input0'),
  join('c2', 'Output0', 'c3', 'Input0'),
  // Screws on the assembler's first input, plates on its second: the other way round from the recipe.
  join('c3', 'Output0', 'a', 'Input0'),
  join('c1', 'Output0', 'a', 'Input1'),
  ...run('a', 'Output0', ['b4'], 'Build_TrainDockingStation_C_1', 'Input0'),
  ...run('Build_TrainDockingStation_C_2', 'Output0', ['b5'], 'c4', 'Input0'),
  ...run('Build_TrainDockingStation_C_3', 'Output0', ['b6'], 'g', 'Input0'),
  ...run('w', 'FGPipeConnectionFactory', ['p1'], 'j', 'Connection0', true),
  ...run('j', 'Connection1', ['p2'], 'g', 'FGPipeConnectionFactory', true),
];

describe('the save factories, found again on the next import', () => {
  test('a factory keeps its id when most of its buildings are still there', () => {
    const first = findFactories({ buildings, links });
    expect(first.list).toHaveLength(1);
    const id = first.list[0].id;
    expect(first.list[0].recipes).toMatchObject({ Recipe_IronPlate_C: 1, Recipe_IronPlateReinforced_C: 1 });
    // The player took the concrete constructor down and the factory was renamed by its first building.
    const fewer = buildings.filter((b) => b.id !== 'c4');
    expect(findFactories({ buildings: fewer, links }, { old: first.members[id] }).list[0].id).toBe('old');
    // Rebuilt from scratch: a new id.
    expect(findFactories({ buildings, links }, { old: ['x', 'y'] }).list[0].id).toBe(id);
  });
});

const machineCard = (id: string, r: string, done?: true | 'save'): MNode => ({
  id,
  x: 0,
  y: 0,
  k: 'machine',
  recipe: r,
  ...(done ? { done } : {}),
});
const use = (r: string, built: number, node?: string) =>
  ({ recipe: { id: r }, built, ...(node ? { node } : {}) }) as SolveResult['recipes'][number];

describe('ticks from the save', () => {
  test('cards are ticked as far as the save has machines, the player’s own ticks stay and count', () => {
    const plan = {
      floor: 'manual' as const,
      model: { nodes: [machineCard('1', 'R_A', true), machineCard('2', 'R_A'), machineCard('3', 'R_A', 'save'), machineCard('4', 'R_B')] },
    };
    const result = { recipes: [use('R_A', 2, '1'), use('R_A', 2, '2'), use('R_A', 1, '3'), use('R_B', 3, '4')] };
    const next = saveTicks(plan, { R_A: 4, R_B: 3 }, result);
    expect(next && 'nodes' in next && next.nodes.map((n) => n.done)).toEqual([true, 'save', undefined, 'save']);
    // Nothing to change: undefined.
    expect(saveTicks({ ...plan, model: { nodes: (next as { nodes: MNode[] }).nodes } }, { R_A: 4, R_B: 3 }, result)).toBeUndefined();
  });

  test('on the Auto floor a recipe is ticked when the save has all its machines', () => {
    const result = { recipes: [use('R_A', 3), use('R_B', 2), use('R_C', 1)] };
    expect(saveTicks({ built: ['R_C'], savedBuilt: ['R_B'] }, { R_A: 3, R_B: 1 }, result)).toEqual({
      built: ['R_C', 'R_A'],
      savedBuilt: ['R_A'],
    });
    expect(saveTicks({ built: ['R_C', 'R_A'], savedBuilt: ['R_A'] }, { R_A: 3, R_B: 1 }, result)).toBeUndefined();
  });
});

const SPACE = 'C:/code/ficsit-saves/ela/SPACEDELAELEVATORE.sav';

describe.skipIf(!existsSync(SPACE))('the player save', () => {
  test('SPACEDELAELEVATORE: three factories, the coal plant is not one', async () => {
    const found = findFactories(await readSave(new Uint8Array(readFileSync(SPACE))));
    expect(found.list.map((f) => f.item)).toEqual(['Desc_ModularFrame_C', 'Desc_SteelPlateReinforced_C', 'Desc_SAMIngot_C']);
    expect(Object.values(found.list[0].count).reduce((n, c) => n + c, 0)).toBe(60);
  });
});

describe('a factory tab linked to a save factory', () => {
  test('the link and the save’s ticks are kept with the tab, and taken off with the link', async () => {
    const { cleanPlan } = await import('../src/lib/sanitize');
    const { newPlan, unlinkSave } = await import('../src/store');
    const raw = {
      ...newPlan('Rods'),
      saveFactory: 'Build_AssemblerMk1_C_2146008795',
      built: ['Recipe_IronRod_C', 'Recipe_Screw_C'],
      savedBuilt: ['Recipe_Screw_C', 'Recipe_IronPlate_C'],
      floor: 'manual',
      model: {
        v: 1,
        calc: 'basic',
        seq: 9,
        links: [],
        nodes: [machineCard('1', 'Recipe_IronRod_C', 'save'), machineCard('2', 'Recipe_IronRod_C', true)],
      },
    };
    const plan = cleanPlan(raw, newPlan('x'));
    expect(plan.saveFactory).toBe('Build_AssemblerMk1_C_2146008795');
    // Only ticks still on can have come from the save.
    expect(plan.savedBuilt).toEqual(['Recipe_Screw_C']);
    expect(plan.model?.nodes.map((n) => n.done)).toEqual(['save', true]);
    expect(cleanPlan({ ...raw, saveFactory: 'bad id!' }, newPlan('x')).saveFactory).toBeUndefined();
    const off = unlinkSave(plan);
    expect(off.saveFactory).toBeUndefined();
    expect(off.built).toEqual(['Recipe_IronRod_C']);
    expect(off.model?.nodes.map((n) => n.done)).toEqual([undefined, true]);
  });
});
