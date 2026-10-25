// Builds the hand-built floor of a worked-out factory for the e2e checks, which need a Manual factory with something on
// its floor and have no button to make one from an Auto factory any more.
//
//   bun e2e/make-manual.ts '<json: [["Desc_Motor_C", 10]]>' [separate item ...] > model.json
import loadHighs from 'highs';
import { effectiveExtraction } from '../src/lib/extraction';
import { factoryInput } from '../src/lib/solution';
import { solve } from '../src/lib/solver';
import { newPlan } from '../src/store';
import { modelFromSolve } from '../tests/helpers/fromAuto';
import { layoutEngine } from '../tests/helpers/elk';

const [json, ...separate] = process.argv.slice(2);
const targets = (JSON.parse(json) as [string, number][]).map(([item, rate]) => ({ item, rate }));
const plan = { ...newPlan('Factory 1'), targets, ...(separate.length ? { separate } : {}) };
const input = factoryInput(plan, 9);
if (!input) throw new Error('nothing to make');
const stop = layoutEngine();
const model = await modelFromSolve(solve(await loadHighs(), input), 9, effectiveExtraction(plan.extraction, 9));
process.stdout.write(JSON.stringify(model));
stop();
process.exit(0);
