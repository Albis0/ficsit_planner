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

test('a stop pulled off a straight belt bends it through the stop, never back over itself', () => {
  // Doubling back: a run that goes the opposite way of the run before it.
  const back = (runs: [{ x: number; y: number }, { x: number; y: number }][]) =>
    runs.some(([a, b], i) => {
      if (i === 0) return false;
      const [p, q] = runs[i - 1];
      return (b.x - a.x) * (q.x - p.x) + (b.y - a.y) * (q.y - p.y) < 0;
    });
  for (const down of [false, true]) {
    const at = (x: number, y: number) => (down ? { x: y, y: x } : { x, y });
    for (const stops of [[at(100, 57)], [at(100, 57), at(200, 332)], [at(100, 57), at(200, 332), at(350, 107)]]) {
      const { runs } = squarePath(at(0, 208), stops, at(450, 208), down, true);
      expect(along(runs)).toBe(true);
      expect(back(runs)).toBe(false);
    }
  }
});
