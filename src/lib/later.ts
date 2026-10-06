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
    if (found.length === SHOWN) break;
    const tier = itemTier(item.id);
    if (tier !== undefined && searchKey(name(item)).includes(f)) found.push({ item, tier });
  }
  return found;
}
