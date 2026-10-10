import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createJSONStorage } from 'zustand/middleware';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { makeSafeStorage } from '../src/lib/safeStorage';

/** A browser store that accepts `room` writes, then throws like a full one. */
function fake(room = Number.POSITIVE_INFINITY) {
  const data = new Map<string, string>();
  let writes = 0;
  const s = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (writes >= room) throw new DOMException('full', 'QuotaExceededError');
      writes++;
      data.set(k, v);
    },
    removeItem: (k: string) => void data.delete(k),
  } as unknown as Storage;
  return { s, data, writes: () => writes, open: () => (room = Number.POSITIVE_INFINITY) };
}

describe('the old behaviour: a full store breaks the action', () => {
  test('plain zustand persist throws out of set() when the browser store is full', () => {
    const f = fake(0);
    const store = create<{ n: number; bump: () => void }>()(
      persist((set, get) => ({ n: 0, bump: () => set({ n: get().n + 1 }) }), {
        name: 'x',
        storage: createJSONStorage(() => f.s),
      }),
    );
    expect(() => store.getState().bump()).toThrow();
  });
});

describe('the safe store', () => {
  let timers: Array<() => void> = [];
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  beforeEach(() => {
    timers = [];
    // @ts-expect-error a fake clock: timers run only when the test says so
    globalThis.setTimeout = (fn: () => void) => timers.push(fn);
    // @ts-expect-error see above
    globalThis.clearTimeout = (id: number) => {
      timers[id - 1] = () => {};
    };
  });
  afterEach(() => {
    globalThis.setTimeout = realSet;
    globalThis.clearTimeout = realClear;
  });
  const tick = () => {
    const run = timers;
    timers = [];
    for (const t of run) t();
  };

  test('a full browser store no longer throws out of a store action, and the failure is flagged', () => {
    const f = fake(0);
    const safe = makeSafeStorage(() => f.s);
    const store = create<{ n: number; bump: () => void }>()(
      persist((set, get) => ({ n: 0, bump: () => set({ n: get().n + 1 }) }), {
        name: 'x',
        storage: createJSONStorage(() => safe.storage),
      }),
    );
    expect(() => store.getState().bump()).not.toThrow();
    expect(store.getState().n).toBe(1);
    expect(safe.failed()).toBe(false);
    safe.flush();
    expect(safe.failed()).toBe(true);
  });

  test('the flag clears once a write goes through again, and listeners hear both changes', () => {
    const f = fake(0);
    const safe = makeSafeStorage(() => f.s);
    let heard = 0;
    safe.subscribe(() => heard++);
    safe.storage.setItem('a', '1');
    safe.flush();
    expect(safe.failed()).toBe(true);
    f.open();
    safe.storage.setItem('a', '2');
    safe.flush();
    expect(safe.failed()).toBe(false);
    expect(f.data.get('a')).toBe('2');
    expect(heard).toBe(2);
  });

  test('a burst of writes is saved once, with the last value', () => {
    const f = fake();
    const safe = makeSafeStorage(() => f.s);
    for (let i = 1; i <= 20; i++) safe.storage.setItem('a', String(i));
    expect(f.writes()).toBe(0);
    expect(safe.storage.getItem('a')).toBe('20');
    tick();
    expect(f.writes()).toBe(1);
    expect(f.data.get('a')).toBe('20');
  });

  test('flush writes at once, and nothing is left for the timer', () => {
    const f = fake();
    const safe = makeSafeStorage(() => f.s);
    safe.storage.setItem('a', 'x');
    safe.flush();
    expect(f.data.get('a')).toBe('x');
    tick();
    expect(f.writes()).toBe(1);
  });

  test('a browser with no store at all does not throw', () => {
    const safe = makeSafeStorage(() => undefined);
    expect(() => {
      safe.storage.setItem('a', 'x');
      safe.flush();
      safe.storage.removeItem('a');
    }).not.toThrow();
    expect(safe.storage.getItem('b')).toBeNull();
  });

  test('a store that throws on read reads as empty', () => {
    const safe = makeSafeStorage(() => {
      throw new Error('blocked');
    });
    expect(safe.storage.getItem('a')).toBeNull();
  });
});
