import { data } from '../lib/data';
import { useT } from '../lib/i18n';
import { groupClocks } from '../lib/clocks';
import { amplification, NO_MOD, shardsFor, type SolveResult } from '../lib/solver';
import { usePlan, useStore } from '../store';
import { Icon } from './Icon';
import { RateInput } from './RateInput';

const MAX_CLOCK = 2.5;

/** Clock speed + somersloop settings for one recipe's machines, like the in-game machine panel. */
export function Inspector({ result }: { result: SolveResult }) {
  const { t, name, num } = useT();
  const inspect = useStore((s) => s.inspect);
  const set = useStore((s) => s.set);
  const setMod = useStore((s) => s.setMod);
  const plan = usePlan();
  const use = result.recipes.find((u) => u.recipe.id === inspect);
  if (!use) return null;

  const { recipe } = use;
  const machine = data.machines[recipe.machine];
  const mod = plan.mods[recipe.id] ?? NO_MOD;
  // Slots show the busiest machine; the label gives the real total across the line.
  const shards = Math.max(0, ...use.clocks.map(shardsFor));
  const amp = amplification(recipe, mod);
  const change = (patch: Partial<typeof mod>) => setMod(recipe.id, { ...mod, ...patch });

  return (
    <aside className="inspector" aria-label={name(recipe)}>
      <header className="inspector-head">
        <Icon id={recipe.machine} size={48} />
        <div className="inspector-title">
          <span className="inspector-machine">{name(machine)}</span>
          <span className="inspector-recipe">{name(recipe).replace(/^(Alternatif|Alternate): /, '')}</span>
        </div>
        <button type="button" className="icon-button" aria-label={t('close')} onClick={() => set({ inspect: undefined })}>
          ×
        </button>
      </header>

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
            value={Math.round(mod.clock * 100)}
            onChange={(e) => change({ clock: Number(e.target.value) / 100 })}
            style={{ ['--fill' as string]: `${((mod.clock * 100 - 1) / (MAX_CLOCK * 100 - 1)) * 100}%` }}
          />
          <RateInput
            value={Math.round(mod.clock * 10000) / 100}
            label={t('clockSpeed')}
            onChange={(n) => change({ clock: Math.min(MAX_CLOCK, Math.max(0.01, n / 100)) })}
          />
          <span className="unit">%</span>
        </div>
        <div className="shard-slots" aria-label={`${t('shards')}: ${shards}`}>
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
            {Array.from({ length: machine.somersloopSlots + 1 }, (_, n) => (
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
