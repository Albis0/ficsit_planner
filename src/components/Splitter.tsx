import { useRef } from 'react';
import { useT } from '../lib/i18n';
import { useStore } from '../store';

const MIN = 170;
/** Room the factory floor keeps under the tallest panel, plus the top bar. */
const FLOOR_MIN = 300;
const TOP = 64;
const STEP = 24;

const clamp = (h: number) => Math.round(Math.max(MIN, Math.min(window.innerHeight - TOP - FLOOR_MIN, h)));

/** Drag handle on the bottom edge of the panel above the floor. Arrow keys move it too; double-click goes back to the default. */
export function Splitter() {
  const { t } = useT();
  const height = useStore((s) => s.deckHeight);
  const set = useStore((s) => s.set);
  const start = useRef<{ y: number; h: number }>(undefined);

  const current = () => height ?? document.querySelector('.side')?.getBoundingClientRect().height ?? 320;

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="horizontal"
      aria-label={t('resizePanel')}
      aria-valuenow={Math.round(current())}
      aria-valuemin={MIN}
      tabIndex={0}
      title={t('resizePanel')}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { y: e.clientY, h: current() };
        document.body.classList.add('resizing');
      }}
      onPointerMove={(e) => {
        if (start.current) set({ deckHeight: clamp(start.current.h + e.clientY - start.current.y) });
      }}
      onPointerUp={() => {
        start.current = undefined;
        document.body.classList.remove('resizing');
      }}
      onDoubleClick={() => set({ deckHeight: undefined })}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp') set({ deckHeight: clamp(current() - STEP) });
        if (e.key === 'ArrowDown') set({ deckHeight: clamp(current() + STEP) });
      }}
    />
  );
}
