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
  type SizeBy,
  sizable,
  unitPower,
} from '../lib/power';
import type { FactoryDraw, PowerLoad } from '../lib/solution';
import type { SolveResult, Target } from '../lib/solver';
import { activePowerPlan, poweredBy, usePlan, useStore } from '../store';
import { Glyph } from './Glyph';
import { Icon } from './Icon';
import { ItemPicker } from './ItemPicker';
import { RateInput } from './RateInput';
import { Slot } from './Slot';
import { Cards } from './TargetsPanel';

const supplyItems = Object.values(data.items).filter((i) => !i.raw);
const allItems = Object.values(data.items);

export interface PowerPanelProps {
  result?: SolveResult;
  draws: FactoryDraw[];
  load: PowerLoad;
  /** MW the plant's own fuel chain draws: its machines, miners and pumps. */
  chainDraw: number;
  /** Sized to what you have: the same plant solved for a set output, to show what its fuel is made from. */
  probe?: SolveResult;
}

/** The power planner's panel: the plant's generators, what it's sized to, and backup. */
export function PowerPanel(props: PowerPanelProps) {
  return (
    <div className="panel-body power">
      <Generators result={props.result} />
      <SizeSection {...props} />
      <Backup {...props} />
    </div>
  );
}

function StepTitle({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <h3 className="section-title step">
      <span className="step-num" aria-hidden>
        {n}
      </span>
      {children}
    </h3>
  );
}

/** The plant's generators: any mix of buildings and fuels, and the button that adds one. */
function Generators({ result }: { result?: SolveResult }) {
  const { t } = useT();
  const plants = useStore((s) => activePowerPlan(s).plants);
  return (
    <section className="stack plants">
      <StepTitle n={1}>{t('stepGenerators')}</StepTitle>
      {plants.length > 1 && plants.some((p) => sizable(generatorOf(p)) && p.by === 'auto') && <p className="hint">{t('autoHint')}</p>}
      {plants.map((p) => (
        <PlantCard key={p.id} plant={p} result={result} />
      ))}
      <AddPlant />
    </section>
  );
}

const MODES: [SizeBy, 'byHave' | 'byWant' | 'byFactories', 'byHaveHint' | 'byWantHint' | 'byFactoriesHint'][] = [
  ['have', 'byHave', 'byHaveHint'],
  ['want', 'byWant', 'byWantHint'],
  ['factories', 'byFactories', 'byFactoriesHint'],
];

/** What the plant is sized to: fuel on hand, a set output, or the factories it powers. */
function SizeSection(props: PowerPanelProps) {
  const { t, num } = useT();
  const pp = useStore(activePowerPlan);
  const updatePower = useStore((s) => s.updatePower);
  const { chainDraw } = props;

  return (
    <section className="stack size-by">
      <StepTitle n={2}>{t('stepSizeBy')}</StepTitle>
      <div className="size-modes" role="radiogroup" aria-label={t('stepSizeBy')}>
        {MODES.map(([by, label, hint]) => (
          <button key={by} type="button" role="radio" aria-checked={pp.sizeBy === by} onClick={() => updatePower({ sizeBy: by })}>
            <b>{t(label)}</b>
            <small>{t(hint)}</small>
          </button>
        ))}
      </div>
      <div className="size-box">
        {pp.sizeBy === 'have' && <HaveBox {...props} />}
        {pp.sizeBy === 'want' && <WantBox {...props} />}
        {pp.sizeBy === 'factories' && <FactoriesBox {...props} />}
        <label className="check-row own-load">
          <input type="checkbox" checked={pp.ownLoad} onChange={(e) => updatePower({ ownLoad: e.target.checked })} />
          <span>
            <b>{t('ownLoad')}</b>
            <small>{pp.ownLoad && chainDraw > 0.01 ? t('ownLoadNow', { mw: num(chainDraw) }) : t('ownLoadHint')}</small>
          </span>
        </label>
      </div>
    </section>
  );
}

/** Sized to what you have: the items it may use, and what that makes. */
function HaveBox({ result, probe, chainDraw }: PowerPanelProps) {
  const { t, num, name } = useT();
  const pp = useStore(activePowerPlan);
  const updatePower = useStore((s) => s.updatePower);
  const have = pp.have;
  const put = (list: Target[]) => updatePower({ have: list });
  const listed = new Set(have.map((h) => h.item));
  // What one plant's worth of fuel is made from, so the list can start from a tap.
  const needs = probe ? [...probe.raw, ...probe.supplies, ...probe.missing].filter((x) => !listed.has(x.item)) : [];
  const made = result?.grid?.generation ?? 0;
  const net = made - (pp.ownLoad ? chainDraw : 0);

  return (
    <>
      <p className="hint">{t('haveHint')}</p>
      <Cards
        list={have}
        size={52}
        onRate={(i, v) => put(have.map((h, j) => (j === i ? { ...h, rate: v } : h)))}
        onRemove={(i) => put(have.filter((_, j) => j !== i))}
      />
      <ItemPicker items={allItems} label={t('addHave')} onPick={(id) => put([...have, { item: id, rate: 60 }])} exclude={[...listed]} />
      {needs.length > 0 && (
        <div className="have-needs">
          <span className="control-label">{have.length ? t('alsoNeeds') : t('madeFrom')}</span>
          <span className="have-chips">
            {needs.map((x) => (
              <button
                key={x.item}
                type="button"
                className="fuel-chip"
                title={t('addThis')}
                onClick={() => put([...have, { item: x.item, rate: Math.round(x.rate * 10) / 10 }])}
              >
                <Icon id={x.item} size={24} />
                <span>{name(data.items[x.item])}</span>
                <small>
                  {num(x.rate)}
                  {t('perMin')}
                </small>
              </button>
            ))}
          </span>
          <small className="hint">{t('madeFromHint')}</small>
        </div>
      )}
      {result && made > 0 && (
        <div className="size-total">
          <span className="size-total-label">{t('plantMakes')}</span>
          <b>
            {num(made)} <small>MW</small>
          </b>
          <span className="size-total-note">
            {pp.ownLoad && chainDraw > 0.01 ? t('netAfterChain', { mw: num(net), chain: num(chainDraw) }) : t('allForGrid')}
          </span>
        </div>
      )}
    </>
  );
}

/** Sized to a set output. */
function WantBox({ chainDraw }: PowerPanelProps) {
  const { t, num } = useT();
  const pp = useStore(activePowerPlan);
  const updatePower = useStore((s) => s.updatePower);
  const chain = pp.ownLoad ? chainDraw : 0;
  return (
    <>
      <div className="item-card flat power-row">
        <span className="power-row-label">
          {t('wantLabel')}
          <small>{t('wantHint')}</small>
        </span>
        <span className="item-card-rate">
          <RateInput value={pp.want} label={t('wantLabel')} onChange={(v) => updatePower({ want: v })} step />
          <span className="unit">MW</span>
        </span>
      </div>
      <div className="size-total">
        <span className="size-total-label">{t('plantHasToMake')}</span>
        <b>
          {num(pp.want + chain)} <small>MW</small>
        </b>
        {chain > 0.01 && <span className="size-total-note">{t('wantSplit', { want: num(pp.want), chain: num(chain) })}</span>}
      </div>
    </>
  );
}

/** Sized to the factories it powers: tick them, add what the planner can't see, keep some spare. */
function FactoriesBox({ draws, load, chainDraw }: PowerPanelProps) {
  const { t, num } = useT();
  const pp = useStore(activePowerPlan);
  const plans = useStore((s) => s.plans);
  const all = useStore((s) => s.power);
  const updatePower = useStore((s) => s.updatePower);
  const setPowered = useStore((s) => s.setPowered);
  const on = poweredBy(pp, plans);
  const chain = pp.ownLoad ? chainDraw : 0;
  const keep = 1 + pp.headroom;
  const locked = pp.locked !== undefined;

  return (
    <>
      <div className="size-head">
        <span className="control-label">{t('factoriesPowered')}</span>
        {locked ? (
          <button type="button" className="live-tag locked" title={t('followLiveHint')} onClick={() => updatePower({ locked: undefined })}>
            <Glyph name="lock" size={14} />
            {t('lockedTag')}
          </button>
        ) : (
          <button type="button" className="live-tag" title={t('lockHint')} onClick={() => updatePower({ locked: load.live })}>
            <span className="live-dot" aria-hidden />
            {t('liveTag')}
          </button>
        )}
      </div>
      <ul className="draw-list">
        {draws.map((f) => {
          const ticked = on.has(f.id);
          const other = ticked ? undefined : all.find((x) => x.id !== pp.id && poweredBy(x, plans).has(f.id));
          return (
            <li key={f.id} className={ticked ? '' : 'off'}>
              <label className="draw-row">
                <input type="checkbox" checked={ticked} onChange={() => setPowered(f.id, !ticked)} />
                <Glyph name="factory" size={18} />
                <span className="draw-name">
                  {f.name}
                  {other && <small className="draw-other">{t('onOtherPlant', { name: other.name })}</small>}
                </span>
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
          <RateInput value={pp.extra} label={t('otherLoad')} onChange={(v) => updatePower({ extra: v })} step />
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
            value={Math.round(pp.headroom * 1000) / 10}
            label={t('headroom')}
            onChange={(v) => updatePower({ headroom: Math.min(2, v / 100) })}
            step
          />
          <span className="unit">%</span>
        </span>
      </div>
      <div className="size-total">
        <span className="size-total-label">{t('plantHasToMake')}</span>
        <b>
          {num((load.demand + chain) * keep)} <small>MW</small>
        </b>
        <span className="size-total-note">
          {t('factoriesSplit', { factories: num(load.demand), chain: num(chain), pct: num(pp.headroom * 100) })}
        </span>
        {locked && Math.abs(load.live - load.demand) > 0.5 && (
          <span className="size-total-note warn">
            {t('lockedAt', { mw: num(load.demand), live: num(load.live) })}{' '}
            <button type="button" className="text-button" onClick={() => updatePower({ locked: undefined })}>
              {t('followLive')}
            </button>
          </span>
        )}
      </div>
    </>
  );
}

/** One row of generators: building and fuel, how it's sized, its clock, and what it burns. */
function PlantCard({ plant, result }: { plant: Plant; result?: SolveResult }) {
  const { t, name, num } = useT();
  const tier = useStore((s) => s.tier);
  const have = useStore((s) => activePowerPlan(s).sizeBy === 'have');
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
              <span className={`auto-note ${use ? '' : 'idle'}`}>
                {use ? t(have ? 'autoNoteHave' : 'autoNote', { n: use.built }) : t(have ? 'autoIdleHave' : 'autoIdle')}
              </span>
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

/** "Add a generator": every building, and for burners every fuel, as one tap each. */
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
function Backup({ result, load, chainDraw }: PowerPanelProps) {
  const { t, num, name } = useT();
  const pp = useStore(activePowerPlan);
  const updatePower = useStore((s) => s.updatePower);
  const plan = usePlan();
  const s = useStore();
  const storage = data.powerStorage;
  const generation = result?.grid?.generation ?? 0;
  // Sized to what you have, everything it makes is the load it carries.
  const carried = pp.sizeBy === 'have' ? generation : load.demand + (pp.ownLoad ? chainDraw : 0);
  const need = (carried * pp.backup) / 60;
  const units = need > 0 ? Math.ceil(need / storage.capacity - 1e-9) : 0;
  const spare = result?.grid ? generation - carried : 0;
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
          <RateInput value={pp.backup} label={t('rideOut')} onChange={(v) => updatePower({ backup: v })} step />
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

      {pp.sizeBy !== 'have' && (
        <>
          <h3 className="section-title">{t('fuelOnHand')}</h3>
          <p className="hint">{t('fuelOnHandHint')}</p>
          <Cards list={plan.supplies} size={52} onRate={s.setSupply} onRemove={s.removeSupply} />
          <ItemPicker
            items={supplyItems}
            label={t('addSupply')}
            onPick={(id) => s.addSupply(id)}
            exclude={plan.supplies.map((x) => x.item)}
          />
        </>
      )}
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
