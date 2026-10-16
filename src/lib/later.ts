import { type Item, itemLock, itemTier } from './data';
import { searchKey } from './text';
import { type Lock, lockText } from './unlocks';

/** Names shown at most; a search for "motor" shouldn't list a dozen. */
const SHOWN = 3;

/** What a search finds among the items hidden for being above the tier, with the tier each opens at, or the milestone it waits for. */
export function laterMatches(
  q: string,
  hidden: Item[],
  name: (i: Item) => string,
  current?: number,
): { item: Item; tier: number; lock: Lock }[] {
  const f = searchKey(q.trim());
  if (!f) return [];
  const found: { item: Item; tier: number; lock: Lock }[] = [];
  for (const item of hidden) {
    const tier = itemTier(item.id);
    if (tier !== undefined && searchKey(name(item)).includes(f))
      found.push({ item, tier, lock: (current !== undefined && itemLock(item.id, current)) || { tier } });
  }
  // The ones that open up first.
  return found.sort((a, b) => a.tier - b.tier || name(a.item).localeCompare(name(b.item))).slice(0, SHOWN);
}

/** The names of what a search found, each with what it waits for: "Plastic (Oil Processing), Motor (Tier 4)". */
export const laterText = (found: { item: Item; lock: Lock }[], name: (i: Item) => string, tierTag: (tier: number) => string) =>
  found.map((x) => `${name(x.item)} (${lockText(x.lock, tierTag)})`).join(', ');
