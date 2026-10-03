import { expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { type CodexData, indexOf, pageKey, pageOf, parsePage, recipesFor, schematicIcon, search } from '../src/lib/codex';
import { data, recipeById, SPECIAL_ITEMS } from '../src/lib/data';
import { choicesFor } from '../src/lib/model/choices';
import codexJson from '../src/data/codex.json';
import creaturesJson from '../src/data/creatures.json';

const codex = { ...codexJson, ...creaturesJson } as unknown as CodexData;
const index = indexOf(codex);
const icons = new Set(fs.readdirSync(path.join(import.meta.dir, '..', 'public', 'icons')).map((f) => f.replace(/\.webp$/, '')));

test('every cost and unlock points at a page', () => {
  const costs = [
    ...Object.values(codex.buildings).flatMap((b) => b.cost ?? []),
    ...Object.values(codex.vehicles).flatMap((v) => v.cost ?? []),
    ...codex.schematics.flatMap((s) => [...s.cost, ...(s.gives ?? [])]),
    ...Object.values(codex.crafts).flatMap((c) => c.flatMap((x) => x.inputs)),
  ];
  expect(costs.filter((c) => !codex.items[c.item]).map((c) => c.item)).toEqual([]);
  const unlocks = codex.schematics.flatMap((s) => s.unlocks);
  expect(unlocks.filter((u) => !pageOf(u, codex))).toEqual([]);
  const after = codex.schematics.flatMap((s) => s.after);
  // Dependencies may name schematics the Codex leaves out (cosmetics, events); the page skips those.
  expect(after.filter((a) => index.schematic.has(a)).length).toBeGreaterThan(50);
});

test('every entry has its icon', () => {
  const missing = index.entries.filter((e) => e.icon && !icons.has(e.icon)).map((e) => e.name);
  expect(missing).toEqual([]);
});

test('pages survive the address bar', () => {
  for (const key of ['', 'cat/parts', 'item/Desc_Motor_C', 'building/Build_ConstructorMk1_C', 'guide/sloops', 'schematic/Schematic_1-1_C'])
    expect(pageKey(parsePage(key))).toBe(key);
  expect(parsePage('cat/nonsense')).toEqual({ kind: 'home' });
  expect(parsePage('guide/nope')).toEqual({ kind: 'home' });
});

test('search puts names that start with the text first', () => {
  const hits = search(index, 'motor');
  expect(hits[0].name).toBe('Motor');
  expect(hits.some((h) => h.name === 'Turbo Motor')).toBe(true);
  expect(search(index, '   ')).toEqual([]);
});

test('an item knows what makes it, what uses it and what it builds', () => {
  const makes = recipesFor('Desc_Motor_C');
  expect(makes[0].kind).toBe('standard');
  expect(makes.some((r) => r.kind === 'alternate')).toBe(true);
  expect((index.usedIn.get('Desc_Motor_C') ?? []).length).toBeGreaterThan(3);
  expect(index.builtWith.get('Desc_Motor_C')?.some((b) => b.page.kind === 'vehicle')).toBe(true);
  expect(index.paidWith.get('Desc_Motor_C')?.length).toBeGreaterThan(0);
});

test('milestones, research, alternates and the shop are all there', () => {
  const types = new Set(codex.schematics.map((s) => s.type));
  expect([...types].sort()).toEqual(['alternate', 'hub', 'mam', 'milestone', 'shop']);
  const tier1 = codex.schematics.find((s) => s.name === 'Base Building');
  expect(tier1?.tier).toBe(1);
  for (const s of codex.schematics) expect(schematicIcon(s, codex)).toBeDefined();
});

test('every creature has an icon, a page and remains that exist', () => {
  expect(codex.creatures.length).toBeGreaterThan(15);
  for (const c of codex.creatures) {
    expect(icons.has(c.id)).toBe(true);
    expect(parsePage(pageKey({ kind: 'creature', id: c.id }))).toEqual({ kind: 'creature', id: c.id });
    if (c.drop) expect(codex.items[c.drop]).toBeDefined();
  }
  expect(search(index, 'hog').some((e) => e.page.kind === 'creature')).toBe(true);
  expect(codex.counts.pod).toBe(118);
});

test('gear kept apart in the build menu is what the Codex calls ammo, equipment or consumables, and power shards', () => {
  const made = new Set(data.recipes.flatMap((r) => r.outputs.map((o) => o.item)));
  const gear = Object.entries((codexJson as unknown as CodexData).items)
    .filter(([id, x]) => made.has(id) && ['ammo', 'equipment', 'consumable'].includes(x.kind))
    .map(([id]) => id);
  expect([...SPECIAL_ITEMS].sort()).toEqual([...gear, 'Desc_CrystalShard_C'].sort());
  // In the build menu: every recipe making one on the Special tab, none of the parts.
  for (const c of choicesFor(undefined, 9)) {
    if (c.init.k !== 'machine') continue;
    const r = recipeById.get(c.init.recipe)!;
    expect(c.tab).toBe(r.outputs.some((o) => SPECIAL_ITEMS.has(o.item)) ? 'special' : 'make');
  }
  expect(choicesFor(undefined, 9).find((c) => c.init.k === 'machine' && c.init.recipe === 'Recipe_Nobelisk_C')?.tab).toBe('special');
});
