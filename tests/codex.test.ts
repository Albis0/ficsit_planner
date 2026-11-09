import { expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { type CodexData, indexOf, type MamTree, pageKey, pageOf, parsePage, recipesFor, schematicIcon, search } from '../src/lib/codex';
import { data, recipeById, SPECIAL_ITEMS } from '../src/lib/data';
import { choicesFor } from '../src/lib/model/choices';
import codexJson from '../src/data/codex.json';
import creaturesJson from '../src/data/creatures.json';
import statsJson from '../src/data/stats.json';
import mamJson from '../src/data/mam.json';
import adaJson from '../src/data/ada.json';
import mamIcons from '../src/data/mam-icons.json';

const codex = { ...codexJson, ...creaturesJson, stats: statsJson } as unknown as CodexData;
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

test('weapon, fuel and vehicle numbers sit on their pages and add up', () => {
  const rows = (id: string) => Object.fromEntries((codex.stats[id] ?? []).map(([k, v]) => [k, v]));
  const rifle = rows('Desc_CartridgeStandard_C');
  expect(rifle.damage).toBe(5);
  expect(rifle.fireRate).toBe(5);
  expect(rifle.dps).toBe(rifle.damage * rifle.fireRate);
  expect(rows('BP_EquipmentDescriptorRifle_C').reload).toBe(3.2);
  // A fuel item burns for the inverse of its burn rate: the solid biofuel's 0.35 a second is 2.9 s.
  const jet = rows('BP_EquipmentDescriptorJetPack_C');
  expect(jet['burn:Desc_Biofuel_C']).toBe(2.9);
  expect(jet['burn:Desc_PackagedIonizedFuel_C']).toBeGreaterThan(jet['burn:Desc_PackagedRocketFuel_C']);
  expect(rows('Desc_Tractor_C').fuelUse).toBe(55);
  expect(rows('Desc_Medkit_C').heals).toBe(100);
  // A creature's hit: a hog charges for 10, tougher hogs for more.
  expect(rows('Desc_HogBasic_C').damage).toBe(10);
  expect(rows('Desc_HogNuclear_C').damage).toBeGreaterThan(rows('Desc_HogAlpha_C').damage);
  // A building's space: the Constructor takes 8 by 10 metres, the Manufacturer 18 by 20 (belt pit included).
  expect(rows('Build_ConstructorMk1_C').footprint).toBe(8);
  expect(codex.stats.Build_ManufacturerMk1_C[0].slice(0, 3)).toEqual(['footprint', 18, '20']);
  // Every number belongs to a page the Codex has, and every row has a label.
  const labels = fs.readFileSync(path.join(import.meta.dir, '..', 'src', 'locales', 'en.ts'), 'utf8');
  for (const [id, list] of Object.entries(codex.stats)) {
    expect(codex.items[id] ?? codex.vehicles[id] ?? codex.buildings[id] ?? codex.creatures.find((c) => c.id === id)).toBeDefined();
    for (const [key] of list) if (!key.includes(':')) expect(labels).toContain(`st_${key}:`);
  }
});

test('a number finds the page that has it', () => {
  const names = (q: string) => search(index, q).map((e) => e.name);
  expect(names('health')).toContain('Fluffy-Tailed Hog');
  expect(names('health')).toContain('Medicinal Inhaler');
  expect(names('damage')).toContain('Rifle Ammo');
  expect(names('jetpack')[0]).toBe('Jetpack');
  expect(names('fuel use')).toContain('Explorer');
  // A name still beats a number: "rifle" lists the Rifle before anything found only by its numbers.
  expect(names('rifle')[0]).toBe('Rifle');
});

test('every MAM research sits on one tree cell and its lines end at a child', () => {
  const mam = new Set(codexJson.schematics.filter((s) => s.type === 'mam').map((s) => s.id));
  for (const [name, tree] of Object.entries(mamJson as unknown as Record<string, MamTree>)) {
    const ids = new Set(tree.nodes.map((n) => n.id));
    const cells = new Set(tree.nodes.map((n) => `${n.x},${n.y}`));
    expect(cells.size, name).toBe(tree.nodes.length);
    for (const n of tree.nodes) {
      expect(mam.has(n.id), n.id).toBe(true);
      expect(n.x < tree.cols && n.y < tree.rows, n.id).toBe(true);
      for (const p of n.parents) expect(ids.has(p), `${n.id} < ${p}`).toBe(true);
      for (const r of n.roads) {
        expect(ids.has(r.to), `${n.id} > ${r.to}`).toBe(true);
        expect(r.points.length).toBeGreaterThan(0);
      }
    }
  }
});

test('every HUB milestone has its own game picture and a page', () => {
  const milestones = codex.schematics.filter((s) => s.type === 'hub' || s.type === 'milestone');
  expect(milestones.length).toBe(48);
  for (const s of milestones) {
    expect(s.id in mamIcons, s.id).toBe(true);
    expect(index.schematic.has(s.id)).toBe(true);
  }
});

test('every ADA line in the voice list is a file in public/ada, has subtitles in time order and belongs to a real schematic', () => {
  const dir = path.join(import.meta.dir, '..', 'public', 'ada');
  for (const [id, messages] of Object.entries(adaJson as unknown as Record<string, { a: string[]; c: [number, string, number][] }[]>)) {
    expect(index.schematic.has(id), id).toBe(true);
    for (const m of messages) {
      for (const f of m.a) expect(fs.existsSync(path.join(dir, `${f}.ogg`)), f).toBe(true);
      expect(m.c.length, id).toBeGreaterThan(0);
      expect(m.c[0][0], id).toBe(0);
      expect(
        m.c.every((c, i) => c[1] && (i === 0 || c[0] >= m.c[i - 1][0])),
        id,
      ).toBe(true);
    }
  }
  for (const f of ['logo', 'bubble']) expect(fs.existsSync(path.join(dir, `${f}.png`)), f).toBe(true);
});

test('every HUB milestone but the tutorial ones has an ADA voice', () => {
  const ada = adaJson as Record<string, unknown>;
  for (const s of index.data.schematics.filter((x) => x.type === 'hub' || x.type === 'milestone')) {
    if (!s.id.startsWith('Schematic_Tutorial')) expect(ada[s.id], s.id).toBeDefined();
  }
});
