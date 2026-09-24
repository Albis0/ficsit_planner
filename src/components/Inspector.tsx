import { useState } from 'react';
import { data } from '../lib/data';
import { useT } from '../lib/i18n';
import { recipeLabel } from '../lib/text';
import { groupClocks } from '../lib/clocks';
import { amplification, NO_MOD, shardsFor, type SolveResult } from '../lib/solver';
import { usePlan, useStore } from '../store';
import { Icon } from './Icon';
import { RateInput } from './RateInput';

const MAX_CLOCK = 2.5;
const EPS = 1e-6;

/** Clock speed + somersloop settings for one recipe's machines, like the in-game machine panel. */
export function Inspector({ result }: { result: SolveResult }) {
  const { t, name, num } = useT();
  const inspect = useStore((s) => s.inspect);
  const set = useStore((s) => s.set);
  const setMod = useStore((s) => s.setMod);
  const plan = usePlan();
  // Slider position while it's dragged, and until the solve comes back with the clock it asked for.
  // Tied to the machine and the clock it started from, so any new result shows the real clock again.
  const [draft, setDraft] = useState<{ value: number; id: string; from: number }>();
  const use = result.recipes.find((u) => u.recipe.id === inspect);
  if (!use) return null;

  const { recipe } = use;
  const machine = data.machines[recipe.machine];
  const mod = plan.mods[recipe.id] ?? NO_MOD;
  // Slots show the busiest machine; the label gives the real total across the line.
  const shards = Math.max(0, ...use.clocks.map(shardsFor));
  const amp = amplification(recipe, mod);
  const change = (patch: Partial<typeof mod>) => setMod(recipe.id, { ...mod, ...patch });

  // The line's work in machines at 100%. Setting a machine count spreads it evenly, so the clock
  // shown here is always the clock the machines on the graph actually run at.
  const units = use.count * mod.clock;
  const fewest = Math.max(1, Math.ceil(units / MAX_CLOCK - EPS));
  const most = Math.max(fewest, Math.floor(units / 0.01 + EPS));
  const setMachines = (n: number) => change({ clock: units / Math.min(most, Math.max(fewest, n)) });
  /**
   * Only some clocks split the work evenly (units / n). Take the nearest one, and if that's where
   * the line already is, step one machine the way the clock moved so arrow keys still get somewhere.
   */
  const setClock = (want: number) => {
    if (Math.abs(want - use.clock) < EPS) return;
    const exact = units / Math.min(MAX_CLOCK, Math.max(0.01, want));
    let n = [Math.floor(exact + EPS), Math.ceil(exact - EPS)]
      .map((k) => Math.min(most, Math.max(fewest, k)))
      .reduce((a, b) => (Math.abs(units / b - want) < Math.abs(units / a - want) ? b : a));
    if (n === use.built) n = Math.min(most, Math.max(fewest, n + (want > use.clock ? -1 : 1)));
    setDraft({ value: units / n, id: recipe.id, from: use.clock });
    setMachines(n);
  };
  const clock = draft && draft.id === recipe.id && draft.from === use.clock ? draft.value : use.clock;

  return (
    <aside className="inspector" aria-label={name(recipe)}>
      <header className="inspector-head">
        <Icon id={recipe.machine} size={48} />
        <div className="inspector-title">
          <span className="inspector-machine">{name(machine)}</span>
          <span className="inspector-recipe">{recipeLabel(name(recipe), recipe.kind)}</span>
        </div>
        <button type="button" className="icon-button" aria-label={t('close')} onClick={() => set({ inspect: undefined })}>
          ×
        </button>
      </header>

      <div className="inspector-row">
        <span className="inspector-label">{t('machines')}</span>
        <div className="stepper">
          <button type="button" aria-label={t('fewerMachines')} disabled={use.built <= fewest} onClick={() => setMachines(use.built - 1)}>
            −
          </button>
          <b>{use.built}</b>
          <button type="button" aria-label={t('moreMachines')} disabled={use.built >= most} onClick={() => setMachines(use.built + 1)}>
            +
          </button>
          <span className="slot-label">{t('clockSnapHint')}</span>
        </div>
      </div>

      <div className="inspector-row">
        <label className="inspector-label" htmlFor="clock">
          {t('clockSpeed')}
        </label>
        <div className="clock-control">
          <input
            id="clock"
            type="range"
            min={1}
            max={MAX_CLOCK * 100}
            step={1}
            value={Math.round(clock * 100)}
            onChange={(e) => setDraft({ value: Number(e.target.value) / 100, id: recipe.id, from: use.clock })}
            onPointerUp={() => setClock(clock)}
            onKeyUp={() => setClock(clock)}
            style={{ ['--fill' as string]: `${((clock * 100 - 1) / (MAX_CLOCK * 100 - 1)) * 100}%` }}
          />
          <RateInput
            value={Math.round(clock * 10000) / 100}
            label={t('clockSpeed')}
            onChange={(n) => setClock(Math.min(MAX_CLOCK, n / 100))}
          />
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

      <div className="inspector-row">
        <span className="inspector-label">{t('sloops')}</span>
        {machine.somersloopSlots === 0 ? (
          <p className="hint">{t('noSloopSlots')}</p>
        ) : (
          <div className="sloop-slots" role="radiogroup" aria-label={t('sloops')}>
            {Array.from({ length: machine.somersloopSlots + 1 }, (_, n) => n).map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={mod.sloops === n}
                className={n > 0 && n <= Math.ceil(mod.sloops) ? 'filled' : undefined}
                onClick={() => change({ sloops: n })}
              >
                {n}
              </button>
            ))}
            <span className="slot-label">
              +{num((amp - 1) * 100)}% {t('outputBoost')}
              {use.sloops > 0 && `, ${use.sloops} ${t('inUse')}`}
            </span>
          </div>
        )}
      </div>

      <dl className="inspector-stats">
        <div>
          <dt>{t('machines')}</dt>
          <dd>
            {groupClocks(use.clocks)
              .map((g) => `${g.n} × ${num(g.clock * 100)}%`)
              .join(', ')}
          </dd>
        </div>
        <div>
          <dt>{t('power')}</dt>
          <dd className="power">{num(use.power)} MW</dd>
        </div>
        {use.outputs.map((o) => (
          <div key={o.item}>
            <dt>
              <Icon id={o.item} size={18} /> {name(data.items[o.item])}
            </dt>
            <dd>
              {num(o.rate)}
              {t('perMin')}
            </dd>
          </div>
        ))}
      </dl>

      {(mod.clock !== 1 || mod.sloops !== 0) && (
        <button type="button" className="text-button" onClick={() => setMod(recipe.id, undefined)}>
          {t('resetMod')}
        </button>
      )}
    </aside>
  );
}
