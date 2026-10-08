import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { data } from './lib/data';
import { isLang, type Lang } from './lib/lang';
import { DEFAULT_EXTRACTION, type ExtractionSettings } from './lib/extraction';
import type { Aim } from './lib/solution';
import { generatorById } from './lib/data';
import { PLANT_NAMES, type Plant, type SizeBy, sizable } from './lib/power';
import { POOL } from './lib/pool';
import { cleanChoice, cleanNumber, cleanPlan, cleanPowerPlan, cleanSettings, gridToPower } from './lib/sanitize';
import { DEFAULT_SETTINGS, type Settings } from './lib/settings';
import type { RecipeMod, Target } from './lib/solver';
import { cleanMapFilter, DEFAULT_MAP_FILTER, type MapFilter } from './lib/world';
import { autoScope, forget, powerScope, record, redo, undo } from './lib/model/history';
import { floorTargets, sameTargets, withTargets } from './lib/model/targets';
import { emptyModel, type Model } from './lib/model/types';
import type { Carrier } from './lib/transport';

export const MAX_TIER = Math.max(...data.recipes.map((r) => r.tier ?? 0));

export const defaultEnabled = () => data.recipes.filter((r) => r.kind === 'standard').map((r) => r.id);

export { POOL };

/** An item a factory gets instead of making it: on hand (a train, storage), taken from another factory tab, or from the pool. */
export interface Supply extends Target {
  /** The factory tab it comes from, which makes it on top of its own targets; or POOL, which makes nothing extra. */
  from?: string;
}

export interface Plan {
  id: string;
  name: string;
  targets: Target[];
  supplies: Supply[];
  enabled: string[];
  caps: Record<string, number>;
  /** Raw resources pinned to an exact amount from the graph; targets scale to fit them. */
  fixed: Record<string, number>;
  /** Per-recipe clock speed and somersloops. */
  mods: Record<string, RecipeMod>;
  /** Which miner, node purity and clock to count extractors with. */
  extraction: ExtractionSettings;
  /** How each input arrives and each output leaves ("in:<item>", "out:<item>"); belts or pipes when not set. */
  transport?: Record<string, Route>;
  /** Built by hand on the floor instead of worked out from the targets. */
  floor?: 'manual';
  /** The hand-built factory; kept when switching back to Auto, so Manual comes back as it was. */
  model?: Model;
  /** Recipes whose machines are built in the game, ticked from the Auto floor; Manual cards start from them. */
  built?: string[];
  /** Targets (by item) made on a line of their own, apart from the others; unset: everything is one line. */
  separate?: string[];
  /** What a raw resource costs this plan when the cost is set by hand (Resources › Cost › Custom). */
  weights?: Record<string, number>;
}

/** A carrier chosen for one input or output, and how far it goes one way, in metres. */
export interface Route {
  by: Carrier;
  distance: number;
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
  /** 'have': what there is to burn, raw or made, per minute; some of it may come from the pool. */
  have: Supply[];
  /** 'want': MW to put on the grid. */
  want: number;
  /** 'factories': the factory tabs it powers, or every one of them. */
  factories: string[] | 'all';
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

/** The plan's built ticks with one recipe ticked or unticked; for `updatePlan`. */
export const toggleBuilt =
  (recipe: string) =>
  (p: Plan): Partial<Plan> => {
    const on = p.built ?? [];
    const next = on.includes(recipe) ? on.filter((id) => id !== recipe) : [...on, recipe];
    return { built: next.length ? next : undefined };
  };

/** The plan's separate lines with one product put on a line of its own or taken off it; for `updatePlan`. */
export const toggleLine =
  (item: string) =>
  (p: Plan): Partial<Plan> => {
    const on = p.separate ?? [];
    const next = on.includes(item) ? on.filter((x) => x !== item) : [...on, item];
    return { separate: next.length ? next : undefined };
  };

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
  /** What's on screen: the factory planner, the power planner, the Codex or the world map. */
  mode: 'factory' | 'power' | 'codex' | 'map';
  /** World map: resources left off it, and which node purities show (0 impure, 1 normal, 2 pure). */
  mapFilter: MapFilter;
  /** A resource the map was just asked to show (from the Codex or the resources panel). Not persisted. */
  mapFocus?: string;
  /** Codex page on screen, as in the address: '' for its home, 'item/Desc_Motor_C' for a part. */
  codexPage: string;
  /** Power plant tabs, and the one on screen. */
  power: PowerPlan[];
  activePower: string;
  settings: Settings;
  /** Open modal. Not persisted. */
  dialog?: 'settings' | 'report';
  /** Highest milestone tier the player has unlocked in their save. Recipes and buildings above it sit out. */
  tier: number;
  /** Every raw resource costs the plan the same, for mods that let you build nodes anywhere. */
  equalWeights: boolean;
  /** Every plan costs its resources as it sets them itself, where it does. */
  customWeights: boolean;
  /** Plan for the fewest machines instead of the fewest resources. */
  fewestBuildings: boolean;
  /** Newest version whose notes under Settings › Updates were opened. */
  seenUpdates?: string;
  /** Whether the first-run "where are you in the game" question was answered. */
  onboarded: boolean;
  /** Somersloops and power shards the player owns, for auto placement. */
  inventory: { sloops: number; shards: number };
  view: 'graph' | 'table' | 'transport';
  tab: 'targets' | 'recipes' | 'resources';
  plans: Plan[];
  active: string;
  /** Machine opened in the inspector. Not persisted. */
  inspect?: string;
  /** On phones the side panel and the factory floor take turns filling the screen. Not persisted. */
  pane: 'side' | 'floor';
  /** The "All" tab is open: every factory and power plant side by side, read-only. Not persisted. */
  overview?: boolean;
  /** Factory tab being renamed. Not persisted. */
  renaming?: string;
  /** Height of the panel above the factory floor, set by dragging its edge; unset uses the layout default. */
  deckHeight?: number;
  /** Width of the panel beside the floor when it sits on the left or right. */
  sideWidth?: number;
  /** Panel above the floor folded down to its tabs, so the factory gets the whole screen. */
  deckClosed?: boolean;
  /** The totals strip over the factory folded down to one line. */
  summaryClosed?: boolean;
  /** Graph direction picked by the player; unset lets the layout choose what fits the screen. */
  graphDir?: 'LR' | 'TB';
  /** A short message at the foot of the screen (a shared link opened, or couldn't be read). Not persisted. */
  notice?: { key: 'sharedOpened' | 'sharedPlantOpened' | 'sharedBroken'; name?: string };
  /** The tab just closed, and everything as it was before, so Undo can put it back. Not persisted. */
  closed?: { name: string; before: Pick<State, 'plans' | 'power' | 'active' | 'activePower'> };

  set: (
    patch: Partial<
      Pick<
        State,
        | 'lang'
        | 'mode'
        | 'codexPage'
        | 'mapFilter'
        | 'mapFocus'
        | 'dialog'
        | 'tier'
        | 'equalWeights'
        | 'customWeights'
        | 'fewestBuildings'
        | 'seenUpdates'
        | 'onboarded'
        | 'inventory'
        | 'view'
        | 'tab'
        | 'active'
        | 'activePower'
        | 'inspect'
        | 'overview'
        | 'pane'
        | 'renaming'
        | 'deckHeight'
        | 'sideWidth'
        | 'deckClosed'
        | 'summaryClosed'
        | 'graphDir'
        | 'notice'
        | 'closed'
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
  /**
   * Opens a factory making one item (the Codex's build buttons): in the tab on screen when it's still blank,
   * otherwise in a new tab named after the item. With a recipe, that recipe is the only one making the item.
   */
  buildFactory: (item: string, name: string, recipe?: string) => void;
  /** Opens a power plant burning one fuel: in the plant on screen when it has no generators yet, otherwise in a new one. */
  buildPlant: (generator: string, fuel: string) => void;
  duplicatePlan: (id: string) => void;
  removePlan: (id: string) => void;
  renamePlan: (id: string, name: string) => void;

  addTarget: (item: string) => void;
  setTarget: (i: number, rate: number) => void;
  removeTarget: (i: number) => void;
  addSupply: (item: string, rate?: number, from?: string) => void;
  /** Where an on-hand item comes from: another factory tab, or nowhere in particular. */
  setSupplyFrom: (i: number, from: string | undefined) => void;
  setSupply: (i: number, rate: number) => void;
  removeSupply: (i: number) => void;
  toggleRecipe: (id: string, on?: boolean) => void;
  setRecipes: (ids: string[], on: boolean) => void;
  setCap: (item: string, cap: number | undefined) => void;
  setWeight: (item: string, weight: number | undefined) => void;
  setMod: (recipe: string, mod: RecipeMod | undefined) => void;
  /** Auto or Manual for a factory tab; a model to start Manual with, when there isn't one yet or it's rebuilt. */
  setFloor: (plan: string, floor: 'auto' | 'manual', model?: Model) => void;
  /**
   * Changes a factory's hand-built model. The model before goes on the tab's undo list; edits sharing a merge key a
   * moment apart (typing, a slider) undo as one.
   */
  editModel: (plan: string, fn: (m: Model) => Model, merge?: string) => void;
  undoModel: (plan: string) => void;
  redoModel: (plan: string) => void;
  /** Undo and redo for the Auto floor's plan, or the power plant, on screen. */
  undoPlan: () => void;
  redoPlan: () => void;
}

const first = newPlan('Factory 1');
const firstPower = newPowerPlan('Plant 1');

/** The power plant tab on screen. */
export const activePowerPlan = (s: Pick<State, 'power' | 'activePower'>) => s.power.find((p) => p.id === s.activePower) ?? s.power[0];

/** Supplies taken from a factory that isn't there (any more) become plain on-hand items. */
export function dropSource(plans: Plan[], gone: string | ((id: string) => boolean)): Plan[] {
  const test = typeof gone === 'string' ? (id: string) => id === gone : gone;
  // The pool is always there.
  const missing = (id: string) => id !== POOL && test(id);
  return plans.map((p) =>
    p.supplies.some((x) => x.from && missing(x.from))
      ? { ...p, supplies: p.supplies.map(({ from, ...x }) => (from && !missing(from) ? { ...x, from } : x)) }
      : p,
  );
}

/** Whether a patch would change anything in what it's applied to. */
const changes = (before: object, patch: object) =>
  Object.entries(patch).some(([k, v]) => JSON.stringify(v) !== JSON.stringify((before as Record<string, unknown>)[k]));

/** What other factory tabs take from this one: it makes these on top of its own targets. */
export function exportsOf(plans: Plan[], id: string): { item: string; rate: number; to: string }[] {
  return plans.flatMap((q) =>
    q.id === id ? [] : q.supplies.filter((x) => x.from === id && x.rate > 0).map((x) => ({ item: x.item, rate: x.rate, to: q.id })),
  );
}

/** "Motor (2)", or "Motor (3)" when that's taken too: the name a copy of a tab gets. */
function copyName(name: string, taken: string[]): string {
  let n = 2;
  while (taken.includes(`${name} (${n})`)) n++;
  return `${name} (${n})`;
}

/** "Coal plant", or "Coal plant 2" when that name is taken. */
function freeName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** What the plans keep down, from the choice on the Resources tab. */
export const aimOf = (s: Pick<State, 'equalWeights' | 'fewestBuildings' | 'customWeights'>): Aim =>
  s.fewestBuildings ? 'buildings' : s.customWeights ? 'custom' : s.equalWeights ? 'equal' : 'rarity';

/** What a reload keeps: the part of the state written to the browser's storage. */
export const persisted = (s: State): Persisted => ({
  lang: s.lang,
  mode: s.mode,
  codexPage: s.codexPage,
  mapFilter: s.mapFilter,
  power: s.power,
  activePower: s.activePower,
  settings: s.settings,
  sideWidth: s.sideWidth,
  tier: s.tier,
  equalWeights: s.equalWeights,
  customWeights: s.customWeights,
  fewestBuildings: s.fewestBuildings,
  seenUpdates: s.seenUpdates,
  onboarded: s.onboarded,
  inventory: s.inventory,
  view: s.view,
  tab: s.tab,
  plans: s.plans,
  active: s.active,
  deckHeight: s.deckHeight,
  deckClosed: s.deckClosed,
  summaryClosed: s.summaryClosed,
  graphDir: s.graphDir,
});

export const useStore = create<State>()(
  persist(
    (set, get) => {
      // Edits to the power plant on screen; the plant as it was goes on its undo list.
      const power = (fn: (p: PowerPlan) => Partial<PowerPlan>, merge?: string) => {
        const id = activePowerPlan(get()).id;
        set({
          power: get().power.map((p) => {
            if (p.id !== id) return p;
            const patch = fn(p);
            if (changes(p, patch)) record(powerScope(id), p, merge);
            return { ...p, ...patch };
          }),
        });
      };
      // Plan edits go to whatever is on screen: the active factory, or the power plant's fuel plan. On the Auto floor
      // the plan as it was goes on the tab's undo list; edits sharing a merge key a moment apart undo as one.
      const update = (fn: (p: Plan) => Partial<Plan>, merge?: string) => {
        if (get().mode === 'power') return power((pp) => ({ chain: { ...pp.chain, ...fn(pp.chain) } }), merge);
        set({
          plans: get().plans.map((p) => {
            if (p.id !== get().active) return p;
            const patch = fn(p);
            if (p.floor !== 'manual' && changes(p, patch)) record(autoScope(p.id), p, merge);
            // Targets and a hand-built floor's products are one list: new targets reach its output cards, one step to undo.
            if (patch.targets && p.model && !patch.model) {
              const model = withTargets(p.model, patch.targets);
              if (model !== p.model) {
                record(p.id, p.model, 'targets');
                return { ...p, ...patch, model };
              }
            }
            return { ...p, ...patch };
          }),
        });
      };
      /** A hand-built floor changed: its output cards are the factory's targets from here on. */
      const withFloor = (p: Plan, model: Model): Plan => {
        const targets = floorTargets(model, p.targets);
        return sameTargets(targets, p.targets) ? { ...p, model } : { ...p, model, targets };
      };
      /** Steps the Auto floor's plan, or the power plant, on screen back or forward one edit. */
      const stepPlan = (step: typeof undo) => {
        if (get().mode === 'power') {
          const id = activePowerPlan(get()).id;
          const cur = get().power.find((p) => p.id === id);
          const snap = step(powerScope(id), cur);
          // Which factories a plant feeds is set from the factory tabs too, so it stays as it is.
          if (snap) set({ power: get().power.map((p) => (p.id === id ? { ...snap, factories: p.factories } : p)), inspect: undefined });
          return;
        }
        const id = get().active;
        const cur = get().plans.find((p) => p.id === id);
        if (!cur || cur.floor === 'manual') return;
        const snap = step(autoScope(id), cur);
        if (!snap) return;
        // The tab keeps its name, and its hand-built floor as it is except for the targets it shares with the plan.
        const { floor: _f, model: _m, name: _n, ...rest } = snap;
        const model = cur.model && withTargets(cur.model, rest.targets);
        if (model && model !== cur.model) record(id, cur.model, 'targets');
        set({
          plans: get().plans.map((p) => (p.id === id ? { ...rest, name: p.name, ...(model ? { model } : {}) } : p)),
          inspect: undefined,
        });
      };
      const plants = (fn: (list: Plant[]) => Plant[], merge?: string) => power((pp) => ({ plants: fn(pp.plants) }), merge);

      return {
        lang: 'en',
        mode: 'factory',
        codexPage: '',
        mapFilter: DEFAULT_MAP_FILTER,
        power: [firstPower],
        activePower: firstPower.id,
        settings: DEFAULT_SETTINGS,
        tier: MAX_TIER,
        equalWeights: false,
        customWeights: false,
        fewestBuildings: false,
        onboarded: false,
        inventory: { sloops: 0, shards: 0 },
        view: 'graph',
        tab: 'targets',
        pane: 'floor',
        plans: [first],
        active: first.id,

        // Going to another tab or planner leaves the "All" page.
        set: (patch) =>
          set(
            'overview' in patch || !('active' in patch || 'activePower' in patch || 'mode' in patch)
              ? patch
              : { ...patch, overview: undefined },
          ),
        setSettings: (patch) => set({ settings: { ...get().settings, ...patch } }),
        updatePower: (patch) => power(() => patch, `power:${Object.keys(patch).join()}`),
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
        updatePlant: (id, patch) =>
          plants((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)), `plant:${id}:${Object.keys(patch).join()}`),
        removePlant: (id) => plants((list) => list.filter((p) => p.id !== id)),
        updatePlan: (patch) =>
          update(
            typeof patch === 'function' ? patch : () => patch,
            typeof patch === 'function' ? undefined : `plan:${Object.keys(patch).join()}`,
          ),
        addPlan: (name) => {
          const p = newPlan(name);
          set({ plans: [...get().plans, p], active: p.id, inspect: undefined });
        },
        buildFactory: (item, name, recipe) => {
          const { plans, active } = get();
          const cur = plans.find((p) => p.id === active);
          const blank = cur && cur.targets.length === 0 && cur.supplies.length === 0 ? cur : undefined;
          let enabled = defaultEnabled();
          if (recipe) {
            const rivals = new Set(data.recipes.filter((r) => r.id !== recipe && r.outputs[0]?.item === item).map((r) => r.id));
            enabled = [...enabled.filter((id) => !rivals.has(id)), recipe];
          }
          const plan: Plan = {
            ...newPlan(
              freeName(
                name,
                plans.filter((p) => p !== blank).map((p) => p.name),
              ),
            ),
            targets: [{ item, rate: 10 }],
            enabled,
          };
          if (blank) plan.id = blank.id;
          set({
            plans: blank ? plans.map((p) => (p === blank ? plan : p)) : [...plans, plan],
            active: plan.id,
            mode: 'factory',
            tab: 'targets',
            pane: 'floor',
            inspect: undefined,
          });
        },
        buildPlant: (generator, fuel) => {
          if (activePowerPlan(get()).plants.length > 0) get().addPowerPlan(`Plant ${get().power.length + 1}`);
          get().addPlant(generator, fuel);
          set({ mode: 'power', tab: 'targets', pane: 'floor', inspect: undefined });
        },
        duplicatePlan: (id) => {
          const src = get().plans.find((p) => p.id === id);
          if (!src) return;
          const copy = {
            ...structuredClone(src),
            id: uid(),
            name: copyName(
              src.name,
              get().plans.map((p) => p.name),
            ),
          };
          const i = get().plans.indexOf(src);
          const plans = [...get().plans];
          plans.splice(i + 1, 0, copy);
          set({ plans, active: copy.id, inspect: undefined });
        },
        removePlan: (id) => {
          const plans = get().plans.filter((p) => p.id !== id);
          if (plans.length === 0) plans.push(newPlan('Factory 1'));
          const active = get().active === id ? plans[Math.max(0, get().plans.findIndex((p) => p.id === id) - 1)].id : get().active;
          // Power plants stop counting a factory that's gone, and what came from it is simply on hand now.
          const power = get().power.map((pp) => (pp.factories === 'all' ? pp : { ...pp, factories: pp.factories.filter((f) => f !== id) }));
          set({ plans: dropSource(plans, id), active, power, inspect: undefined });
        },
        renamePlan: (id, name) => set({ plans: get().plans.map((p) => (p.id === id ? { ...p, name } : p)) }),

        addTarget: (item) => update((p) => (p.targets.some((t) => t.item === item) ? {} : { targets: [...p.targets, { item, rate: 10 }] })),
        setTarget: (i, rate) => update((p) => ({ targets: p.targets.map((t, j) => (j === i ? { ...t, rate } : t)) }), `target:${i}`),
        removeTarget: (i) => update((p) => ({ targets: p.targets.filter((_, j) => j !== i) })),
        addSupply: (item, rate = 10, from) =>
          update((p) =>
            p.supplies.some((t) => t.item === item) ? {} : { supplies: [...p.supplies, from ? { item, rate, from } : { item, rate }] },
          ),
        setSupplyFrom: (i, from) =>
          update((p) => ({
            supplies: p.supplies.map((x, j) => {
              if (j !== i) return x;
              const { from: _, ...rest } = x;
              return from ? { ...rest, from } : rest;
            }),
          })),
        setSupply: (i, rate) => update((p) => ({ supplies: p.supplies.map((t, j) => (j === i ? { ...t, rate } : t)) }), `supply:${i}`),
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
          }, `cap:${item}`),
        setWeight: (item, weight) =>
          update((p) => {
            const weights = { ...p.weights };
            if (weight === undefined) delete weights[item];
            else weights[item] = weight;
            return { weights: Object.keys(weights).length ? weights : undefined };
          }, `weight:${item}`),
        setFixed: (item, rate) =>
          update((p) => {
            const fixed = { ...p.fixed };
            if (rate === undefined) delete fixed[item];
            else fixed[item] = rate;
            return { fixed };
          }, `fixed:${item}`),
        setMod: (recipe, mod) =>
          update((p) => {
            const mods = { ...p.mods };
            if (!mod || (mod.clock === 1 && mod.sloops === 0)) delete mods[recipe];
            else mods[recipe] = mod;
            return { mods };
          }, `mod:${recipe}`),
        setFloor: (id, floor, model) => {
          if (model) forget(id);
          set({
            plans: get().plans.map((p) => {
              if (p.id !== id) return p;
              const { floor: _, ...rest } = p;
              return { ...rest, ...(floor === 'manual' ? { floor } : {}), ...(model ? { model } : {}) };
            }),
            inspect: undefined,
          });
        },
        editModel: (id, fn, merge) => {
          const plan = get().plans.find((p) => p.id === id);
          // A manual floor saved without its model starts from an empty one.
          const model = plan?.model ?? (plan?.floor === 'manual' ? emptyModel() : undefined);
          if (!model) return;
          const next = fn(model);
          if (next === model) return;
          record(id, model, merge);
          set({ plans: get().plans.map((p) => (p.id === id ? withFloor(p, next) : p)) });
        },
        undoModel: (id) => {
          const plan = get().plans.find((p) => p.id === id);
          const prev = undo(id, plan?.model);
          if (prev) set({ plans: get().plans.map((p) => (p.id === id ? withFloor(p, prev) : p)) });
        },
        redoModel: (id) => {
          const plan = get().plans.find((p) => p.id === id);
          const next = redo(id, plan?.model);
          if (next) set({ plans: get().plans.map((p) => (p.id === id ? withFloor(p, next) : p)) });
        },
        undoPlan: () => stepPlan(undo),
        redoPlan: () => stepPlan(redo),
      };
    },
    {
      name: 'ficsit-planner',
      version: 3,
      partialize: persisted,
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
    | 'codexPage'
    | 'mapFilter'
    | 'power'
    | 'activePower'
    | 'settings'
    | 'tier'
    | 'equalWeights'
    | 'customWeights'
    | 'fewestBuildings'
    | 'seenUpdates'
    | 'onboarded'
    | 'inventory'
    | 'view'
    | 'tab'
    | 'plans'
    | 'active'
    | 'deckHeight'
    | 'sideWidth'
    | 'deckClosed'
    | 'summaryClosed'
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
  const known = new Set(plans.map((x) => x.id));
  for (const [i, plan] of plans.entries()) plans[i] = dropSource([plan], (from) => !known.has(from) || from === plan.id)[0];
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
    mode: cleanChoice(p.mode, ['factory', 'power', 'codex', 'map'] as const, 'factory'),
    codexPage: typeof p.codexPage === 'string' ? p.codexPage.slice(0, 200) : '',
    mapFilter: cleanMapFilter(p.mapFilter),
    power,
    activePower,
    settings: cleanSettings(p.settings),
    tier: Math.round(cleanNumber(p.tier, 0, MAX_TIER, current.tier)),
    equalWeights: p.equalWeights === true,
    customWeights: p.customWeights === true,
    fewestBuildings: p.fewestBuildings === true,
    seenUpdates: typeof p.seenUpdates === 'string' ? p.seenUpdates.slice(0, 20) : undefined,
    onboarded: p.onboarded === true,
    inventory: {
      sloops: Math.round(cleanNumber(p.inventory?.sloops, 0, 1e4, 0)),
      shards: Math.round(cleanNumber(p.inventory?.shards, 0, 1e4, 0)),
    },
    view: cleanChoice(p.view, ['graph', 'table', 'transport'] as const, current.view),
    tab: cleanChoice(p.tab, ['targets', 'recipes', 'resources'] as const, current.tab),
    deckHeight: typeof p.deckHeight === 'number' ? cleanNumber(p.deckHeight, 100, 4000, 320) : undefined,
    sideWidth: typeof p.sideWidth === 'number' ? cleanNumber(p.sideWidth, 200, 4000, 460) : undefined,
    deckClosed: p.deckClosed === true,
    summaryClosed: p.summaryClosed === true,
    graphDir: p.graphDir === 'LR' || p.graphDir === 'TB' ? p.graphDir : undefined,
    plans,
    active,
  };
}

/** The plan on screen: the active factory, or in the power planner the plant's fuel plan. */
export const currentPlan = (s: Pick<State, 'mode' | 'power' | 'activePower' | 'plans' | 'active'>) =>
  s.mode === 'power' ? activePowerPlan(s).chain : (s.plans.find((p) => p.id === s.active) ?? s.plans[0]);

export const usePlan = () => useStore(currentPlan);
