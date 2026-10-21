import {
  cleanStandardOff,
  cleanUnlocked,
  dropSource,
  MAX_TIER,
  newPlan,
  newPowerPlan,
  type Plan,
  POOL,
  type PowerPlan,
  useStore,
} from '../store';
import { clearBackups } from './autobackup';
import { forgetSave } from './save/store-idb';
import { planStorage } from './safeStorage';
import { cleanNumber, cleanPlan, cleanPowerPlan, cleanSettings, gridToPower } from './sanitize';
import { DEFAULT_SETTINGS, sameSettings } from './settings';
import { cleanSkipped } from './unlocks';

export const KIND = 'ficsit-planner';

/** Everything this app keeps in the browser: the saved session, the answers to its questions, an unsent report, the saved copies, the game save. */
export async function wipeLocal() {
  // The plans may still be waiting to be written; drop them too, or leaving the page would put them back.
  planStorage.storage.removeItem(KIND);
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith('ficsit-')) localStorage.removeItem(key);
  } catch {}
  await clearBackups();
  await forgetSave();
}

/** Everything worth keeping in one file: factories, power plants and the settings. */
export function buildExport() {
  const s = useStore.getState();
  return {
    kind: KIND,
    version: 2,
    exported: new Date().toISOString(),
    plans: s.plans,
    power: s.power,
    settings: s.settings,
    tier: s.tier,
    unlocked: s.unlocked,
    standardOff: s.standardOff,
    skipped: s.skipped,
  };
}

/** How far the player has got: the tier, the milestones not bought and the alternate recipes unlocked. */
export type Progress = { tier: number; skipped: string[]; unlocked: string[]; standardOff?: string[] };

/** The progress a file carries, checked like a saved session; undefined for older files that have none. */
function progressOf(file: { tier?: unknown; skipped?: unknown; unlocked?: unknown; standardOff?: unknown }): Progress | undefined {
  if (typeof file.tier !== 'number') return undefined;
  return {
    tier: Math.round(cleanNumber(file.tier, 0, MAX_TIER, 0)),
    skipped: cleanSkipped(file.skipped),
    unlocked: cleanUnlocked(file.unlocked),
    // Files from before the switch have none: the player's own list stays.
    ...(Array.isArray(file.standardOff) ? { standardOff: cleanStandardOff(file.standardOff) } : {}),
  };
}

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Puts a file's progress in place of the player's own; only ever called from the button that offers it. */
export const applyProgress = (p: Progress) =>
  useStore.setState({ tier: p.tier, skipped: p.skipped, unlocked: p.unlocked, ...(p.standardOff ? { standardOff: p.standardOff } : {}) });
export type ExportFile = ReturnType<typeof buildExport>;

/** Whether a copy holds anything worth keeping: a factory with something in it, a plant, a hand-built floor. */
export const hasPlans = (f: Pick<ExportFile, 'plans' | 'power'>) =>
  f.plans.some((p) => p.targets.length > 0 || p.supplies.length > 0 || !!p.model?.nodes.length) || f.power.some((p) => p.plants.length > 0);

export function exportAll() {
  const file = buildExport();
  const blob = new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ficsit-planner-${file.exported.slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const uid = () => Math.random().toString(36).slice(2, 10);

type Taken = 'loaded' | 'kept' | 'none';
export type ImportResult =
  | { ok: true; count: number; power: number; settings: Taken; plans: string[]; plants: string[]; progress?: Progress }
  | { ok: false };

/** A power plant nobody has set up: no generators, still waiting for its first one. */
const untouchedPower = (list: PowerPlan[]) => list.length === 1 && list[0].plants.length === 0 && !!list[0].autoName;

/** A factory nobody has started: nothing to make and nothing on hand. */
const blankPlans = (list: Plan[]) => list.length === 1 && list[0].targets.length === 0 && list[0].supplies.length === 0;

/**
 * Adds a file's factories and power plants as new tabs (they never replace yours, except an empty
 * factory or plant you haven't touched). Its settings come along only if you haven't changed your own. Everything
 * is checked the same way a saved session is, so a damaged or hand-made file can't break the app.
 */
export async function importFile(f: File): Promise<ImportResult> {
  try {
    return importData(JSON.parse(await f.text()));
  } catch {
    return { ok: false };
  }
}

/** Adds what a backup file or a shared link carries, as new tabs; see importFile. */
export function importData(parsed: unknown): ImportResult {
  try {
    const file = parsed as {
      kind?: unknown;
      plans?: unknown;
      power?: unknown;
      grid?: unknown;
      settings?: unknown;
      tier?: unknown;
      skipped?: unknown;
      unlocked?: unknown;
      standardOff?: unknown;
    };
    if (file?.kind !== KIND || !Array.isArray(file.plans)) return { ok: false };
    const s = useStore.getState();
    // Tabs get fresh ids so they can't clash with yours; the plants' lists of factories follow them.
    const ids = new Map<string, string>();
    const cleaned: Plan[] = file.plans.map((p: unknown) => {
      const plan = cleanPlan(p, newPlan('Factory'));
      const id = uid();
      ids.set(plan.id, id);
      return { ...plan, id };
    });
    // Taken from a factory in the same file: follows its new id. From one that didn't come along: just on hand.
    const added = dropSource(cleaned, (from) => !ids.has(from)).map((p) => ({
      ...p,
      supplies: p.supplies.map((x) => (x.from && x.from !== POOL ? { ...x, from: ids.get(x.from)! } : x)),
      ...(p.model
        ? {
            model: {
              ...p.model,
              nodes: p.model.nodes.map((n) => (n.k === 'in' && n.from && n.from !== POOL ? { ...n, from: ids.get(n.from)! } : n)),
            },
          }
        : {}),
    }));
    const fileIds = added.map((p) => p.id);
    // Files from before plant tabs carry one power grid instead.
    const saved: PowerPlan[] = Array.isArray(file.power)
      ? file.power.map((x: unknown) => cleanPowerPlan(x, newPowerPlan('Plant')))
      : file.grid
        ? [gridToPower(file.grid, newPowerPlan('Plant'), [...ids.keys()])]
        : [];
    const power = saved
      .filter((pp) => pp.plants.length > 0)
      .map((pp) => {
        const id = uid();
        return {
          ...pp,
          id,
          chain: { ...pp.chain, id: `chain-${id}` },
          // "Every factory" meant the file's factories, not yours.
          factories: pp.factories === 'all' ? fileIds : pp.factories.flatMap((x) => (ids.has(x) ? [ids.get(x)!] : [])),
        };
      });
    const settings = file.settings ? cleanSettings(file.settings) : undefined;
    const settingsIn = !!settings && !sameSettings(settings, DEFAULT_SETTINGS);
    const takeSettings = settingsIn && sameSettings(s.settings, DEFAULT_SETTINGS);
    const mine = power.length && untouchedPower(s.power) ? [] : s.power;
    const myPlans = added.length && blankPlans(s.plans) ? [] : s.plans;
    useStore.setState({
      plans: [...myPlans, ...added],
      power: [...mine, ...power],
      activePower: mine.length ? s.activePower : (power[0]?.id ?? s.activePower),
      settings: takeSettings ? settings : s.settings,
      active: added[0]?.id ?? s.active,
      inspect: undefined,
    });
    // Offered, never applied here: a copy from another day shouldn't change what the player has unlocked on its own.
    const theirs = progressOf(file);
    const progress =
      theirs &&
      (theirs.tier !== s.tier ||
        !same(theirs.skipped, s.skipped) ||
        !same(theirs.unlocked, s.unlocked) ||
        (!!theirs.standardOff && !same(theirs.standardOff, s.standardOff)))
        ? theirs
        : undefined;
    return {
      ok: true,
      progress,
      count: added.length,
      power: power.length,
      settings: takeSettings ? 'loaded' : settingsIn ? 'kept' : 'none',
      plans: fileIds,
      plants: power.map((pp) => pp.id),
    };
  } catch {
    return { ok: false };
  }
}
