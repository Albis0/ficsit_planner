import { useSyncExternalStore } from 'react';

// Chrome, Edge and Android fire `beforeinstallprompt` once, often before React mounts, so it is
// caught here at import time and kept until the user clicks Install.

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | undefined;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

const standalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

/** iPhone and iPad Safari have no install prompt; the app is added from the Share menu instead. */
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = undefined;
    emit();
  });
}

export type InstallMode = 'prompt' | 'ios' | 'none';

const snapshot = (): InstallMode => {
  if (installed || standalone()) return 'none';
  if (deferred) return 'prompt';
  return isIos() ? 'ios' : 'none';
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** How this browser can install the app: its own prompt, the iOS Share menu, or not at all. */
export const useInstallMode = () => useSyncExternalStore(subscribe, snapshot, () => 'none' as InstallMode);

/** Shows the browser's install dialog. */
export async function promptInstall() {
  const e = deferred;
  if (!e) return;
  deferred = undefined;
  await e.prompt();
  await e.userChoice;
  emit();
}
