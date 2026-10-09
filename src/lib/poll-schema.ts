import { looksAbusive, str } from './feedback-schema';

/**
 * A short answer to a question the app asks, as it travels to the site's own endpoint (functions/api/poll.ts).
 * `act` is what the person did with the question; only an answer carries a rating and a note.
 */
export const POLL_ACTS = ['shown', 'answer', 'later', 'close', 'never'] as const;
export type PollAct = (typeof POLL_ACTS)[number];

/** Where it was asked: the card that opens after trying a part of the app, or the form under Settings › Updates. */
export type PollSrc = 'popup' | 'update';

export interface PollMsg {
  q: string;
  act: PollAct;
  /** 1 to 5 on an answer, 0 otherwise. */
  rating: number;
  note: string;
  src: PollSrc;
  ver: string;
}

export const POLL_NOTE = 600;

/** Cleans what arrived; says what's wrong when it can't be used. */
export function checkPoll(x: unknown): { ok: true; value: PollMsg } | { ok: false; error: string } {
  if (!x || typeof x !== 'object') return { ok: false, error: 'not an object' };
  const m = x as Record<string, unknown>;
  if (typeof m.q !== 'string' || !/^[a-z0-9.-]{1,40}$/.test(m.q)) return { ok: false, error: 'q' };
  const act = POLL_ACTS.find((a) => a === m.act);
  if (!act) return { ok: false, error: 'act' };
  const rating = typeof m.rating === 'number' && Number.isInteger(m.rating) ? m.rating : 0;
  if (act === 'answer' ? rating < 1 || rating > 5 : rating !== 0) return { ok: false, error: 'rating' };
  const src = m.src === 'update' ? 'update' : 'popup';
  const ver = typeof m.ver === 'string' && /^\d+\.\d+\.\d+$/.test(m.ver) ? m.ver : '';
  const note = act === 'answer' ? str(m.note, POLL_NOTE, true) : '';
  // Writing to whatever reads the answers: the rating stays, the words don't.
  const clean = looksAbusive({ title: '', body: note, steps: '', area: '', contact: '' }) ? '' : note;
  return { ok: true, value: { q: m.q, act, rating, note: clean, src, ver } };
}
