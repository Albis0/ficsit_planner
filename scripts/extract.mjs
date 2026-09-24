// Reads the game's CommunityResources/Docs JSON and writes a compact src/data/gamedata.json.
// Usage: bun run extract "<path to Satisfactory install>"
import fs from 'node:fs';
import path from 'node:path';

const gameDir = process.argv[2] ?? process.env.SATISFACTORY_DIR ?? 'C:/Program Files/Epic Games/Satisfactory';
const docsDir = path.join(gameDir, 'CommunityResources', 'Docs');
const outFile = path.join(import.meta.dirname, '..', 'src', 'data', 'gamedata.json');

const load = (lang) =>
  JSON.parse(fs.readFileSync(path.join(docsDir, `${lang}.json`)).toString('utf16le').replace(/^\uFEFF/, ''));

const en = load('en-US');

const nativeName = (g) => g.NativeClass.match(/FactoryGame\.(\w+)'/)?.[1];
const byNative = (docs, nc) => docs.find((g) => nativeName(g) === nc)?.Classes ?? [];

const num = (s) => Number.parseFloat(s);

// ---- Machines ----------------------------------------------------------------
const machines = {};
for (const nc of ['FGBuildableManufacturer', 'FGBuildableManufacturerVariablePower']) {
  for (const c of byNative(en, nc)) {
    machines[c.ClassName] = {
      id: c.ClassName,
      name: c.mDisplayName,
      power: num(c.mPowerConsumption),
      powerExp: num(c.mPowerConsumptionExponent),
      variable: nc === 'FGBuildableManufacturerVariablePower',
      somersloopSlots: Number.parseInt(c.mProductionShardSlotSize, 10),
    };
  }
}

// ---- Items -------------------------------------------------------------------
const colorOf = (s) => {
  const m = s?.match(/B=(\d+),G=(\d+),R=(\d+),A=(\d+)/);
  if (!m || m[4] === '0') return undefined;
  return '#' + [m[3], m[2], m[1]].map((v) => Number(v).toString(16).padStart(2, '0')).join('');
};

const allItems = {};
for (const g of en) {
  for (const c of g.Classes) {
    if (c.mForm === undefined || c.mStackSize === undefined) continue;
    const form = c.mForm === 'RF_SOLID' ? 'solid' : c.mForm === 'RF_GAS' ? 'gas' : 'liquid';
    allItems[c.ClassName] = {
      id: c.ClassName,
      name: c.mDisplayName,
      form,
      sink: Number.parseInt(c.mResourceSinkPoints ?? '0', 10) || 0,
      color: form === 'solid' ? undefined : colorOf(form === 'gas' ? c.mGasColor : c.mFluidColor) ?? colorOf(c.mFluidColor),
      raw: nativeName(g) === 'FGResourceDescriptor',
    };
  }
}

// ---- Recipes -----------------------------------------------------------------
const parseStacks = (s) =>
  [...(s ?? '').matchAll(/([A-Za-z0-9_-]+_C)'",Amount=([\d.]+)/g)].map((m) => ({ item: m[1], amount: num(m[2]) }));

// Schematics tell us how a recipe is unlocked: hard drive research (alternate) or a milestone tier.
const unlockedBy = new Map();
for (const s of byNative(en, 'FGSchematic')) {
  for (const u of s.mUnlocks ?? []) {
    for (const m of (u.mRecipes ?? '').matchAll(/\.(Recipe_\w+_C)/g)) {
      const prev = unlockedBy.get(m[1]);
      const next = { type: s.mType, tier: Number.parseInt(s.mTechTier, 10) || 0 };
      // Prefer the alternate marker, then the lowest milestone tier.
      if (!prev || next.type === 'EST_Alternate' || (prev.type !== 'EST_Alternate' && next.tier < prev.tier)) unlockedBy.set(m[1], next);
    }
  }
}

const CONVERTER = 'Build_Converter_C';
const recipes = [];
const used = new Set();
for (const c of byNative(en, 'FGRecipe')) {
  const producers = [...c.mProducedIn.matchAll(/\.(Build_\w+_C)/g)].map((m) => m[1]).filter((b) => machines[b]);
  if (producers.length === 0 || c.mRelevantEvents) continue; // skip seasonal (FICSMAS) recipes
  const machine = producers[0];
  const duration = num(c.mManufactoringDuration);
  const perMin = (stacks) =>
    stacks.map(({ item, amount }) => {
      const it = allItems[item];
      const qty = it && it.form !== 'solid' ? amount / 1000 : amount;
      used.add(item);
      return { item, rate: (qty * 60) / duration };
    });
  const inputs = perMin(parseStacks(c.mIngredients));
  const outputs = perMin(parseStacks(c.mProduct));
  if (outputs.length === 0) continue;

  const unlock = unlockedBy.get(c.ClassName);
  const alt = unlock?.type === 'EST_Alternate' || c.ClassName.includes('Alternate');
  const m = machines[machine];
  const power = m.variable
    ? num(c.mVariablePowerConsumptionConstant) + num(c.mVariablePowerConsumptionFactor) / 2
    : m.power;

  recipes.push({
    id: c.ClassName,
    name: c.mDisplayName,
    kind: alt ? 'alternate' : machine === CONVERTER && outputs.every((o) => allItems[o.item]?.raw) ? 'converter' : 'standard',
    tier: unlock?.type === 'EST_Milestone' ? unlock.tier : undefined,
    machine,
    duration,
    power,
    powerRange: m.variable
      ? [num(c.mVariablePowerConsumptionConstant), num(c.mVariablePowerConsumptionConstant) + num(c.mVariablePowerConsumptionFactor)]
      : undefined,
    inputs,
    outputs,
  });
}

// Raw resources always exist even if only mined.
for (const it of Object.values(allItems)) if (it.raw) used.add(it.id);
let items = Object.fromEntries([...used].filter((id) => allItems[id]).map((id) => [id, allItems[id]]));

// World extraction limits from SatisfactoryTools (greeny/SatisfactoryTools, src/Data/Data.ts); last compared with upstream on 2026-09-24.
const worldLimits = {
  Desc_OreIron_C: 92100,
  Desc_OreCopper_C: 36900,
  Desc_Stone_C: 69900,
  Desc_Coal_C: 42300,
  Desc_OreGold_C: 15000,
  Desc_LiquidOil_C: 12600,
  Desc_RawQuartz_C: 13500,
  Desc_Sulfur_C: 10800,
  Desc_OreBauxite_C: 12300,
  Desc_OreUranium_C: 2100,
  Desc_NitrogenGas_C: 12000,
  Desc_SAM_C: 10200,
  Desc_Water_C: null,
};

// Transport throughput per minute. Belt mSpeed is in half-items per second of belt length units, so /2 gives items/min.
const belts = byNative(en, 'FGBuildableConveyorBelt')
  .map((c) => ({ name: c.mDisplayName.replace('Conveyor Belt ', ''), rate: num(c.mSpeed) / 2 }))
  .sort((a, b) => a.rate - b.rate);
const pipes = byNative(en, 'FGBuildablePipeline')
  .filter((c) => !c.ClassName.includes('NoIndicator'))
  .map((c) => ({ name: c.mDisplayName.replace('Pipeline ', ''), rate: num(c.mFlowLimit) * 60 }))
  .sort((a, b) => a.rate - b.rate);

// Extractors: base rate per minute on a normal node at 100% clock. Purity multiplies it (impure 0.5, pure 2).
const extractors = [];
for (const nc of ['FGBuildableResourceExtractor', 'FGBuildableWaterPump', 'FGBuildableFrackingExtractor']) {
  for (const c of byNative(en, nc)) {
    const forms = c.mAllowedResourceForms.match(/RF_\w+/g) ?? [];
    const fluid = !forms.includes('RF_SOLID');
    extractors.push({
      id: c.ClassName,
      name: c.mDisplayName,
      rate: ((num(c.mItemsPerCycle) / (fluid ? 1000 : 1)) * 60) / num(c.mExtractCycleTime),
      power: num(c.mPowerConsumption),
      powerExp: num(c.mPowerConsumptionExponent),
      // Empty list = any solid resource (miners).
      resources: [...(c.mAllowedResources ?? '').matchAll(/\.(Desc_\w+_C)'/g)].map((m) => m[1]),
      purity: nc !== 'FGBuildableWaterPump',
    });
  }
}
extractors.sort((a, b) => a.rate - b.rate || a.name.localeCompare(b.name));
console.log('extractors', extractors.map((e) => `${e.name}=${e.rate}/min ${e.power}MW`).join(', '));

// Buildings: which milestone tier unlocks them and what they cost to place (build gun recipes).
const buildRecipes = byNative(en, 'FGRecipe').filter((r) => r.mProducedIn.includes('BuildGun'));
const buildingInfo = (buildId) => {
  const desc = buildId.replace(/^Build_/, 'Desc_');
  const r = buildRecipes.find((x) => parseStacks(x.mProduct).some((s) => s.item === desc));
  if (!r) return { tier: 0, cost: [] };
  const cost = parseStacks(r.mIngredients);
  for (const c of cost) used.add(c.item);
  return { tier: unlockedBy.get(r.ClassName)?.tier ?? 0, cost };
};
for (const m of Object.values(machines)) Object.assign(m, buildingInfo(m.id));
for (const e of extractors) Object.assign(e, buildingInfo(e.id));
const withTier = (list, nc) =>
  list.map((t) => {
    const c = byNative(en, nc).find((x) => x.mDisplayName.endsWith(t.name));
    return { ...t, id: c.ClassName, tier: buildingInfo(c.ClassName).tier };
  });
// Building costs may reference parts no production recipe touched; include them too.
items = Object.fromEntries([...used].filter((id) => allItems[id]).map((id) => [id, allItems[id]]));
const beltsOut = withTier(belts, 'FGBuildableConveyorBelt');
const pipesOut = withTier(pipes, 'FGBuildablePipeline');
console.log('belt tiers', beltsOut.map((b) => `${b.name}@T${b.tier}`).join(' '), '| pipes', pipesOut.map((p) => `${p.name}@T${p.tier}`).join(' '));
console.log('machine tiers', Object.values(machines).map((m) => `${m.name}@T${m.tier}`).join(', '));

// Icon texture paths for the .NET icon extractor (tools/icon-extractor). Machines use their building descriptor.
const iconPath = (s) => s?.match(/Texture2D \/Game\/(.+)\.\w+$/)?.[1];
const iconManifest = {};
// Somersloops are never a recipe input or output, but the inventory panel shows them.
const extraIcons = ["Desc_WAT1_C"];
const allClasses = new Map(en.flatMap((g) => g.Classes.map((c) => [c.ClassName, c])));
for (const id of [...Object.keys(items), ...extraIcons]) {
  const p = iconPath(allClasses.get(id)?.mSmallIcon);
  if (p) iconManifest[id] = `FactoryGame/Content/${p}`;
}
for (const id of [...Object.keys(machines), ...extractors.map((e) => e.id), ...beltsOut.map((b) => b.id), ...pipesOut.map((p) => p.id)]) {
  const p = iconPath(allClasses.get(id.replace(/^Build_/, 'Desc_'))?.mSmallIcon);
  if (p) iconManifest[id] = `FactoryGame/Content/${p}`;
}
fs.writeFileSync(path.join(path.dirname(outFile), 'icon-manifest.json'), JSON.stringify(iconManifest, null, 1));
console.log('icons in manifest', Object.keys(iconManifest).length);

// Record which game build the data came from, so a checkout without the game still knows.
const versionFile = fs
  .readdirSync(path.join(gameDir, 'Engine', 'Binaries', 'Win64'))
  .find((f) => f.endsWith('-Shipping.version'));
const build = versionFile ? JSON.parse(fs.readFileSync(path.join(gameDir, 'Engine', 'Binaries', 'Win64', versionFile), 'utf8')) : {};
const meta = {
  gameVersion: build.GameVersion ?? 'unknown',
  changelist: build.Changelist ?? null,
  engine: build.MajorVersion ? `${build.MajorVersion}.${build.MinorVersion}.${build.PatchVersion}` : 'unknown',
  extractedAt: new Date().toISOString().slice(0, 10),
};
fs.writeFileSync(path.join(path.dirname(outFile), 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
console.log('game', meta);

recipes.sort((a, b) => a.name.localeCompare(b.name));
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify({ items, recipes, machines, worldLimits, belts: beltsOut, pipes: pipesOut, extractors }));
console.log('belts', belts.map((b) => `${b.name}=${b.rate}`).join(' '), '| pipes', pipes.map((p) => `${p.name}=${p.rate}`).join(' '));

const count = (k) => recipes.filter((r) => r.kind === k).length;
console.log(
  `items ${Object.keys(items).length}, recipes ${recipes.length} (standard ${count('standard')}, alternate ${count('alternate')}, converter ${count('converter')}), machines ${Object.keys(machines).length}`,
);
