import { useSyncExternalStore } from 'react';
import { createJSONStorage, type StateStorage } from 'zustand/middleware';

/**
 * Where the store keeps its plans. A full or blocked browser store makes a plain `setItem` throw, and zustand calls
 * it inside every `set()`, so one failed write used to cut an action off halfway. Here a failed write is caught and
 * remembered instead, and the app can say so. Writes are gathered for a moment so a burst of edits (typing a number,
 * a drag) is saved once, and they are written at once when the page is hidden or closed.
 */
export interface SafeStorage {
  storage: StateStorage;
  /** True while the last write did not go through. */
  failed: () => boolean;
  subscribe: (f: () => void) => () => void;
  /** Like `storage.setItem`, but the text can be made when it is written: a burst of changes makes it once. */
  queue: (name: string, value: string | (() => string)) => void;
  /** Writes what is waiting now. */
  flush: () => void;
}

export function makeSafeStorage(backend: () => Storage | undefined, wait = 300): SafeStorage {
  // A value can wait as a function: turning the plans into text is the costly part, so it is left for the write.
  const waiting = new Map<string, string | (() => string)>();
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let bad = false;
  let asked = false;

  const mark = (v: boolean) => {
    if (v === bad) return;
    bad = v;
    for (const f of listeners) f();
  };

  const flush = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (waiting.size === 0) return;
    const todo = [...waiting];
    waiting.clear();
    let ok = true;
    for (const [name, value] of todo) {
      try {
        backend()?.setItem(name, typeof value === 'function' ? value() : value);
      } catch {
        ok = false;
      }
    }
    mark(!ok);
  };

  // Ask the browser once not to clear this site's data when space runs short.
  const keep = () => {
    if (asked) return;
    asked = true;
    try {
      void navigator.storage?.persist?.().catch(() => {});
    } catch {
      // Not offered here.
    }
  };

  const queue = (name: string, value: string | (() => string)) => {
    keep();
    waiting.set(name, value);
    if (timer === undefined) timer = setTimeout(flush, wait);
  };

  return {
    flush,
    queue,
    failed: () => bad,
    subscribe: (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    storage: {
      getItem: (name) => {
        const queued = waiting.get(name);
        if (queued !== undefined) return typeof queued === 'function' ? queued() : queued;
        try {
          return backend()?.getItem(name) ?? null;
        } catch {
          return null;
        }
      },
      setItem: (name, value) => queue(name, value),
      removeItem: (name) => {
        waiting.delete(name);
        try {
          backend()?.removeItem(name);
        } catch {
          // Nothing to remove from.
        }
      },
    },
  };
}

const local = () => {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

export const planStorage = makeSafeStorage(local);
const plain = createJSONStorage(() => planStorage.storage);

/** The same as zustand's JSON storage, except the plans are turned into text once per write, not once per change. */
export const jsonPlanStorage: typeof plain = plain && {
  getItem: plain.getItem,
  removeItem: plain.removeItem,
  setItem: (name, value) => planStorage.queue(name, () => JSON.stringify(value)),
};

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', planStorage.flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') planStorage.flush();
  });
}

/** Whether the last attempt to save the plans in this browser failed. */
export const useSaveFailed = () => useSyncExternalStore(planStorage.subscribe, planStorage.failed, () => false);
