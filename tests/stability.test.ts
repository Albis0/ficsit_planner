import { describe, expect, test } from 'bun:test';
import { data } from '../src/lib/data';
import { DEFAULT_EXTRACTION } from '../src/lib/extraction';
import { cleanPlan, cleanPowerPlan, cleanSettings } from '../src/lib/sanitize';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import { decode, encode, pack, unpack } from '../src/lib/share';
import { newPlan, newPowerPlan, type Plan } from '../src/store';

/**
 * What goes into a save, a backup or a shared link has to come out the same, and anything that isn't a save at all has
 * to come out as a working plan instead of a crash. Seeds are fixed so a failure can be replayed.
 */

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)];
  return { next, int, pick, chance: (p: number) => next() < p };
}

const items = Object.keys(data.items);
const recipes = data.recipes.map((r) => r.id);

function randomPlan(seed: number): Plan {
  const r = rng(seed);
  const base = newPlan(`Factory ${seed}`);
  const some = <T>(list: T[], n: number) => [...new Set(Array.from({ length: r.int(0, n) }, () => r.pick(list)))];
  const rates = (ids: string[]) => Object.fromEntries(some(ids, 4).map((id) => [id, Number((r.next() * 500).toFixed(2)) + 0.01]));
  return {
    ...base,
    targets: some(items, 5).map((item) => ({ item, rate: Number((r.next() * 100).toFixed(2)) + 0.01 })),
    supplies: some(items, 3).map((item) => ({ item, rate: r.int(1, 400), ...(r.chance(0.3) ? { pinned: true } : {}) })),
    enabled: [...new Set(some(recipes, 120))],
    caps: rates(items),
    fixed: rates(items),
    mods: Object.fromEntries(
      some(recipes, 6).map((id) => [id, { clock: Number((0.01 + r.next() * 2.4).toFixed(2)), sloops: r.int(0, 4) }]),
    ),
    extraction: { ...DEFAULT_EXTRACTION, clock: r.pick([1, 1.5, 2.5]) },
    ...(r.chance(0.4) ? { built: [...new Set(some(recipes, 6))] } : {}),
  } as Plan;
}

// Recipes are a set: a link may list them in another order.
const sorted = (p: Plan): Plan => ({ ...p, enabled: [...p.enabled].sort() });

const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

describe('a factory survives being saved, backed up and shared', () => {
  test('cleaning a good plan changes nothing, and cleaning twice is the same as once', () => {
    for (const seed of SEEDS) {
      const plan = randomPlan(seed);
      const once = cleanPlan(JSON.parse(JSON.stringify(plan)), newPlan('x'));
      expect(once).toEqual(cleanPlan(once, newPlan('x')));
      // Everything a plan holds is kept, the way it was typed.
      expect(once.targets).toEqual(plan.targets.filter((t) => t.rate > 0));
      expect(sorted(once).enabled).toEqual(sorted(plan).enabled);
      expect(once.built ?? []).toEqual(plan.built ?? []);
    }
  });

  test('a shared link reads back to the plan that went into it', async () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const plan = cleanPlan(randomPlan(seed), newPlan('x'));
      const back = cleanPlan(unpack(await decode(await encode(pack(plan)))), newPlan('x'));
      expect(sorted(back)).toEqual(sorted(plan));
    }
  });

  test('junk where a plan should be gives a plan that works, and cleaning it again changes nothing', () => {
    const junk: unknown[] = [
      null,
      undefined,
      0,
      'plan',
      [],
      [1, 2, 3],
      {},
      { targets: 'x', supplies: 5, enabled: 'all', caps: [], fixed: null, mods: 7, extraction: 'high' },
      { targets: [{ item: 'nope', rate: 5 }, { item: items[0], rate: -3 }, { item: items[1], rate: Number.NaN }, null, 4] },
      { enabled: ['nope', 3, null, recipes[0], recipes[0]] },
      { built: ['nope', 4, recipes[0], recipes[0]], model: { v: 99, nodes: 'x' }, floor: 'manual' },
      { mods: { [recipes[0]]: { clock: 99, sloops: -3 }, nope: { clock: 1 } } },
      { name: 'x'.repeat(10_000), id: 'y'.repeat(500) },
    ];
    for (const j of junk) {
      const clean = cleanPlan(j, newPlan('Fallback'));
      expect(clean.targets.every((t) => t.rate > 0 && Number.isFinite(t.rate) && t.item in data.items)).toBe(true);
      expect(clean.enabled.every((id) => recipes.includes(id))).toBe(true);
      expect(clean.name.length).toBeLessThanOrEqual(200);
      expect(cleanPlan(clean, newPlan('Fallback'))).toEqual(clean);
    }
  });

  test('settings and power plans clean the same way', () => {
    const settings = cleanSettings({ ...DEFAULT_SETTINGS, autoBelts: 'square' });
    expect(cleanSettings(settings)).toEqual(settings);
    for (const j of [null, 5, 'x', [], { autoBelts: 'zigzag', theme: 12, cardSize: 'huge', splitLines: {} }]) {
      const s = cleanSettings(j);
      expect(cleanSettings(s)).toEqual(s);
    }
    const power = newPowerPlan('Coal');
    expect(cleanPowerPlan(JSON.parse(JSON.stringify(power)), newPowerPlan('x'))).toEqual(power);
    for (const j of [null, 5, [], { plants: 'x', have: 4, sizeBy: 'lots' }, { plants: [{ id: 'a', generator: 'nope' }, null] }]) {
      const p = cleanPowerPlan(j, newPowerPlan('x'));
      expect(cleanPowerPlan(p, newPowerPlan('x'))).toEqual(p);
    }
  });
});
