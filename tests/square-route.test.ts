import { describe, expect, test } from 'bun:test';
import { type SquareBelt, squareBends } from '../src/lib/squareRoute';

const belt = (
  id: string,
  source: string,
  target: string,
  from: [number, number],
  to: [number, number],
  via: [number, number][] = [],
): SquareBelt => ({
  id,
  source,
  target,
  from: { x: from[0], y: from[1] },
  to: { x: to[0], y: to[1] },
  via: via.map(([x, y]) => ({ x, y })),
});

/** Every stretch of the belt runs along one axis. */
const square = (b: SquareBelt, bends: { x: number; y: number }[]) => {
  const pts = [b.from, ...bends, b.to];
  return pts.slice(1).every((p, i) => Math.abs(p.x - pts[i].x) < 1e-6 || Math.abs(p.y - pts[i].y) < 1e-6);
};

describe('square belts', () => {
  test('a belt between two heights steps across half way, level with both ends', () => {
    const b = belt('a', 'x', 'y', [100, 50], [300, 150]);
    const bends = squareBends([b], 'LR').get('a')!;
    expect(bends).toEqual([
      { x: 200, y: 50 },
      { x: 200, y: 150 },
    ]);
    expect(square(b, bends)).toBe(true);
  });

  test('a level belt needs no bends', () => {
    expect(squareBends([belt('a', 'x', 'y', [100, 50], [300, 50])], 'LR').get('a')).toEqual([]);
  });

  test('a long belt runs level through each column it passes, upright only between them', () => {
    const b = belt(
      'a',
      'x',
      'y',
      [100, 50],
      [700, 250],
      [
        [300, 120],
        [500, 180],
      ],
    );
    const bends = squareBends([b], 'LR').get('a')!;
    expect(square(b, bends)).toBe(true);
    expect(bends).toHaveLength(6);
    expect(bends[0].y).toBe(50);
    expect(bends.at(-1)?.y).toBe(250);
  });

  test('belts of different lines upright in the same gap each get a lane; belts off one machine share theirs', () => {
    const [p, q] = [belt('p', 'a', 'c', [100, 0], [300, 200]), belt('q', 'b', 'd', [100, 100], [300, 300])];
    const lanes = squareBends([p, q], 'LR');
    expect(lanes.get('p')![0].x).not.toBe(lanes.get('q')![0].x);
    const [r, s] = [belt('r', 'a', 'c', [100, 0], [300, 200]), belt('s', 'a', 'd', [100, 0], [300, 300])];
    const shared = squareBends([r, s], 'LR');
    expect(shared.get('r')![0].x).toBe(shared.get('s')![0].x);
  });

  test('on a floor running down the same holds turned a quarter', () => {
    const b = belt('a', 'x', 'y', [50, 100], [150, 300]);
    const bends = squareBends([b], 'TB').get('a')!;
    expect(bends).toEqual([
      { x: 50, y: 200 },
      { x: 150, y: 200 },
    ]);
    expect(square(b, bends)).toBe(true);
  });
});
