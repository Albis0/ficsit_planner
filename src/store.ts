import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { data } from './lib/data';
import type { Lang } from './lib/i18n';
import { DEFAULT_EXTRACTION, type ExtractionSettings } from './lib/extraction';
import type { RecipeMod, Target } from './lib/solver';

export const MAX_TIER = Math.max(...data.recipes.map((r) => r.tier ?? 0));

export const defaultEnabled = () => data.recipes.filter((r) => r.kind === 'standard').map((r) => r.id);

export interface Plan {
  id: string;
  name: string;
  objective: 'resources' | 'power';
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

export const newPlan = (name: string): Plan => ({
  id: uid(),
  name,
  objective: 'resources',
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
  /** Whole-UI zoom, 1 = 100%. */
  scale: number;
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

  set: (patch: Partial<Pick<State, 'lang' | 'scale' | 'tier' | 'onboarded' | 'inventory' | 'view' | 'tab' | 'active' | 'inspect'>>) => void;
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

const first = newPlan('Fabrika 1');

export const useStore = create<State>()(
  persist(
    (set, get) => {
      const update = (fn: (p: Plan) => Partial<Plan>) =>
        set({ plans: get().plans.map((p) => (p.id === get().active ? { ...p, ...fn(p) } : p)) });

      return {
        lang: 'tr',
        scale: 1,
        tier: MAX_TIER,
        onboarded: false,
        inventory: { sloops: 0, shards: 0 },
        view: 'graph',
        tab: 'targets',
        plans: [first],
        active: first.id,

        set: (patch) => set(patch),
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
          if (plans.length === 0) plans.push(newPlan('Fabrika 1'));
          const active = get().active === id ? plans[Math.max(0, get().plans.findIndex((p) => p.id === id) - 1)].id : get().active;
          set({ plans, active, inspect: undefined });
        },
        renamePlan: (id, name) => set({ plans: get().plans.map((p) => (p.id === id ? { ...p, name } : p)) }),

        addTarget: (item) =>
          update((p) => (p.targets.some((t) => t.item === item) ? {} : { targets: [...p.targets, { item, rate: 10 }] })),
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
      partialize: (s) => ({ lang: s.lang, scale: s.scale, tier: s.tier, onboarded: s.onboarded, inventory: s.inventory, view: s.view, tab: s.tab, plans: s.plans, active: s.active }),
      migrate: (persisted, version) => {
        const old = persisted as Record<string, unknown>;
        if (version < 2) {
          // v1 kept a single plan at the top level.
          const plan: Plan = { ...newPlan('Fabrika 1'), ...(old as Partial<Plan>) };
          return { lang: old.lang ?? 'tr', view: old.view ?? 'graph', tab: old.tab ?? 'targets', plans: [plan], active: plan.id };
        }
        return old;
      },
      // Drop ids that no longer exist after a game update re-extract.
      merge: (persisted, current) => {
        const p = persisted as Partial<State>;
        const valid = new Set(data.recipes.map((r) => r.id));
        const plans = (p.plans ?? current.plans).map((saved) => {
          const plan = { ...newPlan(saved.name ?? 'Fabrika'), ...saved };
          return {
            ...plan,
            enabled: plan.enabled.filter((id) => valid.has(id)),
            targets: plan.targets.filter((t) => data.items[t.item]),
            supplies: plan.supplies.filter((t) => data.items[t.item]),
            mods: Object.fromEntries(Object.entries(plan.mods).filter(([id]) => valid.has(id))),
          };
        });
        const active = plans.some((x) => x.id === p.active) ? p.active! : plans[0].id;
        return { ...current, ...p, plans, active };
      },
    },
  ),
);

export const usePlan = () => useStore((s) => s.plans.find((p) => p.id === s.active) ?? s.plans[0]);
