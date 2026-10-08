import { describe, expect, test } from 'bun:test';
import { data } from '../src/lib/data';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import { decode, encode, hasWork, moveLink, NEW_URL, openShared, pack, SHARE_HASH, sharedTabs, unpack } from '../src/lib/share';
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
    const value = { kind: 'ficsit-planner', plans: [pack(factory('Frames'))], note: 'Crème brûlée, 3 × 50%, 日本 ✓' };
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

  test('moving to the new address takes every factory, every plant that has generators, and the settings', async () => {
    const a = factory('Frames');
    const b = { ...newPlan('Rotors'), targets: [{ item: 'Desc_Rotor_C', rate: 5 }] };
    const plant = { ...newPowerPlan('Coal plant'), plants: [coal], factories: 'all' as const };
    const empty = newPowerPlan('Plant 2');
    useStore.setState({
      mode: 'factory',
      plans: [a, b],
      active: a.id,
      power: [plant, empty],
      activePower: plant.id,
      settings: { ...DEFAULT_SETTINGS, cardScale: 1.3 },
    });
    expect(hasWork()).toBe(true);
    const link = (await moveLink())!;
    expect(link.startsWith(`${NEW_URL}/${SHARE_HASH}`)).toBe(true);

    // The new address, in a browser that has nothing yet.
    const blank = newPlan('Factory 1');
    const first = newPowerPlan('Plant 1');
    useStore.setState({
      mode: 'codex',
      plans: [blank],
      active: blank.id,
      power: [first],
      activePower: first.id,
      settings: DEFAULT_SETTINGS,
    });
    expect(hasWork()).toBe(false);
    expect(await openShared(link.slice(NEW_URL.length + 1))).toBe(true);
    const now = useStore.getState();
    expect(now.plans.map((p) => p.name)).toEqual(['Frames', 'Rotors']);
    expect(now.power.map((p) => p.name)).toEqual(['Coal plant']);
    expect(now.settings.cardScale).toBe(1.3);
    expect(now.plans[1].targets).toEqual(b.targets);
  });

  test('more plans than a link can hold give no link, and the backup file is the way', async () => {
    const big = Array.from({ length: 300 }, (_, i) => ({
      ...newPlan(`Factory ${i}`),
      caps: Object.fromEntries(
        Object.keys(data.items)
          .slice(0, 80)
          .map((id) => [id, Math.random() * 1000]),
      ),
    }));
    useStore.setState({ plans: big, active: big[0].id });
    expect(await moveLink()).toBeUndefined();
  });
});
