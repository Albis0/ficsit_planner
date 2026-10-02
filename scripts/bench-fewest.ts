// Fewest buildings, measured: twelve products with every alternate on, planned by rarity, the old way (machines
// only, tidied) and the new way (miners counted, kinds weighed). Prints buildings, raw kinds, recipes and time.
// Run: bun scripts/bench-fewest.ts
import loadHighs from 'highs';
import { data } from '../src/lib/data';
import { DEFAULT_EXTRACTION, extractorCost, planExtraction } from '../src/lib/extraction';
import { fewerLines, fewestBuildings, type SolveInput, type SolveResult, solve } from '../src/lib/solver';

const PRODUCTS: [string, number][] = [
  ['Desc_IronPlateReinforced_C', 10],
  ['Desc_ModularFrame_C', 10],
  ['Desc_Rotor_C', 10],
  ['Desc_Stator_C', 10],
  ['Desc_Motor_C', 10],
  ['Desc_CircuitBoard_C', 10],
  ['Desc_Computer_C', 5],
  ['Desc_ModularFrameHeavy_C', 5],
  ['Desc_HighSpeedConnector_C', 5],
  ['Desc_ComputerSuper_C', 2],
  ['Desc_MotorLightweight_C', 2],
  ['Desc_SteelPlateReinforced_C', 10],
];

const highs = await loadHighs();
const all = new Set(data.recipes.filter((r) => r.kind !== 'power').map((r) => r.id));
const settings = DEFAULT_EXTRACTION;

const measure = (r: SolveResult, ms: number) => {
  const extractors = planExtraction(r.raw, settings).reduce((n, u) => n + u.built, 0);
  const machines = r.recipes.reduce((n, u) => n + u.built, 0);
  const kinds = r.raw.filter((x) => x.item !== 'Desc_Water_C').length;
  return { buildings: machines + extractors, kinds, recipes: r.recipes.length, ms: Math.round(ms) };
};

const time = (f: () => SolveResult) => {
  const t0 = performance.now();
  const r = f();
  return measure(r, performance.now() - t0);
};

const rows: Record<string, ReturnType<typeof measure>>[] = [];
for (const [item, rate] of PRODUCTS) {
  const base: SolveInput = { targets: [{ item, rate }], supplies: [], enabledRecipes: all, resourceCaps: {}, objective: 'resources' };
  const rarity = time(() => solve(highs, base));
  const oldIn: SolveInput = { ...base, objective: 'buildings' };
  const old = time(() => fewerLines(highs, oldIn, solve(highs, oldIn)));
  const newIn: SolveInput = { ...oldIn, extractorCost: extractorCost(settings) };
  const fresh = time(() => fewestBuildings(highs, newIn));
  rows.push({ rarity, old, fresh });
  const name = data.items[item].name;
  console.log(
    `${name.padEnd(24)} rarity ${rarity.buildings}b/${rarity.kinds}k  old ${old.buildings}b/${old.kinds}k/${old.recipes}r ${old.ms}ms  new ${fresh.buildings}b/${fresh.kinds}k/${fresh.recipes}r ${fresh.ms}ms`,
  );
}

const sum = (k: 'rarity' | 'old' | 'fresh', f: 'buildings' | 'kinds') => rows.reduce((s, r) => s + r[k][f], 0);
console.log(
  `\ntotal     rarity ${sum('rarity', 'buildings')}b/${sum('rarity', 'kinds')}k  old ${sum('old', 'buildings')}b/${sum('old', 'kinds')}k  new ${sum('fresh', 'buildings')}b/${sum('fresh', 'kinds')}k`,
);
console.log(`slowest new ${Math.max(...rows.map((r) => r.fresh.ms))}ms`);

// The bar: no more kinds than by rarity, buildings within 5% of the old way, no product more than 2 buildings
// worse unless it drops 2 kinds or more.
const fails: string[] = [];
if (sum('fresh', 'kinds') > sum('rarity', 'kinds')) fails.push('more kinds than by rarity');
if (sum('fresh', 'buildings') > sum('old', 'buildings') * 1.05) fails.push('buildings over old + 5%');
rows.forEach((r, i) => {
  if (r.fresh.buildings > r.old.buildings + 2 && r.old.kinds - r.fresh.kinds < 2) fails.push(`${PRODUCTS[i][0]} worse than old`);
});
console.log(fails.length ? `FAIL: ${fails.join('; ')}` : 'PASS');
