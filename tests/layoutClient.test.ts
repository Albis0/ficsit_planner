import { afterEach, expect, spyOn, test } from 'bun:test';
import type { ElkNode } from 'elkjs/lib/elk-api';
import type { Engine } from '../src/lib/layout';
import { layoutInBackground, setWorkerFactory } from '../src/lib/layoutClient';
import { testEngine } from './helpers/elk';

const tiny = (): ElkNode => ({
  id: 'root',
  layoutOptions: { 'elk.algorithm': 'layered' },
  children: [
    { id: 'a', width: 50, height: 30 },
    { id: 'b', width: 50, height: 30 },
  ],
  edges: [{ id: 'e', sources: ['a'], targets: ['b'] }],
});

/** The main-thread fallback, counted: Bun can't run ELK's bundled build, so tests stand in ELK's worker for it. */
function countedFallback() {
  const calls = { n: 0 };
  const engine: Engine = (g) => {
    calls.n++;
    return testEngine(g);
  };
  return { calls, engine };
}

afterEach(() => setWorkerFactory(undefined));

test('lays out in a worker, not quietly on the fallback', async () => {
  const warn = spyOn(console, 'warn');
  const fallback = countedFallback();
  let made = 0;
  setWorkerFactory(() => {
    made++;
    return new Worker(new URL('../src/lib/layout.worker.ts', import.meta.url), { type: 'module' });
  }, fallback.engine);
  const laid = await layoutInBackground(tiny());
  expect(made).toBeGreaterThan(0);
  expect(fallback.calls.n).toBe(0);
  expect(warn).not.toHaveBeenCalled();
  const [a, b] = laid.children!;
  expect(b.x!).toBeGreaterThan(a.x!);
  warn.mockRestore();
});

test('falls back when the worker dies, including jobs already waiting', async () => {
  const fallback = countedFallback();
  const broken = URL.createObjectURL(new Blob(['throw new Error("no ELK here")'], { type: 'text/javascript' }));
  setWorkerFactory(() => new Worker(broken, { type: 'module' }), fallback.engine);
  const laid = await Promise.all([layoutInBackground(tiny()), layoutInBackground(tiny()), layoutInBackground(tiny())]);
  expect(fallback.calls.n).toBe(3);
  for (const g of laid) expect(g.children![1].x!).toBeGreaterThan(g.children![0].x!);
});

test('falls back when the worker never answers', async () => {
  const fallback = countedFallback();
  const silent = URL.createObjectURL(new Blob(['self.onmessage = () => {};'], { type: 'text/javascript' }));
  setWorkerFactory(() => new Worker(silent, { type: 'module' }), fallback.engine);
  const laid = await layoutInBackground(tiny());
  expect(fallback.calls.n).toBe(1);
  expect(laid.children![1].x!).toBeGreaterThan(laid.children![0].x!);
}, 10_000);

/** A worker speaking ELK's protocol: quick to answer questions, `layoutMs` to hand back each layout (unchanged). */
const fakeElk = (layoutMs: number) =>
  URL.createObjectURL(
    new Blob(
      [
        `self.onmessage = (e) => {
          const m = e.data;
          const reply = () => self.postMessage({ id: m.id, data: m.cmd === 'layout' ? m.graph : [] });
          if (m.cmd === 'layout') setTimeout(reply, ${layoutMs}); else reply();
        };`,
      ],
      { type: 'text/javascript' },
    ),
  );

test('a slow layout on working workers is waited for, not taken as broken workers', async () => {
  const fallback = countedFallback();
  const slow = fakeElk(5000);
  setWorkerFactory(() => new Worker(slow, { type: 'module' }), fallback.engine);
  const laid = await layoutInBackground(tiny());
  expect(fallback.calls.n).toBe(0);
  expect(laid.id).toBe('root');
}, 10_000);

test('falls back when workers cannot even be created', async () => {
  const fallback = countedFallback();
  setWorkerFactory(() => {
    throw new Error('blocked by the page');
  }, fallback.engine);
  const laid = await layoutInBackground(tiny());
  expect(fallback.calls.n).toBe(1);
  expect(laid.children![1].x!).toBeGreaterThan(laid.children![0].x!);
});

test('layouts overtaken by a newer one are dropped before they start, not run for nothing', async () => {
  const fallback = countedFallback();
  const quick = fakeElk(200);
  setWorkerFactory(() => new Worker(quick, { type: 'module' }), fallback.engine);
  let stale = false;
  const jobs = Array.from({ length: 12 }, () => layoutInBackground(tiny(), () => stale));
  stale = true;
  const settled = await Promise.allSettled(jobs);
  const ran = settled.filter((s) => s.status === 'fulfilled').length;
  // Only the jobs already in a worker when they went stale ran; the pool has at most 4 workers.
  expect(ran).toBeLessThanOrEqual(4);
  expect(settled.filter((s) => s.status === 'rejected').length).toBe(12 - ran);
});

test("an old pool's timer never gives up a newer pool", async () => {
  const fallback = countedFallback();
  // A pool that never answers, replaced at once by one that answers questions quickly but lays out slowly.
  const silent = URL.createObjectURL(new Blob(['self.onmessage = () => {};'], { type: 'text/javascript' }));
  setWorkerFactory(() => new Worker(silent, { type: 'module' }), fallback.engine);
  layoutInBackground(tiny()).catch(() => {});
  const slow = fakeElk(5000);
  setWorkerFactory(() => new Worker(slow, { type: 'module' }), fallback.engine);
  const laid = await layoutInBackground(tiny());
  expect(fallback.calls.n).toBe(0);
  expect(laid.id).toBe('root');
}, 10_000);
