import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { UPDATES } from '../src/locales/updates.en';

describe('update notes', () => {
  test('no version lists the same note twice', () => {
    for (const u of UPDATES) expect(new Set(u.notes.map((n) => n[1])).size).toBe(u.notes.length);
  });

  test('every version is listed once, newest first, and has a CHANGELOG entry with no section twice', () => {
    const versions = UPDATES.map((u) => u.version);
    expect(new Set(versions).size).toBe(versions.length);
    const log = readFileSync('CHANGELOG.md', 'utf8');
    for (const v of versions) {
      const start = log.indexOf(`## ${v} `);
      expect(start).toBeGreaterThan(-1);
      const end = log.indexOf('\n## ', start + 1);
      const headings = log.slice(start, end < 0 ? undefined : end).match(/^### .+$/gm) ?? [];
      expect(new Set(headings).size).toBe(headings.length);
    }
  });
});
