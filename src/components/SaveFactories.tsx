import { useEffect, useMemo, useState } from 'react';
import { data, generatorById, recipeById } from '../lib/data';
import type { GameRules } from '../lib/game';
import { useT } from '../lib/i18n';
import { arrangeModel } from '../lib/model/arrange';
import { isPart } from '../lib/model/types';
import { PLANT_NAMES, type Plant, unitPower } from '../lib/power';
import { buildingOf, factoryTitle, type SaveFactory, type SaveGrid } from '../lib/save/map';
import { savedWhen } from '../lib/save/pick';
import { type KeptFloor, keepFloor, keptFloor } from '../lib/save/store-idb';
import { saveTicks } from '../lib/save/ticks';
import type { SolveResult } from '../lib/solver';
import { factoryPower } from '../lib/solution';
import { useMediaQuery } from '../lib/useMediaQuery';
import { type Plan, useStore, useTier } from '../store';
import { Glyph } from './Glyph';
import { Icon } from './Icon';
import { useModelCalc } from './modeler/hosts';
import { type ModelHost, ModelEditor } from './modeler/ModelEditor';

/** A factory of the followed game save, by its id. */
export const useSaveFactory = (id: string | undefined) =>
  useStore((s) => (id ? s.save?.map?.factories.find((f) => f.id === id) : undefined));

const machinesIn = (f: SaveFactory) => Object.values(f.count).reduce((s, n) => s + n, 0);

/** The buildings of a save factory as icons, the most first, each with how many. */
export function SaveCounts({ f }: { f: SaveFactory }) {
  const { name } = useT();
  return (
    <ul className="save-counts">
      {Object.entries(f.count)
        .sort((a, b) => b[1] - a[1])
        .map(([cls, n]) => (
          <li key={cls} title={name(buildingOf(cls))}>
            <Icon id={cls} size={28} />
            <b>{n}</b>
          </li>
        ))}
    </ul>
  );
}

/** Which factory tab a save factory is linked to; choosing one links it there, "Not linked" unlinks it. */
export function SaveLink({ f }: { f: SaveFactory }) {
  const { t, name } = useT();
  const plans = useStore((s) => s.plans);
  const linkSave = useStore((s) => s.linkSave);
  const linked = plans.find((p) => p.saveFactory === f.id);
  return (
    <select
      className="save-link"
      value={linked?.id ?? ''}
      aria-label={t('saveLinkLabel', { name: name(factoryTitle(f)) })}
      onChange={(e) => {
        const to = e.target.value;
        if (to) linkSave(to, f.id);
        else if (linked) linkSave(linked.id, undefined);
      }}
    >
      <option value="">{t('saveNotLinked')}</option>
      {plans.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

/** Opens a save factory's floor, read-only, in place of the "All" page. */
export const openSaveFloor = (id: string) =>
  useStore.getState().set({ mode: 'factory', overview: true, saveView: id, pane: 'floor', inspect: undefined });

/** Shows a save factory on the map. */
export const showSaveOnMap = (id: string) =>
  useStore.getState().set({ mode: 'map', pane: 'floor', inspect: undefined, mapFocus: `save:${id}` });

/** All › From your save: a card for each factory in the followed save, to link it to a factory tab or open its floor. */
export function SaveFactoryList() {
  const { t, name } = useT();
  const save = useStore((s) => s.save);
  const factories = save?.map?.factories ?? [];
  const grids = save?.grids ?? [];
  const [open, setOpen] = useState(true);
  if (!save || (!factories.length && !grids.length)) return null;
  return (
    <section className="ov-section save-list" data-open={open}>
      <h2 className="ov-title">
        <button type="button" className="save-list-head" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Glyph name={open ? 'chevronDown' : 'chevronRight'} size={18} />
          {t('mapFromSave')}
          <small>{t('saveLine', { game: save.game, when: savedWhen(save.savedAt, t('today')) })}</small>
        </button>
      </h2>
      {open && factories.length > 0 && (
        <div className="save-cards">
          {factories.map((f) => {
            const n = machinesIn(f);
            return (
              <article key={f.id} className="save-card">
                <header>
                  <Icon id={f.item} size={40} />
                  <span>
                    <b>{name(factoryTitle(f))}</b>
                    <small>{n === 1 ? t('saveMachine') : t('saveMachines', { n })}</small>
                  </span>
                </header>
                <SaveCounts f={f} />
                <footer>
                  <SaveLink f={f} />
                  <button type="button" className="ghost-button" onClick={() => openSaveFloor(f.id)}>
                    {t('saveOpen')}
                  </button>
                </footer>
              </article>
            );
          })}
        </div>
      )}
      {open && grids.length > 0 && <SaveGrids grids={grids} />}
    </section>
  );
}

const BATTERY = data.powerStorage.id;

/** The generator making the most of a circuit's power: what its card and plant tab are named after. */
const mainGenerator = (g: SaveGrid) =>
  g.plants.reduce((a, b) => (unitPower(asPlant(b)) * b.n > unitPower(asPlant(a)) * a.n ? b : a)).generator;
const asPlant = ({ n, ...r }: SaveGrid['plants'][number]): Plant => ({ ...r, id: '', by: 'count', amount: n });

/** All › From your save › Power circuits: a card for each circuit with generators, what it makes and draws, and a plant tab to make of it. */
function SaveGrids({ grids }: { grids: SaveGrid[] }) {
  const { t, name, num } = useT();
  const plantFromSave = useStore((s) => s.plantFromSave);
  return (
    <>
      <h3 className="ov-title save-grids-title">{t('saveQPower')}</h3>
      <div className="save-cards">
        {grids.map((g) => {
          const main = mainGenerator(g);
          const title = PLANT_NAMES[main] ?? name(generatorById.get(main));
          const rows = new Map<string, number>();
          for (const p of g.plants) rows.set(p.generator, (rows.get(p.generator) ?? 0) + p.n);
          if (g.batteries) rows.set(BATTERY, g.batteries);
          return (
            <article key={g.id} className="save-card">
              <header>
                <Icon id={main} size={40} />
                <span>
                  <b>{title}</b>
                  <small>{t('saveGridLine', { made: num(g.made), used: num(g.used) })}</small>
                </span>
              </header>
              <ul className="save-counts">
                {[...rows].map(([cls, n]) => (
                  <li key={cls} title={cls === BATTERY ? name(data.powerStorage) : name(buildingOf(cls))}>
                    <Icon id={cls} size={28} />
                    <b>{n}</b>
                  </li>
                ))}
              </ul>
              <footer>
                <span />
                <button type="button" className="ghost-button" onClick={() => plantFromSave(title, g.plants)}>
                  {t('saveMakePlant')}
                </button>
              </footer>
            </article>
          );
        })}
      </div>
    </>
  );
}

const noop = () => {};
/** Floors past this many cards are laid out the quick way (see arrange.ts). */
const QUICK = 150;

/** A save factory's floor, read-only: its cards and belts as built in the game, the totals over it, what it is beside it. */
export function SaveFloor({ id }: { id: string }) {
  const { t, num } = useT();
  const f = useSaveFactory(id);
  const importedAt = useStore((s) => s.save?.importedAt);
  const tier = useTier();
  const game: GameRules = useStore((s) => s.settings.game);
  const [floor, setFloor] = useState<KeptFloor | 'gone'>();
  const [laying, setLaying] = useState<number>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new import brings new floors
  useEffect(() => {
    let gone = false;
    setFloor(undefined);
    void (async () => {
      const kept = await keptFloor(id);
      if (gone) return;
      if (!kept) return setFloor('gone');
      if (kept.laid) return setFloor(kept);
      // Laid out the first time it is opened, and kept that way.
      const parts = kept.model.nodes.filter(isPart).length;
      setLaying(parts);
      const laid: KeptFloor = { ...kept, model: await arrangeModel(kept.model, parts > QUICK), laid: true };
      void keepFloor(id, laid);
      if (gone) return;
      setLaying(undefined);
      setFloor(laid);
    })();
    return () => {
      gone = true;
    };
  }, [id, importedAt]);
  const model = floor && floor !== 'gone' ? floor.model : undefined;
  const hand = useModelCalc(model, tier, game, !!model);
  const host = useMemo<ModelHost | undefined>(
    () => (model ? { key: `save:${id}`, model, edit: noop, undo: noop, redo: noop } : undefined),
    [model, id],
  );
  const power = hand.adapted ? factoryPower(hand.adapted.result, hand.adapted.extraction) : undefined;
  return (
    <>
      {power && (
        <div className="summary">
          <div className="readouts">
            <div className="readout power">
              <span className="readout-label">{t('power')}</span>
              <span className="readout-value">
                {num(power.machines + power.extractors)} <small>MW</small>
              </span>
              <span className="readout-sub">{t('powerSplit', { machines: num(power.machines), extractors: num(power.extractors) })}</span>
            </div>
            <div className="readout">
              <span className="readout-label">{t('machines')}</span>
              <span className="readout-value">{power.count}</span>
            </div>
            <div className="readout">
              <span className="readout-label">{t('extractors')}</span>
              <span className="readout-value">{hand.adapted?.extraction.reduce((s, u) => s + u.built, 0)}</span>
            </div>
          </div>
        </div>
      )}
      <div className="floor-view save-floor">
        {host && <ModelEditor key={host.key} host={host} calc={hand.calc} readOnly />}
        {model && <span className="save-stamp">{t('saveReadOnly')}</span>}
        {f && <SaveInfo f={f} floor={floor !== 'gone' ? floor : undefined} />}
        {laying !== undefined && <div className="busy">{t('saveFloorLaying', { n: num(laying) })}</div>}
        {floor === 'gone' && (
          <div className="floor-message">
            <p className="hint">{t('saveFloorGone')}</p>
          </div>
        )}
      </div>
    </>
  );
}

/** Beside a save factory's floor: what it is, where it is from, what it is linked to, and a copy to build on. Folds away. */
function SaveInfo({ f, floor }: { f: SaveFactory; floor?: KeptFloor }) {
  const { t, name } = useT();
  const save = useStore((s) => s.save);
  const phone = useMediaQuery('(max-width: 900px)');
  const [open, setOpen] = useState(!phone);
  const title = name(factoryTitle(f));
  const skipped = floor?.skipped ?? 0;
  return (
    <aside className="save-info" data-open={open}>
      <button type="button" className="save-info-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Glyph name="lock" size={20} />
        <span>{title}</span>
        <Glyph name={open ? 'chevronUp' : 'chevronDown'} size={18} />
      </button>
      {open && (
        <div className="save-info-body">
          {save && <p className="save-info-from">{t('saveFloorFrom', { game: save.game, when: savedWhen(save.savedAt, t('today')) })}</p>}
          <SaveCounts f={f} />
          {skipped > 0 && <p className="save-small">{skipped === 1 ? t('saveFloorLeftOutOne') : t('saveFloorLeftOut', { n: skipped })}</p>}
          <div className="save-info-link">
            <span>{t('saveLinkedTo')}</span>
            <SaveLink f={f} />
          </div>
          <button type="button" className="text-button" onClick={() => showSaveOnMap(f.id)}>
            {t('saveShowOnMap')}
          </button>
        </div>
      )}
    </aside>
  );
}

/** The save ticks put on each factory tab, by import and save factory: a tab is ticked once per import, and what the player changes after stays. */
const ticked = new Map<string, string>();

/** Ticks a linked factory tab built where the game save has the machines (see saveTicks), once per import. */
function useSaveTicks(plan: Plan, f: SaveFactory, result: SolveResult | undefined, ready: boolean) {
  const importedAt = useStore((s) => s.save?.importedAt);
  useEffect(() => {
    const key = `${f.id}|${importedAt}`;
    if (!ready || !result || ticked.get(plan.id) === key) return;
    ticked.set(plan.id, key);
    const next = saveTicks(plan, f.recipes, result);
    if (!next) return;
    useStore.setState((s) => ({
      plans: s.plans.map((p) => {
        if (p.id !== plan.id) return p;
        if ('nodes' in next) return p.model ? { ...p, model: { ...p.model, nodes: next.nodes } } : p;
        const { built: _, savedBuilt: __, ...rest } = p;
        return {
          ...rest,
          ...(next.built.length ? { built: next.built } : {}),
          ...(next.savedBuilt.length ? { savedBuilt: next.savedBuilt } : {}),
        };
      }),
    }));
  }, [plan, f, result, ready, importedAt]);
}

/** On a linked factory tab's floor: recipe by recipe, how many of its machines the game save has built. Folds away. */
export function SaveCompare({ plan, result, ready }: { plan: Plan; result?: SolveResult; ready: boolean }) {
  const { t, name } = useT();
  const f = useSaveFactory(plan.saveFactory);
  const game = useStore((s) => s.save?.game ?? '');
  const inspect = useStore((s) => s.inspect);
  const [open, setOpen] = useState(true);
  if (!f) return null;
  return (
    <>
      <Ticks plan={plan} f={f} result={result} ready={ready} />
      {!inspect && result && (
        <aside className="save-compare" data-open={open}>
          <button type="button" className="save-compare-head" aria-expanded={open} onClick={() => setOpen(!open)}>
            <span>{t('saveCompare', { name: name(factoryTitle(f)), game })}</span>
            <Glyph name={open ? 'chevronUp' : 'chevronDown'} size={18} />
          </button>
          {open && <CompareRows f={f} result={result} />}
        </aside>
      )}
    </>
  );
}

function Ticks(p: { plan: Plan; f: SaveFactory; result?: SolveResult; ready: boolean }) {
  useSaveTicks(p.plan, p.f, p.result, p.ready);
  return null;
}

function CompareRows({ f, result }: { f: SaveFactory; result: SolveResult }) {
  const { name } = useT();
  const rows = useMemo(() => {
    const planned = new Map<string, number>();
    for (const r of result.recipes) if (r.built > 0) planned.set(r.recipe.id, (planned.get(r.recipe.id) ?? 0) + r.built);
    return [...planned].map(([id, n]) => ({ recipe: recipeById.get(id), planned: n, have: f.recipes[id] ?? 0 }));
  }, [result, f]);
  return (
    <ul className="save-compare-rows">
      {rows.map(({ recipe, planned, have }) =>
        recipe ? (
          <li key={recipe.id} data-done={have >= planned || undefined}>
            <Icon id={recipe.machine} size={26} />
            <span className="save-compare-name">{name(recipe)}</span>
            <b>
              {have}/{planned}
            </b>
            <span className="save-bar" aria-hidden>
              <i style={{ width: `${Math.min(1, have / planned) * 100}%` }} />
            </span>
          </li>
        ) : null,
      )}
    </ul>
  );
}
