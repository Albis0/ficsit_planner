import { expect, test } from 'bun:test';
import { arrival, arrowHead, countCrossings, edgePath, routeSvgPath } from '../src/lib/routes';

const p = (x: number, y: number) => ({ x, y });

test('polyline routes are straight segments', () => {
  expect(routeSvgPath([p(0, 0), p(10, 0), p(10, 10)], 'POLYLINE')).toBe('M0,0 L10,0 L10,10');
});

test('orthogonal routes round their corners, never more than half the shorter run', () => {
  // Runs of 100 and 8: the corner radius is capped at 4, not the usual 12.
  expect(routeSvgPath([p(0, 0), p(100, 0), p(100, 8)], 'ORTHOGONAL')).toBe('M0,0 L96,0 Q100,0 100,4 L100,8');
  expect(routeSvgPath([p(0, 0), p(100, 0), p(100, 100)], 'ORTHOGONAL')).toBe('M0,0 L88,0 Q100,0 100,12 L100,100');
});

test('spline routes are chains of cubic curves through ELK control points', () => {
  expect(routeSvgPath([p(0, 0), p(5, 0), p(5, 10), p(10, 10)], 'SPLINES')).toBe('M0,0 C5,0 5,10 10,10');
  // Control points that don't come in threes: drawn straight rather than guessed at.
  expect(routeSvgPath([p(0, 0), p(5, 5), p(10, 10)], 'SPLINES')).toBe('M0,0 L5,5 L10,10');
});

test('crossings: a real crossing counts once, touching at a shared machine does not, parallel runs do not', () => {
  const across = { source: 'a', target: 'b', points: [p(0, 0), p(10, 10)] };
  const back = { source: 'c', target: 'd', points: [p(0, 10), p(10, 0)] };
  expect(countCrossings([across, back])).toBe(1);
  const sameSource = { source: 'a', target: 'e', points: [p(0, 10), p(10, 0)] };
  expect(countCrossings([across, sameSource])).toBe(0);
  const parallel = { source: 'f', target: 'g', points: [p(0, 1), p(10, 11)] };
  expect(countCrossings([across, parallel])).toBe(0);
  // Each crossing segment pair counts: an S-bend crossing a straight run twice is 2.
  const s = { source: 'h', target: 'i', points: [p(0, 5), p(4, -5), p(8, 5)] };
  const flat = { source: 'j', target: 'k', points: [p(-1, 0), p(9, 0)] };
  expect(countCrossings([s, flat])).toBe(2);
});

test('a belt arrives heading along its last run, ignoring repeated end points', () => {
  // Back-edges arrive heading left, against the flow of the floor.
  expect(arrival([p(100, 0), p(100, 50), p(0, 50)])).toEqual({ at: p(0, 50), dir: p(-1, 0) });
  expect(arrival([p(0, 0), p(0, 30), p(0, 30)])).toEqual({ at: p(0, 30), dir: p(0, 1) });
});

test('the arrowhead tips at the end of the belt, its base set back along the way it came', () => {
  // Heading right into (100,50): base 10 back, 6 either side.
  expect(arrowHead({ at: p(100, 50), dir: p(1, 0) }, 10, 12)).toBe('100,50 90,56 90,44');
});

test('a laid-out belt arrives along its route; a moved one along the fallback', () => {
  const route = { points: [p(0, 0), p(50, 0), p(50, 20)], label: p(25, 0), from: p(0, 0), to: p(40, 20), routing: 'ORTHOGONAL' as const };
  const fallback = (): [string, number, number, ReturnType<typeof arrival>] => ['M', 0, 0, { at: p(9, 9), dir: p(-1, 0) }];
  expect(edgePath(route, p(0, 0), p(40, 20), fallback)[3]).toEqual({ at: p(50, 20), dir: p(0, 1) });
  expect(edgePath(route, p(0, 0), p(80, 20), fallback)[3]).toEqual({ at: p(9, 9), dir: p(-1, 0) });
});
