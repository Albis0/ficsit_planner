import { expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { LANGS } from '../src/lib/lang';
import { en } from '../src/locales/en';

// Keys looked up through a variable instead of a literal t('...') call.
const DYNAMIC = [
  'all',
  'standard',
  'alternate',
  'converter',
  'impure',
  'normal',
  'pure',
  'errInfeasible',
  'errPinnedInfeasible',
  'errStopped',
];

const sources = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.tsx?$/.test(e.name) ? [fs.readFileSync(p, 'utf8')] : [];
  });

const code = sources(path.join(import.meta.dir, '..', 'src')).join('\n');
const used = new Set([...code.matchAll(/\bt\('(\w+)'/g)].map((m) => m[1]));

test('every string the UI asks for exists', () => {
  const missing = [...used].filter((k) => !(k in en));
  expect(missing).toEqual([]);
});

test('every string is used somewhere', () => {
  const unused = Object.keys(en).filter((k) => !used.has(k) && !DYNAMIC.includes(k));
  expect(unused).toEqual([]);
});

test('every language fills every key', () => {
  for (const { messages } of Object.values(LANGS)) expect(Object.keys(messages).sort()).toEqual(Object.keys(en).sort());
});
