import { useEffect, useMemo, useRef, useState } from 'react';
import { data, producersOf, recipeUnlocked } from '../lib/data';
import { useCodex } from '../lib/codex';
import { versusStandard } from '../lib/insights';
import { useT } from '../lib/i18n';
import { recipeLabel } from '../lib/text';
import { groupClocks } from '../lib/clocks';
import { buildGroups, groupsLabel, isPipe } from '../lib/groups';
import { amplification, NO_MOD, shardsFor, type SolveResult } from '../lib/solver';
import { matchFlows, splitByDestination } from '../lib/split';
import { toggleBuilt, usePlan, useStore } from '../store';
import { Icon } from './Icon';
import { RateInput } from './RateInput';
import { useSplitText } from './SplitText';

const MAX_CLOCK = 2.5;
const EPS = 1e-6;

/** Clock speed + somersloop settings for one recipe's machines, like the in-game machine panel. */
export function Inspector({ result }: { result: SolveResult }) {
  const { t, name, num } = useT();
  const inspect = useStore((s) => s.inspect);
  const tier = useStore((s) => s.tier);
  const set = useStore((s) => s.set);
  const setMod = useStore((s) => s.setMod);
  const updatePlan = useStore((s) => s.updatePlan);
  const plan = usePlan();
  // Slider position while it's dragged, and until the solve comes back with the clock it asked for.
  // Tied to the machine and the clock it started from, so any new result shows the real clock again.
  const [draft, setDraft] = useState<{ value: number; id: string; from: number }>();
  const flows = useMemo(() => matchFlows(result), [result]);
  const words = useSplitText();
  const use = result.recipes.find((u) => u.recipe.id === inspect);
  // Ticking another recipe for the part here can take this machine out of the plan; the panel then follows the
  // part to whatever makes it now, instead of closing.
  const part = useRef<string>(undefined);
  if (use) part.current = use.recipe.outputs[0].item;
  useEffect(() => {
    if (use || !inspect || !part.current) return;
    const now = result.recipes.find((u) => u.recipe.kind !== 'power' && u.recipe.outputs[0].item === part.current);
    set({ inspect: now?.recipe.id });
  }, [use, inspect, result, set]);
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
  const groups = buildGroups(use, tier);
  const split = splitByDestination(use, flows, tier);
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
          <span className="slot-label">{use.shards === 1 ? t('shardOne') : t('shardsN', { n: use.shards })}</span>
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
        {groups && (
          <div className="inspector-groups">
            <dt>{t('buildGroups')}</dt>
            <dd>{t('groupsShort', { sizes: groupsLabel(groups.sizes) })}</dd>
            <dd className="hint groups-why">
              {t('groupsWhy', {
                rate: num(groups.rate),
                item: name(data.items[groups.item]),
                transport: t(isPipe(groups.transport) ? 'pipeName' : 'beltName', { mk: groups.transport.name }),
              })}
            </dd>
          </div>
        )}
        {split && (
          <div className="inspector-split">
            <dt>{t('splitTitle')}</dt>
            {split.groups.map((g) => (
              <dd key={g.to.map((d) => (d.kind === 'recipe' ? d.recipe.id : d.kind)).join()} className="split-line">
                <span className="split-run">{words.run(g.use)}</span>
                <span className="split-to">{t('splitTo', { to: words.where(g.to) })}</span>
                <span className="split-rate">
                  {num(g.rate)}
                  {t('perMin')}
                </span>
                {g.groups && <span className="split-groups">{t('groupsShort', { sizes: groupsLabel(g.groups.sizes) })}</span>}
              </dd>
            ))}
            <dd className="hint groups-why">{words.extra(split)}</dd>
          </div>
        )}
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

      <div className="inspector-actions">
        <label className={`built-check ${plan.built?.includes(recipe.id) ? 'on' : ''}`}>
          <input type="checkbox" checked={!!plan.built?.includes(recipe.id)} onChange={() => updatePlan(toggleBuilt(recipe.id))} />
          {t('builtCheck')}
        </label>
      </div>

      <RecipeChoices item={recipe.outputs[0].item} result={result} />

      {(mod.clock !== 1 || mod.sloops !== 0) && (
        <button type="button" className="text-button" onClick={() => setMod(recipe.id, undefined)}>
          {t('resetMod')}
        </button>
      )}
    </aside>
  );
}

/**
 * The recipes turned on for the part this machine makes, so one can be turned off from the floor; what's off stays in
 * the Recipes tab. Each says how its whole line compares with the standard one, once the Codex is in.
 */
function RecipeChoices({ item, result }: { item: string; result: SolveResult }) {
  const { t, name } = useT();
  const plan = usePlan();
  const tier = useStore((s) => s.tier);
  const toggleRecipe = useStore((s) => s.toggleRecipe);
  const codex = useCodex();
  // The comparisons are worked out at the game's default part cost; under another one they'd mislead.
  const parts = useStore((s) => s.settings.game.parts);
  const on = new Set(plan.enabled);
  const recipes = (producersOf.get(item) ?? []).filter((r) => r.kind !== 'power' && recipeUnlocked(r, tier) && on.has(r.id));
  if (recipes.length < 2) return null;
  const used = new Set(result.recipes.map((u) => u.recipe.id));
  const insight = parts === 1 ? codex?.data.insights.items[item] : undefined;
  const change = (share: number, more: 'moreRaw' | 'morePower', less: 'lessRaw' | 'lessPower') =>
    Math.abs(share) < 0.005 ? undefined : t(share > 0 ? more : less, { n: Math.round(Math.abs(share) * 100) });
  return (
    <section className="recipe-choices">
      <h3 className="inspector-label">{t('recipesFor', { item: name(data.items[item]) })}</h3>
      <ul>
        {recipes.map((r) => {
          const vs = r.kind === 'standard' ? undefined : versusStandard(insight, r.id);
          const note = vs
            ? vs.needsMore
              ? t('needsOtherParts')
              : [change(vs.raw, 'moreRaw', 'lessRaw'), change(vs.power, 'morePower', 'lessPower')].filter(Boolean).join(', ')
            : '';
          return (
            <li key={r.id}>
              <label className={`recipe-choice ${on.has(r.id) ? 'on' : ''}`}>
                <input type="checkbox" checked={on.has(r.id)} onChange={(e) => toggleRecipe(r.id, e.target.checked)} />
                <span className="recipe-choice-text">
                  <span className="recipe-choice-name">
                    {recipeLabel(name(r), r.kind)}
                    {r.kind !== 'standard' && <span className={`kind ${r.kind}`}>{t(r.kind)}</span>}
                    {used.has(r.id) && <span className="recipe-choice-used">{t('inUse')}</span>}
                  </span>
                  {note && <small>{note}</small>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
