import { useRef } from 'react';
import { useT } from '../lib/i18n';
import { useStore } from '../store';

const MIN = 300;
/** Room the factory floor keeps next to the widest panel. */
const FLOOR_MIN = 420;
const STEP = 24;

const clamp = (w: number) => Math.round(Math.max(MIN, Math.min(window.innerWidth - FLOOR_MIN, w)));

/** Drag handle on the side panel's edge. Arrow keys move it too; double-click goes back to the default. */
export function Splitter() {
  const { t } = useT();
  const width = useStore((s) => s.sideWidth);
  const set = useStore((s) => s.set);
  const start = useRef<{ x: number; w: number }>(undefined);

  const current = () => width ?? document.querySelector('.side')?.getBoundingClientRect().width ?? 460;

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={t('resizePanel')}
      aria-valuenow={Math.round(current())}
      aria-valuemin={MIN}
      tabIndex={0}
      title={t('resizePanel')}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, w: current() };
        document.body.classList.add('resizing');
      }}
      onPointerMove={(e) => {
        if (start.current) set({ sideWidth: clamp(start.current.w + e.clientX - start.current.x) });
      }}
      onPointerUp={() => {
        start.current = undefined;
        document.body.classList.remove('resizing');
      }}
      onDoubleClick={() => set({ sideWidth: undefined })}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') set({ sideWidth: clamp(current() - STEP) });
        if (e.key === 'ArrowRight') set({ sideWidth: clamp(current() + STEP) });
      }}
    />
  );
}
