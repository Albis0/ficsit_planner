// A hand-built floor for the e2e checks: the worked-out factory for some targets, laid out as a Manual floor. Made once
// by e2e/make-manual.ts (needs bun) and kept in e2e/out/fixtures/.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve('e2e/out/fixtures');

/** targets: [[item, rate], ...]; separate: items on a line of their own. */
export function manualModel(targets, separate = []) {
  const file = path.join(DIR, `${[...targets.map(([i, r]) => `${i}-${r}`), ...separate.map((i) => `line-${i}`)].join('+')}.json`);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(DIR, { recursive: true });
    const out = execFileSync('bun', ['e2e/make-manual.ts', JSON.stringify(targets), ...separate], { maxBuffer: 1 << 28 });
    fs.writeFileSync(file, out);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
