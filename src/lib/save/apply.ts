import codex from '../../data/codex.json';
import { data } from '../data';
import { MILESTONES } from '../unlocks';
import type { SaveCount, SaveData } from './types';

/** What a game save sets in the planner: the tier, the milestones not bought, the alternates, and the sloops and shards. */
export type Values = { tier: number; skipped: string[]; unlocked: string[]; sloops: number; shards: number };

/** The parts of Values one choice covers, in the order the refresh window lists them. */
export const FIELDS = ['tier', 'recipes', 'sloops', 'shards'] as const;
export type Field = (typeof FIELDS)[number];

/** What the player chose to take from the save, at the first import or later in Settings › Game save. */
export type Answers = { progress: boolean; inventory: boolean; factories: boolean; power: boolean };
export const ALL_ANSWERS: Answers = { progress: true, inventory: true, factories: true, power: true };

/** The save the planner follows, and what the game said at the last import. Holds no player name or account. */
export type SaveInfo = {
  /** The game (session) it follows: its id, or its name for saves without one. */
  session: string;
  /** The name the player gave the game. */
  game: string;
  file: string;
  savedAt: number;
  playSeconds: number;
  saveVersion: number;
  build: number;
  phase?: string;
  importedAt: number;
  answers: Answers;
  /** What the game said last time; a planner value that differs from it was changed by the player since. */
  seen: Values;
};

/** The tier of each HUB milestone. Ids do not always match the tier (Schematic_5-3_C is a tier 4 milestone). */
const MILESTONE_TIER = new Map(codex.schematics.filter((s) => s.type === 'milestone' || s.type === 'hub').map((s) => [s.id, s.tier]));
const tierOfId = (id: string) => MILESTONE_TIER.get(id) ?? Number(/^Schematic_(\d+)-\d+_C$/.exec(id)?.[1] ?? 0);

const OPTIONAL = new Set(data.recipes.filter((r) => r.kind === 'alternate' || r.kind === 'converter').map((r) => r.id));
const KNOWN = new Set(data.recipes.map((r) => r.id));
/** Event recipes: decorations, snow, candy canes. The planner has no use for them. */
const FICSMAS = /Xmas|Ficsmas|Snow|Candy|Wreath|TreeGift/i;

const total = (c: SaveCount) => c.free + c.inMachines + c.inDepot;

/** What the save sets: the highest HUB tier with a milestone bought, the milestones up to it not bought, the alternates it has. */
export function valuesOf(save: Pick<SaveData, 'schematics' | 'recipes' | 'sloops' | 'shards'>): Values {
  const bought = new Set(save.schematics);
  const tier = Math.max(0, ...save.schematics.map(tierOfId));
  return {
    tier,
    skipped: MILESTONES.filter((m) => m.tier <= tier && !bought.has(m.id)).map((m) => m.id),
    unlocked: [...new Set(save.recipes.filter((id) => OPTIONAL.has(id)))],
    // Every one the player owns: loose, slotted into machines, and uploaded to the Dimensional Depot.
    sloops: total(save.sloops),
    shards: total(save.shards),
  };
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && new Set([...a, ...b]).size === a.length;

/** Whether two sets of values differ in one field. */
export function differs(field: Field, a: Values, b: Values): boolean {
  switch (field) {
    case 'tier':
      return a.tier !== b.tier || !sameSet(a.skipped, b.skipped);
    case 'recipes':
      return !sameSet(a.unlocked, b.unlocked);
    default:
      return a[field] !== b[field];
  }
}

/** The fields the answers let a save set. */
export const fieldsOf = (a: Answers): Field[] => FIELDS.filter((f) => (f === 'tier' || f === 'recipes' ? a.progress : a.inventory));

/**
 * The fields to ask about on a refresh: the player changed them since the last import, and the game now says
 * something else again. A field the player left alone just follows the game.
 */
export const conflicts = (mine: Values, seen: Values, game: Values, fields: readonly Field[]): Field[] =>
  fields.filter((f) => differs(f, mine, seen) && differs(f, mine, game));

/** The values after an import: the game's for the fields taken, the player's own for the rest. */
export function merge(mine: Values, game: Values, take: readonly Field[]): Values {
  const has = (f: Field) => take.includes(f);
  return {
    tier: has('tier') ? game.tier : mine.tier,
    skipped: has('tier') ? game.skipped : mine.skipped,
    unlocked: has('recipes') ? game.unlocked : mine.unlocked,
    sloops: has('sloops') ? game.sloops : mine.sloops,
    shards: has('shards') ? game.shards : mine.shards,
  };
}

/** Recipes in the save the planner does not have: FICSMAS ones, and alternates it does not know (from mods or a newer game). */
export function unknownRecipes(save: Pick<SaveData, 'recipes'>): { ficsmas: number; alternates: number } {
  const unknown = save.recipes.filter((id) => !KNOWN.has(id));
  return {
    ficsmas: unknown.filter((id) => FICSMAS.test(id)).length,
    alternates: unknown.filter((id) => /Alternate/i.test(id) && !FICSMAS.test(id)).length,
  };
}
