import { beforeAll, describe, expect, test } from 'bun:test';
import loadHighs, { type Highs } from 'highs';
import { data } from '../src/lib/data';
import { buildGroups, groupsLabel } from '../src/lib/groups';
import { type SolveInput, solve } from '../src/lib/solver';

let highs: Highs;
beforeAll(async () => {
  highs = await loadHighs();
});

const standard = () => new Set(data.recipes.filter((r) => r.kind === 'standard').map((r) => r.id));
const plan = (patch: Partial<SolveInput>) =>
  solve(highs, { targets: [], supplies: [], enabledRecipes: standard(), resourceCaps: {}, objective: 'resources', ...patch });
const use = (r: ReturnType<typeof plan>, id: string) => r.recipes.find((u) => u.recipe.id === id)!;

describe('build groups', () => {
  test('1,000 m³/min of rocket fuel on 600 m³/min pipes is built as 6 + 4 blenders', () => {
    const r = plan({ targets: [{ item: 'Desc_RocketFuel_C', rate: 1000 }] });
    const g = buildGroups(use(r, 'Recipe_RocketFuel_C'), 9);
    expect(g?.sizes).toEqual([6, 4]);
    expect(g?.transport.rate).toBe(600);
    expect(groupsLabel(g!.sizes)).toBe('6 + 4');
  });

  test('a line whose belts all fit needs no split', () => {
    const r = plan({ targets: [{ item: 'Desc_IronPlate_C', rate: 60 }] });
    expect(buildGroups(use(r, 'Recipe_IronPlate_C'), 9)).toBeUndefined();
  });

  test('slower belts at a low tier split a line that fits later', () => {
    const r = plan({ targets: [{ item: 'Desc_IronPlate_C', rate: 300 }] });
    const plates = use(r, 'Recipe_IronPlate_C');
    // 450 ingots in: at tier 2 one Mk.2 belt (120/min) feeds only 4 constructors.
    const low = buildGroups(plates, 2);
    expect(low?.sizes.reduce((a, b) => a + b, 0)).toBe(plates.built);
    expect(low!.sizes.length).toBeGreaterThan(1);
    expect(buildGroups(plates, 9)).toBeUndefined();
  });

  test('labels group equal sizes', () => {
    expect(groupsLabel([6, 6, 6, 2])).toBe('3 × 6 + 2');
  });
});
