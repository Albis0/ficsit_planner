import { flushSync } from 'react-dom';
import { useT } from '../lib/i18n';
import { useStore } from '../store';
import { Glyph } from './Glyph';

type Mode = 'factory' | 'power' | 'codex' | 'map';

/** Whether to skip the big transitions: the player's setting first, then the system's. */
export function motionReduced(): boolean {
  const pref = useStore.getState().settings.motion;
  if (pref !== 'system') return pref === 'reduce';
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Switches planner with a short cross-fade; reduced motion, and browsers without view transitions, just switch. */
function switchMode(next: Mode) {
  const apply = () => flushSync(() => useStore.getState().set({ mode: next, inspect: undefined }));
  if (motionReduced() || typeof document.startViewTransition !== 'function') return apply();
  document.startViewTransition(apply);
}

/** Factory planner, power planner, the Codex or the map: a lever in the top bar, the thumb sliding between them. */
export function ModeSwitch() {
  const { t } = useT();
  const mode = useStore((s) => s.mode);
  const option = (id: Mode, label: string, glyph: 'factory' | 'bolt' | 'book' | 'map') => (
    <button type="button" role="radio" aria-checked={mode === id} title={label} onClick={() => mode !== id && switchMode(id)}>
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
      {option('map', t('mapMode'), 'map')}
    </div>
  );
}
