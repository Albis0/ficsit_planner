import list from '../data/milestones.json';

/** A milestone that opens something the planner uses. The ones that open nothing it uses are left out. */
export interface Milestone {
  id: string;
  name: string;
  tier: number;
  /** Recipes, buildings, belts, pipes, miners, plants and vehicles it opens, by planner id. */
  unlocks: string[];
}

export const MILESTONES = list as Milestone[];
export const milestoneById = new Map(MILESTONES.map((m) => [m.id, m]));

const milestoneOf = new Map<string, Milestone>();
for (const m of MILESTONES) for (const u of m.unlocks) milestoneOf.set(u, m);

/*
 * The milestones the player has not bought. Module state, so the many tier checks and the calculation worker
 * can read it without every signature taking a list; the store and the worker message set it before they use it.
 */
let skip: ReadonlySet<string> = new Set();

export const setSkipped = (ids: Iterable<string>) => {
  skip = new Set(ids);
};

/** The skipped milestone ids, as a string that changes whenever the list does: for cache keys. */
export const skipKey = () => [...skip].sort().join();

/** The skipped milestone ids, to hand to the calculation worker. */
export const skippedList = () => [...skip];

/** The milestone the player skipped that would have opened this recipe, building, belt, miner, plant or vehicle. */
export const blockedBy = (id: string): Milestone | undefined => {
  const m = milestoneOf.get(id);
  return m && skip.has(m.id) ? m : undefined;
};

/** Is it usable: its game tier is reached and the milestone that opens it is bought. */
export const isOpen = (x: { id: string; tier: number }, tier: number) => x.tier <= tier && !blockedBy(x.id);

/** What keeps something out of reach: a higher tier, or a milestone the player skipped. */
export type Lock = { tier: number } | { milestone: Milestone };

/** Why something is out of reach. Undefined when it is open. */
export const lockOf = (x: { id: string; tier: number }, tier: number): Lock | undefined => {
  if (x.tier > tier) return { tier: x.tier };
  const milestone = blockedBy(x.id);
  return milestone ? { milestone } : undefined;
};

/** The skipped list as saved: only milestones this build knows, each once. */
export const cleanSkipped = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((id): id is string => typeof id === 'string' && milestoneById.has(id)))] : [];

/** What a lock tag says: the milestone's name, or the tier. */
export const lockText = (lock: Lock, tierTag: (tier: number) => string) => ('milestone' in lock ? lock.milestone.name : tierTag(lock.tier));

/** The sentence for a lock: "Needs Logistics Mk.4" or "Needs tier 5". */
export const lockWords = (lock: Lock, t: (key: 'needsTier' | 'needsMilestone', vars: Record<string, string | number>) => string) =>
  'milestone' in lock ? t('needsMilestone', { name: lock.milestone.name }) : t('needsTier', { tier: lock.tier });

/** How many of the milestones the player skipped fall in the tiers they have unlocked: the ones that matter right now. */
export const offAt = (tier: number, skipped: readonly string[]) =>
  skipped.filter((id) => (milestoneById.get(id)?.tier ?? Number.POSITIVE_INFINITY) <= tier).length;
