import { expect, test } from 'bun:test';
import { untangle } from '../src/components/floor/BeltStroke';

const cross = (p: number[], q: number[], r: number[]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
const crosses = (pts: [number, number][]) =>
  pts.some((a, k) =>
    pts.slice(k + 2, -1).some((c, m) => {
      const [b, d] = [pts[k + 1], pts[k + 3 + m]];
      return b && d && cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
    }),
  );

test('a lane on the inside of a bend too tight for it has its loop cut, turning in a corner where it crossed itself', () => {
  // A lane on the inside of a right-angle turn: it runs past the corner, back, and down, crossing itself at (85, 25).
  const loop: [number, number][] = [
    ...Array.from({ length: 14 }, (_, i): [number, number] => [i * 6, 25]),
    [110, 25],
    [110, 15],
    [85, 15],
    ...Array.from({ length: 18 }, (_, i): [number, number] => [85, 16 + i * 6]),
  ];
  expect(crosses(loop)).toBe(true);
  const cut = untangle(loop);
  expect(crosses(cut)).toBe(false);
  expect(cut.length).toBeLessThan(loop.length);
  // The corner is where it crossed: on the first run and on the last.
  expect(cut.some(([x, y]) => Math.abs(x - 85) < 1e-6 && Math.abs(y - 25) < 1e-6)).toBe(true);
  // A lane that never crosses itself is left exactly as it was.
  const straight: [number, number][] = Array.from({ length: 30 }, (_, i) => [i * 6, Math.sin(i / 5) * 20]);
  expect(untangle(straight)).toEqual(straight);
});
