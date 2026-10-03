import type { ELK as Elk, ElkNode } from 'elkjs/lib/elk-api';
import ELK from 'elkjs/lib/elk-api.js';
import type { Engine } from './layout';

/** Workers to lay out in, so several arrangements are tried at once. */
const POOL = () => Math.min(4, Math.max(2, (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2));
/** Workers that haven't answered a quick question by now are taken as not working. A layout itself may take longer. */
const FIRST_ANSWER_MS = 4000;

/** Why a layout was dropped: a newer one replaced it before a worker got to it. */
export class StaleLayout extends Error {
  constructor() {
    super('layout overtaken by a newer one');
  }
}

type Job = { graph: ElkNode; isStale?: () => boolean; resolve: (g: ElkNode) => void; reject: (e: unknown) => void; done?: boolean };
type Slot = { elk: Elk; job?: Job };

const defaultFactory = () => new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' });
/** ELK on this thread, loaded only when the workers don't work here. */
const defaultFallback: Engine = async (graph) => (await import('./elkMain')).mainThreadEngine(graph);

let factory: () => Worker = defaultFactory;
let onThisThread: Engine = defaultFallback;
let pool: Slot[] | undefined;
let broken = false;
/** Jobs waiting for a free worker, oldest first. */
let queue: Job[] = [];

/** For tests: lay out in workers made this way, falling back to `fallback` (undefined: the real ones). Starts a fresh pool. */
export function setWorkerFactory(make?: () => Worker, fallback?: Engine): void {
  for (const s of pool ?? []) s.elk.terminateWorker();
  pool = undefined;
  broken = false;
  queue = [];
  factory = make ?? defaultFactory;
  onThisThread = fallback ?? defaultFallback;
}

/** Resolves or rejects a job once, whichever of the worker or the fallback answers first. */
const settle = (job: Job, f: () => void) => {
  if (job.done) return;
  job.done = true;
  f();
};

/** Lays the job out on this thread, unless it has gone stale meanwhile. */
function runHere(job: Job) {
  if (job.isStale?.()) return settle(job, () => job.reject(new StaleLayout()));
  onThisThread(job.graph).then(
    (g) => settle(job, () => job.resolve(g)),
    (e) => settle(job, () => job.reject(e)),
  );
}

/** Workers don't work here: stop using them, and lay out everything still waiting on this thread. */
function giveUp(why: unknown) {
  if (broken) return;
  console.warn('Layout workers unavailable, laying out on the main thread:', why);
  broken = true;
  const waiting = [...(pool ?? []).flatMap((s) => (s.job ? [s.job] : [])), ...queue];
  for (const s of pool ?? []) s.elk.terminateWorker();
  pool = undefined;
  queue = [];
  for (const job of waiting) runHere(job);
}

/** Starts the pool, and asks each worker a quick question to learn whether workers run here at all. */
function start(): Slot[] | undefined {
  let slots: Slot[] = [];
  try {
    slots = Array.from({ length: POOL() }, () => ({
      elk: new ELK({
        workerFactory: () => {
          const w = factory();
          // ELK's own wrapper never hears about a worker that fails, so its layouts would wait forever.
          w.addEventListener('error', (e) => {
            e.preventDefault();
            if (pool === slots) giveUp(e.message || 'worker failed to start');
          });
          return w;
        },
      }),
    }));
  } catch (e) {
    // Workers can't even be made here (a sandboxed page, a strict content policy).
    giveUp(e);
    return undefined;
  }
  pool = slots;
  let alive = false;
  for (const s of slots)
    s.elk.knownLayoutAlgorithms().then(
      () => {
        alive = true;
      },
      () => {},
    );
  setTimeout(() => {
    if (pool === slots && !alive) giveUp('no answer in time');
  }, FIRST_ANSWER_MS);
  return slots;
}

/** Hands waiting jobs to free workers, dropping the ones a newer layout has replaced. */
function pump() {
  const owner = pool;
  for (const slot of owner ?? []) {
    if (slot.job) continue;
    let job = queue.shift();
    while (job?.isStale?.()) {
      const stale = job;
      settle(stale, () => stale.reject(new StaleLayout()));
      job = queue.shift();
    }
    if (!job) return;
    const mine = job;
    slot.job = mine;
    slot.elk
      .layout(mine.graph)
      .then(
        (g) => settle(mine, () => mine.resolve(g)),
        (e) => settle(mine, () => mine.reject(e)),
      )
      .finally(() => {
        if (pool !== owner) return;
        slot.job = undefined;
        pump();
      });
  }
}

/**
 * Lays out in the next free worker of the pool, or on this thread when workers don't work here. A job still
 * waiting for a worker when `isStale` says a newer layout replaced it is dropped with a StaleLayout error.
 */
export const layoutInBackground: Engine = (graph, isStale) =>
  new Promise((resolve, reject) => {
    const job: Job = { graph, isStale, resolve, reject };
    if (broken || typeof Worker === 'undefined' || !(pool ?? start())) return runHere(job);
    queue.push(job);
    pump();
  });

/**
 * Runs layouts so only the latest one counts. Each run is told how to check whether a newer one has started, and
 * one finishing after a newer one started resolves to undefined, so the floor never jumps back to an older arrangement.
 */
export function latestOnly<T>(): (run: (isStale: () => boolean) => Promise<T>) => Promise<T | undefined> {
  let latest = 0;
  return (run) => {
    const mine = ++latest;
    const isStale = () => mine !== latest;
    return run(isStale).then((v) => (isStale() ? undefined : v));
  };
}
