import { useT } from '../lib/i18n';
import { usePlan, useStore } from '../store';

/** Fewer resources or less power, for the active factory. */
export function ObjectiveSwitch({ wide = false }: { wide?: boolean }) {
  const { t } = useT();
  const plan = usePlan();
  const updatePlan = useStore((s) => s.updatePlan);
  return (
    <div className={`segmented ${wide ? 'wide' : ''}`} role="radiogroup" aria-label={t('objective')}>
      <button type="button" role="radio" aria-checked={plan.objective === 'resources'} onClick={() => updatePlan({ objective: 'resources' })}>
        {t('objResources')}
      </button>
      <button type="button" role="radio" aria-checked={plan.objective === 'power'} onClick={() => updatePlan({ objective: 'power' })}>
        {t('objPower')}
      </button>
    </div>
  );
}
