import { expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { type CodexData, funFacts, indexOf, pageKey, pageOf, parsePage, recipesFor, schematicIcon, search } from '../src/lib/codex';
import codexJson from '../src/data/codex.json';

const codex = codexJson as unknown as CodexData;
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

test('the home page facts come out of the data', () => {
  const facts = funFacts(index);
  expect(facts.length).toBeGreaterThanOrEqual(4);
  const nuclear = facts.find((f) => f.key === 'factNuclear');
  expect(nuclear?.vars.n).toBe(83);
});
