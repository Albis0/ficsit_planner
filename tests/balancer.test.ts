import { describe, expect, test } from 'bun:test';
import { balancerFor, nearestEven, smoothStages, treeSplitters } from '../src/lib/balancer';

describe('sharing a belt between machines', () => {
  test('a count of 2s and 3s splits evenly in a tree, the 2s first', () => {
    expect(smoothStages(12)).toEqual([2, 2, 3]);
    expect(smoothStages(18)).toEqual([2, 3, 3]);
    expect(smoothStages(5)).toBeUndefined();
    expect(smoothStages(14)).toBeUndefined();
    expect(smoothStages(1)).toBeUndefined();
  });

  test('a tree takes a splitter for the first stage, then one for each branch', () => {
    expect(treeSplitters([2])).toBe(1);
    expect(treeSplitters([3])).toBe(1);
    expect(treeSplitters([2, 3])).toBe(3);
    // The bigger split last: fewer splitters than the other way round (1 + 3).
    expect(treeSplitters([3, 2])).toBe(4);
    expect(treeSplitters([2, 2, 2])).toBe(7);
    expect(treeSplitters([3, 3])).toBe(4);
  });

  test('other counts get a manifold with a splitter for every machine but one, and the nearest even count named', () => {
    const five = balancerFor(5);
    expect(five).toMatchObject({ kind: 'manifold', splitters: 4, nearest: 4 });
    expect(balancerFor(7)).toMatchObject({ kind: 'manifold', nearest: 6 });
    expect(balancerFor(11).nearest).toBe(12);
    expect(nearestEven(10)).toBe(9);
  });

  test('every count from 2 up either splits evenly or says what would', () => {
    for (let n = 2; n <= 200; n++) {
      const b = balancerFor(n);
      if (b.kind === 'tree') expect(b.stages.reduce((a, c) => a * c, 1)).toBe(n);
      else expect(smoothStages(b.nearest!)).toBeDefined();
      expect(b.splitters).toBeGreaterThan(0);
    }
    expect(balancerFor(1).kind).toBe('none');
  });
});
