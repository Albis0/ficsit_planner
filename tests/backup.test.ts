import { describe, expect, test } from 'bun:test';
import { importFile } from '../src/lib/backup';
import { checkFeedback } from '../src/lib/feedback-schema';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import { newGrid, newPlan, useStore } from '../src/store';

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
        grid: { ...newGrid(), plants: [coal], exclude: ['b', 'gone'] },
        settings: { ...DEFAULT_SETTINGS, cardScale: 1.3 },
        ...patch,
      }),
    ],
    'copy.json',
  );

describe('loading a copy', () => {
  test('left-out factories stay left out, and the grid and settings only fill what is untouched', async () => {
    useStore.setState({ plans: [newPlan('Mine')], grid: newGrid(), settings: DEFAULT_SETTINGS });
    expect(await importFile(copy())).toEqual({ ok: true, count: 2, grid: 'loaded', settings: 'loaded' });
    const s = useStore.getState();
    const b = s.plans.find((p) => p.name === 'B')!;
    expect(b.id).not.toBe('b');
    expect(s.grid.exclude).toEqual([b.id]);
    expect(s.settings.cardScale).toBe(1.3);

    // Now the grid and settings are the player's own: a second copy leaves them alone.
    const again = await importFile(copy({ settings: { ...DEFAULT_SETTINGS, cardScale: 0.8 } }));
    expect(again).toMatchObject({ ok: true, count: 2, grid: 'kept', settings: 'kept' });
    expect(useStore.getState().settings.cardScale).toBe(1.3);
    expect(useStore.getState().plans).toHaveLength(5);
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
