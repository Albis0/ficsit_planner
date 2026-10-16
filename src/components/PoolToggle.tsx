import { useT } from '../lib/i18n';
import { togglePooled, useStore } from '../store';

/** The button under an output card: offers the product to the pool, or takes it back, as the panel's Pool button does. */
export function PoolToggle({ item }: { item: string }) {
  const { t } = useT();
  const on = useStore((s) => !!s.plans.find((p) => p.id === s.active)?.pooled?.includes(item));
  const update = useStore((s) => s.updatePlan);
  return (
    <button
      type="button"
      className="endpoint-make endpoint-pool nodrag nopan"
      aria-pressed={on}
      title={t('toPoolHint')}
      onClick={() => update(togglePooled(item))}
    >
      {on ? t('inPool') : t('toPool')}
    </button>
  );
}
