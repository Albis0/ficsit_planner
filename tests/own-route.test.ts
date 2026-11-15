import { expect, test } from 'bun:test';
import { keepBetween, SQUARE_TURN, squarePath, turnFor } from '../src/components/floor/squarePath';

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

test('belts side by side turn wider than their outer lane is off the middle, so the inner lane never folds', () => {
  // One belt keeps the usual turn; three 22 apart (the Manual floor's) need more than 22, the outer lane's offset.
  expect(turnFor(1, 22)).toBe(SQUARE_TURN);
  expect(turnFor(3, 22)).toBeGreaterThan(22);
  expect(turnFor(6, 22)).toBeGreaterThan(turnFor(3, 22));
  // The turn is cut off by the runs either side of it, never bigger than half of them.
  const { path } = squarePath(
    { x: 0, y: 0 },
    [
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ],
    { x: 200, y: 100 },
    false,
    true,
    turnFor(3, 22),
  );
  const arcs = [...path.matchAll(/L([\d.-]+),([\d.-]+) Q([\d.-]+),([\d.-]+) ([\d.-]+),([\d.-]+)/g)];
  expect(arcs.length).toBeGreaterThan(0);
  for (const m of arcs)
    expect(Math.hypot(Number(m[5]) - Number(m[1]), Number(m[6]) - Number(m[2]))).toBeLessThanOrEqual(turnFor(3, 22) * 2);
});

test('belts side by side stepping aside less than two of their turns take one easy S instead of two folded turns', () => {
  const r = turnFor(6, 10);
  const jog = squarePath(
    { x: 0, y: 0 },
    [
      { x: 200, y: 0 },
      { x: 200, y: 8 },
    ],
    { x: 400, y: 8 },
    false,
    false,
    r,
  ).path;
  expect(jog).toContain('C');
  expect(jog).not.toContain('Q');
  // One belt, or a step as big as the turns need, keeps its square turns.
  expect(
    squarePath(
      { x: 0, y: 0 },
      [
        { x: 200, y: 0 },
        { x: 200, y: 8 },
      ],
      { x: 400, y: 8 },
    ).path,
  ).toContain('Q');
  expect(
    squarePath(
      { x: 0, y: 0 },
      [
        { x: 200, y: 0 },
        { x: 200, y: 200 },
      ],
      { x: 400, y: 200 },
      false,
      false,
      r,
    ).path,
  ).toContain('Q');
});

test('a laid-out belt keeps its bends between its ends with room for its turn, so it never runs past an end and back', () => {
  const from = { x: 0, y: 0 };
  const to = { x: 300, y: 100 };
  // The layout put the last bend on the card's border, past the end standing out from it.
  const kept = keepBetween(
    [
      { x: 150, y: 0 },
      { x: 310, y: 0 },
      { x: 310, y: 100 },
    ],
    from,
    to,
    false,
    40,
  );
  expect(kept.map((p) => p.x)).toEqual([150, 260, 260]);
  expect(kept.map((p) => p.y)).toEqual([0, 0, 100]);
  // Too short for both: the bends meet in the middle. Down the floor it works on y. Backwards it is left alone.
  expect(keepBetween([{ x: 5, y: 0 }], from, { x: 60, y: 9 }, false, 40)[0].x).toBe(30);
  expect(keepBetween([{ x: 0, y: 290 }], from, { x: 9, y: 300 }, true, 40)[0].y).toBe(260);
  expect(keepBetween([{ x: 500, y: 0 }], to, from, false, 40)[0].x).toBe(500);
});
