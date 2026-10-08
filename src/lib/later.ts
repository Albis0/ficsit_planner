import { type Item, itemTier } from './data';
import { searchKey } from './text';

/** Names shown at most; a search for "motor" shouldn't list a dozen. */
const SHOWN = 3;

/** What a search finds among the items hidden for being above the tier, with the tier each opens at. */
export function laterMatches(q: string, hidden: Item[], name: (i: Item) => string): { item: Item; tier: number }[] {
  const f = searchKey(q.trim());
  if (!f) return [];
  const found: { item: Item; tier: number }[] = [];
  for (const item of hidden) {
    const tier = itemTier(item.id);
    if (tier !== undefined && searchKey(name(item)).includes(f)) found.push({ item, tier });
  }
  // The ones that open up first.
  return found.sort((a, b) => a.tier - b.tier || name(a.item).localeCompare(name(b.item))).slice(0, SHOWN);
}
