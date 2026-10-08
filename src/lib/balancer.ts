/** How a belt is shared out between n machines. */
export interface Balancer {
  n: number;
  /** A tree of splitters when n splits evenly in 2s and 3s; otherwise a manifold, a splitter at each machine. */
  kind: 'none' | 'tree' | 'manifold';
  /** Tree: how many ways each stage splits, 2s first (fewest splitters that way), then 3s. */
  stages: number[];
  /** Splitters it takes. */
  splitters: number;
  /** Manifold: the nearest machine count a tree splits evenly, if it isn't n. */
  nearest?: number;
}

/** n as 2s and 3s, or undefined when it has another factor. */
export function smoothStages(n: number): number[] | undefined {
  if (n < 2 || !Number.isInteger(n)) return undefined;
  const stages: number[] = [];
  let rest = n;
  while (rest % 2 === 0) {
    stages.push(2);
    rest /= 2;
  }
  while (rest % 3 === 0) {
    stages.push(3);
    rest /= 3;
  }
  return rest === 1 ? stages : undefined;
}

/** Splitters in a tree with these stages: one for the first, then one for each branch it made, and so on down. */
export function treeSplitters(stages: number[]): number {
  let width = 1;
  let total = 0;
  for (const s of stages) {
    total += width;
    width *= s;
  }
  return total;
}

/** The count nearest n (either side, the lower on a tie) that a tree of 2s and 3s splits evenly, other than n itself. */
export function nearestEven(n: number): number {
  for (let d = 1; d < n + 2; d++) {
    for (const m of [n - d, n + d]) if (m >= 2 && smoothStages(m)) return m;
  }
  return 2;
}

export function balancerFor(n: number): Balancer {
  if (n < 2) return { n, kind: 'none', stages: [], splitters: 0 };
  const stages = smoothStages(n);
  if (stages) return { n, kind: 'tree', stages, splitters: treeSplitters(stages) };
  return { n, kind: 'manifold', stages: [], splitters: n - 1, nearest: nearestEven(n) };
}
