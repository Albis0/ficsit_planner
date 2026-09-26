import { useEffect, useRef, useState } from 'react';
import { data, type Generator } from '../lib/data';
import { PURITIES } from '../lib/extraction';
import { useT } from '../lib/i18n';
import { fuelRate, generatorOf, handFed, PLANT_OPTIONS, PLANT_PREFIX, type Plant, type SizeBy, sizable } from '../lib/power';
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

/**
 * The power planner's panel, one column top to bottom: the plant's generators, then what it's sized
 * to. Counts and clocks live on the floor (select a generator); backup sits folded away at the end.
 */
export function PowerPanel(props: PowerPanelProps) {
  const { t } = useT();
  return (
    <div className="panel-body power">
      <Generators result={props.result} />
      <SizeSection {...props} />
      <details className="power-more">
        <summary>{t('moreOptions')}</summary>
        <Backup {...props} />
      </details>
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

/** Step 1: the generators and what each burns. */
function Generators({ result }: { result?: SolveResult }) {
  const { t } = useT();
  const plants = useStore((s) => activePowerPlan(s).plants);
  return (
    <section className="stack gens">
      <StepTitle n={1}>{t('stepGenerators')}</StepTitle>
      {plants.map((p) => (
        <GenRow key={p.id} plant={p} result={result} />
      ))}
      <AddPlant />
    </section>
  );
}

/** One kind of generator: its fuel, and how many the planner builds (or you set). */
function GenRow({ plant, result }: { plant: Plant; result?: SolveResult }) {
  const { t, name, num } = useT();
  const tier = useStore((s) => s.tier);
  const updatePlant = useStore((s) => s.updatePlant);
  const removePlant = useStore((s) => s.removePlant);
  const set = useStore((s) => s.set);
  const inspected = useStore((s) => s.inspect);
  const g = generatorOf(plant);
  const use = result?.recipes.find((u) => u.recipe.id === PLANT_PREFIX + plant.id);
  const mw = result?.grid?.plants[plant.id] ?? 0;
  const put = (patch: Partial<Plant>) => updatePlant(plant.id, patch);
  const locked = g.tier > tier;
  const auto = sizable(g) && plant.by === 'auto';
  const count = Math.max(0, Math.round(plant.by === 'count' || !sizable(g) ? plant.amount : (use?.built ?? 1)));

  return (
    <article className={`gen-row ${locked ? 'locked' : ''}`} aria-label={name(g)}>
      <header className="gen-row-head">
        <Icon id={g.id} size={32} />
        <span className="gen-row-name">{name(g)}</span>
        {locked && <span className="tier-tag">{t('tierTag', { tier: g.tier })}</span>}
        <span className="gen-row-mw">
          {num(mw)} <small>MW</small>
        </span>
        <button type="button" className="gen-row-remove" aria-label={`${t('remove')} ${name(g)}`} onClick={() => removePlant(plant.id)}>
          <Glyph name="close" size={14} />
        </button>
      </header>

      {g.kind === 'fuel' && (
        <div className="fuel-pills" role="radiogroup" aria-label={t('fuel')}>
          {g.fuels.map((f) => (
            <button
              key={f.item}
              type="button"
              role="radio"
              aria-checked={plant.fuel === f.item}
              className="fuel-pill"
              title={`${num(fuelRate(g, f.item))}${t('perMin')} ${t('perGenerator')}${handFed(f.item) ? ` · ${t('handFed')}` : ''}`}
              onClick={() => put({ fuel: f.item })}
            >
              <Icon id={f.item} size={22} />
              {name(data.items[f.item])}
            </button>
          ))}
        </div>
      )}

      {g.kind === 'geothermal' && (
        <div className="segmented small" role="radiogroup" aria-label={t('purity')}>
          {PURITIES.map((p) => (
            <button key={p} type="button" role="radio" aria-checked={(plant.purity ?? 'normal') === p} onClick={() => put({ purity: p })}>
              {t(p)}
            </button>
          ))}
        </div>
      )}

      {g.kind === 'augmenter' && g.booster && (
        <label className="check-row small">
          <input type="checkbox" checked={!!plant.fed} onChange={(e) => put({ fed: e.target.checked })} />
          <span>{t('feedMatrix', { boost: Math.round(g.booster.boost * 100) })}</span>
        </label>
      )}

      <div className="gen-row-foot">
        {auto ? (
          <>
            {use ? (
              <button
                type="button"
                className="gen-count"
                title={t('inspectPowerHint')}
                aria-pressed={inspected === use.recipe.id}
                // Pressed again, it closes the generator's panel on the floor.
                onClick={() => set({ inspect: inspected === use.recipe.id ? undefined : use.recipe.id })}
              >
                <b>{use.built}</b> × {num(use.clock * 100)}%
              </button>
            ) : (
              <span className="gen-count idle">{result && !locked ? t('notNeeded') : '–'}</span>
            )}
            <span className="gen-mode">{t('autoSized')}</span>
            {use && (
              <button type="button" className="text-button" onClick={() => put({ by: 'count', amount: use.built })}>
                {t('fixCount')}
              </button>
            )}
          </>
        ) : (
          <>
            <span className="mini-stepper">
              <button
                type="button"
                aria-label={t('fewerMachines')}
                disabled={count <= 0}
                onClick={() => put({ by: 'count', amount: count - 1 })}
              >
                −
              </button>
              <b>{count}</b>
              <button type="button" aria-label={t('moreMachines')} onClick={() => put({ by: 'count', amount: count + 1 })}>
                +
              </button>
            </span>
            <span className="gen-mode">{g.kind === 'augmenter' ? t('augmenters') : t('generatorsSet')}</span>
            {sizable(g) && (
              <button type="button" className="text-button" onClick={() => put({ by: 'auto' })}>
                {t('backToAuto')}
              </button>
            )}
          </>
        )}
      </div>
    </article>
  );
}

const MODES: [SizeBy, 'byHave' | 'byWant' | 'byFactories'][] = [
  ['have', 'byHave'],
  ['want', 'byWant'],
  ['factories', 'byFactories'],
];

/** Step 2: what the plant is sized to. */
function SizeSection(props: PowerPanelProps) {
  const { t } = useT();
  const pp = useStore(activePowerPlan);
  const updatePower = useStore((s) => s.updatePower);

  return (
    <section className="stack size-by">
      <StepTitle n={2}>{t('stepSizeBy')}</StepTitle>
      <div className="segmented size-modes" role="radiogroup" aria-label={t('stepSizeBy')}>
        {MODES.map(([by, label]) => (
          <button key={by} type="button" role="radio" aria-checked={pp.sizeBy === by} onClick={() => updatePower({ sizeBy: by })}>
            {t(label)}
          </button>
        ))}
      </div>
      <div className="size-box">
        {pp.sizeBy === 'have' && <HaveBox {...props} />}
        {pp.sizeBy === 'want' && <WantBox />}
        {pp.sizeBy === 'factories' && <FactoriesBox {...props} />}
        <label className="check-row small own-load">
          <input type="checkbox" checked={pp.ownLoad} onChange={(e) => updatePower({ ownLoad: e.target.checked })} />
          <span>{t('ownLoad')}</span>
        </label>
        <SizeTotal {...props} />
      </div>
    </section>
  );
}

/** The one figure the step comes to, with what it's made of underneath. */
function SizeTotal({ result, load, chainDraw }: PowerPanelProps) {
  const { t, num } = useT();
  const pp = useStore(activePowerPlan);
  const chain = pp.ownLoad ? chainDraw : 0;
  if (pp.sizeBy === 'have') {
    const made = result?.grid?.generation ?? 0;
    if (!result || made <= 0) return null;
    return (
      <div className="size-total">
        <span className="size-total-label">{t('plantMakes')}</span>
        <b>
          {num(made)} <small>MW</small>
        </b>
        <span className="size-total-note">
          {chain > 0.01 ? t('netAfterChain', { mw: num(made - chain), chain: num(chain) }) : t('allForGrid')}
        </span>
      </div>
    );
  }
  const keep = pp.sizeBy === 'factories' ? 1 + pp.headroom : 1;
  return (
    <div className="size-total">
      <span className="size-total-label">{t('plantHasToMake')}</span>
      <b>
        {num((load.demand + chain) * keep)} <small>MW</small>
      </b>
      <span className="size-total-note">
        {pp.sizeBy === 'factories'
          ? t('factoriesSplit', { factories: num(load.demand), chain: num(chain), pct: num(pp.headroom * 100) })
          : chain > 0.01
            ? t('wantSplit', { want: num(pp.want), chain: num(chain) })
            : t('allForGrid')}
      </span>
    </div>
  );
}

/** Sized to what you have: the items it may use. */
function HaveBox({ probe }: PowerPanelProps) {
  const { t, num, name } = useT();
  const have = useStore((s) => activePowerPlan(s).have);
  const updatePower = useStore((s) => s.updatePower);
  const put = (list: Target[]) => updatePower({ have: list });
  const listed = new Set(have.map((h) => h.item));
  // What the fuel is made from, so the list can start from a tap. Water is free, so it isn't offered.
  const needs = probe
    ? [...probe.raw, ...probe.supplies, ...probe.missing].filter((x) => !listed.has(x.item) && x.item !== 'Desc_Water_C')
    : [];

  return (
    <>
      <p className="hint">{t('haveHint')}</p>
      <Cards
        list={have}
        size={44}
        onRate={(i, v) => put(have.map((h, j) => (j === i ? { ...h, rate: v } : h)))}
        onRemove={(i) => put(have.filter((_, j) => j !== i))}
      />
      {needs.length > 0 && (
        <div className="have-chips">
          <span className="control-label">{have.length ? t('alsoNeeds') : t('madeFrom')}</span>
          {needs.map((x) => (
            <button
              key={x.item}
              type="button"
              className="fuel-pill"
              title={t('addThis')}
              onClick={() => put([...have, { item: x.item, rate: Math.round(x.rate * 10) / 10 }])}
            >
              <Glyph name="plus" size={14} />
              <Icon id={x.item} size={22} />
              {name(data.items[x.item])}
              <small>
                {num(x.rate)}
                {t('perMin')}
              </small>
            </button>
          ))}
        </div>
      )}
      <ItemPicker items={allItems} label={t('addHave')} onPick={(id) => put([...have, { item: id, rate: 60 }])} exclude={[...listed]} />
    </>
  );
}

/** Sized to a set output. */
function WantBox() {
  const { t } = useT();
  const want = useStore((s) => activePowerPlan(s).want);
  const updatePower = useStore((s) => s.updatePower);
  return (
    <div className="power-row">
      <span className="power-row-label">{t('wantLabel')}</span>
      <span className="item-card-rate">
        <RateInput value={want} label={t('wantLabel')} onChange={(v) => updatePower({ want: v })} step />
        <span className="unit">MW</span>
      </span>
    </div>
  );
}

/** Sized to the factories it powers: tick them, add what the planner can't see, keep some spare. */
function FactoriesBox({ draws }: PowerPanelProps) {
  const { t, num } = useT();
  const pp = useStore(activePowerPlan);
  const plans = useStore((s) => s.plans);
  const all = useStore((s) => s.power);
  const updatePower = useStore((s) => s.updatePower);
  const setPowered = useStore((s) => s.setPowered);
  const on = poweredBy(pp, plans);

  return (
    <>
      <ul className="draw-list">
        {draws.map((f) => {
          const ticked = on.has(f.id);
          const other = ticked ? undefined : all.find((x) => x.id !== pp.id && poweredBy(x, plans).has(f.id));
          return (
            <li key={f.id} className={ticked ? '' : 'off'}>
              <label className="draw-row">
                <input type="checkbox" checked={ticked} onChange={() => setPowered(f.id, !ticked)} />
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
      <div className="power-row">
        <span className="power-row-label">{t('otherLoad')}</span>
        <span className="item-card-rate">
          <RateInput value={pp.extra} label={t('otherLoad')} onChange={(v) => updatePower({ extra: v })} step />
          <span className="unit">MW</span>
        </span>
      </div>
      <div className="power-row">
        <span className="power-row-label">{t('headroom')}</span>
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
    </>
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
    <div className="stack backup">
      <h3 className="section-title with-icon">
        <Glyph name="battery" size={20} />
        {t('backup')}
      </h3>
      <div className="power-row">
        <span className="power-row-label">{t('rideOut')}</span>
        <span className="item-card-rate">
          <RateInput value={pp.backup} label={t('rideOut')} onChange={(v) => updatePower({ backup: v })} step />
          <span className="unit">{t('minutes')}</span>
        </span>
      </div>
      {units > 0 && (
        <div className="backup-result">
          <Slot id={storage.id} rate={units} size={56} />
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
          <Cards list={plan.supplies} size={44} onRate={s.setSupply} onRemove={s.removeSupply} />
          <ItemPicker
            items={supplyItems}
            label={t('addSupply')}
            onPick={(id) => s.addSupply(id)}
            exclude={plan.supplies.map((x) => x.item)}
          />
        </>
      )}
    </div>
  );
}

/** 0.75 -> "45 min", 2.5 -> "2 h 30 min". */
function formatHours(h: number): string {
  const total = Math.round(h * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return hh > 0 ? `${hh} h${mm ? ` ${mm} min` : ''}` : `${mm} min`;
}
