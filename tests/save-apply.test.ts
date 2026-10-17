import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { buildExport } from '../src/lib/backup';
import { data } from '../src/lib/data';
import { ALL_ANSWERS, conflicts, fieldsOf, merge, unknownRecipes, type Values, valuesOf } from '../src/lib/save/apply';
import { extract, readSave } from '../src/lib/save/extract';
import { type Found, groupGames, isSaveFile } from '../src/lib/save/files';
import type { SaveHeader } from '../src/lib/save/header';
import { takeSave as take } from '../src/lib/save/take';
import type { SaveData } from '../src/lib/save/types';
import { gameVersion, isNewer, isSupported } from '../src/lib/save/version';
import { cleanSave, mergeState, persisted, useStore } from '../src/store';

const none = { free: 0, inMachines: 0, inDepot: 0 };
const save = (p: Partial<Pick<SaveData, 'schematics' | 'recipes' | 'sloops' | 'shards'>>) => ({
  schematics: [],
  recipes: [],
  sloops: none,
  shards: none,
  ...p,
});
const alt = data.recipes.filter((r) => r.kind === 'alternate').map((r) => r.id);
const std = data.recipes.find((r) => r.kind === 'standard')!.id;
const values = (p: Partial<Values> = {}): Values => ({ tier: 3, skipped: [], unlocked: [], sloops: 0, shards: 0, ...p });

describe('what a save sets', () => {
  test('the tier is the highest HUB milestone bought, by its real tier and not the number in its id', () => {
    // Schematic_5-3_C is Logistics Mk.3, a tier 4 milestone.
    expect(valuesOf(save({ schematics: ['Schematic_1-1_C', 'Schematic_3-1_C', 'Schematic_5-3_C'] })).tier).toBe(4);
    // Not in the planner's list (it opens nothing the planner uses): the id gives the tier.
    expect(valuesOf(save({ schematics: ['Schematic_1-2_C', 'Research_Caterium_0_C', 'Schematic_Alternate_SteelRod_C'] })).tier).toBe(1);
    expect(valuesOf(save({})).tier).toBe(0);
  });

  test('milestones up to the tier and not bought are the skipped ones; those above are left to the tier', () => {
    const v = valuesOf(save({ schematics: ['Schematic_3-1_C', 'Schematic_2-1_C'] }));
    expect(v.tier).toBe(3);
    expect(v.skipped).toContain('Schematic_3-4_C');
    expect(v.skipped).not.toContain('Schematic_3-1_C');
    expect(v.skipped).not.toContain('Schematic_4-1_C');
  });

  test('only alternate and converter recipes the planner knows count as unlocked', () => {
    const v = valuesOf(save({ recipes: [alt[0], alt[0], std, 'Recipe_Foundation_8x4_01_C', 'Recipe_Alternate_Modded_C'] }));
    expect(v.unlocked).toEqual([alt[0]]);
  });

  test('sloops and shards are all the player owns: loose, in machines and in the depot', () => {
    const v = valuesOf(save({ sloops: { free: 3, inMachines: 8, inDepot: 1 }, shards: { free: 0, inMachines: 30, inDepot: 0 } }));
    expect([v.sloops, v.shards]).toEqual([12, 30]);
  });

  test('recipes the planner lacks: FICSMAS ones, and alternates it does not know', () => {
    expect(
      unknownRecipes({ recipes: ['Recipe_XmasBall1_C', 'Recipe_CandyCane_C', 'Recipe_FF_Alternate_X_C', 'Recipe_Wall_8x4_01_C', std] }),
    ).toEqual({
      ficsmas: 2,
      alternates: 1,
    });
  });
});

describe('a refresh after the player changed things', () => {
  const seen = values({ tier: 3, unlocked: [alt[0]], sloops: 5 });
  const all = fieldsOf(ALL_ANSWERS);

  test('nothing changed by the player: nothing to ask, the game wins', () => {
    expect(conflicts(seen, seen, values({ tier: 5, sloops: 9 }), all)).toEqual([]);
  });

  test('changed by the player and the game says otherwise: asked', () => {
    const mine = values({ tier: 4, unlocked: [alt[0], alt[1]], sloops: 5 });
    expect(conflicts(mine, seen, values({ tier: 5, unlocked: [alt[0]], sloops: 9 }), all)).toEqual(['tier', 'recipes']);
  });

  test('changed by the player to what the game now says: not asked', () => {
    const mine = values({ tier: 5, unlocked: [alt[0]], sloops: 5 });
    expect(conflicts(mine, seen, values({ tier: 5, unlocked: [alt[0]], sloops: 5 }), all)).toEqual([]);
  });

  test('a skipped milestone counts as a tier change', () => {
    const mine = values({ ...seen, skipped: ['Schematic_3-4_C'] });
    expect(conflicts(mine, seen, values({ ...seen, tier: 3 }), all)).toEqual(['tier']);
  });

  test('fields turned off in the answers are neither asked nor taken', () => {
    expect(fieldsOf({ ...ALL_ANSWERS, inventory: false })).toEqual(['tier', 'recipes']);
    const mine = values({ sloops: 1 });
    expect(conflicts(mine, seen, values({ sloops: 9 }), fieldsOf({ ...ALL_ANSWERS, inventory: false }))).toEqual([]);
  });

  test('merge takes the game for the fields taken and keeps the rest', () => {
    const mine = values({ tier: 8, skipped: ['Schematic_3-4_C'], sloops: 14 });
    const game = values({ tier: 7, sloops: 11, shards: 30 });
    expect(merge(mine, game, ['sloops', 'shards'])).toEqual({ ...mine, sloops: 11, shards: 30 });
    expect(merge(mine, game, ['tier'])).toEqual({ ...mine, tier: 7, skipped: [] });
  });
});

const header = (p: Partial<SaveHeader>): SaveHeader => ({
  headerVersion: 14,
  saveVersion: 60,
  build: 502094,
  saveName: 'a',
  mapName: 'Persistent_Level',
  sessionName: 'ela',
  sessionId: 's1',
  playSeconds: 3600,
  savedAt: 0,
  modded: false,
  creative: false,
  bodyStart: 0,
  ...p,
});
const found = (p: Partial<SaveHeader>, name = 'x.sav'): Found => ({ file: { name } as File, header: header(p) });

describe('choosing among the saves', () => {
  test('only real saves are opened', () => {
    expect(isSaveFile({ name: 'ela_autosave_0.sav', size: 880_000 })).toBe(true);
    expect(isSaveFile({ name: 'ServerManager_V2.sav', size: 50_000 })).toBe(false);
    expect(isSaveFile({ name: 'tiny.sav', size: 116 })).toBe(false);
    expect(isSaveFile({ name: 'blueprint.sbp', size: 50_000 })).toBe(false);
  });

  test('saves group by game, the game saved last first, each newest first by the date inside', () => {
    const games = groupGames([
      found({ sessionId: 'a', sessionName: 'Old', savedAt: 10, saveName: 'old1' }),
      found({ sessionId: 'b', sessionName: 'New', savedAt: 5, saveName: 'new1' }),
      found({ sessionId: 'b', sessionName: 'New', savedAt: 30, saveName: 'new2' }),
      // Same name, another game: kept apart by its id.
      found({ sessionId: 'c', sessionName: 'Old', savedAt: 1, saveName: 'other' }),
    ]);
    expect(games.map((g) => g.name)).toEqual(['New', 'Old', 'Old']);
    expect(games[0].saves.map((s) => s.header.saveName)).toEqual(['new2', 'new1']);
  });

  test('versions: named from the save version, newer ones warned about, pre-1.0 ones refused', () => {
    expect([46, 52, 58, 60].map(gameVersion)).toEqual(['1.0', '1.1', '1.2', '1.2']);
    expect(isNewer({ saveVersion: 60, build: 502094 })).toBe(false);
    expect(isNewer({ saveVersion: 61, build: 502094 })).toBe(true);
    expect(isNewer({ saveVersion: 60, build: 510000 })).toBe(true);
    expect(isSupported({ saveVersion: 42 })).toBe(false);
  });
});

describe('the followed save in the planner', () => {
  const data0 = (p: Partial<SaveData>): SaveData => ({
    ...extract({ objects: [], collected: [], unknown: {}, total: 0 } as never, header({})),
    ...p,
  });

  test('taking a save sets tier, alternates and inventory, turns new alternates on in every factory, and remembers what the game said', () => {
    const before = useStore.getState();
    useStore.setState({ tier: 9, skipped: [], unlocked: [], inventory: { sloops: 0, shards: 0 }, save: undefined });
    const f = found({ sessionName: 'ela', saveName: 'SPACE', savedAt: 1000 });
    const taken = take(
      f,
      data0({ schematics: ['Schematic_4-1_C'], recipes: [alt[0]], sloops: { free: 2, inMachines: 1, inDepot: 0 } }),
      ALL_ANSWERS,
      ['shards'],
    );
    const s = useStore.getState();
    expect(taken).toEqual(['tier', 'recipes', 'sloops']);
    expect(s.tier).toBe(4);
    expect(s.unlocked).toEqual([alt[0]]);
    expect(s.inventory.sloops).toBe(3);
    expect(s.plans.every((p) => p.enabled.includes(alt[0]))).toBe(true);
    expect(s.save).toMatchObject({ session: 's1', game: 'ela', file: 'SPACE', savedAt: 1000, seen: { tier: 4, sloops: 3 } });
    useStore.setState(before);
  });

  test('the save is kept on reload but never in a backup file', () => {
    const before = useStore.getState();
    const f = found({});
    take(f, data0({}), ALL_ANSWERS, []);
    const kept = persisted(useStore.getState());
    expect(kept.save?.session).toBe('s1');
    expect(mergeState(JSON.parse(JSON.stringify(kept)), useStore.getState()).save).toEqual(kept.save);
    expect('save' in buildExport()).toBe(false);
    useStore.setState(before);
  });

  test('a damaged followed save is dropped, a sound one comes back the same', () => {
    expect(cleanSave(undefined)).toBeUndefined();
    expect(cleanSave({ session: 3 })).toBeUndefined();
    expect(
      cleanSave({ session: 'x', seen: { tier: 99, skipped: ['nope'], unlocked: ['Recipe_Nope_C', alt[0]], sloops: -4 }, answers: {} }),
    ).toMatchObject({
      seen: { tier: 9, skipped: [], unlocked: [alt[0]], sloops: 0 },
      answers: ALL_ANSWERS,
    });
  });
});

const SPACE = 'C:/code/ficsit-saves/ela/SPACEDELAELEVATORE.sav';

describe.skipIf(!existsSync(SPACE))('the player save', () => {
  test('SPACEDELAELEVATORE: tier 4, every milestone up to it bought, three alternates', async () => {
    const v = valuesOf(await readSave(new Uint8Array(readFileSync(SPACE))));
    expect(v.tier).toBe(4);
    expect(v.skipped).toEqual([]);
    expect(v.unlocked.sort()).toEqual(
      ['Recipe_Alternate_BoltedFrame_C', 'Recipe_Alternate_ReinforcedIronPlate_2_C', 'Recipe_Alternate_SteelRod_C'].sort(),
    );
    expect([v.sloops, v.shards]).toEqual([2, 21]);
  });
});
