import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import names from '../src/data/world-names.json';
import { findGrids } from '../src/lib/save/circuits';
import { readSave } from '../src/lib/save/extract';
import { cleanGrids } from '../src/lib/save/map';
import type { SaveBuilding } from '../src/lib/save/types';
import { NODES } from '../src/lib/world';
import { cleanSave, newPowerPlan, useStore } from '../src/store';

const GEYSER = NODES.findIndex((n) => n.item === 'Desc_Geyser_C' && n.purity === 2);

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

const buildings: SaveBuilding[] = [
  at('g1', 'generator', 'Build_GeneratorCoal_C', { fuel: 'Desc_Coal_C' }),
  // Standing empty: counted as burning what the others burn.
  at('g2', 'generator', 'Build_GeneratorCoal_C'),
  at('g3', 'generator', 'Build_GeneratorCoal_C', { fuel: 'Desc_Coal_C', clock: 1.5 }),
  at('aug', 'generator', 'Build_AlienPowerBuilding_C', { fuel: 'Desc_AlienPowerFuel_C' }),
  at('geo', 'generator', 'Build_GeneratorGeoThermal_C', { node: names.node[GEYSER] }),
  at('bat', 'battery', 'Build_PowerStorageMk1_C'),
  at('c', 'machine', 'Build_ConstructorMk1_C', { recipe: 'Recipe_IronPlate_C' }),
  at('m', 'extractor', 'Build_MinerMk1_C'),
  at('lone', 'machine', 'Build_ConstructorMk1_C', { recipe: 'Recipe_IronPlate_C' }),
];

describe('power circuits from a save', () => {
  test('a circuit with generators: its rows, batteries, what it makes with the augmenter boost, and what it draws', () => {
    const grids = findGrids({
      buildings,
      circuits: [
        { id: 3, members: ['g1', 'g2', 'g3', 'aug', 'geo', 'bat', 'c', 'm'] },
        // Machines alone have nothing to make a power plant of.
        { id: 4, members: ['lone'] },
      ],
    });
    expect(grids).toHaveLength(1);
    const [g] = grids;
    expect(g.plants).toEqual([
      { generator: 'Build_GeneratorCoal_C', fuel: 'Desc_Coal_C', clock: 1, n: 2 },
      { generator: 'Build_GeneratorCoal_C', fuel: 'Desc_Coal_C', clock: 1.5, n: 1 },
      { generator: 'Build_AlienPowerBuilding_C', clock: 1, fed: true, n: 1 },
      { generator: 'Build_GeneratorGeoThermal_C', clock: 1, purity: 'pure', n: 1 },
    ]);
    expect(g.batteries).toBe(1);
    // (75 + 75 + 112.5 coal + 500 augmenter + 400 pure geyser) × (1 + 10% + 20% fed)
    expect(g.made).toBeCloseTo(1162.5 * 1.3, 0);
    // A constructor (4 MW) and a Miner Mk.1 (5 MW).
    expect(g.used).toBe(9);
  });

  test('kept circuits are checked: a broken one is left out', () => {
    const good = {
      id: 1,
      plants: [{ generator: 'Build_GeneratorCoal_C', fuel: 'Desc_Coal_C', clock: 1, n: 2 }],
      batteries: 0,
      made: 150,
      used: 4,
    };
    expect(cleanGrids([good])).toEqual([good]);
    expect(cleanGrids([{ ...good, plants: [{ ...good.plants[0], generator: 'Build_Nope_C' }] }])).toEqual([]);
    expect(cleanGrids([{ ...good, plants: [{ ...good.plants[0], purity: 'shiny' }] }])).toEqual([]);
    expect(cleanGrids([{ ...good, plants: [] }, 'x', null])).toEqual([]);
    const s = cleanSave({ session: 's', answers: {}, seen: {}, grids: [good, { id: 2 }] });
    expect(s?.grids).toEqual([good]);
  });

  test('a power plant tab from a circuit: the untouched plant on screen takes it, the next one is new', () => {
    const empty = newPowerPlan('Plant 1');
    useStore.setState({ power: [empty], activePower: empty.id, mode: 'factory' });
    const rows = [
      { generator: 'Build_GeneratorCoal_C', fuel: 'Desc_Coal_C', clock: 1, n: 20 },
      { generator: 'Build_GeneratorGeoThermal_C', clock: 1, purity: 'pure' as const, n: 1 },
    ];
    useStore.getState().plantFromSave('Coal plant', rows);
    let s = useStore.getState();
    expect([s.mode, s.overview]).toEqual(['power', undefined]);
    expect(s.power).toHaveLength(1);
    expect(s.power[0].name).toBe('Coal plant');
    expect(s.power[0].autoName).toBeUndefined();
    expect(s.power[0].plants.map(({ id: _, ...p }) => p)).toEqual([
      { generator: 'Build_GeneratorCoal_C', fuel: 'Desc_Coal_C', clock: 1, by: 'count', amount: 20 },
      { generator: 'Build_GeneratorGeoThermal_C', clock: 1, purity: 'pure', by: 'count', amount: 1 },
    ]);
    useStore.getState().plantFromSave('Coal plant', rows);
    s = useStore.getState();
    expect(s.power.map((p) => p.name)).toEqual(['Coal plant', 'Coal plant 2']);
    expect(s.activePower).toBe(s.power[1].id);
  });
});

const SPACE = 'C:/code/ficsit-saves/ela/SPACEDELAELEVATORE.sav';
const DUNARR = 'C:/code/ficsit-saves/online/etothepii/Dunarr-076.sav';

describe.skipIf(!existsSync(SPACE))('the player save’s power', () => {
  test('SPACEDELAELEVATORE: one circuit, 20 coal generators, 16 batteries', async () => {
    const [g, ...rest] = findGrids(await readSave(new Uint8Array(readFileSync(SPACE))));
    expect(rest).toEqual([]);
    expect(g.plants).toEqual([{ generator: 'Build_GeneratorCoal_C', fuel: 'Desc_Coal_C', clock: 1, n: 20 }]);
    expect([g.batteries, g.made]).toEqual([16, 1500]);
    expect(g.used).toBeGreaterThan(800);
  });
});

describe.skipIf(!existsSync(DUNARR))('circuits joined by power switches', () => {
  test('Dunarr: three circuits behind switches that are on run as one', async () => {
    const grids = findGrids(await readSave(new Uint8Array(readFileSync(DUNARR))));
    expect(grids).toHaveLength(1);
    expect(grids[0].batteries).toBe(23);
    expect(grids[0].plants.reduce((s, p) => s + p.n, 0)).toBe(64);
  });
});
