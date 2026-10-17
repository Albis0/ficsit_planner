import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Parser } from '@etothepii/satisfactory-file-parser';
import { OLDEST_SAVE_VERSION, readSave } from '../src/lib/save/extract';
import { readHeader } from '../src/lib/save/header';
import { SaveError } from '../src/lib/save/reader';

// Real saves never go into the repo (they hold the player's name and account), so they live outside it. Without that
// folder (CI, another machine) these tests are skipped. Each save is read by our reader and by etothepii's
// satisfactory-file-parser, and the two have to agree on everything the planner uses.
const ROOT = 'C:/code/ficsit-saves';
const files = existsSync(ROOT)
  ? readdirSync(ROOT, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.sav'))
      .map((f) => join(ROOT, f))
  : [];

// biome-ignore lint/suspicious/noExplicitAny: the reference parser's objects are loosely typed
type Any = any;
const idOf = (path: string) => path.slice(path.lastIndexOf('.') + 1);
const short = (path: string) => path.slice(path.indexOf('.') + 1);
const prop = (o: Any, name: string) => o.properties?.[name];
const round = (v: number) => Math.round(v * 1e6) / 1e6;

function reference(bytes: Uint8Array) {
  const save: Any = Parser.ParseSave('x', bytes.slice().buffer, { throwErrors: true });
  const levels: Any[] = Object.values(save.levels);
  const objects: Any[] = levels.flatMap((l) => l.objects);
  const one = (cls: string) => objects.find((o) => o.typePath.endsWith(cls));
  const machines = new Map<string, string>();
  const extractors = new Map<string, string>();
  // Mods' buildings (paths outside /Game/FactoryGame/) are not imported.
  for (const o of objects.filter((o) => o.typePath.startsWith('/Game/FactoryGame/'))) {
    const recipe = prop(o, 'mCurrentRecipe');
    if (recipe) machines.set(short(o.instanceName), `${idOf(recipe.value.pathName)} ${round(prop(o, 'mCurrentPotential')?.value ?? 1)}`);
    const node = prop(o, 'mExtractableResource');
    if (node) extractors.set(short(o.instanceName), short(node.value.pathName));
  }
  const links = new Set<string>();
  for (const o of objects) {
    const to =
      /FGFactoryConnectionComponent|FGPipeConnection(Component|Factory)$/.test(o.typePath) &&
      prop(o, 'mConnectedComponent')?.value?.pathName;
    if (to) links.add([short(o.instanceName), short(to)].sort().join(' '));
  }
  const collected = new Set<string>();
  const keep = (path: string) => /^(BP_WAT[12]|BP_Crystal(_mk[23])?|BP_DropPod)(_|\d|$)/.test(short(path)) && collected.add(short(path));
  for (const l of levels) {
    for (const c of l.collectables ?? []) keep(c.pathName);
    for (const list of Object.values(l.destroyedActorsMap ?? {}) as Any[][]) for (const c of list) keep(c.pathName);
  }
  // The game also counts looted drop pods in a set of its own; dismantled and still standing ones together.
  const looted = prop(one('.FGScannableSubsystem'), 'mLootedDropPods')?.values?.length ?? 0;
  const depot = { sloops: 0, shards: 0 };
  for (const s of prop(one('.FGCentralStorageSubsystem'), 'mStoredItems')?.values ?? []) {
    const id = idOf(s.properties?.ItemClass?.value?.pathName ?? '');
    const n = (s.properties?.Amount ?? s.properties?.amount)?.value ?? 0;
    if (id === 'Desc_WAT1_C') depot.sloops += n;
    if (id === 'Desc_CrystalShard_C') depot.shards += n;
  }
  const items = { sloops: 0, shards: 0 };
  for (const o of objects.filter((o) => o.typePath.endsWith('.FGInventoryComponent')))
    for (const s of prop(o, 'mInventoryStacks')?.values ?? []) {
      const id = idOf(s.properties?.Item?.value?.itemReference?.pathName ?? '');
      if (id === 'Desc_WAT1_C') items.sloops += s.properties.NumItems?.value ?? 0;
      if (id === 'Desc_CrystalShard_C') items.shards += s.properties.NumItems?.value ?? 0;
    }
  return {
    objects: objects.length,
    recipes: prop(one('.FGRecipeManager'), 'mAvailableRecipes').values.map((v: Any) => idOf(v.pathName)),
    schematics: prop(one('.BP_SchematicManager_C'), 'mPurchasedSchematics').values.map((v: Any) => idOf(v.pathName)),
    phase: idOf(prop(one('.BP_GamePhaseManager_C'), 'mCurrentGamePhase').value.pathName),
    machines,
    extractors,
    links,
    collected,
    looted,
    depot,
    items,
    connectors: objects.filter((o) => o.typePath.endsWith('.FGFactoryConnectionComponent')).length,
  };
}

describe.skipIf(!files.length)('real saves read the same as the reference parser', () => {
  for (const file of files) {
    test(file.slice(ROOT.length + 1), async () => {
      const bytes = new Uint8Array(readFileSync(file));
      if (readHeader(bytes).saveVersion < OLDEST_SAVE_VERSION) {
        await expect(readSave(bytes)).rejects.toBeInstanceOf(SaveError);
        return;
      }
      const ours = await readSave(bytes);
      const ref = reference(bytes);
      expect(ours.objects).toBe(ref.objects);
      // Everything is read; only recipes this version has no data for (FICSMAS) may be left over.
      expect(Object.keys(ours.unknown).filter((k) => !k.startsWith('recipe '))).toEqual([]);
      expect(ours.recipes).toEqual(ref.recipes);
      expect(ours.schematics).toEqual(ref.schematics);
      expect(ours.phase).toBe(ref.phase);
      expect(new Map(ours.buildings.filter((b) => b.recipe).map((b) => [b.id, `${b.recipe} ${b.clock}`]))).toEqual(ref.machines);
      expect(new Map(ours.buildings.filter((b) => b.node).map((b) => [b.id, b.node]))).toEqual(ref.extractors);
      // Water extractors stand in a water volume, not on a node; mods bring nodes of their own (BP_DirtNode).
      expect(ours.buildings.filter((b) => /^BP_(ResourceNode|Fracking)/.test(b.node ?? '')).every((b) => b.nodeAt)).toBe(true);
      expect(new Set(ours.links.map((l) => [`${l.a}.${l.ap}`, `${l.b}.${l.bp}`].sort().join(' ')))).toEqual(ref.links);
      // A looted pod that still stands is known by a flag the reference reads wrong in 1.2, so pods are checked by count.
      const pod = (name: string) => name.startsWith('BP_DropPod');
      expect(new Set(ours.collected.filter((c) => !pod(c)))).toEqual(new Set([...ref.collected].filter((c) => !pod(c))));
      expect(ours.collected.filter(pod)).toEqual(expect.arrayContaining([...ref.collected].filter(pod)));
      // In creative mode the game's own count can lag behind the pods' flags (Release-032: 2 flagged, 1 counted).
      if (ours.header.creative) expect(ours.collected.filter(pod).length).toBeGreaterThanOrEqual(ref.looted);
      else expect(ours.collected.filter(pod)).toHaveLength(ref.looted);
      expect(ours.sloops.free + ours.sloops.inMachines).toBe(ref.items.sloops);
      expect(ours.shards.free + ours.shards.inMachines).toBe(ref.items.shards);
      expect(ours.sloops.inDepot).toBe(ref.depot.sloops);
      expect(ours.shards.inDepot).toBe(ref.depot.shards);
      // Nothing that names the player comes out.
      expect(JSON.stringify(ours)).not.toContain('mCachedPlayerName');
    }, 60_000);
  }

  const big = files.find((f) => f.endsWith('SPACEDELAELEVATORE.sav'));
  test.skipIf(!big)('the 58-hour save: the counts checked by hand, read in under a second', async () => {
    const bytes = new Uint8Array(readFileSync(big!));
    const t = performance.now();
    const s = await readSave(bytes);
    expect(performance.now() - t).toBeLessThan(1000);
    expect(s.objects).toBe(11127);
    expect(s.recipes).toHaveLength(187);
    expect(s.schematics).toHaveLength(75);
    const machines = s.buildings.filter((b) => b.recipe);
    expect(machines).toHaveLength(77);
    const clocks: Record<string, number> = {};
    for (const m of machines) clocks[m.clock!.toFixed(2)] = (clocks[m.clock!.toFixed(2)] ?? 0) + 1;
    expect(clocks).toEqual({ '1.00': 53, '0.75': 11, '0.83': 10, '1.33': 1, '0.50': 1, '2.50': 1 });
    expect(reference(bytes).connectors).toBe(1626);
    expect(s.phase).toBe('GP_Project_Assembly_Phase_1');
  });
});
