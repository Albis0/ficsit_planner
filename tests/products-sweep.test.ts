import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import loadHighs, { type Highs } from 'highs';
import { data } from '../src/lib/data';
import { buildGraph } from '../src/lib/graph';
import { DEFAULT_EXTRACTION } from '../src/lib/extraction';
import { calcModel } from '../src/lib/model/calc';
import { adaptModel } from '../src/lib/model/calc/adapter';
import { modelFromSolve } from '../src/lib/model/fromAuto';
import { cleanModel } from '../src/lib/model/sanitize';
import { solve } from '../src/lib/solver';
import { layoutEngine } from './helpers/elk';

/**
 * Every product the game makes with the standard recipes, planned on the Auto floor and copied to the Manual one: the
 * copy has to make the same product from the same raw resources. A handful of items is covered in model.test.ts; this
 * is the rest, so a recipe or a belt rule that only breaks one chain can't slip through.
 */

let highs: Highs;
let stopLayout: () => void;
beforeAll(async () => {
  highs = await loadHighs();
  stopLayout = layoutEngine();
});
afterAll(() => stopLayout());

const standard = new Set(data.recipes.filter((r) => r.kind === 'standard').map((r) => r.id));
const everything = new Set(data.recipes.filter((r) => r.kind !== 'power').map((r) => r.id));
const products = [
  ...new Set(data.recipes.filter((r) => standard.has(r.id) && r.kind === 'standard').flatMap((r) => r.outputs.map((o) => o.item))),
]
  .filter((id) => !data.items[id]?.raw)
  .sort();

const RATE = 12;

/** Does the plan send something round in a circle (dark energy feeding the dark matter that makes more of it)? */
function circles(auto: ReturnType<typeof solve>): boolean {
  const next = new Map<string, string[]>();
  for (const e of buildGraph(auto, 9, { dir: 'LR', splitLines: 'each' }).edges) {
    if (e.type === 'flow' && e.source !== e.target) next.set(e.source, [...(next.get(e.source) ?? []), e.target]);
  }
  const state = new Map<string, 1 | 2>();
  const visit = (n: string): boolean => {
    if (state.get(n) === 1) return true;
    if (state.get(n) === 2) return false;
    state.set(n, 1);
    const found = (next.get(n) ?? []).some(visit);
    state.set(n, 2);
    return found;
  };
  return [...next.keys()].some(visit);
}

for (const [label, recipes] of [
  ['standard recipes', standard],
  ['every recipe on', everything],
] as const)
  describe(`Auto and Manual agree on every product, ${label}`, () => {
    test('the list is not empty', () => expect(products.length).toBeGreaterThan(100));

    for (const item of products) {
      test(item, async () => {
        const auto = solve(highs, {
          targets: [{ item, rate: RATE }],
          supplies: [],
          enabledRecipes: recipes,
          resourceCaps: {},
          objective: 'resources',
        });
        // Items only made from something the game doesn't let you make (mycelia, waste, event items): the plan says to bring it.
        if (auto.missing.length) return;
        const m = await modelFromSolve(auto, 9, DEFAULT_EXTRACTION);
        expect(cleanModel(m)).toEqual(m);
        const r = calcModel(highs, m, 9);
        // A plan that goes round in a circle is the steady state; on the Manual floor the loop has to be primed, and it
        // says so rather than quietly making nothing.
        if (circles(auto) && Object.values(r.nodes).some((n) => n.status === 'deadlock')) return;
        const { result } = adaptModel(m, r);
        expect(result.targets.find((t) => t.item === item)?.rate ?? 0).toBeCloseTo(RATE, 3);
        for (const x of auto.raw) expect(result.raw.find((y) => y.item === x.item)?.rate ?? 0).toBeCloseTo(x.rate, 3);
        for (const x of result.raw) expect(auto.raw.some((y) => y.item === x.item)).toBe(true);
      }, 20000);
    }
  });
