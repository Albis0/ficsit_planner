import { useT } from '../lib/i18n';
import { Glyph } from './Glyph';

/** What kind of factory a tab is, in front of its name: a gear for one worked out from its targets, a grid for one built by hand. */
export function KindIcon({ manual, size = 20 }: { manual: boolean; size?: number }) {
  const { t } = useT();
  const label = t(manual ? 'newManualPlan' : 'newAutoPlan');
  return (
    <span className={`kind-icon ${manual ? 'manual' : 'auto'}`} role="img" aria-label={label} title={label}>
      <Glyph name={manual ? 'floor' : 'gear'} size={size} />
    </span>
  );
}
