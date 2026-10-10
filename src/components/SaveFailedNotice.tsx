import { useState } from 'react';
import { exportAll } from '../lib/backup';
import { useT } from '../lib/i18n';
import { useSaveFailed } from '../lib/safeStorage';

/**
 * Shown while the browser refuses to keep the plans (its store is full or blocked). The backup file is the way out.
 * It goes away by itself once a save goes through again; "Dismiss" hides it until the next failure.
 */
export function SaveFailedNotice() {
  const { t } = useT();
  const failed = useSaveFailed();
  const [hidden, setHidden] = useState(false);
  if (!failed) {
    if (hidden) setHidden(false);
    return null;
  }
  if (hidden) return null;
  return (
    <div className="toast moved bad" role="alert">
      <span>{t('saveFailed')}</span>
      <button type="button" className="text-button" onClick={exportAll}>
        {t('saveFailedBackup')}
      </button>
      <button type="button" className="text-button quiet" onClick={() => setHidden(true)}>
        {t('saveFailedDismiss')}
      </button>
    </div>
  );
}
