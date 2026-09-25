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
  'errNoPower',
  'byHave',
  'byWant',
  'byFactories',
  'errStopped',
  'genNote_fuel',
  'genNote_geothermal',
  'genNote_augmenter',
  'areaGraph',
  'areaPower',
  'areaRecipes',
  'areaResources',
  'areaLook',
  'areaOther',
];

const sources = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.tsx?$/.test(e.name) ? [fs.readFileSync(p, 'utf8')] : [];
  });

const code = sources(path.join(import.meta.dir, '..', 'src')).join('\n');
const called = new Set([...code.matchAll(/\bt\('(\w+)'/g)].map((m) => m[1]));
// Keys handed around as values (a table of terms, a component prop) count as used too.
const quoted = new Set([...code.matchAll(/['"](\w+)['"]/g)].map((m) => m[1]).filter((k) => k in en));
const used = new Set([...called, ...quoted]);

// Families of keys built from an id, like t(`cat_${category}`).
const DYNAMIC_PREFIXES = [
  'cat_',
  'catSub_',
  'catLead_',
  'extra_',
  'form_',
  'group_',
  'guide_',
  'guideSub_',
  'guideText_',
  'kind_',
  'pageKind_',
  'stat_',
  'statUnit_',
];

test('every string the UI asks for exists', () => {
  const missing = [...called].filter((k) => !(k in en));
  expect(missing).toEqual([]);
});

test('every string is used somewhere', () => {
  const unused = Object.keys(en).filter((k) => !used.has(k) && !DYNAMIC.includes(k) && !DYNAMIC_PREFIXES.some((p) => k.startsWith(p)));
  expect(unused).toEqual([]);
});

test('every language fills every key', () => {
  for (const { messages } of Object.values(LANGS)) expect(Object.keys(messages).sort()).toEqual(Object.keys(en).sort());
});
