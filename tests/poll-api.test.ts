import { describe, expect, test } from 'bun:test';
import { onRequest } from '../functions/api/poll';

/** POST /api/poll against a stand-in for D1: who is let in, and that a banned sender is turned away without being told. */

const SALT = 'a-secret-long-enough-to-pass';
const ORIGIN = 'https://ficsitplanner.app';
const answer = { q: 'manual', act: 'answer', rating: 4, note: 'nice', src: 'popup', ver: '0.13.36' };

function fakeDb(opts: { banned?: boolean; slot?: boolean; stored?: boolean } = {}) {
  const batches: { sql: string; args: unknown[] }[][] = [];
  const stmt = (sql: string) => {
    const s = { sql, args: [] as unknown[] };
    return Object.assign(s, {
      bind(...a: unknown[]) {
        s.args = a;
        return s;
      },
      async first() {
        return opts.banned ? { x: 1 } : null;
      },
    });
  };
  const rows = (on: boolean) => ({ results: on ? [{ n: 1, id: 1 }] : [] });
  return {
    batches,
    DB: {
      prepare: stmt,
      batch: async (list: { sql: string; args: unknown[] }[]) => {
        batches.push(list);
        return [rows(true), rows(opts.slot ?? true), rows(opts.stored ?? true)];
      },
    },
  };
}

type Over = {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  raw?: string;
  db?: ReturnType<typeof fakeDb>;
  salt?: string;
};
async function send(body: unknown, over: Over = {}) {
  const db = over.db ?? fakeDb();
  const url = over.url ?? `${ORIGIN}/api/poll`;
  const request = new Request(url, {
    method: over.method ?? 'POST',
    headers: { origin: new URL(url).origin, 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', ...over.headers },
    body: over.method === 'GET' ? undefined : (over.raw ?? JSON.stringify(body)),
  });
  const env = { REPORT_SALT: over.salt ?? SALT, DB: db.DB };
  const response = await (onRequest as unknown as (c: unknown) => Promise<Response>)({ request, env });
  return { response, db };
}

describe('who the poll endpoint lets in', () => {
  test('only a POST from the app itself, as JSON', async () => {
    expect((await send(answer, { method: 'GET' })).response.status).toBe(405);
    expect((await send(answer, { headers: { origin: 'https://evil.example' } })).response.status).toBe(403);
    expect((await send(answer, { headers: { 'content-type': 'text/plain' } })).response.status).toBe(415);
  });

  test('a big body, with or without a true length, and a missing secret', async () => {
    expect((await send(answer, { headers: { 'content-length': '9999' } })).response.status).toBe(413);
    expect((await send(null, { raw: 'x'.repeat(5000) })).response.status).toBe(413);
    expect((await send(answer, { salt: 'short' })).response.status).toBe(503);
  });

  test('something that is not an answer is a 400', async () => {
    expect((await send(null, { raw: '{oops' })).response.status).toBe(400);
    expect((await send({ ...answer, rating: 9 })).response.status).toBe(400);
    expect((await send({ ...answer, q: 'Bad Name' })).response.status).toBe(400);
  });
});

describe('what happens to an answer', () => {
  test('it is stored, with the address it came in on named by kind only', async () => {
    const { response, db } = await send(answer);
    expect(response.status).toBe(204);
    const insert = db.batches[0][2];
    expect(insert.sql).toContain('INSERT INTO polls');
    expect(insert.args).toContain('app');
    expect(JSON.stringify(db.batches)).not.toContain('203.0.113.9');
  });

  test('a preview address is told apart from the real one', async () => {
    const { db } = await send(answer, { url: 'https://abc123.ficsit-planner.pages.dev/api/poll' });
    expect(db.batches[0][2].args).toContain('preview');
  });

  test('a banned sender gets the same answer and nothing is kept', async () => {
    const { response, db } = await send(answer, { db: fakeDb({ banned: true }) });
    expect(response.status).toBe(204);
    expect(db.batches).toHaveLength(0);
  });

  test('over the hourly limit, or the day’s total: turned away', async () => {
    expect((await send(answer, { db: fakeDb({ slot: false }) })).response.status).toBe(429);
    expect((await send(answer, { db: fakeDb({ stored: false }) })).response.status).toBe(429);
  });
});
