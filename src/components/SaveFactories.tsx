import { useEffect, useMemo, useState } from 'react';
import { data, generatorById, recipeById } from '../lib/data';
import { useT } from '../lib/i18n';
import { PLANT_NAMES, type Plant, unitPower } from '../lib/power';
import { buildingOf, factoryTitle, type SaveFactory, type SaveGrid } from '../lib/save/map';
import { savedWhen } from '../lib/save/pick';
import { saveTicks } from '../lib/save/ticks';
import type { SolveResult } from '../lib/solver';
import { type Plan, useStore } from '../store';
import { Glyph } from './Glyph';
import { Icon } from './Icon';

/** A factory of the followed game save, by its id. */
export const useSaveFactory = (id: string | undefined) =>
  useStore((s) => (id ? s.save?.map?.factories.find((f) => f.id === id) : undefined));

/** All › From your save: the power circuits of the followed save. */
export function SaveFactoryList() {
  const { t } = useT();
  const save = useStore((s) => s.save);
  const grids = save?.grids ?? [];
  const [open, setOpen] = useState(true);
  if (!save || !grids.length) return null;
  return (
    <section className="ov-section save-list" data-open={open}>
      <h2 className="ov-title">
        <button type="button" className="save-list-head" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Glyph name={open ? 'chevronDown' : 'chevronRight'} size={18} />
          {t('mapFromSave')}
          <small>{t('saveLine', { game: save.game, when: savedWhen(save.savedAt, t('today')) })}</small>
        </button>
      </h2>
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
