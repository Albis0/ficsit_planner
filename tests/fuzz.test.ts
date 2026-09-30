import { beforeAll, describe, expect, test } from 'bun:test';
import loadHighs, { type Highs } from 'highs';
import { craftableItems, data, rawItems, recipeUnlocked } from '../src/lib/data';
import { DEFAULT_EXTRACTION, extractionPowerPerUnit, MINERS, PURITIES, planExtraction } from '../src/lib/extraction';
import { buildGraph } from '../src/lib/graph';
import { PLANT_OPTIONS, type Plant, plantSize, plantValid } from '../src/lib/power';
import {
  autoAssign,
  type RecipeMod,
  SolverError,
  type SolveInput,
  type SolveResult,
  shardsFor,
  sloopSlots,
  solve,
} from '../src/lib/solver';

/**
 * Thousands of made-up plans, each from a fixed seed so a failure can be replayed: random products and
 * amounts, alternates, tiers, limits, items on hand, pinned inputs, clocks, somersloops and power plants.
 * Every answer has to add up: no broken numbers, every item's belts balance, and no two cards on the floor
 * sit on top of each other. A seed that ever fails goes into SEEDS below for good.
 */

let highs: Highs;
beforeAll(async () => {
  highs = await loadHighs();
});

/** Small seeded generator (mulberry32): the same seed always gives the same plan. */
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
  const chance = (p: number) => next() < p;
  // Amounts people type: whole numbers mostly, a few odd decimals, now and then something tiny or huge.
  const amount = () =>
    chance(0.1)
      ? Number((next() * 0.5).toFixed(3)) + 0.001
      : chance(0.1)
        ? int(500, 5000)
        : chance(0.5)
          ? int(1, 60)
          : Number((next() * 120).toFixed(2)) + 0.01;
  return { next, int, pick, chance, amount };
}

const alternates = data.recipes.filter((r) => r.kind === 'alternate');

function randomInput(seed: number): SolveInput {
  const r = rng(seed);
  const tier = r.int(0, 9);
  const usable = data.recipes.filter((x) => recipeUnlocked(x, tier));
  const enabled = new Set(usable.filter((x) => x.kind === 'standard').map((x) => x.id));
  // Some alternates, sometimes all of them, sometimes a standard recipe switched off.
  const altShare = r.chance(0.2) ? 1 : r.chance(0.5) ? r.next() * 0.3 : 0;
  for (const a of alternates) if (recipeUnlocked(a, tier) && r.next() < altShare) enabled.add(a.id);
  if (r.chance(0.2)) for (let i = r.int(1, 5); i > 0; i--) enabled.delete(r.pick(usable).id);

  const products = craftableItems.map((i) => i.id);
  const targets = Array.from({ length: r.int(1, 4) }, () => ({ item: r.pick(products), rate: r.amount() }));
  const supplies = r.chance(0.25) ? Array.from({ length: r.int(1, 3) }, () => ({ item: r.pick(products), rate: r.amount() })) : [];
  const resourceCaps: Record<string, number> = {};
  if (r.chance(0.25)) for (let i = r.int(1, 3); i > 0; i--) resourceCaps[r.pick(rawItems).id] = r.int(0, 3000);
  const fixed: Record<string, number> = {};
  if (r.chance(0.1)) fixed[r.pick(rawItems).id] = r.int(1, 1200);

  const mods: Record<string, RecipeMod> = {};
  if (r.chance(0.4)) {
    const list = [...enabled].map((id) => data.recipes.find((x) => x.id === id)!).filter((x) => x.kind !== 'converter');
    for (let i = r.int(1, 8); i > 0; i--) {
      const rec = r.pick(list);
      const clock = r.chance(0.3) ? 1 : Number((0.01 + r.next() * 2.49).toFixed(4));
      mods[rec.id] = { clock, sloops: r.chance(0.5) ? 0 : r.next() * sloopSlots(rec) };
    }
  }

  let power: SolveInput['power'];
  if (r.chance(0.15)) {
    const plants: Plant[] = Array.from({ length: r.int(1, 3) }, (_, i) => {
      const o = r.pick(PLANT_OPTIONS);
      const by = r.pick(['auto', 'count', 'power'] as const);
      return {
        id: `p${i}`,
        generator: o.generator.id,
        fuel: o.fuel,
        by,
        amount: by === 'count' ? r.int(0, 20) : r.int(0, 5000),
        clock: r.chance(0.5) ? 1 : Number((0.01 + r.next() * 2.49).toFixed(3)),
        purity: r.pick(PURITIES),
        fed: r.chance(0.5),
      };
    });
    power = {
      plants,
      demand: r.int(0, 3000),
      headroom: r.chance(0.5) ? 0 : r.next() * 0.3,
      extraction: extractionPowerPerUnit({ ...DEFAULT_EXTRACTION, miner: r.pick(MINERS).id }),
      ownLoad: r.chance(0.8),
      maximize: r.chance(0.2),
    };
  }

  return {
    targets: power && r.chance(0.5) ? [] : targets,
    supplies,
    enabledRecipes: enabled,
    resourceCaps,
    objective: r.chance(0.3) ? 'power' : 'resources',
    mods,
    fixed,
    power,
  };
}

const finite = (x: number, what: string) => {
  if (!Number.isFinite(x) || x < -1e-9) throw new Error(`${what} is ${x}`);
};

/** Everything a plan shows has to be a real, non-negative number, and each item's flows must balance. */
function checkResult(r: SolveResult, input: SolveInput) {
  for (const list of [r.raw, r.supplies, r.targets, r.surplus, r.missing]) for (const x of list) finite(x.rate, x.item);
  finite(r.power, 'power');
  finite(r.scale, 'scale');
  for (const u of r.recipes) {
    const id = u.recipe.id;
    finite(u.count, `${id} count`);
    finite(u.power, `${id} power`);
    if (!Number.isInteger(u.built) || u.built < 1 || u.built < u.count - 1e-6) throw new Error(`${id} builds ${u.built} for ${u.count}`);
    if (u.clocks.length !== u.built) throw new Error(`${id} has ${u.clocks.length} clocks for ${u.built} machines`);
    for (const c of u.clocks) if (!(c > 0 && c <= 2.5 + 1e-6)) throw new Error(`${id} runs at ${c}`);
    if (u.shards !== u.clocks.reduce((s, c) => s + shardsFor(c), 0)) throw new Error(`${id} shard count`);
    if (u.sloops > u.built * sloopSlots(u.recipe)) throw new Error(`${id} has ${u.sloops} sloops in ${u.built} machines`);
    for (const s of [...u.inputs, ...u.outputs]) finite(s.rate, `${id} ${s.item}`);
  }

  const net = new Map<string, number>();
  const add = (id: string, x: number) => net.set(id, (net.get(id) ?? 0) + x);
  let scale = 1;
  for (const u of r.recipes) {
    for (const o of u.outputs) add(o.item, o.rate);
    for (const i of u.inputs) add(i.item, -i.rate);
    for (const s of [...u.inputs, ...u.outputs]) scale = Math.max(scale, s.rate);
  }
  for (const list of [r.raw, r.supplies, r.missing]) for (const x of list) add(x.item, x.rate);
  for (const t of r.targets) add(t.item, -t.rate);
  const surplus = new Map(r.surplus.map((s) => [s.item, s.rate]));
  const tol = 1e-4 + 1e-6 * scale;
  for (const [item, x] of net) {
    if (x < -tol) throw new Error(`${item} short by ${-x}`);
    const shown = surplus.get(item) ?? 0;
    if (Math.abs(x - shown) > Math.max(tol, 2e-4)) throw new Error(`${item} leftover ${x} but shows ${shown}`);
  }

  // Targets keep the ratio they were asked for.
  const want = new Map<string, number>();
  for (const t of input.targets) want.set(t.item, (want.get(t.item) ?? 0) + t.rate);
  for (const t of r.targets)
    if (Math.abs(t.rate - (want.get(t.item) ?? 0) * r.scale) > 1e-6 * (1 + t.rate)) throw new Error(`${t.item} target`);

  // Missing items are only ones the enabled recipes can't make from raw resources and what's on hand.
  const enabled = data.recipes.filter((x) => input.enabledRecipes.has(x.id));
  const makes = new Set<string>([...rawItems.map((i) => i.id), ...input.supplies.map((x) => x.item)]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const x of enabled)
      if (x.inputs.every((i) => makes.has(i.item)))
        for (const o of x.outputs)
          if (!makes.has(o.item)) {
            makes.add(o.item);
            grew = true;
          }
  }
  for (const m of r.missing) {
    const maker = enabled.find((x) => x.outputs.some((o) => o.item === m.item) && x.inputs.every((i) => makes.has(i.item)));
    if (maker) throw new Error(`${m.item} shown missing but ${maker.id} makes it`);
  }

  // A plant sized to fit covers the load it was given plus its own machines and miners, with the spare kept on top.
  const power = input.power;
  if (power && r.grid && !power.maximize && power.plants.some((p) => plantValid(p) && plantSize(p) === 'auto')) {
    const own =
      power.ownLoad === false
        ? 0
        : r.recipes.reduce((s, u) => s + u.power, 0) + r.raw.reduce((s, x) => s + (power.extraction[x.item] ?? 0) * x.rate, 0);
    const need = (1 + Math.max(0, power.headroom)) * (power.demand + own);
    if (r.grid.generation < need - 1e-3 * (1 + need)) throw new Error(`grid makes ${r.grid.generation} MW for ${need}`);
  }

  const extraction = planExtraction(r.raw, DEFAULT_EXTRACTION);
  for (const e of extraction) {
    finite(e.power, `${e.item} extraction power`);
    if (!Number.isInteger(e.built)) throw new Error(`${e.item} extractors ${e.built}`);
  }
}

/** No two cards on the floor overlap. */
function checkGraph(r: SolveResult, seed: number) {
  const dir = seed % 2 ? 'LR' : 'TB';
  const { nodes } = buildGraph(r, 9, { dir, scale: 1 + (seed % 3) * 0.25, text: 1 + (seed % 5) * 0.125 });
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (const x of [a.position.x, a.position.y, a.width ?? 0, a.height ?? 0]) finite(Math.abs(x), `${a.id} box`);
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      const apart =
        a.position.x + a.width! <= b.position.x + 0.5 ||
        b.position.x + b.width! <= a.position.x + 0.5 ||
        a.position.y + a.height! <= b.position.y + 0.5 ||
        b.position.y + b.height! <= a.position.y + 0.5;
      if (!apart) throw new Error(`${a.id} overlaps ${b.id}`);
    }
  }
}

function run(seed: number): 'ok' | 'error' {
  const input = randomInput(seed);
  let r: SolveResult;
  try {
    r = solve(highs, input);
  } catch (e) {
    // A plan that can't be met is fine as long as it says why in a way the screen can show.
    if (e instanceof SolverError) return 'error';
    throw new Error(`seed ${seed}: ${(e as Error).message}`);
  }
  try {
    checkResult(r, input);
    if (seed % 8 === 0 && r.recipes.length < 80) checkGraph(r, seed);
    // Auto placement never hands out more somersloops or shards than the stock.
    if (seed % 16 === 1 && !input.power && !Object.keys(input.fixed ?? {}).length) {
      const stock = { sloops: seed % 7, shards: seed % 11 };
      const mods = autoAssign(highs, { ...input, mods: {} }, stock, seed % 2 === 1);
      const placed = solve(highs, { ...input, mods });
      checkResult(placed, input);
      if (placed.sloops > stock.sloops || placed.shards > stock.shards)
        throw new Error(`auto placed ${placed.sloops}/${placed.shards} of ${stock.sloops}/${stock.shards}`);
    }
  } catch (e) {
    throw new Error(`seed ${seed}: ${(e as Error).message}`);
  }
  return 'ok';
}

/**
 * Seeds that once broke something. Each stays here as its own test.
 * 38, 206, 409: compacted coal, rocket fuel or ionized fuel before the blender, where the only enabled recipes
 * loop back on themselves, had no answer at all instead of saying to bring them in.
 * 1701: a ficsonium plant needing more plutonium waste than a set-size plutonium plant leaves had no answer either.
 */
const SEEDS: number[] = [38, 206, 409, 1701];

describe('random plans', () => {
  const PLANS = Number(process.env.FUZZ_PLANS ?? 2000);
  const BATCH = 100;
  for (let start = 0; start < PLANS; start += BATCH) {
    test(`plans ${start + 1}–${start + BATCH}`, () => {
      const tally = { ok: 0, error: 0 };
      for (let seed = start + 1; seed <= start + BATCH; seed++) tally[run(seed)]++;
      // Most made-up plans should solve; if nearly all fail, the generator stopped testing anything.
      expect(tally.ok).toBeGreaterThan(BATCH * 0.3);
    }, 120_000);
  }

  for (const seed of SEEDS) test(`seed ${seed}`, () => expect(['ok', 'error']).toContain(run(seed)), 60_000);
});
