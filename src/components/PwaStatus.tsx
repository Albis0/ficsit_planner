import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useT } from '../lib/i18n';
import { promptInstall, useInstallMode } from '../lib/install';
import { useStore } from '../store';

/** Install button for the top bar; on iPhone/iPad it explains the Share menu instead. */
export function InstallButton({ className = 'install-button' }: { className?: string }) {
  const { t } = useT();
  const mode = useInstallMode();
  const [hint, setHint] = useState(false);
  if (mode === 'none') return null;
  return (
    <span className="install">
      <button type="button" className={className} onClick={() => (mode === 'prompt' ? promptInstall() : setHint((h) => !h))}>
        {t('install')}
      </button>
      {hint && (
        <span className="install-hint" role="status">
          {t('installIosHint')}
        </span>
      )}
    </span>
  );
}

/** How often an open tab asks the site whether there's a newer version. */
const CHECK_EVERY = 30 * 60 * 1000;

/**
 * Lets the waiting version take over, then reloads into it: when it controls the page, when it has activated (a
 * page it doesn't control yet never sees the first), or after a few seconds whatever happens.
 */
function reloadInto(reg: ServiceWorkerRegistration | undefined) {
  const waiting = reg?.waiting;
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    window.location.reload();
  };
  if (!waiting) return go();
  navigator.serviceWorker.addEventListener('controllerchange', go);
  waiting.addEventListener('statechange', () => {
    if (waiting.state === 'activated') go();
  });
  setTimeout(go, 4000);
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

/**
 * Registers the service worker, says once when everything is cached for offline use, and when a newer version
 * has downloaded, offers to reload into it. An open tab looks for one every half hour and whenever it comes back
 * into view, since browsers only look on their own when a page is opened.
 */
export function PwaStatus() {
  const { t } = useT();
  const [later, setLater] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>();
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh],
  } = useRegisterSW({
    // Reload is done here instead: the library only reloads a page the old version was already serving, so after a
    // hard refresh or on a first visit Reload did nothing.
    onNeedReload() {},
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      setRegistration(reg);
      const check = () => {
        if (navigator.onLine && !reg.installing) reg.update().catch(() => {});
      };
      setInterval(check, CHECK_EVERY);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
    // Private windows and some browsers refuse service workers; the app still works, just not offline.
    onRegisterError: () => {},
  });
  useEffect(() => {
    if (!offlineReady) return;
    const timer = setTimeout(() => setOfflineReady(false), 6000);
    return () => clearTimeout(timer);
  }, [offlineReady, setOfflineReady]);
  if (needRefresh && !later) {
    return (
      <div className="toast" role="status">
        <span>{t('newVersion')}</span>
        <button type="button" className="text-button" onClick={() => reloadInto(registration)}>
          {t('reloadNow')}
        </button>
        <button type="button" className="text-button quiet" onClick={() => setLater(true)}>
          {t('later')}
        </button>
      </div>
    );
  }
  if (!offlineReady) return null;
  return (
    <div className="toast" role="status">
      <span>{t('offlineReady')}</span>
      <button type="button" className="text-button" onClick={() => setOfflineReady(false)}>
        {t('dismiss')}
      </button>
    </div>
  );
}

/** Says a tab was closed and offers it back for a few seconds, instead of asking before it goes. */
export function ClosedTab() {
  const { t } = useT();
  const closed = useStore((s) => s.closed);
  const set = useStore((s) => s.set);
  useEffect(() => {
    if (!closed) return;
    const timer = setTimeout(() => set({ closed: undefined }), 8000);
    return () => clearTimeout(timer);
  }, [closed, set]);
  if (!closed) return null;
  return (
    <div className="toast" role="status">
      <span>{t('tabClosed', { name: closed.name })}</span>
      <button
        type="button"
        className="text-button"
        onClick={() => useStore.setState({ ...closed.before, closed: undefined, inspect: undefined, renaming: undefined })}
      >
        {t('undo')}
      </button>
    </div>
  );
}

/** A short message from the app itself (a shared link opened, or couldn't be read), gone after a while. */
export function Notice() {
  const { t } = useT();
  const notice = useStore((s) => s.notice);
  const set = useStore((s) => s.set);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => set({ notice: undefined }), 8000);
    return () => clearTimeout(timer);
  }, [notice, set]);
  if (!notice) return null;
  return (
    <div className={`toast ${notice.key === 'sharedBroken' ? 'bad' : ''}`} role="status">
      <span>{t(notice.key, { name: notice.name ?? '' })}</span>
      <button type="button" className="text-button" onClick={() => set({ notice: undefined })}>
        {t('dismiss')}
      </button>
    </div>
  );
}
