// POST /api/report: feedback from the app's report dialog, stored in the site's own D1 database.
// Read it with `bun run reports` (scripts/reports.mjs).
import { checkFeedback, LIMITS } from '../../src/lib/feedback-schema';

interface Env {
  DB: D1Database;
  /** Secret mixed into the sender hash so it can't be turned back into an address. */
  REPORT_SALT?: string;
}

/** Reports one sender may send per clock hour, a whole IPv6 site (/48) per clock hour, and everyone per day. */
const PER_HOUR = 6;
const PER_SITE = 20;
const PER_DAY = 300;
/**
 * Largest body accepted, in bytes: every field at its limit, typed text at up to 3 bytes a character,
 * the attached plan with its quotes escaped, plus room for the JSON around them.
 */
const TEXT = LIMITS.title + LIMITS.body + LIMITS.steps + LIMITS.area + LIMITS.contact + LIMITS.meta;
const MAX_BYTES = 2 * LIMITS.plan + 3 * TEXT + 8_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/**
 * Who's asking, for the hourly limits only. The address (an IPv6 one cut to its /64, which one home
 * or phone gets whole, and to its /48 for the wider limit) is hashed with the secret and the current
 * hour. The hash sits in `hits` as a counter for that hour, with no finer time, and is never stored
 * with a report; the secret was generated on upload and never shown, so nobody can turn it back.
 */
async function senderKeys(request: Request, salt: string, hour: string): Promise<{ near: string; site: string }> {
  const ip = request.headers.get('cf-connecting-ip') ?? '';
  const v6 = ip.includes(':');
  const hash = async (scope: string, part: string) => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${scope}|${salt}|${hour}|${part}`));
    return [...new Uint8Array(digest)]
      .slice(0, 16)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  };
  return { near: await hash('near', v6 ? ipv6Prefix(ip, 4) : ip), site: await hash('site', v6 ? ipv6Prefix(ip, 3) : ip) };
}

/** "2001:db8::1", 4 groups -> "2001:0db8:0000:0000", the first 64 bits. */
function ipv6Prefix(ip: string, groups: number): string {
  const [head, tail = ''] = ip.split('%')[0].split('::');
  const a = head ? head.split(':') : [];
  const b = tail ? tail.split(':') : [];
  const full = [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b];
  return full
    .slice(0, groups)
    .map((h) => h.padStart(4, '0'))
    .join(':');
}

/** The body as text, or undefined once it passes `max` bytes, without reading the rest. */
async function readBody(request: Request, max: number): Promise<string | undefined> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

let warned = false;

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  // Only the app itself posts here; browsers always send Origin on a POST.
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'origin' }, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return json({ error: 'type' }, 415);
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BYTES) return json({ error: 'size' }, 413);
  // Without the secret the sender hash could be reversed from the table, so take nothing in.
  const salt = env.REPORT_SALT ?? '';
  if (salt.length < 16) {
    if (!warned) console.error('REPORT_SALT is missing or too short; reports are turned away until it is set.');
    warned = true;
    return json({ error: 'setup' }, 503);
  }

  const text = await readBody(request, MAX_BYTES);
  if (text === undefined) return json({ error: 'size' }, 413);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return json({ error: 'json' }, 400);
  }
  const checked = checkFeedback(parsed);
  if (!checked.ok) return json({ error: checked.error }, 400);
  const f = checked.value;

  // A filled honeypot is a bot: answer like a stored report, so it can't tell, and keep nothing.
  if (f.website) {
    const next = await env.DB.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS id FROM reports').first<{ id: number }>();
    return json({ ok: true, id: next?.id ?? 1 }, 201);
  }

  const hour = new Date().toISOString().slice(0, 13);
  const { near, site } = await senderKeys(request, salt, hour);
  // A random tag for this request: each step only goes ahead if the one before it took a slot under it.
  const tag = crypto.randomUUID();
  const took = (key: string) => `EXISTS (SELECT 1 FROM hits WHERE sender = ${key} AND last = ?4)`;
  const slot = (key: string, limit: string, after?: string) =>
    `INSERT INTO hits (sender, hour, n, last) SELECT ${key}, ?3, 1, ?4 WHERE ${after ? took(after) : 'true'}
     ON CONFLICT (sender) DO UPDATE SET n = n + 1, last = ?4 WHERE n < ${limit} RETURNING n`;
  // One batch is one transaction: forget other hours, take the sender's slot, then the site's (so a
  // sender over their own limit doesn't use up their neighbours'), then store the report only if both
  // were free and today's total allows it. Parallel requests can't slip past.
  const [, nearSlot, siteSlot, stored] = await env.DB.batch([
    env.DB.prepare('DELETE FROM hits WHERE hour <> ?1').bind(hour),
    env.DB.prepare(slot('?1', '?2')).bind(near, PER_HOUR, hour, tag),
    env.DB.prepare(slot('?1', '?2', '?5')).bind(site, PER_SITE, hour, tag, near),
    env.DB.prepare(
      `INSERT INTO reports (kind, title, body, steps, area, contact, plan, meta)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
       WHERE EXISTS (SELECT 1 FROM hits WHERE sender = ?9 AND last = ?10)
         AND (SELECT COUNT(*) FROM reports WHERE created > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 day')) < ?11
       RETURNING id`,
    ).bind(f.kind, f.title, f.body, f.steps, f.area, f.contact, f.plan ?? null, JSON.stringify(f.meta), site, tag, PER_DAY),
  ]);
  if (siteSlot.results.length === 0 || nearSlot.results.length === 0) return json({ error: 'rate' }, 429);
  const id = (stored.results[0] as { id: number } | undefined)?.id;
  if (id === undefined) return json({ error: 'busy' }, 429);
  return json({ ok: true, id }, 201);
};
