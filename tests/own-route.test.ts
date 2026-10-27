import { expect, test } from 'bun:test';
import { squarePath } from '../src/components/floor/squarePath';

const along = (runs: [{ x: number; y: number }, { x: number; y: number }][]) =>
  runs.every(([a, b]) => Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6);

test('a belt routed by hand runs square between its stops, whichever way the floor runs', () => {
  const stops = [
    { x: 200, y: 340 },
    { x: 380, y: 100 },
    { x: 260, y: 220 },
  ];
  for (const down of [false, true]) {
    const { runs } = squarePath({ x: 40, y: 60 }, stops, { x: 520, y: 180 }, down, true);
    expect(along(runs)).toBe(true);
    // Every stop is on the belt.
    for (const s of stops)
      expect(runs.some(([a, b]) => [a, b].some((p) => Math.abs(p.x - s.x) < 1e-6 && Math.abs(p.y - s.y) < 1e-6))).toBe(true);
  }
});
