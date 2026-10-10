import { describe, expect, test } from 'bun:test';
import { readBody } from '../functions/api/report';

const post = (body: string) => new Request('https://ficsitplanner.app/api/poll', { method: 'POST', body });

describe('reading a request body with a size limit', () => {
  test('a body under the limit comes back whole', async () => {
    expect(await readBody(post('{"q":"manual"}'), 100)).toBe('{"q":"manual"}');
  });

  test('a body over the limit is turned away', async () => {
    expect(await readBody(post('a'.repeat(101)), 100)).toBeUndefined();
  });

  test('a body of exactly the limit is taken', async () => {
    expect((await readBody(post('a'.repeat(100)), 100))?.length).toBe(100);
  });
});
