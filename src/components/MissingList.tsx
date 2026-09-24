import { data, recipeById, whyMissing } from '../lib/data';
import { useT } from '../lib/i18n';
import type { Target } from '../lib/solver';
import { recipeLabel } from '../lib/text';
import { usePlan, useStore } from '../store';
import { Icon } from './Icon';

/** Each item the plan can't make, why, and the fix: switch tier, turn its recipe on, or bring it in. */
export function MissingList({ missing }: { missing: Target[] }) {
  const { t, name, num } = useT();
  const tier = useStore((s) => s.tier);
  const set = useStore((s) => s.set);
  const addSupply = useStore((s) => s.addSupply);
  const toggleRecipe = useStore((s) => s.toggleRecipe);
  const enabled = new Set(usePlan().enabled);

  return (
    <ul className="missing-list">
      {missing.map((m) => {
        const why = whyMissing(m.item, tier, enabled);
        const recipe = why.kind === 'off' ? recipeById.get(why.recipe) : undefined;
        return (
          <li key={m.item}>
            <Icon id={m.item} size={32} />
            <span className="missing-text">
              <b>{name(data.items[m.item])}</b> {why.kind === 'tier' && t('missingTier', { tier: why.tier, current: tier })}
              {why.kind === 'off' && t('missingOff', { recipe: recipe ? recipeLabel(name(recipe), recipe.kind) : '?' })}
              {why.kind === 'none' && t('missingNone')}
            </span>
            <span className="missing-fixes">
              {why.kind === 'tier' && (
                <button type="button" className="chip fix" onClick={() => set({ tier: why.tier })}>
                  {t('switchTier', { tier: why.tier })}
                </button>
              )}
              {why.kind === 'off' && (
                <button type="button" className="chip fix" onClick={() => toggleRecipe(why.recipe, true)}>
                  {t('turnOn')}
                </button>
              )}
              <button type="button" className="chip alert" onClick={() => addSupply(m.item, Math.ceil(m.rate))}>
                {t('bringIn')} {num(m.rate)}
                {t('perMin')}
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
