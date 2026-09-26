import { describe, expect, test } from 'bun:test';
import { decode, encode, openShared, pack, SHARE_HASH, sharedTabs, unpack } from '../src/lib/share';
import { newPlan, newPowerPlan, useStore } from '../src/store';

const coal = { id: 'c', generator: 'Build_GeneratorCoal_C', fuel: 'Desc_Coal_C', by: 'auto' as const, amount: 0, clock: 1 };
const alt = 'Recipe_Alternate_Screw_C';

function factory(name: string) {
  const p = newPlan(name);
  return {
    ...p,
    targets: [{ item: 'Desc_ModularFrame_C', rate: 12 }],
    enabled: [...p.enabled.filter((id) => id !== 'Recipe_Screw_C'), alt],
    mods: { Recipe_ModularFrame_C: { clock: 1.5, sloops: 1 } },
  };
}

describe('shared links', () => {
  test('recipes travel as changes from the standard set and come back whole', () => {
    const plan = factory('Frames');
    const packed = pack(plan);
    expect(packed.on).toEqual([alt]);
    expect(packed.off).toEqual(['Recipe_Screw_C']);
    expect(new Set((unpack(packed) as { enabled: string[] }).enabled)).toEqual(new Set(plan.enabled));
  });

  test('a link reads back to what went in, and garbage is refused', async () => {
    const value = { kind: 'ficsit-planner', plans: [pack(factory('Frames'))], note: 'çok güzel ✓' };
    const text = await encode(value);
    expect(text.startsWith('z')).toBe(true);
    expect(text).toMatch(/^[\w-]+$/);
    expect(await decode(text)).toEqual(value);
    await expect(decode('z!!!not-a-link')).rejects.toThrow();
    await expect(decode(`z${'A'.repeat(70_000)}`)).rejects.toThrow();
  });

  test('a factory is shared with the plants that power it, and opens as a new tab next to yours', async () => {
    const frames = factory('Frames');
    const other = { ...newPlan('Other'), targets: [{ item: 'Desc_IronPlate_C', rate: 10 }] };
    const plant = { ...newPowerPlan('Coal plant'), plants: [coal], factories: [frames.id, other.id] };
    const idle = newPowerPlan('Idle');
    useStore.setState({ mode: 'factory', plans: [frames, other], active: frames.id, power: [plant, idle], activePower: plant.id });
    const shared = sharedTabs();
    expect(shared.plans.map((p) => p.name)).toEqual(['Frames']);
    expect(shared.power.map((p) => p.name)).toEqual(['Coal plant']);

    const body = {
      kind: 'ficsit-planner',
      v: 1,
      from: 'factory',
      plans: shared.plans.map(pack),
      power: shared.power.map((pp) => ({ ...pp, chain: pack(pp.chain) })),
    };
    const link = `${SHARE_HASH}${await encode(body)}`;

    // Someone else, with a factory of their own.
    const theirs = { ...newPlan('Theirs'), targets: [{ item: 'Desc_Rotor_C', rate: 5 }] };
    const their = newPowerPlan('Plant 1');
    useStore.setState({ mode: 'codex', plans: [theirs], active: theirs.id, power: [their], activePower: their.id });
    expect(await openShared(link)).toBe(true);
    const s = useStore.getState();
    expect(s.plans.map((p) => p.name)).toEqual(['Theirs', 'Frames']);
    const opened = s.plans[1];
    expect(opened.id).not.toBe(frames.id);
    expect(s.active).toBe(opened.id);
    expect(s.mode).toBe('factory');
    expect(new Set(opened.enabled)).toEqual(new Set(frames.enabled));
    expect(opened.mods).toEqual(frames.mods);
    // Their untouched plant gives way; the shared one powers only the shared factory.
    expect(s.power.map((p) => p.name)).toEqual(['Coal plant']);
    expect(s.power[0].factories).toEqual([opened.id]);
    expect(s.notice).toEqual({ key: 'sharedOpened', name: 'Frames' });
  });

  test('a plant is shared with the factories it powers and opens on the plant; a blank first tab gives way', async () => {
    const frames = factory('Frames');
    const plant = { ...newPowerPlan('Coal plant'), plants: [coal], factories: 'all' as const };
    useStore.setState({ mode: 'power', plans: [frames], active: frames.id, power: [plant], activePower: plant.id });
    const shared = sharedTabs();
    const body = {
      kind: 'ficsit-planner',
      v: 1,
      from: 'power',
      plans: shared.plans.map(pack),
      power: shared.power.map((pp) => ({ ...pp, chain: pack(pp.chain) })),
    };
    const link = `${SHARE_HASH}${await encode(body)}`;

    const blank = newPlan('Factory 1');
    const mine = { ...newPowerPlan('Fuel plant'), plants: [{ ...coal, id: 'x' }] };
    useStore.setState({ mode: 'factory', plans: [blank], active: blank.id, power: [mine], activePower: mine.id });
    expect(await openShared(link)).toBe(true);
    const s = useStore.getState();
    expect(s.plans.map((p) => p.name)).toEqual(['Frames']);
    expect(s.power.map((p) => p.name)).toEqual(['Fuel plant', 'Coal plant']);
    expect(s.mode).toBe('power');
    expect(s.activePower).toBe(s.power[1].id);
    expect(s.power[1].factories).toEqual([s.plans[0].id]);
  });

  test('a damaged or foreign link adds nothing', async () => {
    const before = useStore.getState().plans.length;
    expect(await openShared(`${SHARE_HASH}zAAAA`)).toBe(false);
    expect(await openShared(`${SHARE_HASH}${await encode({ kind: 'something-else', plans: [] })}`)).toBe(false);
    expect(await openShared(`${SHARE_HASH}${await encode({ kind: 'ficsit-planner', plans: [{ targets: 'x' }] })}`)).toBe(true);
    expect(useStore.getState().plans.length).toBe(before + 1);
  });
});
