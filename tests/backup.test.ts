import { describe, expect, test } from 'bun:test';
import { importFile } from '../src/lib/backup';
import { checkFeedback } from '../src/lib/feedback-schema';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import { newPlan, newPowerPlan, useStore } from '../src/store';

const coal = { id: 'p', generator: 'Build_GeneratorCoal_C', fuel: 'Desc_Coal_C', by: 'auto', amount: 0, clock: 1 };
const copy = (patch: object = {}) =>
  new File(
    [
      JSON.stringify({
        kind: 'ficsit-planner',
        version: 1,
        plans: [
          { ...newPlan('A'), id: 'a' },
          { ...newPlan('B'), id: 'b' },
        ],
        grid: { plants: [coal], exclude: ['b', 'gone'] },
        settings: { ...DEFAULT_SETTINGS, cardScale: 1.3 },
        ...patch,
      }),
    ],
    'copy.json',
  );

describe('loading a copy', () => {
  test('an old copy’s grid becomes a plant feeding the same factories; settings only fill what is untouched', async () => {
    const empty = newPowerPlan('Plant 1');
    const mine = { ...newPlan('Mine'), targets: [{ item: 'Desc_IronPlate_C', rate: 10 }] };
    useStore.setState({ plans: [mine], power: [empty], activePower: empty.id, settings: DEFAULT_SETTINGS });
    expect(await importFile(copy())).toMatchObject({ ok: true, count: 2, power: 1, settings: 'loaded' });
    const s = useStore.getState();
    const a = s.plans.find((p) => p.name === 'A')!;
    expect(a.id).not.toBe('a');
    // The empty plant nobody touched gives way; the file's plant feeds A, not B.
    expect(s.power).toHaveLength(1);
    expect(s.power[0].factories).toEqual([a.id]);
    expect(s.activePower).toBe(s.power[0].id);
    expect(s.settings.cardScale).toBe(1.3);

    // Now the plants and settings are the player's own: a second copy adds a plant and leaves the settings alone.
    const again = await importFile(copy({ settings: { ...DEFAULT_SETTINGS, cardScale: 0.8 } }));
    expect(again).toMatchObject({ ok: true, count: 2, power: 1, settings: 'kept' });
    expect(useStore.getState().settings.cardScale).toBe(1.3);
    expect(useStore.getState().plans).toHaveLength(5);
    expect(useStore.getState().power).toHaveLength(2);
  });

  test('a new copy’s plants feeding every factory feed only the file’s factories', async () => {
    const mine = newPlan('Mine');
    useStore.setState({ plans: [mine], power: [newPowerPlan('Plant 1')] });
    const pp = { ...newPowerPlan('Coal plant'), plants: [coal], factories: 'all' };
    expect(await importFile(copy({ grid: undefined, power: [pp, newPowerPlan('Empty')] }))).toMatchObject({ ok: true, power: 1 });
    const s = useStore.getState();
    const added = s.power[s.power.length - 1];
    expect(added.factories).toEqual(s.plans.filter((p) => p.name !== 'Mine').map((p) => p.id));
    expect(added.chain.id).toBe(`chain-${added.id}`);
  });

  test('a file that is not a copy changes nothing', async () => {
    const before = useStore.getState().plans.length;
    expect(await importFile(new File(['{"kind":"other"}'], 'x.json'))).toEqual({ ok: false });
    expect(await importFile(new File(['not json'], 'x.json'))).toEqual({ ok: false });
    expect(useStore.getState().plans).toHaveLength(before);
  });
});

describe('feedback text', () => {
  const base = { kind: 'bug', title: 'Graph is wrong', body: 'First line\r\nsecond line', meta: {} };

  test('one-line fields lose their line breaks, so they cannot fake rows or headings', () => {
    const r = checkFeedback({
      ...base,
      title: 'ok title\rFAKE\n#999 BUG spoof',
      area: 'a\n## #1 Bug',
      contact: 'me\r\n@x',
      meta: { mode: 'x\ry' },
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.value.title).toBe('ok title FAKE #999 BUG spoof');
    expect(r.value.area).toBe('a ## #1 Bug');
    expect(r.value.contact).toBe('me @x');
    expect(r.value.meta.mode).toBe('x y');
    expect(r.value.body).toBe('First line\nsecond line');
  });

  test('control characters and direction overrides are dropped', () => {
    const r = checkFeedback({ ...base, body: 'safe \u001b[31mred\u202e text here' });
    if (!r.ok) throw new Error(r.error);
    expect(r.value.body).toBe('safe [31mred text here');
  });
});
