import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { data } from './lib/data';
import { isLang, type Lang } from './lib/lang';
import { DEFAULT_EXTRACTION, type ExtractionSettings } from './lib/extraction';
import { generatorById } from './lib/data';
import { PLANT_NAMES, type Plant, type SizeBy, sizable } from './lib/power';
import { cleanChoice, cleanNumber, cleanPlan, cleanPowerPlan, cleanSettings, gridToPower } from './lib/sanitize';
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

/**
 * A power plant tab: its generators (any mix of buildings and fuels), what it's sized to, and the
 * plan that makes its fuel. Each one is worked out on its own, like a factory tab.
 */
export interface PowerPlan {
  id: string;
  name: string;
  /** Still the name it was created with; the first generator added renames it ("Coal plant"). */
  autoName?: boolean;
  /** Rows of generators, each one building burning one fuel. */
  plants: Plant[];
  sizeBy: SizeBy;
  /** 'have': what there is to burn, raw or made, per minute. */
  have: Target[];
  /** 'want': MW to put on the grid. */
  want: number;
  /** 'factories': the factory tabs it powers, or every one of them. */
  factories: string[] | 'all';
  /** 'factories': held at this MW instead of following the factories as they change. */
  locked?: number;
  /** MW for what the planner doesn't see: trains, drones, lights, the HUB. */
  extra: number;
  /** Spare capacity kept on top of the factories, 0.1 = 10%. */
  headroom: number;
  /** Whether the plant also runs its own fuel chain: refineries, miners, pumps. */
  ownLoad: boolean;
  /** Minutes the batteries should carry the whole load for when generation stops. */
  backup: number;
  /** Recipes, limits, fuel on hand and extraction for the factory that makes the fuel. */
  chain: Plan;
}

export const newPowerPlan = (name: string, factories: PowerPlan['factories'] = 'all'): PowerPlan => {
  const id = uid();
  return {
    id,
    name,
    autoName: true,
    plants: [],
    sizeBy: 'factories',
    have: [],
    want: 1000,
    factories,
    extra: 0,
    headroom: 0.1,
    ownLoad: true,
    backup: 0,
    chain: { ...newPlan(name), id: `chain-${id}` },
  };
};

/** The factory tabs a power plant feeds. */
export const poweredBy = (pp: Pick<PowerPlan, 'factories'>, plans: Pick<Plan, 'id'>[]): Set<string> =>
  new Set(pp.factories === 'all' ? plans.map((p) => p.id) : pp.factories);

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
  /** Power plant tabs, and the one on screen. */
  power: PowerPlan[];
  activePower: string;
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
        | 'activePower'
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
  /** Changes the power plant on screen. */
  updatePower: (patch: Partial<Omit<PowerPlan, 'id' | 'chain'>>) => void;
  /** Ticks a factory on the power plant on screen, taking it off any other plant so it isn't counted twice. */
  setPowered: (factory: string, on: boolean) => void;
  addPowerPlan: (name: string) => void;
  duplicatePowerPlan: (id: string) => void;
  removePowerPlan: (id: string) => void;
  renamePowerPlan: (id: string, name: string) => void;
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
const firstPower = newPowerPlan('Plant 1');

/** The power plant tab on screen. */
export const activePowerPlan = (s: Pick<State, 'power' | 'activePower'>) => s.power.find((p) => p.id === s.activePower) ?? s.power[0];

/** "Coal plant", or "Coal plant 2" when that name is taken. */
function freeName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

export const useStore = create<State>()(
  persist(
    (set, get) => {
      // Edits to the power plant on screen.
      const power = (fn: (p: PowerPlan) => Partial<PowerPlan>) => {
        const id = activePowerPlan(get()).id;
        set({ power: get().power.map((p) => (p.id === id ? { ...p, ...fn(p) } : p)) });
      };
      // Plan edits go to whatever is on screen: the active factory, or the power plant's fuel plan.
      const update = (fn: (p: Plan) => Partial<Plan>) => {
        if (get().mode === 'power') return power((pp) => ({ chain: { ...pp.chain, ...fn(pp.chain) } }));
        set({ plans: get().plans.map((p) => (p.id === get().active ? { ...p, ...fn(p) } : p)) });
      };
      const plants = (fn: (list: Plant[]) => Plant[]) => power((pp) => ({ plants: fn(pp.plants) }));

      return {
        lang: 'en',
        mode: 'factory',
        power: [firstPower],
        activePower: firstPower.id,
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
        updatePower: (patch) => power(() => patch),
        setPowered: (factory, on) => {
          const plans = get().plans;
          const current = activePowerPlan(get()).id;
          const without = (pp: PowerPlan) => [...poweredBy(pp, plans)].filter((id) => id !== factory && plans.some((p) => p.id === id));
          set({
            power: get().power.map((pp) => {
              if (pp.id === current) return { ...pp, factories: on ? [...without(pp), factory] : without(pp) };
              return on && poweredBy(pp, plans).has(factory) ? { ...pp, factories: without(pp) } : pp;
            }),
          });
        },
        addPowerPlan: (name) => {
          // A new plant takes the factories no other plant feeds yet.
          const plans = get().plans;
          const taken = new Set(get().power.flatMap((pp) => [...poweredBy(pp, plans)]));
          const pp = newPowerPlan(
            name,
            plans.map((p) => p.id).filter((id) => !taken.has(id)),
          );
          set({ power: [...get().power, pp], activePower: pp.id, inspect: undefined });
        },
        duplicatePowerPlan: (id) => {
          const src = get().power.find((p) => p.id === id);
          if (!src) return;
          const copy = structuredClone(src);
          copy.id = uid();
          copy.name = freeName(
            src.name,
            get().power.map((p) => p.name),
          );
          copy.chain.id = `chain-${copy.id}`;
          delete copy.autoName;
          // The copy starts out feeding nothing, so no factory is counted on both.
          copy.factories = [];
          const power = [...get().power];
          power.splice(power.indexOf(src) + 1, 0, copy);
          set({ power, activePower: copy.id, inspect: undefined });
        },
        removePowerPlan: (id) => {
          const power = get().power.filter((p) => p.id !== id);
          if (power.length === 0) power.push(newPowerPlan('Plant 1'));
          const activePower =
            get().activePower === id ? power[Math.max(0, get().power.findIndex((p) => p.id === id) - 1)].id : get().activePower;
          set({ power, activePower, inspect: undefined });
        },
        renamePowerPlan: (id, name) =>
          set({ power: get().power.map((p) => (p.id === id && p.name !== name ? { ...p, name, autoName: undefined } : p)) }),
        addPlant: (generator, fuel) => {
          const pp = activePowerPlan(get());
          // An untouched plant is named after its first generator.
          const base = pp.autoName && pp.plants.length === 0 ? PLANT_NAMES[generator] : undefined;
          if (base) {
            const others = get().power.filter((p) => p.id !== pp.id);
            power(() => ({
              name: freeName(
                base,
                others.map((p) => p.name),
              ),
              autoName: undefined,
            }));
          }
          plants((list) => {
            const g = generatorById.get(generator);
            // The first burner covers the whole demand; later ones start as a few generators to split it.
            // Sized to what you have, every burner takes what it can.
            const auto =
              !!g && sizable(g) && (pp.sizeBy === 'have' || !list.some((p) => p.by === 'auto' && sizable(generatorById.get(p.generator)!)));
            const plant: Plant = { id: uid(), generator, fuel, by: auto ? 'auto' : 'count', amount: 1, clock: 1 };
            if (g?.kind === 'geothermal') plant.purity = 'normal';
            return [...list, plant];
          });
        },
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
          // Power plants stop counting a factory that's gone.
          const power = get().power.map((pp) => (pp.factories === 'all' ? pp : { ...pp, factories: pp.factories.filter((f) => f !== id) }));
          set({ plans, active, power, inspect: undefined });
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
      version: 3,
      partialize: (s) => ({
        lang: s.lang,
        mode: s.mode,
        power: s.power,
        activePower: s.activePower,
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
    | 'power'
    | 'activePower'
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
> & {
  /** Before version 3: the one power grid, now the first power plant tab. */
  grid?: unknown;
};

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
  const power =
    Array.isArray(p.power) && p.power.length
      ? p.power.map((x) => cleanPowerPlan(x, newPowerPlan('Plant')))
      : p.grid
        ? [
            gridToPower(
              p.grid,
              newPowerPlan('Plant 1'),
              plans.map((x) => x.id),
            ),
          ]
        : current.power;
  const powerIds = new Set<string>();
  for (const pp of power) {
    if (powerIds.has(pp.id)) pp.id = uid();
    powerIds.add(pp.id);
  }
  const activePower = power.some((x) => x.id === p.activePower) ? p.activePower! : power[0].id;
  return {
    ...current,
    lang: isLang(p.lang) ? p.lang : current.lang,
    mode: p.mode === 'power' ? 'power' : 'factory',
    power,
    activePower,
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

/** The plan on screen: the active factory, or in the power planner the plant's fuel plan. */
export const currentPlan = (s: Pick<State, 'mode' | 'power' | 'activePower' | 'plans' | 'active'>) =>
  s.mode === 'power' ? activePowerPlan(s).chain : (s.plans.find((p) => p.id === s.active) ?? s.plans[0]);

export const usePlan = () => useStore(currentPlan);
