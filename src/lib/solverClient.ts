import { recipeById } from './data';
import type { CalcInput, CalcResult } from './model/calc/result';
import type { RecipeMod, SolveInput, SolveResult } from './solver';
import type { SolveFailure } from './solveFailure';
import { useSyncExternalStore } from 'react';
import type { SolverLoading, SolverRequest, SolverResponse } from './solver.worker';

type Pending = {
  resolve: (v: SolverResponse & { ok: true }) => void;
  reject: (f: SolveFailure) => void;
  timer?: ReturnType<typeof setTimeout>;
};

let worker: Worker | undefined;

// How far the solver has loaded, 0 to 1; 1 once it is ready. A new worker starts again from 0.
let loaded = 0;
const listeners = new Set<() => void>();
const setLoaded = (v: number) => {
  if (v === loaded) return;
  loaded = v;
  for (const l of listeners) l();
};

/** How much of the solver has loaded, 0 to 1, or undefined once it is ready (or before any solve asked for it). */
export function useSolverLoading(): number | undefined {
  const v = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => loaded,
  );
  return v > 0 && v < 1 ? v : undefined;
}
/** Whether the solver has finished loading. */
export function useSolverReady(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => loaded >= 1,
  );
}
let nextId = 0;
const pending = new Map<number, Pending>();

// The slowest real solve takes under a second; a worker that has said nothing for this long is stuck.
let timeoutMs = 30_000;
/** Changes how long a request may wait for the worker (for tests). */
export const setSolverTimeout = (ms: number) => {
  timeoutMs = ms;
};

const settle = (id: number) => {
  const p = pending.get(id);
  if (p?.timer) clearTimeout(p.timer);
  pending.delete(id);
  return p;
};

/** Fails everything in flight and drops the worker; the next call starts a new one. */
function resetWorker(failure: SolveFailure) {
  const waiting = [...pending.keys()];
  for (const id of waiting) settle(id)?.reject(failure);
  worker?.terminate();
  worker = undefined;
  setLoaded(0);
}

// A request waits this long for the worker; progress while it loads starts the wait again.
const arm = (id: number) => {
  const p = pending.get(id);
  if (!p) return;
  if (p.timer) clearTimeout(p.timer);
  p.timer = setTimeout(() => resetWorker({ code: 'stopped', status: 'no answer' }), timeoutMs);
};

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = ({ data }: MessageEvent<SolverResponse | SolverLoading>) => {
    if ('loading' in data) {
      for (const id of pending.keys()) arm(id);
      return setLoaded(data.loading);
    }
    const p = settle(data.id);
    if (!p) return;
    if (data.ok) p.resolve(data);
    else p.reject(data.failure);
  };
  // A crashed worker fails everything in flight.
  w.onerror = (e) => {
    e.preventDefault();
    resetWorker({ code: 'stopped', status: e.message });
  };
  worker = w;
  return w;
}

/** Starts the worker, and with it the solver's loading, before anything asks it to solve. */
export const startSolver = () => void getWorker();

type Request = SolverRequest extends infer R ? (R extends SolverRequest ? Omit<R, 'id'> : never) : never;

function call(req: Request): Promise<SolverResponse & { ok: true }> {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    arm(id);
    getWorker().postMessage({ ...req, id });
  });
}

/** Solves in the worker. Rejects with a SolveFailure. */
export async function solveAsync(input: SolveInput): Promise<SolveResult> {
  const result = (await call({ kind: 'solve', input })).value as SolveResult;
  // Recipes come back as structured-clone copies; point them at the shared objects again.
  for (const u of [...result.recipes, ...(result.lines?.flatMap((l) => l.result.recipes) ?? [])])
    u.recipe = recipeById.get(u.recipe.id) ?? u.recipe;
  return result;
}

/** Works out a hand-built model in the worker. Rejects with a SolveFailure. */
export async function calcAsync(input: CalcInput): Promise<CalcResult> {
  return (await call({ kind: 'model', input })).value as CalcResult;
}

/** Places somersloops and power shards in the worker. Rejects with a SolveFailure. */
export async function autoAssignAsync(
  input: SolveInput,
  stock: { sloops: number; shards: number },
  all = false,
): Promise<Record<string, RecipeMod>> {
  return (await call({ kind: 'autoAssign', input, stock, all })).value as Record<string, RecipeMod>;
}
