import { unlinkSave, useStore } from '../../store';
import { type Answers, type Field, fieldsOf, merge, type SaveInfo, type Values, valuesOf } from './apply';
import { type Found, gameKey } from './files';
import { findGrids } from './circuits';
import { findFactories } from './factories';
import { keepSave, keptMembers } from './store-idb';
import { toMap } from './toMap';
import type { SaveData } from './types';

/** The planner's own values for what a save can set. */
export function mine(): Values {
  const s = useStore.getState();
  return { tier: s.tier, skipped: s.skipped, unlocked: s.unlocked, sloops: s.inventory.sloops, shards: s.inventory.shards };
}

/**
 * Puts what a save says in place: the fields the answers take, except those the player chose to keep. Alternates new
 * to the planner are turned on in every factory; nothing is turned off. The file and the buildings of its factories are kept
 * in this browser. Returns the fields taken, and how many factory tabs lost the save factory they were linked to.
 */
export async function takeSave(
  found: Found,
  save: SaveData,
  answers: Answers,
  keep: readonly Field[],
): Promise<{ taken: Field[]; unlinked: number }> {
  // A factory found again keeps its id, so the factory tabs linked to it stay linked.
  const factories = answers.factories ? findFactories(save, await keptMembers()) : undefined;
  const ids = new Set(factories?.list.map((f) => f.id));
  const s = useStore.getState();
  const game = valuesOf(save);
  const taken = fieldsOf(answers).filter((f) => !keep.includes(f));
  const next = merge(mine(), game, taken);
  const added = next.unlocked.filter((id) => !s.unlocked.includes(id));
  const h = found.header;
  const info: SaveInfo = {
    session: gameKey(h),
    game: h.sessionName || h.saveName,
    file: h.saveName || found.file.name.replace(/\.sav$/i, ''),
    savedAt: h.savedAt,
    playSeconds: h.playSeconds,
    saveVersion: h.saveVersion,
    build: h.build,
    ...(save.phase ? { phase: save.phase } : {}),
    importedAt: Date.now(),
    answers,
    map: toMap(save, factories?.list ?? []),
    ...(answers.power ? { grids: findGrids(save) } : {}),
    seen: game,
  };
  const lost = (p: { saveFactory?: string }) => !!p.saveFactory && !ids.has(p.saveFactory);
  const unlinked = s.plans.filter(lost).length;
  useStore.setState({
    tier: next.tier,
    skipped: next.skipped,
    unlocked: next.unlocked,
    inventory: { sloops: next.sloops, shards: next.shards },
    plans: s.plans.map((p) => {
      const missing = added.filter((id) => !p.enabled.includes(id));
      const q = lost(p) ? unlinkSave(p) : p;
      return missing.length ? { ...q, enabled: [...q.enabled, ...missing] } : q;
    }),
    save: info,
  });
  await keepSave(found.file, factories);
  return { taken, unlinked };
}
