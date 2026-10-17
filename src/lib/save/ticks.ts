import type { MNode } from '../model/types';
import type { SolveResult } from '../solver';

type Ticked = { built?: string[]; savedBuilt?: string[]; floor?: 'manual'; model?: { nodes: MNode[] } };

/**
 * The built ticks a factory tab gets from the save factory it is linked to, given the machines the save has on each
 * recipe. On a hand-built floor the cards are ticked recipe by recipe, as many as the save's machines cover, in the
 * order they lie on the floor; on the Auto floor a recipe is ticked when the save has all its machines. The player's
 * own ticks are never taken off, and the machines they stand for count as built. Undefined when nothing changes.
 */
export function saveTicks(
  plan: Ticked,
  have: Record<string, number>,
  result: Pick<SolveResult, 'recipes'>,
): { nodes: MNode[] } | { built: string[]; savedBuilt: string[] } | undefined {
  if (plan.floor === 'manual' && plan.model) {
    const need = new Map(result.recipes.flatMap((r) => (r.node ? [[r.node, r.built] as const] : [])));
    const left: Record<string, number> = { ...have };
    let changed = false;
    const nodes = plan.model.nodes.map((n): MNode => {
      if (n.k !== 'machine') return n;
      const k = need.get(n.id) ?? Math.ceil(n.n ?? 1);
      left[n.recipe] = left[n.recipe] ?? 0;
      if (n.done === true) {
        left[n.recipe] -= k;
        return n;
      }
      const built = k > 0 && left[n.recipe] >= k;
      if (built) left[n.recipe] -= k;
      if (built === (n.done === 'save')) return n;
      changed = true;
      const { done: _, ...rest } = n;
      return built ? { ...rest, done: 'save' } : rest;
    });
    return changed ? { nodes } : undefined;
  }
  const planned = new Map<string, number>();
  for (const r of result.recipes) planned.set(r.recipe.id, (planned.get(r.recipe.id) ?? 0) + r.built);
  const saved = plan.savedBuilt ?? [];
  const mine = (plan.built ?? []).filter((id) => !saved.includes(id));
  const savedBuilt = [...planned].filter(([id, n]) => n > 0 && (have[id] ?? 0) >= n && !mine.includes(id)).map(([id]) => id);
  const built = [...mine, ...savedBuilt];
  const same =
    built.length === (plan.built ?? []).length && savedBuilt.length === saved.length && savedBuilt.every((id) => saved.includes(id));
  return same ? undefined : { built, savedBuilt };
}
