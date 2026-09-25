import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { data } from './lib/data';
import { isLang, type Lang } from './lib/lang';
import { DEFAULT_EXTRACTION, type ExtractionSettings } from './lib/extraction';
import { generatorById } from './lib/data';
import { type Plant, sizable } from './lib/power';
import { cleanChoice, cleanGrid, cleanNumber, cleanPlan, cleanSettings } from './lib/sanitize';
import { DEFAULT_SETTINGS, type Settings } from './lib/settings';
import type { RecipeMod, Target } from './lib/solver';

export const MAX_TIER = Math.max(...data.recipes.map((r) => r.tier ?? 0));

export const defaultEnabled = () => data.recipes.filter((r) => r.kind === 'standard').map((r) => r.id);

export interface Plan {
  id: string;
  name: string;
  targets: Target[];
  supplies: Target[];
  enabled: string[];
  caps: Record<string, number>;
  /** Raw resources pinned to an exact amount from the graph; targets scale to fit them. */
  fixed: Record<string, number>;
  /** Per-recipe clock speed and somersloops. */
  mods: Record<string, RecipeMod>;
  /** Which miner, node purity and clock to count extractors with. */
  extraction: ExtractionSettings;
}

const uid = () => Math.random().toString(36).slice(2, 10);

/** The power planner's one grid: its plants, the load they carry, and the plan that makes their fuel. */
export interface Grid {
  plants: Plant[];
  /** Factories left out of the demand (they're powered some other way). */
  exclude: string[];
  /** MW for what the planner doesn't see: trains, drones, lights, the HUB. */
  extra: number;
  /** Spare capacity kept on top of all consumption, 0.1 = 10%. */
  headroom: number;
  /** Minutes the batteries should carry the whole load for when generation stops. */
  backup: number;
  /** Recipes, limits, fuel on hand and extraction for the factory that makes the fuel. */
  chain: Plan;
}

export const newGrid = (): Grid => ({
  plants: [],
  exclude: [],
  extra: 0,
  headroom: 0.1,
  backup: 0,
  chain: { ...newPlan('Power'), id: 'power-grid' },
});

export const newPlan = (name: string): Plan => ({
  id: uid(),
  name,
  targets: [],
  supplies: [],
  enabled: defaultEnabled(),
  caps: {},
  fixed: {},
  mods: {},
  extraction: DEFAULT_EXTRACTION,
});

interface State {
  lang: Lang;
  /** Which planner is on screen: factories, or the power grid that runs them. */
  mode: 'factory' | 'power';
  grid: Grid;
  settings: Settings;
  /** Open modal. Not persisted. */
  dialog?: 'settings' | 'report';
  /** Highest milestone tier the player has unlocked in their save. Recipes and buildings above it sit out. */
  tier: number;
  /** Whether the first-run "where are you in the game" question was answered. */
  onboarded: boolean;
  /** Somersloops and power shards the player owns, for auto placement. */
  inventory: { sloops: number; shards: number };
  view: 'graph' | 'table';
  tab: 'targets' | 'recipes' | 'resources';
  plans: Plan[];
  active: string;
  /** Machine opened in the inspector. Not persisted. */
  inspect?: string;
  /** On phones the side panel and the factory floor take turns filling the screen. Not persisted. */
  pane: 'side' | 'floor';
  /** Factory tab being renamed. Not persisted. */
  renaming?: string;
  /** Height of the panel above the factory floor, set by dragging its edge; unset uses the layout default. */
  deckHeight?: number;
  /** Width of the panel beside the floor when it sits on the left or right. */
  sideWidth?: number;
  /** Panel above the floor folded down to its tabs, so the factory gets the whole screen. */
  deckClosed?: boolean;
  /** Graph direction picked by the player; unset lets the layout choose what fits the screen. */
  graphDir?: 'LR' | 'TB';

  set: (
    patch: Partial<
      Pick<
        State,
        | 'lang'
        | 'mode'
        | 'dialog'
        | 'tier'
        | 'onboarded'
        | 'inventory'
        | 'view'
        | 'tab'
        | 'active'
        | 'inspect'
        | 'pane'
        | 'renaming'
        | 'deckHeight'
        | 'sideWidth'
        | 'deckClosed'
        | 'graphDir'
      >
    >,
  ) => void;
  setSettings: (patch: Partial<Settings>) => void;
  updateGrid: (patch: Partial<Omit<Grid, 'chain'>>) => void;
  addPlant: (generator: string, fuel?: string) => void;
  updatePlant: (id: string, patch: Partial<Plant>) => void;
  removePlant: (id: string) => void;
  setFixed: (item: string, rate: number | undefined) => void;
  updatePlan: (patch: Partial<Plan> | ((p: Plan) => Partial<Plan>)) => void;
  addPlan: (name: string) => void;
  duplicatePlan: (id: string) => void;
  removePlan: (id: string) => void;
  renamePlan: (id: string, name: string) => void;

  addTarget: (item: string) => void;
  setTarget: (i: number, rate: number) => void;
  removeTarget: (i: number) => void;
  addSupply: (item: string, rate?: number) => void;
  setSupply: (i: number, rate: number) => void;
  removeSupply: (i: number) => void;
  toggleRecipe: (id: string, on?: boolean) => void;
  setRecipes: (ids: string[], on: boolean) => void;
  setCap: (item: string, cap: number | undefined) => void;
  setMod: (recipe: string, mod: RecipeMod | undefined) => void;
}

const first = newPlan('Factory 1');

export const useStore = create<State>()(
  persist(
    (set, get) => {
      // Plan edits go to whatever is on screen: the active factory, or the power grid's fuel plan.
      const update = (fn: (p: Plan) => Partial<Plan>) => {
        const { mode, grid } = get();
        if (mode === 'power') return set({ grid: { ...grid, chain: { ...grid.chain, ...fn(grid.chain) } } });
        set({ plans: get().plans.map((p) => (p.id === get().active ? { ...p, ...fn(p) } : p)) });
      };
      const plants = (fn: (list: Plant[]) => Plant[]) => set({ grid: { ...get().grid, plants: fn(get().grid.plants) } });

      return {
        lang: 'en',
        mode: 'factory',
        grid: newGrid(),
        settings: DEFAULT_SETTINGS,
        tier: MAX_TIER,
        onboarded: false,
        inventory: { sloops: 0, shards: 0 },
        view: 'graph',
        tab: 'targets',
        pane: 'floor',
        plans: [first],
        active: first.id,

        set: (patch) => set(patch),
        setSettings: (patch) => set({ settings: { ...get().settings, ...patch } }),
        updateGrid: (patch) => set({ grid: { ...get().grid, ...patch } }),
        addPlant: (generator, fuel) =>
          plants((list) => {
            const g = generatorById.get(generator);
            // The first burner covers the whole demand; later ones start as a few generators to split it.
            const auto = !!g && sizable(g) && !list.some((p) => p.by === 'auto' && sizable(generatorById.get(p.generator)!));
            const plant: Plant = { id: uid(), generator, fuel, by: auto ? 'auto' : 'count', amount: 1, clock: 1 };
            if (g?.kind === 'geothermal') plant.purity = 'normal';
            return [...list, plant];
          }),
        updatePlant: (id, patch) => plants((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p))),
        removePlant: (id) => plants((list) => list.filter((p) => p.id !== id)),
        updatePlan: (patch) => update(typeof patch === 'function' ? patch : () => patch),
        addPlan: (name) => {
          const p = newPlan(name);
          set({ plans: [...get().plans, p], active: p.id, inspect: undefined });
        },
        duplicatePlan: (id) => {
          const src = get().plans.find((p) => p.id === id);
          if (!src) return;
          const copy = { ...structuredClone(src), id: uid(), name: `${src.name} (2)` };
          const i = get().plans.indexOf(src);
          const plans = [...get().plans];
          plans.splice(i + 1, 0, copy);
          set({ plans, active: copy.id, inspect: undefined });
        },
        removePlan: (id) => {
          const plans = get().plans.filter((p) => p.id !== id);
          if (plans.length === 0) plans.push(newPlan('Factory 1'));
          const active = get().active === id ? plans[Math.max(0, get().plans.findIndex((p) => p.id === id) - 1)].id : get().active;
          set({ plans, active, inspect: undefined });
        },
        renamePlan: (id, name) => set({ plans: get().plans.map((p) => (p.id === id ? { ...p, name } : p)) }),

        addTarget: (item) => update((p) => (p.targets.some((t) => t.item === item) ? {} : { targets: [...p.targets, { item, rate: 10 }] })),
        setTarget: (i, rate) => update((p) => ({ targets: p.targets.map((t, j) => (j === i ? { ...t, rate } : t)) })),
        removeTarget: (i) => update((p) => ({ targets: p.targets.filter((_, j) => j !== i) })),
        addSupply: (item, rate = 10) =>
          update((p) => (p.supplies.some((t) => t.item === item) ? {} : { supplies: [...p.supplies, { item, rate }] })),
        setSupply: (i, rate) => update((p) => ({ supplies: p.supplies.map((t, j) => (j === i ? { ...t, rate } : t)) })),
        removeSupply: (i) => update((p) => ({ supplies: p.supplies.filter((_, j) => j !== i) })),
        toggleRecipe: (id, on) =>
          update((p) => {
            const cur = new Set(p.enabled);
            if (on ?? !cur.has(id)) cur.add(id);
            else cur.delete(id);
            return { enabled: [...cur] };
          }),
        setRecipes: (ids, on) =>
          update((p) => {
            const cur = new Set(p.enabled);
            for (const id of ids) {
              if (on) cur.add(id);
              else cur.delete(id);
            }
            return { enabled: [...cur] };
          }),
        setCap: (item, cap) =>
          update((p) => {
            const caps = { ...p.caps };
            if (cap === undefined) delete caps[item];
            else caps[item] = cap;
            return { caps };
          }),
        setFixed: (item, rate) =>
          update((p) => {
            const fixed = { ...p.fixed };
            if (rate === undefined) delete fixed[item];
            else fixed[item] = rate;
            return { fixed };
          }),
        setMod: (recipe, mod) =>
          update((p) => {
            const mods = { ...p.mods };
            if (!mod || (mod.clock === 1 && mod.sloops === 0)) delete mods[recipe];
            else mods[recipe] = mod;
            return { mods };
          }),
      };
    },
    {
      name: 'ficsit-planner',
      version: 2,
      partialize: (s) => ({
        lang: s.lang,
        mode: s.mode,
        grid: s.grid,
        settings: s.settings,
        sideWidth: s.sideWidth,
        tier: s.tier,
        onboarded: s.onboarded,
        inventory: s.inventory,
        view: s.view,
        tab: s.tab,
        plans: s.plans,
        active: s.active,
        deckHeight: s.deckHeight,
        deckClosed: s.deckClosed,
        graphDir: s.graphDir,
      }),
      migrate: migrateState,
      merge: mergeState,
    },
  ),
);

type Persisted = Partial<
  Pick<
    State,
    | 'lang'
    | 'mode'
    | 'grid'
    | 'settings'
    | 'tier'
    | 'onboarded'
    | 'inventory'
    | 'view'
    | 'tab'
    | 'plans'
    | 'active'
    | 'deckHeight'
    | 'sideWidth'
    | 'deckClosed'
    | 'graphDir'
  >
>;

export function migrateState(persisted: unknown, version: number): Persisted {
  const old = persisted as Record<string, unknown>;
  if (version < 2) {
    // v1 kept a single plan at the top level.
    const plan: Plan = { ...newPlan('Factory 1'), ...(old as Partial<Plan>) };
    return {
      lang: old.lang as Lang,
      view: (old.view as State['view']) ?? 'graph',
      tab: (old.tab as State['tab']) ?? 'targets',
      plans: [plan],
      active: plan.id,
    };
  }
  return old as Persisted;
}

/** Drops ids that no longer exist after a game data re-extract, and a language this build doesn’t ship. */
export function mergeState<S extends State>(persisted: unknown, current: S): S {
  const p = (persisted && typeof persisted === 'object' ? persisted : {}) as Persisted;
  const saved = Array.isArray(p.plans) && p.plans.length ? p.plans : current.plans;
  const plans = saved.map((x) => cleanPlan(x, newPlan('Factory')));
  // Two tabs with one id would edit each other; give later ones a fresh id.
  const ids = new Set<string>();
  for (const plan of plans) {
    if (ids.has(plan.id)) plan.id = uid();
    ids.add(plan.id);
  }
  const active = plans.some((x) => x.id === p.active) ? p.active! : plans[0].id;
  return {
    ...current,
    lang: isLang(p.lang) ? p.lang : current.lang,
    mode: p.mode === 'power' ? 'power' : 'factory',
    grid: cleanGrid(p.grid, newGrid()),
    settings: cleanSettings(p.settings),
    tier: Math.round(cleanNumber(p.tier, 0, MAX_TIER, current.tier)),
    onboarded: p.onboarded === true,
    inventory: {
      sloops: Math.round(cleanNumber(p.inventory?.sloops, 0, 1e4, 0)),
      shards: Math.round(cleanNumber(p.inventory?.shards, 0, 1e4, 0)),
    },
    view: cleanChoice(p.view, ['graph', 'table'] as const, current.view),
    tab: cleanChoice(p.tab, ['targets', 'recipes', 'resources'] as const, current.tab),
    deckHeight: typeof p.deckHeight === 'number' ? cleanNumber(p.deckHeight, 100, 4000, 320) : undefined,
    sideWidth: typeof p.sideWidth === 'number' ? cleanNumber(p.sideWidth, 200, 4000, 460) : undefined,
    deckClosed: p.deckClosed === true,
    graphDir: p.graphDir === 'LR' || p.graphDir === 'TB' ? p.graphDir : undefined,
    plans,
    active,
  };
}

/** The plan on screen: the active factory, or in the power planner the grid's fuel plan. */
export const currentPlan = (s: Pick<State, 'mode' | 'grid' | 'plans' | 'active'>) =>
  s.mode === 'power' ? s.grid.chain : (s.plans.find((p) => p.id === s.active) ?? s.plans[0]);

export const usePlan = () => useStore(currentPlan);
