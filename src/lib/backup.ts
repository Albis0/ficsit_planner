import { type Grid, newGrid, newPlan, type Plan, useStore } from '../store';
import { DRAFT_KEY } from './feedback';
import { cleanGrid, cleanPlan, cleanSettings } from './sanitize';
import { DEFAULT_COLORS, DEFAULT_SETTINGS, type Settings } from './settings';

const KIND = 'ficsit-planner';

/** Everything this app keeps in the browser: the saved session and an unsent report. */
export function wipeLocal() {
  for (const key of [KIND, DRAFT_KEY]) {
    try {
      localStorage.removeItem(key);
    } catch {}
  }
}

/** Everything worth keeping in one file: factories, the power grid and the settings. */
export function exportAll() {
  const s = useStore.getState();
  const file = {
    kind: KIND,
    version: 1,
    exported: new Date().toISOString(),
    plans: s.plans,
    grid: s.grid,
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
export type ImportResult = { ok: true; count: number; grid: Taken; settings: Taken } | { ok: false };

/** Whether the player has set anything on the grid yet: plants, loads, or the fuel chain's recipes and limits. */
function untouchedGrid(g: Grid): boolean {
  const d = newGrid();
  const c = g.chain;
  const empty = (x: object) => Object.keys(x).length === 0;
  const enabled = new Set(c.enabled);
  return (
    g.plants.length === 0 &&
    g.exclude.length === 0 &&
    g.extra === d.extra &&
    g.headroom === d.headroom &&
    g.backup === d.backup &&
    c.supplies.length === 0 &&
    empty(c.caps) &&
    empty(c.fixed) &&
    empty(c.mods) &&
    enabled.size === d.chain.enabled.length &&
    d.chain.enabled.every((id) => enabled.has(id)) &&
    c.extraction.miner === d.chain.extraction.miner &&
    c.extraction.purity === d.chain.extraction.purity &&
    c.extraction.clock === d.chain.extraction.clock
  );
}

function sameSettings(a: Settings, b: Settings): boolean {
  return (Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]).every((k) =>
    k === 'colors'
      ? (Object.keys(DEFAULT_COLORS) as (keyof Settings['colors'])[]).every((c) => a.colors[c] === b.colors[c])
      : a[k] === b[k],
  );
}

/**
 * Adds a file's factories as new tabs (they never replace yours). Its power grid and its settings
 * come along only where you haven't set up your own, so nothing of yours is overwritten. Everything
 * is checked the same way a saved session is, so a damaged or hand-made file can't break the app.
 */
export async function importFile(f: File): Promise<ImportResult> {
  try {
    const parsed = JSON.parse(await f.text());
    if (parsed?.kind !== KIND || !Array.isArray(parsed.plans)) return { ok: false };
    const s = useStore.getState();
    // Tabs get fresh ids so they can't clash with yours; the grid's list of left-out factories follows them.
    const ids = new Map<string, string>();
    const added: Plan[] = parsed.plans.map((p: unknown) => {
      const plan = cleanPlan(p, newPlan('Factory'));
      const id = uid();
      ids.set(plan.id, id);
      return { ...plan, id };
    });
    const grid = parsed.grid ? cleanGrid(parsed.grid, newGrid()) : undefined;
    if (grid) grid.exclude = grid.exclude.flatMap((id) => (ids.has(id) ? [ids.get(id)!] : []));
    const gridIn = !!grid && !untouchedGrid(grid);
    const takeGrid = gridIn && untouchedGrid(s.grid);
    const settings = parsed.settings ? cleanSettings(parsed.settings) : undefined;
    const settingsIn = !!settings && !sameSettings(settings, DEFAULT_SETTINGS);
    const takeSettings = settingsIn && sameSettings(s.settings, DEFAULT_SETTINGS);
    useStore.setState({
      plans: [...s.plans, ...added],
      grid: takeGrid ? grid : s.grid,
      settings: takeSettings ? settings : s.settings,
      active: added[0]?.id ?? s.active,
      inspect: undefined,
    });
    return {
      ok: true,
      count: added.length,
      grid: takeGrid ? 'loaded' : gridIn ? 'kept' : 'none',
      settings: takeSettings ? 'loaded' : settingsIn ? 'kept' : 'none',
    };
  } catch {
    return { ok: false };
  }
}
