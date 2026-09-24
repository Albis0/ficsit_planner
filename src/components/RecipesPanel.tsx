import { useMemo, useState } from 'react';
import { data, recipeUnlocked, type Recipe, type RecipeKind, type Stack } from '../lib/data';
import { useT } from '../lib/i18n';
import { recipeLabel, searchKey } from '../lib/text';
import { defaultEnabled, MAX_TIER, usePlan, useStore } from '../store';
import { Icon } from './Icon';
import { Slot } from './Slot';

type Filter = 'all' | RecipeKind;

const tiers = Array.from({ length: MAX_TIER + 1 }, (_, i) => i);

export function RecipesPanel() {
  const { t, name, num } = useT();
  const plan = usePlan();
  const toggle = useStore((s) => s.toggleRecipe);
  const setRecipes = useStore((s) => s.setRecipes);
  const updatePlan = useStore((s) => s.updatePlan);
  const tier = useStore((s) => s.tier);
  const set = useStore((s) => s.set);
  const [filter, setFilter] = useState<Filter>('alternate');
  const [q, setQ] = useState('');

  const on = useMemo(() => new Set(plan.enabled), [plan.enabled]);

  // Group by main product so every way to make screws sits together.
  const groups = useMemo(() => {
    const f = searchKey(q.trim());
    const match = (r: Recipe) =>
      !f ||
      searchKey(name(r)).includes(f) ||
      [...r.inputs, ...r.outputs].some((s) => searchKey(name(data.items[s.item])).includes(f));
    const map = new Map<string, Recipe[]>();
    for (const r of data.recipes) {
      if (filter !== 'all' && r.kind !== filter) continue;
      if (!match(r)) continue;
      const key = r.outputs[0].item;
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return [...map].sort(([a], [b]) => name(data.items[a]).localeCompare(name(data.items[b])));
  }, [filter, q, name]);

  const visibleIds = groups.flatMap(([, rs]) => rs.map((r) => r.id));
  const visibleOn = visibleIds.filter((id) => on.has(id)).length;

  const stacks = (list: Stack[]) => list.map((s, i) => <Slot key={s.item + i} id={s.item} rate={s.rate} size={46} />);

  return (
    <div className="panel-body recipes">
      <div className="recipe-tools">
        <div className="tier-picker">
          <span className="control-label">{t('unlockedTier')}</span>
          <div className="tier-steps" role="radiogroup" aria-label={t('unlockedTier')}>
            {tiers.map((step) => (
              <button
                key={step}
                type="button"
                role="radio"
                aria-checked={tier === step}
                className={step <= tier ? 'reached' : undefined}
                onClick={() => set({ tier: step })}
              >
                {step}
              </button>
            ))}
          </div>
        </div>
        <input className="search" placeholder={t('searchRecipes')} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="segmented" role="radiogroup">
          {(['alternate', 'standard', 'converter', 'all'] as Filter[]).map((f) => (
            <button key={f} type="button" role="radio" aria-checked={filter === f} onClick={() => setFilter(f)}>
              {t(f)}
            </button>
          ))}
        </div>
        <div className="bulk">
          <span className="bulk-count">
            {visibleOn}/{visibleIds.length} {t('enabledCount')}
          </span>
          <button type="button" className="text-button" onClick={() => setRecipes(visibleIds, true)}>
            {t('enableAll')}
          </button>
          <button type="button" className="text-button" onClick={() => setRecipes(visibleIds, false)}>
            {t('disableAll')}
          </button>
          <button type="button" className="text-button" onClick={() => updatePlan({ enabled: defaultEnabled() })}>
            {t('resetRecipes')}
          </button>
        </div>
      </div>

      <div className="recipe-list">
        {groups.length === 0 && <p className="hint">{t('noResults')}</p>}
        {groups.map(([item, rs]) => (
          <section key={item} className="recipe-group">
            <h3 className="section-title with-icon">
              <Icon id={item} size={22} />
              {name(data.items[item])}
            </h3>
            {rs.map((r) => {
              const locked = !recipeUnlocked(r, tier);
              return (
                <label key={r.id} className={`recipe-row ${on.has(r.id) ? 'on' : ''} ${locked ? 'locked' : ''}`}>
                  <input type="checkbox" checked={on.has(r.id)} onChange={() => toggle(r.id)} />
                  <span className="recipe-main">
                    <span className="recipe-name">
                      {recipeLabel(name(r), r.kind)}
                      {r.kind !== 'standard' && <span className={`kind ${r.kind}`}>{t(r.kind)}</span>}
                      {r.tier !== undefined && (
                        <span className="tier-tag" title={locked ? t('aboveTier') : undefined}>
                          T{r.tier}
                        </span>
                      )}
                    </span>
                    <span className="recipe-io">
                      <span className="io-in">{stacks(r.inputs)}</span>
                      <span className="io-arrow" aria-hidden>
                        ›
                      </span>
                      <span className="io-out">{stacks(r.outputs)}</span>
                    </span>
                    <span className="recipe-machine">
                      <Icon id={r.machine} size={20} />
                      {name(data.machines[r.machine])}
                      <span className="recipe-duration">
                        {num(r.duration)} {t('seconds')}
                      </span>
                    </span>
                  </span>
                </label>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}
