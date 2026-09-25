import { useEffect, useRef, useState } from 'react';
import { data, type Generator } from '../lib/data';
import { PURITIES } from '../lib/extraction';
import { useT } from '../lib/i18n';
import {
  clockable,
  fuelRate,
  GEYSER_SWING,
  generatorOf,
  geyserPower,
  handFed,
  MAX_CLOCK,
  PLANT_OPTIONS,
  PLANT_PREFIX,
  type Plant,
  plantValid,
  sizable,
  unitPower,
} from '../lib/power';
import type { FactoryDraw } from '../lib/solution';
import type { SolveResult } from '../lib/solver';
import { usePlan, useStore } from '../store';
import { Glyph } from './Glyph';
import { Icon } from './Icon';
import { ItemPicker } from './ItemPicker';
import { RateInput } from './RateInput';
import { Slot } from './Slot';
import { Cards } from './TargetsPanel';

const supplyItems = Object.values(data.items).filter((i) => !i.raw);

/** The power planner's panel: what the grid has to carry, the plants that carry it, and backup. */
export function PowerPanel({ result, draws, chainDraw }: { result?: SolveResult; draws: FactoryDraw[]; chainDraw: number }) {
  return (
    <div className="panel-body power">
      <Demand draws={draws} chainDraw={chainDraw} />
      <Plants result={result} />
      <Backup result={result} draws={draws} chainDraw={chainDraw} />
    </div>
  );
}

/** Everything the grid feeds: each factory's machines and miners, plus what the planner can't see. */
function Demand({ draws, chainDraw }: { draws: FactoryDraw[]; chainDraw: number }) {
  const { t, num } = useT();
  const grid = useStore((s) => s.grid);
  const updateGrid = useStore((s) => s.updateGrid);
  const skip = new Set(grid.exclude);
  const factories = draws.reduce((s, f) => s + (skip.has(f.id) ? 0 : (f.mw ?? 0)), 0);
  const outside = factories + grid.extra;

  return (
    <section className="stack demand">
      <h3 className="section-title">{t('powerNeeded')}</h3>
      <p className="hint">{t('powerNeededHint')}</p>
      <ul className="draw-list">
        {draws.map((f) => {
          const on = !skip.has(f.id);
          return (
            <li key={f.id} className={on ? '' : 'off'}>
              <label className="draw-row">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => updateGrid({ exclude: on ? [...grid.exclude, f.id] : grid.exclude.filter((x) => x !== f.id) })}
                />
                <Glyph name="factory" size={18} />
                <span className="draw-name">{f.name}</span>
                <span className="draw-mw">
                  {f.failed ? t('cantSolve') : f.mw === undefined ? '…' : f.mw === 0 ? t('nothingPlanned') : `${num(f.mw)} MW`}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="item-card flat power-row">
        <span className="power-row-label">
          {t('otherLoad')}
          <small>{t('otherLoadHint')}</small>
        </span>
        <span className="item-card-rate">
          <RateInput value={grid.extra} label={t('otherLoad')} onChange={(v) => updateGrid({ extra: v })} step />
          <span className="unit">MW</span>
        </span>
      </div>
      <div className="item-card flat power-row">
        <span className="power-row-label">
          {t('headroom')}
          <small>{t('headroomHint')}</small>
        </span>
        <span className="item-card-rate">
          <RateInput
            value={Math.round(grid.headroom * 1000) / 10}
            label={t('headroom')}
            onChange={(v) => updateGrid({ headroom: Math.min(2, v / 100) })}
            step
          />
          <span className="unit">%</span>
        </span>
      </div>
      <p className="demand-total">
        <span>{t('gridMustCarry')}</span>
        <b>
          {num(outside * (1 + grid.headroom))} <small>MW</small>
        </b>
        {chainDraw > 0 && <span className="demand-chain">{t('plusFuelChain', { mw: num(chainDraw * (1 + grid.headroom)) })}</span>}
      </p>
    </section>
  );
}

/** The plant list and the button that adds one. */
function Plants({ result }: { result?: SolveResult }) {
  const { t } = useT();
  const plants = useStore((s) => s.grid.plants);
  return (
    <section className="stack plants">
      <h3 className="section-title">{t('powerPlants')}</h3>
      {plants.length > 1 && plants.some((p) => sizable(generatorOf(p)) && p.by === 'auto') && <p className="hint">{t('autoHint')}</p>}
      {plants.map((p) => (
        <PlantCard key={p.id} plant={p} result={result} />
      ))}
      <AddPlant />
    </section>
  );
}

/** One plant: building and fuel, how it's sized, its clock, and what it burns. */
function PlantCard({ plant, result }: { plant: Plant; result?: SolveResult }) {
  const { t, name, num } = useT();
  const tier = useStore((s) => s.tier);
  const updatePlant = useStore((s) => s.updatePlant);
  const removePlant = useStore((s) => s.removePlant);
  const set = useStore((s) => s.set);
  const g = generatorOf(plant);
  const use = result?.recipes.find((u) => u.recipe.id === PLANT_PREFIX + plant.id);
  const mw = result?.grid?.plants[plant.id] ?? 0;
  const put = (patch: Partial<Plant>) => updatePlant(plant.id, patch);
  const locked = g.tier > tier;
  const flows = [...(use?.inputs ?? []), ...(use?.outputs ?? [])];

  return (
    <article className={`plant-card ${g.kind}`} aria-label={name(g)}>
      <header className="plant-strip">
        <Icon id={g.id} size={34} className="strip-icon" />
        <span className="plant-name">{name(g)}</span>
        {locked && <span className="tier-tag">{t('tierTag', { tier: g.tier })}</span>}
        <span className="plant-mw">
          {num(mw)}
          <small>MW</small>
        </span>
        <button type="button" className="plant-remove" aria-label={`${t('remove')} ${name(g)}`} onClick={() => removePlant(plant.id)}>
          <Glyph name="close" size={16} />
        </button>
      </header>

      <div className="plant-body">
        {locked && <p className="plant-locked">{t('plantLocked', { tier: g.tier })}</p>}
        {g.kind === 'fuel' && (
          <div className="plant-field">
            <span className="control-label">{t('fuel')}</span>
            <div className="fuel-picker" role="radiogroup" aria-label={t('fuel')}>
              {g.fuels.map((f) => (
                <button
                  key={f.item}
                  type="button"
                  role="radio"
                  aria-checked={plant.fuel === f.item}
                  className="fuel-option"
                  title={`${name(data.items[f.item])}: ${num(fuelRate(g, f.item))}${t('perMin')} ${t('perGenerator')}`}
                  onClick={() => put({ fuel: f.item })}
                >
                  <Slot id={f.item} size={46} />
                </button>
              ))}
            </div>
            <span className="fuel-name">
              {plant.fuel ? name(data.items[plant.fuel]) : t('pickFuel')}
              {plant.fuel && handFed(plant.fuel) && <span className="hand-tag">{t('handFed')}</span>}
            </span>
          </div>
        )}

        {g.kind === 'geothermal' && (
          <div className="plant-field">
            <span className="control-label">{t('purity')}</span>
            <div className="segmented" role="radiogroup" aria-label={t('purity')}>
              {PURITIES.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={(plant.purity ?? 'normal') === p}
                  onClick={() => put({ purity: p })}
                >
                  {t(p)}
                </button>
              ))}
            </div>
            <span className="hint">
              {t('geyserSwing', {
                low: num(geyserPower(g, plant.purity ?? 'normal') * (1 - GEYSER_SWING)),
                high: num(geyserPower(g, plant.purity ?? 'normal') * (1 + GEYSER_SWING)),
              })}
            </span>
          </div>
        )}

        <div className="plant-field">
          <span className="control-label">{t('size')}</span>
          <div className="plant-size">
            {sizable(g) && (
              <div className="segmented" role="radiogroup" aria-label={t('size')}>
                {(['auto', 'count', 'power'] as const).map((by) => (
                  <button
                    key={by}
                    type="button"
                    role="radio"
                    aria-checked={plant.by === by}
                    onClick={() =>
                      put({
                        by,
                        // Start the new mode where the plant is now, so switching doesn't jump.
                        amount:
                          by === 'count'
                            ? Math.max(1, use?.built ?? 1)
                            : by === 'power'
                              ? Math.round(mw || unitPower(plant) * (1 + (result?.grid?.boost ?? 0)))
                              : plant.amount,
                      })
                    }
                  >
                    {t(by === 'auto' ? 'sizeAuto' : by === 'count' ? 'sizeCount' : 'sizePower')}
                  </button>
                ))}
              </div>
            )}
            {(plant.by !== 'auto' || !sizable(g)) && (
              <span className="rate-with-unit">
                <RateInput
                  value={plant.by === 'power' && sizable(g) ? plant.amount : Math.round(plant.amount)}
                  label={t('size')}
                  onChange={(v) => put({ amount: plant.by === 'power' && sizable(g) ? v : Math.round(v) })}
                  step
                />
                {g.kind !== 'augmenter' && <span className="unit">{plant.by === 'power' && sizable(g) ? 'MW' : t('generators')}</span>}
              </span>
            )}
            {plant.by === 'auto' && sizable(g) && result && !locked && plantValid(plant) && (
              <span className={`auto-note ${use ? '' : 'idle'}`}>{use ? t('autoNote', { n: use.built }) : t('autoIdle')}</span>
            )}
          </div>
        </div>

        {clockable(g) && (
          <div className="plant-field">
            <span className="control-label">{t('clockSpeed')}</span>
            <span className="rate-with-unit">
              <RateInput
                value={Math.round(plant.clock * 10000) / 100}
                label={t('clockSpeed')}
                onChange={(v) => v > 0 && put({ clock: Math.min(MAX_CLOCK, Math.max(0.01, v / 100)) })}
                step
              />
              <span className="unit">%</span>
            </span>
            {use && use.shards > 0 && <span className="mod-badge shard">{t('shardsNeeded', { n: use.shards })}</span>}
          </div>
        )}

        {g.kind === 'augmenter' && g.booster && (
          <label className="check-row">
            <input type="checkbox" checked={!!plant.fed} onChange={(e) => put({ fed: e.target.checked })} />
            <span>
              <b>{t('feedMatrix', { boost: Math.round(g.booster.boost * 100) })}</b>
              <small>{t('feedMatrixHint', { n: num(60 / g.booster.duration) })}</small>
            </span>
          </label>
        )}
      </div>

      {use && (
        <button type="button" className="plant-foot" onClick={() => set({ inspect: use.recipe.id })}>
          <span className="plant-count">
            <b>{use.built}</b> × {num(use.clock * 100)}%
          </span>
          {flows.map((f) => (
            <span key={f.item} className="plant-flow">
              <Icon id={f.item} size={22} />
              {num(f.rate)}
              {t('perMin')}
            </span>
          ))}
        </button>
      )}
    </article>
  );
}

/** "Add a power plant": every generator, and for burners every fuel, as one tap each. */
function AddPlant() {
  const { t, name, num } = useT();
  const tier = useStore((s) => s.tier);
  const addPlant = useStore((s) => s.addPlant);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  const add = (g: Generator, fuel?: string) => {
    addPlant(g.id, fuel);
    setOpen(false);
  };

  const groups = data.generators.map((g) => ({ g, options: PLANT_OPTIONS.filter((o) => o.generator === g) }));

  return (
    <div className="add-plant" ref={root}>
      <button type="button" className="add-button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden className="add-plus">
          +
        </span>
        {t('addPlant')}
      </button>
      {open && (
        <div className="plant-menu" role="menu">
          {groups.map(({ g, options }) => (
            <div key={g.id} className={`plant-menu-group ${g.tier > tier ? 'locked' : ''}`}>
              <div className="plant-menu-head">
                <Icon id={g.id} size={40} />
                <span className="plant-menu-name">
                  {name(g)}
                  <small>{g.kind === 'geothermal' ? t('geyserRange') : `${num(g.power)} MW`}</small>
                </span>
                {g.tier > tier && <span className="tier-tag">{t('tierTag', { tier: g.tier })}</span>}
                {g.kind !== 'fuel' && (
                  <button type="button" role="menuitem" className="ghost-button small" onClick={() => add(g)}>
                    {t('add')}
                  </button>
                )}
              </div>
              {g.kind === 'fuel' && (
                <div className="plant-menu-fuels">
                  {options.map((o) => (
                    <button key={o.fuel} type="button" role="menuitem" className="fuel-chip" onClick={() => add(g, o.fuel)}>
                      <Icon id={o.fuel!} size={26} />
                      <span>{name(data.items[o.fuel!])}</span>
                      <small>
                        {num(fuelRate(g, o.fuel!))}
                        {t('perMin')}
                      </small>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Batteries to ride out a stop, and fuel already arriving from somewhere else. */
function Backup({ result, draws, chainDraw }: { result?: SolveResult; draws: FactoryDraw[]; chainDraw: number }) {
  const { t, num, name } = useT();
  const grid = useStore((s) => s.grid);
  const updateGrid = useStore((s) => s.updateGrid);
  const plan = usePlan();
  const s = useStore();
  const storage = data.powerStorage;
  const skip = new Set(grid.exclude);
  const load = draws.reduce((sum, f) => sum + (skip.has(f.id) ? 0 : (f.mw ?? 0)), 0) + grid.extra + chainDraw;
  const need = (load * grid.backup) / 60;
  const units = need > 0 ? Math.ceil(need / storage.capacity - 1e-9) : 0;
  const spare = result?.grid ? result.grid.generation - load : 0;
  // Each storage charges at most `rate` MW, so a big bank can't take in more than that times its size.
  const charge = Math.min(spare, units * storage.rate);
  const hours = charge > 0 ? need / charge : Number.POSITIVE_INFINITY;

  return (
    <section className="stack backup">
      <h3 className="section-title with-icon">
        <Glyph name="battery" size={20} />
        {t('backup')}
      </h3>
      <p className="hint">{t('backupHint')}</p>
      <div className="item-card flat power-row">
        <span className="power-row-label">{t('rideOut')}</span>
        <span className="item-card-rate">
          <RateInput value={grid.backup} label={t('rideOut')} onChange={(v) => updateGrid({ backup: v })} step />
          <span className="unit">{t('minutes')}</span>
        </span>
      </div>
      {units > 0 && (
        <div className="backup-result">
          <Slot id={storage.id} rate={units} size={60} />
          <span>
            <b>
              {units} × {name(storage)}
            </b>
            <small>{t('storageHolds', { mwh: num(need), cap: num(units * storage.capacity) })}</small>
            <small>{Number.isFinite(hours) ? t('rechargeIn', { time: formatHours(hours), mw: num(charge) }) : t('noRecharge')}</small>
          </span>
        </div>
      )}

      <h3 className="section-title">{t('fuelOnHand')}</h3>
      <p className="hint">{t('fuelOnHandHint')}</p>
      <Cards list={plan.supplies} size={52} onRate={s.setSupply} onRemove={s.removeSupply} />
      <ItemPicker items={supplyItems} label={t('addSupply')} onPick={(id) => s.addSupply(id)} exclude={plan.supplies.map((x) => x.item)} />
    </section>
  );
}

/** 0.75 -> "45 min", 2.5 -> "2 h 30 min". */
function formatHours(h: number): string {
  const total = Math.round(h * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return hh > 0 ? `${hh} h${mm ? ` ${mm} min` : ''}` : `${mm} min`;
}
