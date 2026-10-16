import { describe, expect, test } from 'bun:test';
import { compile } from '../src/lib/model/calc/compile';
import { AREA_COLOR, hexToHsv, hsvToHex } from '../src/lib/model/color';
import { clipText, copyNodes, insideArea, pasteClip, readClip } from '../src/lib/model/ops';
import { cleanModel } from '../src/lib/model/sanitize';
import type { Model } from '../src/lib/model/types';

const floor = {
  v: 1,
  calc: 'basic',
  seq: 10,
  nodes: [
    { id: 'a', k: 'in', x: 80, y: 80, item: 'Desc_OreIron_C' },
    { id: 'b', k: 'out', x: 480, y: 80, item: 'Desc_OreIron_C' },
    { id: 'c', k: 'sink', x: 2000, y: 0 },
    { id: 'g', k: 'group', x: 0, y: 0, w: 1000, h: 400, label: 'Iron', note: 'Ore straight out', icon: 'Desc_OreIron_C', color: '#4aa3e8' },
  ],
  links: [{ id: 'l', a: 'a', ap: 0, b: 'b', bp: 0 }],
} as Model;

describe('areas on the hand-built floor', () => {
  test('a saved area keeps its name, note, icon and colour', () => {
    const g = cleanModel(floor)!.nodes.find((n) => n.k === 'group')!;
    expect(g).toMatchObject({ label: 'Iron', note: 'Ore straight out', icon: 'Desc_OreIron_C', color: '#4aa3e8', w: 1000, h: 400 });
  });

  test('made-up values are left out: a colour that is not #rrggbb, an icon that is no item, a note without end', () => {
    const wild = {
      ...floor,
      nodes: [{ id: 'g', k: 'group', x: 0, y: 0, w: 1, h: 1e9, color: 'red', icon: 'Nope', note: 'x'.repeat(900) }],
    };
    const g = cleanModel(wild)!.nodes[0] as { w: number; h: number; color?: string; icon?: string; note?: string };
    expect([g.w, g.h, g.color, g.icon, g.note?.length]).toEqual([80, 20000, undefined, undefined, 500]);
    expect((cleanModel({ ...wild, nodes: [{ ...wild.nodes[0], color: '#ABCDEF' }] })!.nodes[0] as { color: string }).color).toBe('#abcdef');
  });

  test('cleaning twice gives the same area', () => {
    const once = cleanModel(floor)!;
    expect(cleanModel(once)).toEqual(once);
  });

  test('the numbers ignore an area', () => {
    const without = { ...floor, nodes: floor.nodes.filter((n) => n.k !== 'group') } as Model;
    expect(compile(floor, 9).nodes.map((n) => n.node.id)).toEqual(compile(without, 9).nodes.map((n) => n.node.id));
  });

  test('what lies wholly inside an area is told from what only touches it', () => {
    expect(insideArea(floor, 'g').sort()).toEqual(['a', 'b']);
    expect(insideArea(floor, 'a')).toEqual([]);
  });

  test('copying an area takes what lies in it, copying a card in it does not take the area', () => {
    expect(
      copyNodes(floor, ['g'])!
        .nodes.map((n) => n.id)
        .sort(),
    ).toEqual(['a', 'b', 'g']);
    expect(copyNodes(floor, ['a'])!.nodes.map((n) => n.id)).toEqual(['a']);
    const clip = readClip(clipText(copyNodes(floor, ['g'])!))!;
    const pasted = pasteClip(floor, clip, 0, 600).model;
    expect(pasted.nodes.filter((n) => n.k === 'group')).toHaveLength(2);
    expect(pasted.links).toHaveLength(2);
    expect(pasted.nodes.find((n) => n.k === 'group' && n.id !== 'g')).toMatchObject({ y: 600, color: '#4aa3e8', label: 'Iron' });
  });
});

describe('colours', () => {
  test('hex and the wheel turn into each other', () => {
    for (const hex of [AREA_COLOR, '#4aa3e8', '#6cc070', '#000000', '#ffffff', '#808080']) expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv('#00ff00').h).toBe(120);
    expect(hsvToHex({ h: 240, s: 1, v: 1 })).toBe('#0000ff');
  });
});
