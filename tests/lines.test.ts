import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import loadHighs, { type Highs } from 'highs';
import { data } from '../src/lib/data';
import { DEFAULT_EXTRACTION } from '../src/lib/extraction';
import { buildGraph } from '../src/lib/graph';
import { calcModel } from '../src/lib/model/calc';
import { adaptModel } from '../src/lib/model/calc/adapter';
import { modelFromSolve } from '../src/lib/model/fromAuto';
import { cleanPlan } from '../src/lib/sanitize';
import { factoryInput } from '../src/lib/solution';
import { type SolveInput, solve } from '../src/lib/solver';
import { newPlan, toggleLine } from '../src/store';
import { layoutEngine } from './helpers/elk';

let highs: Highs;
let stopLayout: () => void;
beforeAll(async () => {
  highs = await loadHighs();
  stopLayout = layoutEngine();
});
afterAll(() => stopLayout());

const standard = () => new Set(data.recipes.filter((r) => r.kind === 'standard').map((r) => r.id));
const input = (patch: Partial<SolveInput>): SolveInput => ({
  targets: [],
  supplies: [],
  enabledRecipes: standard(),
  resourceCaps: {},
  objective: 'resources',
  ...patch,
});
const rate = (list: { item: string; rate: number }[], id: string) => list.find((x) => x.item === id)?.rate ?? 0;
const MOTOR = 'Desc_Motor_C';
const COMPUTER = 'Desc_Computer_C';
const targets = [
  { item: MOTOR, rate: 10 },
  { item: COMPUTER, rate: 5 },
];

describe('separate lines', () => {
  test('a product on a line of its own is made by machines of its own, as if it were planned alone', () => {
    const together = solve(highs, input({ targets }));
    const apart = solve(highs, input({ targets, lines: [COMPUTER] }));
    expect(apart.lines).toHaveLength(2);
    expect(apart.lines?.map((l) => l.items)).toEqual([[MOTOR], [COMPUTER]]);
    const alone = solve(highs, input({ targets: [targets[1]] }));
    expect(apart.lines?.[1].result.raw).toEqual(alone.raw);
    // Every product still comes out at the rate asked for.
    expect(apart.targets.map((t) => [t.item, Math.round(t.rate * 1e6) / 1e6])).toEqual([
      [MOTOR, 10],
      [COMPUTER, 5],
    ]);
    // Recipes scale in a straight line, so what is mined is the same either way; what changes is the machines, each
    // line rounding up on its own (and so never fewer).
    for (const x of together.raw) expect(rate(apart.raw, x.item)).toBeCloseTo(x.rate, 6);
    const built = (r: typeof together) => r.recipes.reduce((s, u) => s + u.built, 0);
    expect(built(apart)).toBeGreaterThanOrEqual(built(together));
  });

  test('the totals are the lines added up, each line still built whole', () => {
    const apart = solve(highs, input({ targets, lines: [MOTOR, COMPUTER] }));
    const [a, b] = apart.lines!.map((l) => l.result);
    expect(apart.power).toBeCloseTo(a.power + b.power, 6);
    for (const x of apart.raw) expect(x.rate).toBeCloseTo(rate(a.raw, x.item) + rate(b.raw, x.item), 6);
    // A recipe both lines use is one entry, with the machines of both.
    const both = apart.recipes.find(
      (u) => a.recipes.some((x) => x.recipe.id === u.recipe.id) && b.recipes.some((x) => x.recipe.id === u.recipe.id),
    )!;
    expect(both).toBeDefined();
    const mine = (r: typeof a) => r.recipes.find((u) => u.recipe.id === both.recipe.id)!;
    expect(both.built).toBe(mine(a).built + mine(b).built);
    expect(both.count).toBeCloseTo(mine(a).count + mine(b).count, 6);
    expect(both.clocks).toHaveLength(both.built);
  });

  test('one product alone, or none marked, is no different from before', () => {
    const plain = solve(highs, input({ targets }));
    expect(solve(highs, input({ targets, lines: [] })).lines).toBeUndefined();
    expect(solve(highs, input({ targets: [targets[0]], lines: [MOTOR] })).lines).toBeUndefined();
    expect(solve(highs, input({ targets, lines: ['Desc_Wire_C'] })).raw).toEqual(plain.raw);
  });

  test('the lines share the resource limits: what one mines is gone for the next', () => {
    const need = solve(highs, input({ targets })).raw.find((x) => x.item === 'Desc_OreIron_C')!.rate;
    expect(() => solve(highs, input({ targets, lines: [COMPUTER], resourceCaps: { Desc_OreIron_C: need * 0.99 } }))).toThrow();
    expect(solve(highs, input({ targets, lines: [COMPUTER], resourceCaps: { Desc_OreIron_C: need * 1.01 } })).lines).toHaveLength(2);
  });

  test('the factory graph stands each line apart: ids of their own, a tag over each, no card on another', () => {
    const apart = solve(highs, input({ targets, lines: [COMPUTER] }));
    for (const dir of ['LR', 'TB'] as const) {
      const g = buildGraph(apart, 9, { dir });
      expect(g.nodes.filter((n) => n.type === 'line')).toHaveLength(2);
      const ids = new Set(g.nodes.map((n) => n.id));
      expect(ids.size).toBe(g.nodes.length);
      for (const e of g.edges) expect(ids.has(e.source) && ids.has(e.target)).toBe(true);
      expect(g.nodes.some((n) => n.id.startsWith('L0:recipe:')) && g.nodes.some((n) => n.id.startsWith('L1:recipe:'))).toBe(true);
      const box = (prefix: string) => {
        const list = g.nodes.filter((n) => n.id.startsWith(prefix));
        return {
          lo: Math.min(...list.map((n) => (dir === 'LR' ? n.position.y : n.position.x))),
          hi: Math.max(...list.map((n) => (dir === 'LR' ? n.position.y + (n.height ?? 0) : n.position.x + (n.width ?? 0)))),
        };
      };
      const [a, b] = [box('L0:'), box('L1:')];
      expect(a.hi).toBeLessThan(b.lo);
    }
  });

  test('a plan hands the solver only the lines that are still products', () => {
    const plan = { ...newPlan('F'), targets, separate: [COMPUTER, 'Desc_Wire_C'] };
    expect(factoryInput(plan, 9)?.lines).toEqual([COMPUTER, 'Desc_Wire_C']);
    expect(factoryInput({ ...plan, separate: ['Desc_Wire_C'] }, 9)?.lines).toBeUndefined();
    expect(factoryInput({ ...plan, targets: [targets[0]], separate: [MOTOR] }, 9)?.lines).toBeUndefined();
  });

  test('saves keep the lines of products still there, and the switch toggles one', () => {
    const plan = { ...newPlan('F'), targets, separate: [COMPUTER, 'Desc_Wire_C', COMPUTER, 4] as unknown as string[] };
    expect(cleanPlan(JSON.parse(JSON.stringify(plan)), newPlan('x')).separate).toEqual([COMPUTER]);
    const on = toggleLine(MOTOR)({ ...newPlan('F'), targets, separate: [COMPUTER] });
    expect(on.separate).toEqual([COMPUTER, MOTOR]);
    expect(toggleLine(COMPUTER)({ ...newPlan('F'), targets, separate: [COMPUTER] }).separate).toBeUndefined();
  });

  test('turned into a hand-built floor, every line still makes its product from its own miners', async () => {
    const apart = solve(highs, input({ targets, lines: [MOTOR, COMPUTER] }));
    const m = await modelFromSolve(apart, 9, DEFAULT_EXTRACTION);
    const { result } = adaptModel(m, calcModel(highs, m, 9));
    expect(rate(result.targets, MOTOR)).toBeCloseTo(10, 4);
    expect(rate(result.targets, COMPUTER)).toBeCloseTo(5, 4);
    for (const x of apart.raw) expect(rate(result.raw, x.item)).toBeCloseTo(x.rate, 3);
  });
});
