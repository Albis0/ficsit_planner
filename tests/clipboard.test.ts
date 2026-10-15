import { describe, expect, test } from 'bun:test';
import { clipText, copyNodes, pasteClip, readClip } from '../src/lib/model/ops';
import type { Model } from '../src/lib/model/types';
import { decode, encode } from '../src/lib/share';

const floor: Model = {
  v: 1,
  calc: 'basic',
  seq: 10,
  nodes: [
    { id: 'a', k: 'in', x: 0, y: 0, item: 'Desc_OreIron_C' },
    { id: 'b', k: 'out', x: 400, y: 0, item: 'Desc_OreIron_C' },
    { id: 'c', k: 'sink', x: 800, y: 0 },
  ],
  links: [{ id: 'l', a: 'a', ap: 0, b: 'b', bp: 0 }],
} as Model;

describe('cards on the system clipboard', () => {
  test('a copy goes out as text and comes back with its belts', () => {
    const clip = copyNodes(floor, ['a', 'b'])!;
    const back = readClip(clipText(clip))!;
    expect(back.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(back.links).toHaveLength(1);
    expect(pasteClip(floor, back, 0, 200).model.nodes).toHaveLength(5);
  });

  test('text that is not a copy is nothing', () => {
    expect(readClip('hello')).toBeUndefined();
    expect(readClip('{"kind":"something","nodes":[]}')).toBeUndefined();
    expect(readClip('{"kind":"ficsit-planner-cards","v":1,"nodes":[],"links":[]}')).toBeUndefined();
    expect(readClip('{not json')).toBeUndefined();
    expect(readClip(`{${'x'.repeat(1_000_001)}`)).toBeUndefined();
  });

  test('a made-up copy is cleaned: unknown items, wild sizes and belts to nowhere do not get in', () => {
    const text = JSON.stringify({
      kind: 'ficsit-planner-cards',
      v: 1,
      nodes: [
        { id: 'a', k: 'in', x: 1e12, y: 0, item: 'Desc_Nope_C' },
        { id: 'n', k: 'note', x: 0, y: 0, text: 'x'.repeat(5000), w: 1e9, h: 1e9 },
        { id: 'z', k: 'bogus', x: 0, y: 0 },
      ],
      links: [{ id: 'l', a: 'n', ap: 0, b: 'ghost', bp: 0 }],
    });
    const back = readClip(text)!;
    expect(back.nodes.map((n) => n.id)).toEqual(['n']);
    const note = back.nodes[0] as { text: string; w: number; h: number };
    expect(note.text).toHaveLength(2000);
    expect(note.w).toBeLessThanOrEqual(4000);
    expect(back.links).toHaveLength(0);
  });
});

describe('a link pasted from the clipboard', () => {
  test('one longer than the address bar takes still reads back', async () => {
    const noise = Array.from({ length: 12000 }, (_, i) => (((i + 1) * 2654435761) % 4294967296).toString(36));
    const text = await encode({ kind: 'ficsit-planner', noise });
    expect(text.length).toBeGreaterThan(60_000);
    await expect(decode(text)).rejects.toThrow();
    expect(((await decode(text, 1_000_000)) as { noise: string[] }).noise).toEqual(noise);
  });
});
