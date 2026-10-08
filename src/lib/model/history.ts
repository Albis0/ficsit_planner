/*
  Undo and redo: whole snapshots, kept in memory per scope, most recent last. A hand-built model is one scope per factory
  tab; the Auto floor's plan and a power plant are scopes of their own ("auto:<id>", "power:<id>"), so none of them
  mixes with another. Snapshots are never changed in place, so keeping one costs only what changed. Lost on reload,
  like a game's undo.
*/

const LIMIT = 100;
/** Edits under the same key this close together (typing a number, dragging a slider) undo as one. */
const MERGE_MS = 600;

interface Stack {
  past: unknown[];
  future: unknown[];
  /** Key and time of the last edit, for merging. */
  last?: { key: string; at: number };
}

const stacks = new Map<string, Stack>();
const stackOf = (scope: string) => {
  let s = stacks.get(scope);
  if (!s) {
    s = { past: [], future: [] };
    stacks.set(scope, s);
  }
  return s;
};

/** Notes the snapshot as it was before an edit. */
export function record<T>(scope: string, before: T | undefined, merge?: string, now = Date.now()) {
  if (!before) return;
  const s = stackOf(scope);
  const same = merge && s.last && s.last.key === merge && now - s.last.at < MERGE_MS;
  if (!same) {
    s.past.push(before);
    if (s.past.length > LIMIT) s.past.shift();
  }
  s.future = [];
  s.last = merge ? { key: merge, at: now } : undefined;
}

/** The snapshot to go back to, given the one on screen; undefined when there's nothing to undo. */
export function undo<T>(scope: string, current: T | undefined): T | undefined {
  const s = stackOf(scope);
  const prev = s.past.pop();
  if (!prev) return undefined;
  if (current) s.future.push(current);
  s.last = undefined;
  return prev as T;
}

export function redo<T>(scope: string, current: T | undefined): T | undefined {
  const s = stackOf(scope);
  const next = s.future.pop();
  if (!next) return undefined;
  if (current) s.past.push(current);
  s.last = undefined;
  return next as T;
}

export const canUndo = (scope: string) => (stacks.get(scope)?.past.length ?? 0) > 0;
export const canRedo = (scope: string) => (stacks.get(scope)?.future.length ?? 0) > 0;

/** Forgets a scope's history (its tab was closed, or the model was rebuilt from scratch). */
export const forget = (scope: string) => stacks.delete(scope);

/** The scope of a factory's Auto plan and of a power plant. */
export const autoScope = (plan: string) => `auto:${plan}`;
export const powerScope = (plant: string) => `power:${plant}`;
