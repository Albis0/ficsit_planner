import { flushSync } from 'react-dom';
import { useT } from '../lib/i18n';
import { useStore } from '../store';
import { Glyph } from './Glyph';

type Mode = 'factory' | 'power' | 'codex';

/** Whether to skip the big transitions: the player's setting first, then the system's. */
export function motionReduced(): boolean {
  const pref = useStore.getState().settings.motion;
  if (pref !== 'system') return pref === 'reduce';
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Switches planner with a reveal: the new screen opens as a circle from the switch, with a shock
 * ring in the new mode's colour (see "Mode switch" in styles.css). Browsers without view
 * transitions, and reduced motion, just switch.
 */
function switchMode(next: Mode, from: HTMLElement) {
  const apply = () => flushSync(() => useStore.getState().set({ mode: next, inspect: undefined }));
  if (motionReduced() || typeof document.startViewTransition !== 'function') return apply();
  const box = from.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const root = document.documentElement;
  root.style.setProperty('--vt-x', `${x}px`);
  root.style.setProperty('--vt-y', `${y}px`);
  root.style.setProperty('--vt-r', `${r}px`);
  // The ring is drawn 480px across and grown to the reveal's size (see .mode-flash).
  root.style.setProperty('--vt-s', String(r / 240));
  root.dataset.vt = next;
  const done = () => delete root.dataset.vt;
  document.startViewTransition(apply).finished.then(done, done);
}

/** Factory planner, power planner or the Codex: a lever in the top bar, the thumb sliding between them. */
export function ModeSwitch() {
  const { t } = useT();
  const mode = useStore((s) => s.mode);
  const option = (id: Mode, label: string, glyph: 'factory' | 'bolt' | 'book') => (
    <button
      type="button"
      role="radio"
      aria-checked={mode === id}
      title={label}
      onClick={(e) => mode !== id && switchMode(id, e.currentTarget)}
    >
      <Glyph name={glyph} size={18} />
      <span className="mode-label">{label}</span>
    </button>
  );
  return (
    <div className="mode-switch" role="radiogroup" aria-label={t('planner')} data-mode={mode}>
      <span className="mode-thumb" aria-hidden />
      {option('factory', t('factoryMode'), 'factory')}
      {option('power', t('powerMode'), 'bolt')}
      {option('codex', t('codex'), 'book')}
    </div>
  );
}

/** The ring that sweeps out from the switch while the planner changes. Hidden outside a transition. */
export function ModeFlash() {
  return <div className="mode-flash" aria-hidden />;
}
