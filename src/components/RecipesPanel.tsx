import { useT } from '../lib/i18n';
import { defaultEnabled, usePlan, useStore } from '../store';
import { RecipeBrowser } from './RecipeBrowser';

/** The recipes the factory on screen may use. */
export function RecipesPanel() {
  const { t } = useT();
  const plan = usePlan();
  const toggle = useStore((s) => s.toggleRecipe);
  const setRecipes = useStore((s) => s.setRecipes);
  const updatePlan = useStore((s) => s.updatePlan);
  // Already the recipes a new factory starts with: resetting would change nothing.
  const d = defaultEnabled();
  const on = new Set(plan.enabled);
  const atDefault = d.length === on.size && d.every((id) => on.has(id));
  return (
    <RecipeBrowser
      enabled={plan.enabled}
      onToggle={(id) => toggle(id)}
      onSet={setRecipes}
      extra={
        <button type="button" className="text-button" disabled={atDefault} onClick={() => updatePlan({ enabled: defaultEnabled() })}>
          <span className="when-wide">{t('resetRecipes')}</span>
          <span className="when-narrow">{t('resetRecipesShort')}</span>
        </button>
      }
    />
  );
}
