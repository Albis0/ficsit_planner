import { useSyncExternalStore } from 'react';
import { useStore } from '../store';
import type { PollAct, PollMsg, PollSrc } from './poll-schema';

/**
 * Short questions the app asks after someone has tried a part of it. Each is listed here, in the code, so a
 * release says exactly what it asks; nothing is fetched from anywhere. A question comes a couple of minutes after
 * the part was first used, once a session at most, and never twice within a few days of another. The person can
 * answer, put it off, close it (it isn't asked again) or switch the questions off.
 */
type AppState = ReturnType<typeof useStore.getState>;

export interface PollDef {
  id: string;
  question: string;
  /** Seconds after the part was first used before asking. */
  wait: number;
  used: (s: AppState) => boolean;
}

export const POLLS: PollDef[] = [
  {
    id: 'manual',
    question: 'How is building a factory by hand going?',
    wait: 150,
    used: (s) => s.mode === 'factory' && s.plans.find((p) => p.id === s.active)?.floor === 'manual',
  },
  {
    id: 'global',
    question: 'The All page and the shared pool between factories: how is that working for you?',
    wait: 150,
    used: (s) => s.overview || s.plans.some((p) => p.supplies.some((x) => x.from === 'pool')),
  },
];

const KEY = 'ficsit-polls';
/** A question put off comes back no sooner than this, and at most this many times. */
export const LATER_WAIT = 20 * 3600 * 1000;
export const MAX_LATER = 3;
/** After any question is shown, the next waits this long. */
export const GAP = 3 * 24 * 3600 * 1000;

export interface Memory {
  /** The questions are switched off. */
  off?: boolean;
  /** When a question was last shown. */
  last?: number;
  polls: Record<string, { st: 'done' | 'closed' | 'later'; at: number; n: number }>;
}

/** Whether a question may be shown now, going by what was done with it and with the others. */
export function canAsk(mem: Memory, id: string, now: number): boolean {
  if (mem.off) return false;
  if (mem.last !== undefined && now - mem.last < GAP) return false;
  const seen = mem.polls[id];
  if (!seen) return true;
  if (seen.st !== 'later') return false;
  return seen.n < MAX_LATER && now - seen.at >= LATER_WAIT;
}

/** What is remembered after an act on a question. */
export function remember(mem: Memory, id: string, act: PollAct, now: number): Memory {
  if (act === 'shown') return { ...mem, last: now };
  if (act === 'never') return { ...mem, off: true };
  const n = (mem.polls[id]?.n ?? 0) + (act === 'later' ? 1 : 0);
  const st = act === 'answer' ? 'done' : act === 'close' ? 'closed' : 'later';
  return { ...mem, polls: { ...mem.polls, [id]: { st, at: now, n } } };
}

let memory: Memory | undefined;
const load = (): Memory => {
  if (memory) return memory;
  let parsed: Memory | undefined;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (raw && typeof raw === 'object' && raw.polls && typeof raw.polls === 'object') parsed = raw;
  } catch {
    // Without storage nothing is remembered, and the next visit may ask again.
  }
  memory = parsed ?? { polls: {} };
  return memory;
};
const save = (m: Memory) => {
  memory = m;
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    // Kept for this visit only.
  }
  for (const f of listeners) f();
};

const listeners = new Set<() => void>();
const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};

/** Whether the questions are on; the switch under Settings. */
export const pollsOn = () => !load().off;
export const setPollsOn = (on: boolean) => {
  const { off: _, ...rest } = load();
  save(on ? rest : { ...rest, off: true });
};
export const usePollsOn = () => useSyncExternalStore(subscribe, pollsOn, () => true);

const post = (msg: PollMsg) =>
  fetch(`${import.meta.env.BASE_URL}api/poll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(msg),
    keepalive: true,
  }).catch(() => {});

/** Sends what was done with a question. Nothing on a local copy. */
export function sendPoll(q: string, act: PollAct, src: PollSrc, rating = 0, note = '') {
  if (!import.meta.env.PROD && !import.meta.env.VITE_POLL_SEND) return;
  if (['localhost', '127.0.0.1'].includes(location.hostname) && !import.meta.env.VITE_POLL_SEND) return;
  post({ q, act, rating, note, src, ver: __APP_VERSION__ });
}

/** The question on screen, if any. */
let current: PollDef | null = null;
const offer = (p: PollDef | null) => {
  current = p;
  for (const f of listeners) f();
};
export const usePollOffer = () =>
  useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );

/** Does what the person chose on the card on screen. */
export function actOnPoll(act: Exclude<PollAct, 'shown'>, rating = 0, note = '') {
  const p = current;
  if (!p) return;
  save(remember(load(), p.id, act, Date.now()));
  sendPoll(p.id, act, 'popup', rating, note);
  offer(null);
}

/** A version's own form under Settings › Updates: answered once per version. */
export const updateKey = (version: string) => `update-${version}`;
export const updateAnswered = (version: string) => load().polls[updateKey(version)]?.st === 'done';
export const useUpdateAnswered = (version: string) =>
  useSyncExternalStore(
    subscribe,
    () => updateAnswered(version),
    () => false,
  );
export function answerUpdate(version: string, rating: number, note: string) {
  save(remember(load(), updateKey(version), 'answer', Date.now()));
  sendPoll(updateKey(version), 'answer', 'update', rating, note);
}

let started = false;
let askedThisSession = false;

/** Watches what the person uses and, after the wait, asks about it. Called once when the app starts. */
export function startPolls() {
  if (started || typeof window === 'undefined') return;
  started = true;
  if (import.meta.env.DEV && new URLSearchParams(location.search).get('poll') === 'reset') {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Nothing to clear.
    }
    memory = undefined;
  }
  const armed = new Set<string>();
  const ask = (p: PollDef, tries: number) => {
    if (askedThisSession || !canAsk(load(), p.id, Date.now())) return;
    // Not while it is hidden, or a dialog is open: try again shortly, for a while.
    if (document.visibilityState !== 'visible' || useStore.getState().dialog) {
      if (tries < 40) setTimeout(() => ask(p, tries + 1), 30_000);
      return;
    }
    askedThisSession = true;
    save(remember(load(), p.id, 'shown', Date.now()));
    sendPoll(p.id, 'shown', 'popup');
    offer(p);
  };
  const look = (s: AppState) => {
    for (const p of POLLS) {
      if (armed.has(p.id) || !p.used(s) || !canAsk(load(), p.id, Date.now())) continue;
      armed.add(p.id);
      // On a local copy the wait is a few seconds, so it can be tried.
      setTimeout(() => ask(p, 0), (import.meta.env.DEV ? 6 : p.wait) * 1000);
    }
  };
  useStore.subscribe(look);
  look(useStore.getState());
}
