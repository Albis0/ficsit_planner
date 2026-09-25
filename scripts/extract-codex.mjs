// Reads the game's CommunityResources/Docs JSON and writes src/data/codex.json: descriptions, stack
// sizes, buildings, vehicles, equipment, milestones, MAM research and the AWESOME Shop for the Codex.
// Also writes src/data/codex-icons.json, the icons the Codex needs that the planner doesn't (feed it to
// the icon extractor). Usage: bun scripts/extract-codex.mjs "<path to Satisfactory install>"
import fs from 'node:fs';
import path from 'node:path';

const gameDir = process.argv[2] ?? process.env.SATISFACTORY_DIR ?? 'C:/Program Files/Epic Games/Satisfactory';
const docsDir = path.join(gameDir, 'CommunityResources', 'Docs');
const dataDir = path.join(import.meta.dirname, '..', 'src', 'data');
const en = JSON.parse(
  fs
    .readFileSync(path.join(docsDir, 'en-US.json'))
    .toString('utf16le')
    .replace(/^\uFEFF/, ''),
);
const game = JSON.parse(fs.readFileSync(path.join(dataDir, 'gamedata.json'), 'utf8'));
const knownIcons = JSON.parse(fs.readFileSync(path.join(dataDir, 'icon-manifest.json'), 'utf8'));

const nativeName = (g) => g.NativeClass.match(/FactoryGame\.(\w+)'/)?.[1];
const byNative = (nc) => en.find((g) => nativeName(g) === nc)?.Classes ?? [];
const classById = new Map(en.flatMap((g) => g.Classes.map((c) => [c.ClassName, c])));
const nativeOf = new Map(en.flatMap((g) => g.Classes.map((c) => [c.ClassName, nativeName(g)])));
const num = (s) => Number.parseFloat(s);
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const classIds = (s) => [...(s ?? '').matchAll(/\.([A-Za-z0-9_-]+_C)\b/g)].map((m) => m[1]);
const parseStacks = (s) => [...(s ?? '').matchAll(/([A-Za-z0-9_-]+_C)'",Amount=([\d.]+)/g)].map((m) => ({ item: m[1], amount: num(m[2]) }));
// The game's descriptions use \r\n and sometimes trail spaces; keep paragraphs, drop the rest.
const text = (s) =>
  (s ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
const icons = {};
const iconPath = (s) => s?.match(/Texture2D \/Game\/(.+)\.\w+$/)?.[1];
const wantIcon = (id, descId = id) => {
  if (knownIcons[id]) return;
  const p = iconPath(classById.get(descId)?.mSmallIcon);
  if (p) icons[id] = `FactoryGame/Content/${p}`;
};

// ---- Items: everything a pioneer can hold -----------------------------------
const STACKS = { SS_ONE: 1, SS_SMALL: 50, SS_MEDIUM: 100, SS_BIG: 200, SS_HUGE: 500, SS_FLUID: 50000 };
const ITEM_KIND = {
  FGResourceDescriptor: 'resource',
  FGItemDescriptor: 'part',
  FGItemDescriptorBiomass: 'part',
  FGItemDescriptorNuclearFuel: 'part',
  FGPowerShardDescriptor: 'part',
  FGItemDescriptorPowerBoosterFuel: 'part',
  FGEquipmentDescriptor: 'equipment',
  FGConsumableDescriptor: 'consumable',
  FGAmmoTypeProjectile: 'ammo',
  FGAmmoTypeSpreadshot: 'ammo',
  FGAmmoTypeInstantHit: 'ammo',
};
const items = {};
for (const [nc, kind] of Object.entries(ITEM_KIND)) {
  for (const c of byNative(nc)) {
    if (!c.mDisplayName) continue;
    const form = c.mForm === 'RF_SOLID' ? 'solid' : c.mForm === 'RF_GAS' ? 'gas' : c.mForm === 'RF_LIQUID' ? 'liquid' : 'solid';
    const stack = Number.parseInt(c.mCachedStackSize, 10) || STACKS[c.mStackSize];
    items[c.ClassName] = {
      name: c.mDisplayName,
      kind,
      desc: text(c.mDescription),
      form,
      // Fluids stack in litres; show m³ like the rest of the app.
      stack: form === 'solid' ? stack : undefined,
      sink: Number.parseInt(c.mResourceSinkPoints ?? '0', 10) || 0,
      energy: num(c.mEnergyValue) > 0 ? round(num(c.mEnergyValue) * (form === 'solid' ? 1 : 1000), 1) : undefined,
      radioactive: num(c.mRadioactiveDecay) > 0 ? round(num(c.mRadioactiveDecay), 3) : undefined,
      alien: c.mIsAlienItem === 'True' || undefined,
    };
    wantIcon(c.ClassName);
  }
}

// Coupons and hard drives are paid into schematics but have no descriptor in the Docs.
items.Desc_ResourceSinkCoupon_C ??= { name: 'FICSIT Coupon', kind: 'part', desc: '', form: 'solid', sink: 0 };
items.Desc_HardDrive_C ??= { name: 'Hard Drive', kind: 'part', desc: '', form: 'solid', sink: 0 };
icons.Desc_ResourceSinkCoupon_C = 'FactoryGame/Content/FactoryGame/Resource/Parts/ResourceSinkCoupon/UI/IconDesc_Ficsit_Coupon_256';
icons.Desc_HardDrive_C = 'FactoryGame/Content/FactoryGame/Resource/Environment/CrashSites/UI/HardDrive_256';

// ---- Recipes outside the planner: build gun, workshop, crafting bench -------
const recipes = byNative('FGRecipe').filter((r) => !r.mRelevantEvents);
const producers = (r) => classIds(r.mProducedIn);
const buildRecipes = recipes.filter((r) => producers(r).includes('BP_BuildGun_C'));
const workshopRecipes = recipes.filter((r) => producers(r).includes('BP_WorkshopComponent_C'));
/** Production recipes that can also be hand-crafted at a Crafting Bench. */
const handCraft = recipes
  .filter((r) => producers(r).includes('BP_WorkBenchComponent_C') && game.recipes.some((x) => x.id === r.ClassName))
  .map((r) => r.ClassName);

// ---- Schematics: who unlocks what --------------------------------------------
const SCHEMATIC_TYPE = {
  EST_Tutorial: 'hub',
  EST_Milestone: 'milestone',
  EST_MAM: 'mam',
  EST_Alternate: 'alternate',
  EST_ResourceSink: 'shop',
};
const humanize = (s) => s.replace(/_RS$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
const recipeProduct = (id) => parseStacks(classById.get(id)?.mProduct)[0]?.item;
const schematics = [];
const unlockedBy = {};
for (const s of byNative('FGSchematic')) {
  const type = SCHEMATIC_TYPE[s.mType];
  if (!type || s.mRelevantEvents) continue;
  const group =
    type === 'mam'
      ? humanize(s.FullName.match(/Research\/(\w+)\//)?.[1] ?? '')
      : type === 'shop'
        ? humanize(s.mSubCategories.match(/SC_RSS_([A-Za-z0-9]+)/)?.[1] ?? '').replace(/^Massage$/, 'Trophies')
        : undefined;
  const unlocks = [];
  const extras = [];
  const gives = [];
  for (const u of s.mUnlocks ?? []) {
    if (u.Class === 'BP_UnlockRecipe_C') {
      for (const r of classIds(u.mRecipes)) {
        unlockedBy[r] ??= s.ClassName;
        unlocks.push(r);
      }
    } else if (u.Class === 'BP_UnlockGiveItem_C') gives.push(...parseStacks(u.mItemsToGive).filter((g) => items[g.item]));
    else if (u.Class === 'BP_UnlockInventorySlot_C') extras.push({ k: 'slots', n: Number(u.mNumInventorySlotsToUnlock) });
    else if (u.Class === 'BP_UnlockArmEquipmentSlot_C') extras.push({ k: 'arm', n: Number(u.mNumArmEquipmentSlotsToUnlock ?? 1) });
    else if (u.Class === 'BP_UnlockScannableResource_C') extras.push({ k: 'scan', items: classIds(u.mResourcesToAddToScanner) });
    else if (u.Class === 'BP_UnlockBuildOverclock_C') extras.push({ k: 'overclock' });
    else if (u.Class === 'BP_UnlockBuildProductionBoost_C') extras.push({ k: 'sloops' });
    else if (u.Class === 'BP_UnlockMap_C') extras.push({ k: 'map' });
    else if (u.Class === 'BP_UnlockBlueprints_C') extras.push({ k: 'blueprints' });
    else if (u.Class.startsWith('BP_UnlockCentralStorage')) extras.push({ k: 'depot' });
  }
  schematics.push({
    id: s.ClassName,
    name: s.mDisplayName.replace(/^Alternate: /, ''),
    type,
    tier: Number.parseInt(s.mTechTier, 10) || 0,
    group,
    cost: parseStacks(s.mCost).map((c) => ({ item: c.item, amount: c.amount })),
    time: num(s.mTimeToComplete) || undefined,
    unlocks,
    extras: extras.length ? extras : undefined,
    gives: gives.length ? gives : undefined,
    after: (s.mSchematicDependencies ?? []).flatMap((d) => classIds(d.mSchematics)),
  });
}

// ---- Buildings ----------------------------------------------------------------
const BUILDING_GROUP = {
  FGBuildableManufacturer: 'production',
  FGBuildableManufacturerVariablePower: 'production',
  FGBuildableResourceExtractor: 'extraction',
  FGBuildableWaterPump: 'extraction',
  FGBuildableFrackingExtractor: 'extraction',
  FGBuildableFrackingActivator: 'extraction',
  FGBuildableGeneratorFuel: 'power',
  FGBuildableGeneratorNuclear: 'power',
  FGBuildableGeneratorGeoThermal: 'power',
  FGBuildablePowerBooster: 'power',
  FGBuildablePowerStorage: 'power',
  FGBuildablePowerPole: 'power',
  FGBuildableWire: 'power',
  FGBuildableCircuitSwitch: 'power',
  FGBuildablePriorityPowerSwitch: 'power',
  FGBuildableConveyorBelt: 'logistics',
  FGBuildableConveyorLift: 'logistics',
  FGBuildableAttachmentSplitter: 'logistics',
  FGBuildableAttachmentMerger: 'logistics',
  FGBuildableSplitterSmart: 'logistics',
  FGBuildableMergerPriority: 'logistics',
  FGBuildableConveyorMonitor: 'logistics',
  FGBuildablePipeline: 'fluids',
  FGBuildablePipelinePump: 'fluids',
  FGBuildablePipeReservoir: 'fluids',
  FGBuildablePipelineJunction: 'fluids',
  FGBuildableStorage: 'storage',
  FGBuildableStackableShelf: 'storage',
  FGCentralStorageContainer: 'storage',
  FGBuildableRailroadTrack: 'transport',
  FGBuildableRailroadStation: 'transport',
  FGBuildableTrainPlatformCargo: 'transport',
  FGBuildableTrainPlatformEmpty: 'transport',
  FGBuildableRailroadSignal: 'transport',
  FGBuildableDockingStation: 'transport',
  FGBuildableDroneStation: 'transport',
  FGBuildablePipeHyper: 'transport',
  FGPipeHyperStart: 'transport',
  FGBuildableJumppad: 'transport',
  FGBuildableElevator: 'transport',
  FGBuildablePortal: 'transport',
  FGBuildablePortalSatellite: 'transport',
  FGBuildableTradingPost: 'special',
  FGBuildableSpaceElevator: 'special',
  FGBuildableMAM: 'special',
  FGBuildableResourceSink: 'special',
  FGBuildableResourceSinkShop: 'special',
  FGBuildableRadarTower: 'special',
  FGBuildableBlueprintDesigner: 'special',
};
// A few buildings sit under a catch-all native class.
const EXTRA_BUILDINGS = { Build_WorkBench_C: 'production', Build_Workshop_C: 'production', Build_LookoutTower_C: 'special' };
const costOf = (descId) => {
  const r = buildRecipes.find((x) => parseStacks(x.mProduct).some((s) => s.item === descId));
  return r ? { cost: parseStacks(r.mIngredients), recipe: r.ClassName } : { cost: [] };
};
// A building's descriptor is usually Build_X -> Desc_X, but some differ in case or underscores
// (Build_PowerPoleWall_Mk2_C -> Desc_PowerPoleWallMk2_C).
const squash = (id) =>
  id
    .replace(/^(Build|Desc)_/, '')
    .replace(/_/g, '')
    .toLowerCase();
const descriptors = new Map(byNative('FGBuildingDescriptor').map((c) => [squash(c.ClassName), c.ClassName]));
const buildings = {};
const addBuilding = (c, group) => {
  if (!c.mDisplayName || c.ClassName.includes('NoIndicator') || buildings[c.ClassName]) return;
  // Seasonal decorations come and go with FICSMAS.
  if (/FICSMAS/i.test(c.mDisplayName)) return;
  const descId = descriptors.get(squash(c.ClassName)) ?? c.ClassName.replace(/^Build_/, 'Desc_');
  const { cost, recipe } = costOf(descId);
  const stats = [];
  const power = num(c.mPowerConsumption);
  if (power > 0) stats.push(['power', power]);
  if (c.mSpeed && /Conveyor/.test(nativeOf.get(c.ClassName))) stats.push(['beltRate', num(c.mSpeed) / 2]);
  if (c.mFlowLimit) stats.push(['flow', num(c.mFlowLimit) * 60]);
  if (c.mStorageCapacity) stats.push(['fluidStore', num(c.mStorageCapacity)]);
  if (c.mInventorySizeX && c.mInventorySizeY && group === 'storage') stats.push(['slots', c.mInventorySizeX * c.mInventorySizeY]);
  if (c.mStorageSizeX && c.mStorageSizeY && num(c.mStorageSizeX) * num(c.mStorageSizeY) > 1)
    stats.push(['slots', num(c.mStorageSizeX) * num(c.mStorageSizeY)]);
  if (num(c.mProductionShardSlotSize) > 0) stats.push(['sloopSlots', num(c.mProductionShardSlotSize)]);
  if (c.mPowerStoreCapacity) stats.push(['storeMWh', num(c.mPowerStoreCapacity)]);
  if (num(c.mPowerProduction) > 0) stats.push(['makes', num(c.mPowerProduction)]);
  if (c.mMaxConnections && group === 'power') stats.push(['connections', num(c.mMaxConnections)]);
  buildings[c.ClassName] = {
    name: c.mDisplayName,
    group,
    desc: text(c.mDescription),
    cost: cost.length ? cost : undefined,
    unlock: recipe ? unlockedBy[recipe] : undefined,
    stats: stats.length ? stats : undefined,
  };
  wantIcon(c.ClassName, descId);
};
for (const [nc, group] of Object.entries(BUILDING_GROUP)) for (const c of byNative(nc)) addBuilding(c, group);
for (const [id, group] of Object.entries(EXTRA_BUILDINGS)) addBuilding(classById.get(id), group);

// ---- Vehicles -----------------------------------------------------------------
const vehicles = {};
for (const c of byNative('FGVehicleDescriptor')) {
  const { cost, recipe } = costOf(c.ClassName);
  vehicles[c.ClassName] = {
    name: c.mDisplayName,
    desc: text(c.mDescription),
    slots: Number(c.mInventorySize) || undefined,
    fluid: c.mIsFluidStorageInventory === 'True' || undefined,
    cost: cost.length ? cost : undefined,
    unlock: recipe ? unlockedBy[recipe] : undefined,
  };
  wantIcon(c.ClassName);
}

// ---- Workshop recipes (equipment, ammo) --------------------------------------
const crafts = {};
for (const r of workshopRecipes) {
  const out = parseStacks(r.mProduct)[0];
  if (!out || !items[out.item]) continue;
  crafts[out.item] ??= [];
  crafts[out.item].push({
    id: r.ClassName,
    name: r.mDisplayName,
    inputs: parseStacks(r.mIngredients),
    amount: out.amount,
    unlock: unlockedBy[r.ClassName],
  });
}

// Which schematic unlocks each planner recipe, so an item page can say where its recipe comes from.
const recipeUnlock = Object.fromEntries(game.recipes.filter((r) => unlockedBy[r.id]).map((r) => [r.id, unlockedBy[r.id]]));

// Unlock lists name recipes; point them at what they give where the Codex has a page for it.
for (const s of schematics) {
  s.unlocks = [
    ...new Set(
      s.unlocks.map((r) => {
        if (game.recipes.some((x) => x.id === r)) return r;
        const product = recipeProduct(r);
        if (!product) return undefined;
        const build = product.replace(/^Desc_/, 'Build_');
        if (buildings[build]) return build;
        if (items[product] || vehicles[product]) return product;
        return undefined;
      }),
    ),
  ].filter(Boolean);
}
// Keep only schematics that give something to show, or cost something (milestones always do).
const kept = schematics.filter((s) => s.unlocks.length || s.extras || s.gives || s.type !== 'shop');
const missing = new Set(kept.flatMap((s) => s.cost.map((c) => c.item)).filter((id) => !items[id]));
console.log('schematic costs without an item page', [...missing]);
kept.sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));

fs.writeFileSync(
  path.join(dataDir, 'codex.json'),
  JSON.stringify({ items, buildings, vehicles, crafts, handCraft, recipeUnlock, schematics: kept }),
);
fs.writeFileSync(path.join(dataDir, 'codex-icons.json'), JSON.stringify(icons, null, 1));
const count = (list, key) => {
  const tally = {};
  for (const x of list) tally[x[key]] = (tally[x[key]] ?? 0) + 1;
  return tally;
};
console.log('items', count(Object.values(items), 'kind'));
console.log('buildings', count(Object.values(buildings), 'group'));
console.log('vehicles', Object.keys(vehicles).length, 'crafts', Object.keys(crafts).length, 'hand-craft', handCraft.length);
console.log('schematics', count(kept, 'type'));
console.log('icons needed', Object.keys(icons).length);
