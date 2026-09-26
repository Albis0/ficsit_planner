import { newPlan, newPowerPlan, type Plan, type PowerPlan, useStore } from '../store';
import { DRAFT_KEY } from './feedback';
import { cleanPlan, cleanPowerPlan, cleanSettings, gridToPower } from './sanitize';
import { DEFAULT_SETTINGS, sameSettings } from './settings';

export const KIND = 'ficsit-planner';

/** Everything this app keeps in the browser: the saved session and an unsent report. */
export function wipeLocal() {
  for (const key of [KIND, DRAFT_KEY]) {
    try {
      localStorage.removeItem(key);
    } catch {}
  }
}

/** Everything worth keeping in one file: factories, power plants and the settings. */
export function exportAll() {
  const s = useStore.getState();
  const file = {
    kind: KIND,
    version: 2,
    exported: new Date().toISOString(),
    plans: s.plans,
    power: s.power,
    settings: s.settings,
  };
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
export type ImportResult = { ok: true; count: number; power: number; settings: Taken; plans: string[]; plants: string[] } | { ok: false };

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
    const file = parsed as { kind?: unknown; plans?: unknown; power?: unknown; grid?: unknown; settings?: unknown };
    if (file?.kind !== KIND || !Array.isArray(file.plans)) return { ok: false };
    const s = useStore.getState();
    // Tabs get fresh ids so they can't clash with yours; the plants' lists of factories follow them.
    const ids = new Map<string, string>();
    const added: Plan[] = file.plans.map((p: unknown) => {
      const plan = cleanPlan(p, newPlan('Factory'));
      const id = uid();
      ids.set(plan.id, id);
      return { ...plan, id };
    });
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
    return {
      ok: true,
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
