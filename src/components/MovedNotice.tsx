import { useState } from 'react';
import { exportAll } from '../lib/backup';
import { useT } from '../lib/i18n';
import { hasWork, moveLink, NEW_URL, OLD_HOST } from '../lib/share';

const KEY = 'ficsit-moved-later';
/** After "Later" the reminder waits this long. */
const WAIT = 7 * 24 * 3600 * 1000;

const waiting = () => {
  try {
    return Date.now() - Number(localStorage.getItem(KEY) ?? 0) < WAIT;
  } catch {
    return false;
  }
};

/**
 * On the old address only: says the app has a new one, and takes the plans along in a link, or, when they're too many
 * for one, saves the backup file to import there. Plans live in the browser per address, so they don't follow by themselves.
 */
export function MovedNotice() {
  const { t } = useT();
  const [state, setState] = useState<'ask' | 'file' | 'gone'>(() => (waiting() ? 'gone' : 'ask'));
  if (typeof location === 'undefined' || location.hostname !== OLD_HOST || state === 'gone') return null;
  const later = () => {
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {}
    setState('gone');
  };
  const move = async () => {
    const link = await moveLink();
    if (link) {
      location.href = link;
      return;
    }
    exportAll();
    setState('file');
  };
  return (
    <div className="toast moved" role="status">
      <span>{state === 'file' ? t('movedFile') : t('movedText')}</span>
      {state === 'file' || !hasWork() ? (
        <a className="text-button" href={NEW_URL}>
          {t('openNewAddress')}
        </a>
      ) : (
        <button type="button" className="text-button" onClick={move}>
          {t('moveMine')}
        </button>
      )}
      <button type="button" className="text-button quiet" onClick={later}>
        {t('later')}
      </button>
    </div>
  );
}
