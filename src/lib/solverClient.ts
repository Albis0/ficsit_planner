import { recipeById } from './data';
import type { CalcInput, CalcResult } from './model/calc/result';
import type { RecipeMod, SolveInput, SolveResult } from './solver';
import type { SolveFailure } from './solveFailure';
import { useSyncExternalStore } from 'react';
import type { SolverLoading, SolverRequest, SolverResponse } from './solver.worker';

type Pending = { resolve: (v: SolverResponse & { ok: true }) => void; reject: (f: SolveFailure) => void };

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

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = ({ data }: MessageEvent<SolverResponse | SolverLoading>) => {
    if ('loading' in data) return setLoaded(data.loading);
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    if (data.ok) p.resolve(data);
    else p.reject(data.failure);
  };
  // A crashed worker fails everything in flight; the next call starts a new one.
  w.onerror = (e) => {
    e.preventDefault();
    for (const p of pending.values()) p.reject({ code: 'stopped', status: e.message });
    pending.clear();
    w.terminate();
    worker = undefined;
    setLoaded(0);
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
