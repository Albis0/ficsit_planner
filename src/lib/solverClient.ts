import { recipeById } from './data';
import type { RecipeMod, SolveInput, SolveResult } from './solver';
import type { SolveFailure } from './solveFailure';
import type { SolverRequest, SolverResponse } from './solver.worker';

type Pending = { resolve: (v: SolverResponse & { ok: true }) => void; reject: (f: SolveFailure) => void };

let worker: Worker | undefined;
let nextId = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = ({ data }: MessageEvent<SolverResponse>) => {
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
  };
  worker = w;
  return w;
}

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
  for (const u of result.recipes) u.recipe = recipeById.get(u.recipe.id) ?? u.recipe;
  return result;
}

/** Places somersloops and power shards in the worker. Rejects with a SolveFailure. */
export async function autoAssignAsync(input: SolveInput, stock: { sloops: number; shards: number }): Promise<Record<string, RecipeMod>> {
  return (await call({ kind: 'autoAssign', input, stock })).value as Record<string, RecipeMod>;
}
