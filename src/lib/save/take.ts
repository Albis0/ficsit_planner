import { useStore } from '../../store';
import { type Answers, type Field, fieldsOf, merge, type SaveInfo, type Values, valuesOf } from './apply';
import { type Found, gameKey } from './files';
import { keepSave } from './store-idb';
import { toMap } from './toMap';
import type { SaveData } from './types';

/** The planner's own values for what a save can set. */
export function mine(): Values {
  const s = useStore.getState();
  return { tier: s.tier, skipped: s.skipped, unlocked: s.unlocked, sloops: s.inventory.sloops, shards: s.inventory.shards };
}

/**
 * Puts what a save says in place: the fields the answers take, except those the player chose to keep. Alternates new
 * to the planner are turned on in every factory; nothing is turned off. The file is kept in this browser.
 * Returns the fields taken.
 */
export function takeSave(found: Found, save: SaveData, answers: Answers, keep: readonly Field[]): Field[] {
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
    map: toMap(save, answers.factories),
    seen: game,
  };
  useStore.setState({
    tier: next.tier,
    skipped: next.skipped,
    unlocked: next.unlocked,
    inventory: { sloops: next.sloops, shards: next.shards },
    plans: added.length
      ? s.plans.map((p) => {
          const missing = added.filter((id) => !p.enabled.includes(id));
          return missing.length ? { ...p, enabled: [...p.enabled, ...missing] } : p;
        })
      : s.plans,
    save: info,
  });
  void keepSave(found.file);
  return taken;
}
