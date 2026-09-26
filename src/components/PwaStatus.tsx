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

/** Registers the service worker and says once when everything is cached for offline use. */
export function PwaStatus() {
  const { t } = useT();
  const {
    offlineReady: [offlineReady, setOfflineReady],
  } = useRegisterSW();
  useEffect(() => {
    if (!offlineReady) return;
    const timer = setTimeout(() => setOfflineReady(false), 6000);
    return () => clearTimeout(timer);
  }, [offlineReady, setOfflineReady]);
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
