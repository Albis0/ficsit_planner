// POST /api/poll: an answer to a short question the app asked, kept in the site's own D1 database.
import { checkPoll } from '../../src/lib/poll-schema';
import { banKey, senderKeys } from './report';

interface Env {
  DB: D1Database;
  REPORT_SALT?: string;
}

/** Rows one sender may add per clock hour, and everyone per day. */
const PER_HOUR = 30;
const PER_DAY = 5000;
const MAX_BYTES = 4000;

const done = () => new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
const bad = (error: string, status: number) =>
  new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** The address a request came in on. */
const hostOf = (request: Request) => {
  const h = new URL(request.url).hostname;
  return h === 'ficsitplanner.app' || h === 'www.ficsitplanner.app'
    ? 'app'
    : h === 'ficsit-planner.pages.dev'
      ? 'dev'
      : h.endsWith('.pages.dev')
        ? 'preview'
        : 'other';
};

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== 'POST') return bad('method', 405);
  // Only the app itself posts here; browsers always send Origin on a POST.
  if (request.headers.get('origin') !== new URL(request.url).origin) return bad('origin', 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return bad('type', 415);
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BYTES) return bad('size', 413);
  const salt = env.REPORT_SALT ?? '';
  if (salt.length < 16) return bad('setup', 503);

  let parsed: unknown;
  try {
    parsed = JSON.parse((await request.text()).slice(0, MAX_BYTES));
  } catch {
    return bad('json', 400);
  }
  const checked = checkPoll(parsed);
  if (!checked.ok) return bad(checked.error, 400);
  const p = checked.value;

  // A sender turned away from the report form is turned away here too, without being told.
  const who = await banKey(request, salt);
  const banned = await env.DB.prepare("SELECT 1 AS x FROM bans WHERE who = ? AND until > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')")
    .bind(who)
    .first();
  if (banned) return done();

  // The hourly limit takes its own counter, apart from the report form's.
  const hour = new Date().toISOString().slice(0, 13);
  const { near } = await senderKeys(request, `${salt}|poll`, hour);
  const tag = crypto.randomUUID();
  const [, slot, stored] = await env.DB.batch([
    env.DB.prepare('DELETE FROM hits WHERE hour <> ?1').bind(hour),
    env.DB.prepare(
      `INSERT INTO hits (sender, hour, n, last) VALUES (?1, ?2, 1, ?3)
       ON CONFLICT (sender) DO UPDATE SET n = n + 1, last = ?3 WHERE n < ?4 RETURNING n`,
    ).bind(near, hour, tag, PER_HOUR),
    env.DB.prepare(
      `INSERT INTO polls (q, act, rating, note, src, host, ver)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
       WHERE EXISTS (SELECT 1 FROM hits WHERE sender = ?8 AND last = ?9)
         AND (SELECT COUNT(*) FROM polls WHERE created > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 day')) < ?10
       RETURNING id`,
    ).bind(p.q, p.act, p.rating, p.note, p.src, hostOf(request), p.ver, near, tag, PER_DAY),
  ]);
  if (slot.results.length === 0) return bad('rate', 429);
  return stored.results.length ? done() : bad('busy', 429);
};
