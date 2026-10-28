import { describe, expect, test } from 'bun:test';
import { importData, KIND } from '../src/lib/backup';
import { splitFloors } from '../src/lib/sanitize';
import { mergeState, migrateState, newPlan, newPowerPlan, useStore } from '../src/store';
import { openShared, pack, SHARE_HASH, encode } from '../src/lib/share';
import { emptyModel, type Model } from '../src/lib/model/types';

const aim = { item: 'Desc_IronPlate_C', rate: 30 };
const floor = (): Model => ({ ...emptyModel(), nodes: [{ id: 'a', x: 0, y: 0, k: 'out', item: aim.item }] });
const ids = (x: unknown[]) => x.map((p) => (p as { id: string }).id);

/** A tab as saved before a factory was Auto or Manual for good. */
const mixed = (extra: Record<string, unknown> = {}) => ({
  ...newPlan('Plates'),
  id: 'f1',
  targets: [aim],
  model: floor(),
  areas: { ...emptyModel(), nodes: [{ id: 'g', x: 0, y: 0, k: 'group', w: 200, h: 100 }] },
  built: ['Recipe_IronPlate_C'],
  ...extra,
});

describe('a tab with both floors becomes two tabs', () => {
  const same = (n: string) => ({ ...newPlan(n), id: n });

  test('Auto on screen: the Auto tab keeps the id, the Manual one follows it and takes the floor', () => {
    const [auto, manual] = splitFloors([mixed()]) as Record<string, unknown>[];
    expect(auto).toMatchObject({ id: 'f1', name: 'Plates', targets: [aim] });
    expect(auto.floor).toBeUndefined();
    expect(auto.model).toBeUndefined();
    expect(auto.areas).toBeDefined();
    expect(manual).toMatchObject({ name: 'Plates (Manual)', floor: 'manual', targets: [aim] });
    expect(manual.id).not.toBe('f1');
    expect((manual.model as Model).nodes).toHaveLength(1);
    // The Auto floor's own areas and ticks stay with it.
    expect(manual.areas).toBeUndefined();
    expect(manual.built).toBeUndefined();
  });

  test('Manual on screen: that tab keeps the id, so what takes from it still does', () => {
    const [auto, manual] = splitFloors([mixed({ floor: 'manual' })]) as Record<string, unknown>[];
    expect(manual).toMatchObject({ id: 'f1', floor: 'manual', name: 'Plates (Manual)' });
    expect(auto.id).not.toBe('f1');
    expect(auto).toMatchObject({ name: 'Plates', targets: [aim] });
    expect(auto.model).toBeUndefined();
  });

  test('the two tabs share nothing, and the Manual one comes right after the Auto one', () => {
    const list = splitFloors([same('x'), mixed(), same('y')]);
    expect(ids(list).slice(0, 1)).toEqual(['x']);
    expect((list[1] as { floor?: string }).floor).toBeUndefined();
    expect((list[2] as { floor?: string }).floor).toBe('manual');
    expect(ids(list)[3]).toBe('y');
    (list[1] as { targets: unknown[] }).targets.length = 0;
    expect((list[2] as { targets: unknown[] }).targets).toHaveLength(1);
  });

  test('a Manual floor with nothing worked out beside it is one Manual tab, named as it was', () => {
    const list = splitFloors([mixed({ targets: [], floor: 'manual' })]) as Record<string, unknown>[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'f1', name: 'Plates', floor: 'manual' });
  });

  test('a floor switched to once and never built on is dropped, an empty Manual one stays', () => {
    const [auto] = splitFloors([mixed({ model: emptyModel() })]) as Record<string, unknown>[];
    expect(auto.model).toBeUndefined();
    expect(auto.floor).toBeUndefined();
    const [empty] = splitFloors([mixed({ model: emptyModel(), floor: 'manual', targets: [] })]) as Record<string, unknown>[];
    expect(empty).toMatchObject({ id: 'f1', floor: 'manual' });
  });

  test('an empty Manual floor left on screen over a worked-out factory keeps that factory as Auto', () => {
    const list = splitFloors([mixed({ model: emptyModel(), floor: 'manual' })]) as Record<string, unknown>[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'f1', name: 'Plates', targets: [aim] });
    expect(list[0].floor).toBeUndefined();
    expect(list[0].model).toBeUndefined();
  });

  test('an Auto factory with no floor comes through untouched', () => {
    const plan = { ...newPlan('A'), targets: [aim] };
    expect(splitFloors([plan])).toEqual([plan]);
  });
});

describe('saved sessions', () => {
  test('a session from before version 4 is split when it is loaded, and the open floor stays open', () => {
    const old = { plans: [mixed({ floor: 'manual' })], active: 'f1' };
    const migrated = migrateState(old, 3);
    expect(migrated.plans).toHaveLength(2);
    const state = mergeState(migrated, useStore.getState());
    expect(state.plans.map((p) => p.name)).toEqual(['Plates', 'Plates (Manual)']);
    expect(state.plans.map((p) => p.floor)).toEqual([undefined, 'manual']);
    expect(state.plans[1].model?.nodes).toHaveLength(1);
    expect(state.plans[0].model).toBeUndefined();
    expect(state.active).toBe('f1');
    expect(state.active).toBe(state.plans[1].id);
  });

  test('a session already at version 4 is not split again', () => {
    const now = { plans: [{ ...newPlan('M'), id: 'm', floor: 'manual', targets: [aim], model: floor() }], active: 'm' };
    expect(migrateState(now, 4)).toBe(now);
  });

  test('an Auto tab carries no floor after loading, a Manual one carries its own', () => {
    const state = mergeState({ plans: [{ ...mixed(), floor: undefined }, mixed({ id: 'f2', floor: 'manual' })] }, useStore.getState());
    expect(state.plans[0].model).toBeUndefined();
    expect(state.plans[1].model?.nodes).toHaveLength(1);
  });
});

describe('copies and links from before', () => {
  const file = (version: number | undefined, plans: unknown[]) => ({ kind: KIND, ...(version ? { version } : {}), plans });
  const take = (f: unknown) => {
    useStore.setState({ plans: [newPlan('Mine')], power: [newPowerPlan('Plant 1')], active: 'x' });
    const r = importData(f);
    return { r, plans: useStore.getState().plans };
  };

  test('an old copy comes in as two tabs, each with a fresh id', () => {
    const { r, plans } = take(file(2, [mixed()]));
    expect(r).toMatchObject({ ok: true, count: 2 });
    const added = plans.filter((p) => p.name.startsWith('Plates'));
    expect(added.map((p) => p.floor)).toEqual([undefined, 'manual']);
    expect(new Set(added.map((p) => p.id)).size).toBe(2);
    expect(added.some((p) => p.id === 'f1')).toBe(false);
  });

  test('a copy with no version is taken as an old one', () => {
    expect(take(file(undefined, [mixed()])).r).toMatchObject({ ok: true, count: 2 });
  });

  test('a current copy is not split, and an Auto tab beside a Manual one keeps what it takes from the other', () => {
    const manual = { ...mixed({ floor: 'manual', id: 'm' }) };
    const user = { ...newPlan('User'), id: 'u', supplies: [{ item: aim.item, rate: 5, from: 'm' }] };
    const { r, plans } = take(file(3, [manual, user]));
    expect(r).toMatchObject({ ok: true, count: 2 });
    const added = plans.filter((p) => p.name !== 'Mine');
    expect(added.map((p) => p.name)).toEqual(['Plates', 'User']);
    expect(added[1].supplies[0].from).toBe(added[0].id);
  });

  test('what another tab took from the tab on screen still comes from the tab that kept its id', () => {
    const user = { ...newPlan('User'), id: 'u', supplies: [{ item: aim.item, rate: 5, from: 'f1' }] };
    const { plans } = take(file(2, [mixed({ floor: 'manual' }), user]));
    const added = plans.filter((p) => p.name !== 'Mine');
    const manual = added.find((p) => p.floor === 'manual')!;
    expect(added.find((p) => p.name === 'User')!.supplies[0].from).toBe(manual.id);
  });

  test('a link made before version 2 is split, one made now is not', async () => {
    const open = async (v: number) => {
      useStore.setState({ plans: [newPlan('Mine')], power: [newPowerPlan('Plant 1')], active: 'x' });
      const body = { kind: KIND, v, from: 'factory', plans: [pack(mixed({ floor: 'manual' }) as never)], power: [] };
      expect(await openShared(`${SHARE_HASH}${await encode(body)}`)).toBe(true);
      return useStore.getState().plans.filter((p) => p.name !== 'Mine');
    };
    expect(await open(1)).toHaveLength(2);
    expect(await open(2)).toHaveLength(1);
  });
});

describe('a factory is Auto or Manual for good', () => {
  const blank = () => {
    const plan = newPlan('Factory 1');
    useStore.setState({ mode: 'factory', plans: [plan], active: plan.id });
    return plan.id;
  };

  test('a factory with nothing in it can be turned into a Manual one, and one with something in it cannot', () => {
    const id = blank();
    useStore.getState().makeManual(id);
    expect(useStore.getState().plans[0]).toMatchObject({ id, floor: 'manual' });
    expect(useStore.getState().plans[0].model?.nodes).toEqual([]);

    const worked = blank();
    useStore.getState().addTarget(aim.item);
    useStore.getState().makeManual(worked);
    expect(useStore.getState().plans[0].floor).toBeUndefined();
    expect(useStore.getState().plans[0].model).toBeUndefined();
  });

  test('changing the targets of an Auto factory does nothing to a Manual one beside it', () => {
    const auto = { ...newPlan('Auto'), id: 'a', targets: [aim] };
    const manual = { ...newPlan('Manual'), id: 'm', targets: [aim], floor: 'manual' as const, model: floor() };
    useStore.setState({ mode: 'factory', plans: [auto, manual], active: 'a' });
    useStore.getState().setTarget(0, 99);
    useStore.getState().undoPlan();
    expect(useStore.getState().plans[1]).toBe(manual);
  });
});

describe('a Manual factory is never taken for an empty one', () => {
  test('the Codex builds a factory in a new tab when the one on screen is Manual, even with no outputs yet', () => {
    const m = { ...newPlan('Manual'), id: 'm', floor: 'manual' as const, model: floor() };
    useStore.setState({ mode: 'factory', plans: [{ ...m, targets: [] }], active: 'm' });
    useStore.getState().buildFactory(aim.item, 'Plates');
    const plans = useStore.getState().plans;
    expect(plans).toHaveLength(2);
    expect(plans[0].model?.nodes).toHaveLength(1);
  });

  test('opening a copy beside a lone Manual factory keeps it', () => {
    const m = { ...newPlan('Manual'), id: 'm', floor: 'manual' as const, model: floor(), targets: [] };
    useStore.setState({ mode: 'factory', plans: [m], power: [newPowerPlan('Plant 1')], active: 'm' });
    importData({ kind: KIND, version: 3, plans: [{ ...newPlan('Other'), targets: [aim] }] });
    expect(useStore.getState().plans.map((p) => p.name)).toEqual(['Manual', 'Other']);
  });
});
