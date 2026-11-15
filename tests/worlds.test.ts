import { describe, expect, test } from 'bun:test';
import { buildExport, importData, wipeLocal } from '../src/lib/backup';
import { DEFAULT_GAME } from '../src/lib/game';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import { canUndo } from '../src/lib/model/history';
import { ALL_ANSWERS } from '../src/lib/save/apply';
import { MAX_TIER, MAX_WORLDS, mergeState, newPlan, newPowerPlan, persisted, useStore } from '../src/store';

const s = () => useStore.getState();
const info = (game: string) => ({
  session: game,
  game,
  file: 'f',
  savedAt: 1,
  playSeconds: 1,
  saveVersion: 60,
  build: 517554,
  importedAt: 1,
  answers: ALL_ANSWERS,
  seen: { tier: 3, skipped: [], unlocked: [], sloops: 0, shards: 0 },
});

/** One open world, as a first launch has it. */
const fresh = () => {
  const plan = newPlan('Factory 1');
  const pp = newPowerPlan('Plant 1');
  useStore.setState({
    // An earlier test file may have left the power planner open, which sends plan edits to a plant.
    mode: 'factory',
    world: { id: 'main', name: 'World 1' },
    worlds: [],
    plans: [plan],
    active: plan.id,
    power: [pp],
    activePower: pp.id,
    tier: MAX_TIER,
    unlocked: [],
    standardOff: [],
    skipped: [],
    inventory: { sloops: 0, shards: 0 },
    save: undefined,
    randomNodes: undefined,
    settings: DEFAULT_SETTINGS,
    closed: undefined,
    inspect: undefined,
  });
};

describe('worlds', () => {
  test('a new world is blank; the world left behind is parked as it was; opening it again brings it back', () => {
    fresh();
    s().renamePlan(s().active, 'Iron');
    s().set({ tier: 3 });
    s().setSettings({ game: { ...DEFAULT_GAME, parts: 0.5 } });
    useStore.setState({ inventory: { sloops: 4, shards: 7 }, save: info('ela') });
    s().addWorld();
    expect(s().world.name).toBe('World 2');
    expect(s().worlds.map((w) => w.name)).toEqual(['World 1']);
    expect(s().plans.map((p) => p.name)).toEqual(['Factory 1']);
    expect(s().tier).toBe(MAX_TIER);
    expect(s().inventory).toEqual({ sloops: 0, shards: 0 });
    expect(s().save).toBeUndefined();
    expect(s().settings.game).toEqual(DEFAULT_GAME);
    // Edits here stay here.
    s().set({ tier: 5 });
    s().addTarget('Desc_IronPlate_C');

    s().openWorld(s().worlds[0].id);
    expect(s().world.name).toBe('World 1');
    expect(s().plans.map((p) => p.name)).toEqual(['Iron']);
    expect(s().tier).toBe(3);
    expect(s().inventory).toEqual({ sloops: 4, shards: 7 });
    expect(s().save?.game).toBe('ela');
    expect(s().settings.game.parts).toBe(0.5);
    expect(s().worlds[0].name).toBe('World 2');
    expect(s().worlds[0].data.tier).toBe(5);
    expect(s().worlds[0].data.plans[0].targets).toHaveLength(1);
    // The settings that are not a world's own are shared.
    s().setSettings({ cardScale: 1.2 });
    s().openWorld(s().worlds[0].id);
    expect(s().settings.cardScale).toBe(1.2);
  });

  test('a world made from the New world window starts as it asked; without values it is blank', () => {
    fresh();
    s().addWorld({ name: '  Dunarr ', tier: 4, game: { parts: 0.5, power: 2, elevator: 3 }, randomNodes: true });
    expect(s().world.name).toBe('Dunarr');
    expect(s().tier).toBe(4);
    expect(s().settings.game).toEqual({ parts: 0.5, power: 2, elevator: 3 });
    expect(s().randomNodes).toBe(true);
    expect(s().plans.map((p) => p.name)).toEqual(['Factory 1']);
    expect(s().worlds[0].name).toBe('World 1');
    // Values out of range or missing are the game as shipped; a blank name is the next free one.
    s().addWorld({ name: ' ', tier: 99, game: { parts: -1, power: 1, elevator: 1 }, randomNodes: false });
    expect(s().world.name).toBe('World 2');
    expect(s().tier).toBe(MAX_TIER);
    expect(s().settings.game).toEqual(DEFAULT_GAME);
    expect(s().randomNodes).toBeUndefined();
    s().addWorld();
    expect(s().tier).toBe(MAX_TIER);
    expect(s().randomNodes).toBeUndefined();
    expect(s().worlds.find((w) => w.name === 'Dunarr')?.data.randomNodes).toBe(true);
  });

  test('random nodes belong to one world: parked with it, back with it, kept on reload and in a backup file', async () => {
    fresh();
    s().addWorld({ name: 'Random', randomNodes: true });
    s().addWorld();
    expect(s().randomNodes).toBeUndefined();
    expect(s().worlds.map((w) => [w.name, w.data.randomNodes])).toEqual([
      ['World 1', undefined],
      ['Random', true],
    ]);
    s().openWorld(s().worlds[1].id);
    expect(s().randomNodes).toBe(true);
    expect(s().worlds.find((w) => w.name === 'World 2')?.data.randomNodes).toBeUndefined();
    const kept = JSON.parse(JSON.stringify(persisted(s())));
    expect(mergeState(kept, s()).randomNodes).toBe(true);
    // Anything but true is not random.
    expect(mergeState({ ...kept, randomNodes: 'yes' }, s()).randomNodes).toBeUndefined();
    s().renamePlan(s().active, 'Iron');
    s().addWorld({ name: 'Third', randomNodes: true });
    const file = JSON.parse(JSON.stringify(buildExport()));
    expect(file.randomNodes).toBe(true);
    await wipeLocal();
    fresh();
    importData(file);
    expect(
      s()
        .worlds.map((w) => [w.name, w.data.randomNodes === true])
        .sort(),
    ).toEqual([
      ['Random', true],
      ['World 1', false],
      ['World 2', false],
    ]);
  });

  test('names: the first free number, rename trimmed and never empty, at most 80 letters', () => {
    fresh();
    s().addWorld();
    s().addWorld();
    expect([s().world.name, ...s().worlds.map((w) => w.name)].sort()).toEqual(['World 1', 'World 2', 'World 3']);
    s().removeWorld(s().worlds.find((w) => w.name === 'World 1')!.id);
    s().addWorld();
    expect(s().world.name).toBe('World 1');
    const parked = s().worlds[0].id;
    s().renameWorld(parked, '  Dunarr  ');
    expect(s().worlds[0].name).toBe('Dunarr');
    s().renameWorld(parked, '   ');
    expect(s().worlds[0].name).toBe('Dunarr');
    s().renameWorld(s().world.id, 'x'.repeat(200));
    expect(s().world.name).toHaveLength(80);
  });

  test('at most 12 worlds', () => {
    fresh();
    for (let i = 0; i < 20; i++) s().addWorld();
    expect(s().worlds.length + 1).toBe(MAX_WORLDS);
  });

  test('the last world cannot be removed; removing the open one opens another', () => {
    fresh();
    s().removeWorld('main');
    expect(s().world.id).toBe('main');
    s().renamePlan(s().active, 'Old');
    s().addWorld();
    const open = s().world.id;
    s().removeWorld(open);
    expect(s().world.id).toBe('main');
    expect(s().plans[0].name).toBe('Old');
    expect(s().worlds).toEqual([]);
  });

  test('a switch forgets the old world’s undo lists and a closed tab, and clears what points at its tabs', () => {
    fresh();
    s().updatePlan({ targets: [{ item: 'Desc_IronPlate_C', rate: 5 }] });
    const id = s().active;
    expect(canUndo(`auto:${id}`)).toBe(true);
    s().set({
      inspect: 'x',
      renaming: id,
      closed: { name: 'A', before: { plans: s().plans, power: s().power, active: id, activePower: s().activePower } },
    });
    s().addWorld();
    expect(canUndo(`auto:${id}`)).toBe(false);
    expect(s().inspect).toBeUndefined();
    expect(s().renaming).toBeUndefined();
    expect(s().closed).toBeUndefined();
  });

  test('a state saved before worlds loads as one world called World 1', () => {
    fresh();
    const merged = mergeState({ tier: 4 }, s());
    expect(merged.world).toEqual({ id: 'main', name: 'World 1' });
    expect(merged.worlds).toEqual([]);
    expect(merged.tier).toBe(4);
  });

  test('parked worlds survive a reload; a broken one, a copy of an id and one with no tabs are dropped', () => {
    fresh();
    s().renamePlan(s().active, 'Iron');
    s().addWorld();
    const kept = JSON.parse(JSON.stringify(persisted(s())));
    const good = kept.worlds[0];
    kept.worlds.push(
      { id: 'bad', name: 'Bad', data: 'nonsense' },
      { id: 'empty', name: 'Empty', data: { plans: [], power: [] } },
      null,
      42,
      { ...good, name: 'Copy' },
      { ...good, id: s().world.id, name: 'Copy of open' },
      { id: 'odd', name: 7, data: { ...good.data, plans: [null, 7], tier: 'x', game: { parts: 'x' } } },
    );
    const merged = mergeState(kept, s());
    expect(merged.worlds.map((w) => w.id)).toEqual([good.id, 'odd']);
    expect(merged.worlds[0].data.plans[0].name).toBe('Iron');
    // What can be saved is saved: the name is made up, a number out of range is the game as shipped.
    expect(merged.worlds[1].name).toBe('World 3');
    expect(merged.worlds[1].data.plans.length).toBeGreaterThan(0);
    expect(merged.worlds[1].data.game.parts).toBe(DEFAULT_GAME.parts);
    expect(persisted(mergeState(JSON.parse(JSON.stringify(persisted(merged))), merged))).toEqual(persisted(merged));
  });
});

describe('worlds in a backup file', () => {
  test('every world comes back from a file, without the followed save; an old file imports as before', async () => {
    fresh();
    s().renamePlan(s().active, 'Iron');
    s().set({ tier: 3 });
    useStore.setState({ save: info('ela') });
    s().addWorld();
    s().renameWorld(s().world.id, 'Second');
    s().addWorld();
    s().updatePlan({ targets: [{ item: 'Desc_IronPlate_C', rate: 5 }] });
    const file = JSON.parse(JSON.stringify(buildExport()));
    expect(file.worlds).toHaveLength(2);
    expect(JSON.stringify(file)).not.toContain('"session"');

    await wipeLocal();
    fresh();
    expect(importData(file)).toMatchObject({ ok: true });
    expect(
      s()
        .worlds.map((w) => w.name)
        .sort(),
    ).toEqual(['Second', 'World 1']);
    // The open world's tabs go in as they always did.
    expect(s().plans.some((p) => p.targets.length === 1)).toBe(true);
    const iron = s().worlds.find((w) => w.name === 'World 1')!;
    expect(iron.data.plans[0].name).toBe('Iron');
    expect(iron.data.tier).toBe(3);
    expect(iron.data.save).toBeUndefined();

    fresh();
    const { worlds: _, ...old } = file;
    expect(importData(old)).toMatchObject({ ok: true });
    expect(s().worlds).toEqual([]);
  });

  test('a file cannot bring in more worlds than there is room for', () => {
    fresh();
    const one = { name: 'W', data: { plans: [newPlan('A')], power: [newPowerPlan('P')] } };
    importData({ kind: 'ficsit-planner', version: 3, plans: [newPlan('A')], worlds: Array.from({ length: 30 }, () => one) });
    expect(s().worlds.length + 1).toBe(MAX_WORLDS);
  });
});
