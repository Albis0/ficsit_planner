import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { setSolverTimeout, solveAsync } from '../src/lib/solverClient';

/** A worker that takes requests and never answers. */
class SilentWorker {
  static made: SilentWorker[] = [];
  onmessage: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  posted: unknown[] = [];
  ended = false;
  constructor() {
    SilentWorker.made.push(this);
  }
  postMessage(m: unknown) {
    this.posted.push(m);
  }
  terminate() {
    this.ended = true;
  }
}

const input = { targets: [], supplies: [], enabledRecipes: new Set<string>(), resourceCaps: {}, objective: 'resources' } as never;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const realWorker = globalThis.Worker;

beforeEach(() => {
  SilentWorker.made = [];
  (globalThis as { Worker: unknown }).Worker = SilentWorker;
  setSolverTimeout(30);
});
afterEach(() => {
  (globalThis as { Worker: unknown }).Worker = realWorker;
  setSolverTimeout(30_000);
});

describe('a worker that never answers', () => {
  test('the waiting request fails as stopped and the worker is thrown away', async () => {
    const first = solveAsync(input);
    await expect(first).rejects.toMatchObject({ code: 'stopped' });
    expect(SilentWorker.made).toHaveLength(1);
    expect(SilentWorker.made[0].ended).toBe(true);
  });

  test('everything in flight fails together', async () => {
    const a = solveAsync(input);
    const b = solveAsync(input);
    const out = await Promise.allSettled([a, b]);
    expect(out.map((o) => o.status)).toEqual(['rejected', 'rejected']);
    expect(SilentWorker.made).toHaveLength(1);
  });

  test('the next call builds a new worker', async () => {
    await solveAsync(input).catch(() => {});
    const again = solveAsync(input).catch((f) => f);
    await wait(5);
    expect(SilentWorker.made).toHaveLength(2);
    expect(SilentWorker.made[1].ended).toBe(false);
    expect(SilentWorker.made[1].posted).toHaveLength(1);
    expect(await again).toMatchObject({ code: 'stopped' });
  });

  test('loading progress keeps the wait going', async () => {
    const p = solveAsync(input).catch((f) => f);
    const w = SilentWorker.made[0];
    for (let i = 1; i <= 4; i++) {
      await wait(18);
      w.onmessage?.({ data: { loading: i / 10 } });
    }
    expect(w.ended).toBe(false);
    expect(await p).toMatchObject({ code: 'stopped' });
    expect(w.ended).toBe(true);
  });
});
