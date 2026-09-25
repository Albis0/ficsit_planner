import { useEffect, useRef, useState } from 'react';
import { data, type Generator } from '../lib/data';
import { useT } from '../lib/i18n';
import { clockable, fuelRate, generatorOf, MAX_CLOCK, PLANT_OPTIONS, plantIdOf, sizable, unitPower } from '../lib/power';
import type { PowerLoad } from '../lib/solution';
import { shardsFor, type SolveResult } from '../lib/solver';
import { activePowerPlan, useStore } from '../store';
import { Glyph } from './Glyph';
import { Icon } from './Icon';
import { MissingList } from './MissingList';
import { motionReduced } from './ModeSwitch';
import { RateInput } from './RateInput';
import { Slot } from './Slot';

/** A generator's colour in the power mix, close to how the building reads in the game. */
export const GENERATOR_COLORS: Record<string, string> = {
  Build_GeneratorBiomass_Automated_C: '#8bbf5a',
  Build_GeneratorCoal_C: '#a3acb4',
  Build_GeneratorFuel_C: '#f08c3a',
  Build_GeneratorNuclear_C: '#72e06a',
  Build_GeneratorGeoThermal_C: '#e3643c',
  Build_AlienPowerBuilding_C: '#b98cf2',
};

/** Eases a number to its new value, so the grid readouts wind up and down instead of jumping. */
export function useCountUp(value: number, ms = 650): number {
  const [shown, setShown] = useState(value);
  const at = useRef(value);
  useEffect(() => {
    const from = at.current;
    if (Math.abs(from - value) < 1e-9) return;
    if (motionReduced()) {
      at.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      at.current = from + (value - from) * (1 - (1 - k) ** 3);
      setShown(at.current);
      if (k < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, ms]);
  return shown;
}

/** The power planner's readouts, four across: what's left, what it makes, what it needs, what else comes out. */
export function PowerSummary({
  result,
  load,
  chainDraw,
}: {
  result: SolveResult;
  load: PowerLoad;
  /** MW the plant's own fuel chain draws: its machines, miners and pumps. */
  chainDraw: number;
}) {
  const { t, num, name } = useT();
  const pp = useStore(activePowerPlan);
  const have = pp.sizeBy === 'have';
  const generation = result.grid?.generation ?? 0;
  const chain = pp.ownLoad ? chainDraw : 0;
  const used = load.demand + chain;
  const balance = have ? generation - chain : generation - used;
  const shown = useCountUp(balance);
  const made = useCountUp(generation);
  const short = !have && balance < -0.5;
  // Fixed counts aren't sized by the solver, so it can't hold them to the spare capacity; say so.
  const headroom = pp.sizeBy === 'factories' ? pp.headroom : 0;
  const reserve = used * headroom;
  const thin = !short && headroom > 0 && balance < reserve - 0.5;
  const generators = result.recipes.reduce((s, u) => s + (plantIdOf(u.recipe.id) ? u.built : 0), 0);
  const needs = result.raw;
  const left = result.surplus;
  const mix = pp.plants
    .map((p) => ({ p, mw: result.grid?.plants[p.id] ?? 0 }))
    .filter((x) => x.mw > 0.01)
    .sort((a, b) => b.mw - a.mw);

  return (
    <div className="summary power-summary">
      <div className="readouts">
        <div className={`readout balance ${short ? 'short' : thin ? 'thin' : 'ok'}`}>
          <span className="readout-label">{have ? t('forTheGrid') : short ? t('gridShort') : t('covers')}</span>
          <span className="readout-value">
            {have ? '' : shown >= 0 ? '+' : '−'}
            {num(Math.abs(shown))} <small>MW</small>
          </span>
          <span className="readout-sub">
            {have
              ? chain > 0.01
                ? t('afterChain', { mw: num(chain) })
                : t('allForGrid')
              : thin
                ? t('belowReserve', { pct: num(headroom * 100), mw: num(reserve) })
                : t('coversSub', { used: num(used) })}
          </span>
        </div>
        <div className="readout power">
          <span className="readout-label">{t('plantMakes')}</span>
          <span className="readout-value">
            {num(made)} <small>MW</small>
          </span>
          <span className="readout-sub">
            {mix.length > 1 ? mix.map((m) => `${num(m.mw)} ${name(generatorOf(m.p))}`).join(' · ') : t('generatorCount', { n: generators })}
            {result.grid && result.grid.boost > 0 && ` · ${t('boostTag', { boost: num(result.grid.boost * 100) })}`}
          </span>
        </div>
        {needs.length > 0 && (
          <div className="readout">
            <span className="readout-label">{t('needs')}</span>
            <span className="slots">
              {needs.map((r) => (
                <Slot key={r.item} id={r.item} rate={r.rate} size={44} />
              ))}
            </span>
          </div>
        )}
        {left.length > 0 && (
          <div className="readout">
            <span className="readout-label">{t('makesAsWell')}</span>
            <span className="slots">
              {left.map((r) => (
                <Slot key={r.item} id={r.item} rate={r.rate} size={44} />
              ))}
            </span>
          </div>
        )}
      </div>
      {result.missing.length > 0 && (
        <div className="missing" role="alert">
          <span className="missing-title">{t('missing')}</span>
          <MissingList missing={result.missing} />
        </div>
      )}
    </div>
  );
}

/** A generator row selected on the floor: its count, clock and what it burns, like the game's panel. */
export function PlantInspector({ result }: { result: SolveResult }) {
  const { t, name, num } = useT();
  const inspect = useStore((s) => s.inspect);
  const plants = useStore((s) => activePowerPlan(s).plants);
  const set = useStore((s) => s.set);
  const updatePlant = useStore((s) => s.updatePlant);
  const plantId = inspect ? plantIdOf(inspect) : undefined;
  const plant = plants.find((p) => p.id === plantId);
  const use = result.recipes.find((u) => u.recipe.id === inspect);
  // Dragging only moves the slider; the plant takes the clock when the drag ends, or a moment after the
  // last change for input that doesn't come from a pointer or key (screen readers, a cancelled touch).
  const [draft, setDraft] = useState<number>();
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(settle.current), []);
  if (!plant || !use) return null;
  const g = generatorOf(plant);
  const mw = result.grid?.plants[plant.id] ?? 0;
  const clock = draft ?? plant.clock;
  const shards = Math.max(0, ...use.clocks.map(shardsFor));
  const commitClock = (c: number) => {
    clearTimeout(settle.current);
    setDraft(undefined);
    updatePlant(plant.id, { clock: Math.min(MAX_CLOCK, Math.max(0.01, c)) });
  };
  const setCount = (n: number) => updatePlant(plant.id, { by: 'count', amount: Math.max(0, n) });

  return (
    <aside className="inspector plant-inspector" aria-label={name(g)}>
      <header className="inspector-head">
        <Icon id={g.id} size={48} />
        <div className="inspector-title">
          <span className="inspector-machine">{name(g)}</span>
          <span className="inspector-recipe">
            {plant.fuel
              ? name(data.items[plant.fuel])
              : g.kind === 'geothermal'
                ? t(plant.purity ?? 'normal')
                : t('boostTag', { boost: num((result.grid?.boost ?? 0) * 100) })}
          </span>
        </div>
        <button type="button" className="icon-button" aria-label={t('close')} onClick={() => set({ inspect: undefined })}>
          ×
        </button>
      </header>

      <div className="inspector-row">
        <span className="inspector-label">{t('generators')}</span>
        <div className="stepper">
          <button type="button" aria-label={t('fewerMachines')} disabled={use.built <= 1} onClick={() => setCount(use.built - 1)}>
            −
          </button>
          <b>{use.built}</b>
          <button type="button" aria-label={t('moreMachines')} onClick={() => setCount(use.built + 1)}>
            +
          </button>
          {sizable(g) && plant.by === 'auto' && <span className="slot-label">{t('stepperFixes')}</span>}
          {sizable(g) && plant.by !== 'auto' && (
            <button type="button" className="text-button" onClick={() => updatePlant(plant.id, { by: 'auto' })}>
              {t('backToAuto')}
            </button>
          )}
        </div>
      </div>

      {clockable(g) && (
        <div className="inspector-row">
          <label className="inspector-label" htmlFor="plant-clock">
            {t('clockSpeed')}
          </label>
          <div className="clock-control">
            <input
              id="plant-clock"
              type="range"
              min={1}
              max={MAX_CLOCK * 100}
              step={1}
              value={Math.round(clock * 100)}
              onChange={(e) => {
                const c = Number(e.target.value) / 100;
                setDraft(c);
                clearTimeout(settle.current);
                settle.current = setTimeout(() => commitClock(c), 500);
              }}
              onPointerUp={() => draft !== undefined && commitClock(clock)}
              onPointerCancel={() => draft !== undefined && commitClock(clock)}
              onKeyUp={() => draft !== undefined && commitClock(clock)}
              onBlur={() => draft !== undefined && commitClock(clock)}
              style={{ ['--fill' as string]: `${((clock * 100 - 1) / (MAX_CLOCK * 100 - 1)) * 100}%` }}
            />
            <RateInput value={Math.round(clock * 10000) / 100} label={t('clockSpeed')} onChange={(n) => n > 0 && commitClock(n / 100)} />
            <span className="unit">%</span>
          </div>
          <div className="shard-slots" role="img" aria-label={`${t('shards')}: ${shards}`}>
            {[0, 1, 2].map((i) => (
              <span key={i} className={`shard-slot ${i < shards ? 'filled' : ''}`} />
            ))}
            <span className="slot-label">
              {use.shards} {t('shards')}
            </span>
          </div>
        </div>
      )}

      <dl className="inspector-stats">
        <div>
          <dt>{t('output')}</dt>
          <dd className="power">{num(mw)} MW</dd>
        </div>
        <div>
          <dt>{t('perGeneratorOut')}</dt>
          <dd>{num(unitPower(plant) * (1 + (result.grid?.boost ?? 0)))} MW</dd>
        </div>
        {[...use.inputs, ...use.outputs].map((f) => (
          <div key={f.item}>
            <dt>
              <Icon id={f.item} size={18} /> {name(data.items[f.item])}
            </dt>
            <dd>
              {num(f.rate)}
              {t('perMin')}
            </dd>
          </div>
        ))}
      </dl>
      {g.kind === 'fuel' && g.id !== 'Build_GeneratorBiomass_Automated_C' && <p className="hint">{t('fullBlastHint')}</p>}
    </aside>
  );
}

/** No generators yet: every way to make power, one tap to start. */
export function PowerQuickStart({ load }: { load: PowerLoad }) {
  const { t, name, num } = useT();
  const tier = useStore((s) => s.tier);
  const addPlant = useStore((s) => s.addPlant);
  const set = useStore((s) => s.set);
  const sizeBy = useStore((s) => activePowerPlan(s).sizeBy);
  const counted = load.fed.filter((f) => (f.mw ?? 0) > 0);
  const total = counted.reduce((s, f) => s + f.mw!, 0);
  const add = (g: Generator, fuel?: string) => {
    addPlant(g.id, fuel);
    set({ tab: 'targets', deckClosed: false });
  };

  return (
    <div className="quick-pick power-start">
      <div className="quick-inner">
        <h2 className="quick-title">{t('howPower')}</h2>
        <p className="hint">
          {sizeBy !== 'factories'
            ? t('pickGenerator')
            : total > 0
              ? counted.length === 1
                ? t('factoryDraws', { mw: num(total), name: counted[0].name })
                : t('factoriesDraw', { mw: num(total), n: counted.length })
              : t('noFactoriesYet')}
        </p>
        <div className="gen-grid">
          {data.generators.map((g) => {
            const locked = g.tier > tier;
            const fuels = PLANT_OPTIONS.filter((o) => o.generator === g && o.fuel);
            const body = (
              <>
                <span className="gen-card-head">
                  <Icon id={g.id} size={72} />
                  <span className="gen-card-name">
                    {name(g)}
                    <small>{g.kind === 'geothermal' ? t('geyserRange') : `${num(g.power)} MW`}</small>
                  </span>
                  {locked && <span className="tier-tag">{t('tierTag', { tier: g.tier })}</span>}
                </span>
                <span className="gen-card-note">{t(`genNote_${g.kind}` as 'genNote_fuel')}</span>
              </>
            );
            return g.kind === 'fuel' ? (
              <div key={g.id} className={`gen-card ${locked ? 'locked' : ''}`} style={{ ['--gen' as string]: GENERATOR_COLORS[g.id] }}>
                {body}
                <span className="gen-fuels">
                  {fuels.map((o) => (
                    <button key={o.fuel} type="button" className="fuel-chip" onClick={() => add(g, o.fuel)}>
                      <Icon id={o.fuel!} size={28} />
                      <span>{name(data.items[o.fuel!])}</span>
                      <small>
                        {num(fuelRate(g, o.fuel!))}
                        {t('perMin')}
                      </small>
                    </button>
                  ))}
                </span>
              </div>
            ) : (
              <button
                key={g.id}
                type="button"
                className={`gen-card button ${locked ? 'locked' : ''}`}
                style={{ ['--gen' as string]: GENERATOR_COLORS[g.id] }}
                onClick={() => add(g)}
              >
                {body}
                <span className="gen-add">
                  <Glyph name="plus" size={16} /> {t('add')}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
