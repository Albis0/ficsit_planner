import { useRef } from 'react';
import { useT } from '../lib/i18n';
import type { PanelSide } from '../lib/settings';
import { useStore } from '../store';

const MIN_H = 170;
const MIN_W = 300;
/** Room the factory floor keeps beside or under the panel, plus the top bar. */
const FLOOR_MIN_H = 300;
const FLOOR_MIN_W = 420;
const TOP = 64;
const STEP = 24;

const clampH = (h: number) => Math.round(Math.max(MIN_H, Math.min(window.innerHeight - TOP - FLOOR_MIN_H, h)));
const clampW = (w: number) => Math.round(Math.max(MIN_W, Math.min(window.innerWidth - FLOOR_MIN_W, w)));

/**
 * Drag handle on the panel's edge that faces the floor: its bottom edge when the panel sits on top,
 * its inner side when it sits left or right. Arrow keys move it too; double-click goes back to the default.
 */
export function Splitter({ side }: { side: PanelSide }) {
  const { t } = useT();
  const height = useStore((s) => s.deckHeight);
  const width = useStore((s) => s.sideWidth);
  const set = useStore((s) => s.set);
  const start = useRef<{ at: number; size: number }>(undefined);
  const across = side !== 'top';
  // Dragging a right-hand panel's edge to the left makes it wider.
  const sign = side === 'right' ? -1 : 1;

  const box = () => document.querySelector('.side')?.getBoundingClientRect();
  const current = () => (across ? (width ?? box()?.width ?? 460) : (height ?? box()?.height ?? 320));
  const put = (v: number) => set(across ? { sideWidth: clampW(v) } : { deckHeight: clampH(v) });

  return (
    <div
      className={`splitter ${across ? 'across' : ''}`}
      role="separator"
      aria-orientation={across ? 'vertical' : 'horizontal'}
      aria-label={t('resizePanel')}
      aria-valuenow={Math.round(current())}
      aria-valuemin={across ? MIN_W : MIN_H}
      tabIndex={0}
      title={t('resizePanel')}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { at: across ? e.clientX : e.clientY, size: current() };
        document.body.classList.add(across ? 'resizing-x' : 'resizing');
      }}
      onPointerMove={(e) => {
        if (start.current) put(start.current.size + sign * ((across ? e.clientX : e.clientY) - start.current.at));
      }}
      onPointerUp={() => {
        start.current = undefined;
        document.body.classList.remove('resizing', 'resizing-x');
      }}
      onDoubleClick={() => set(across ? { sideWidth: undefined } : { deckHeight: undefined })}
      onKeyDown={(e) => {
        const grow = across ? (side === 'right' ? 'ArrowLeft' : 'ArrowRight') : 'ArrowDown';
        const shrink = across ? (side === 'right' ? 'ArrowRight' : 'ArrowLeft') : 'ArrowUp';
        if (e.key === grow) put(current() + STEP);
        if (e.key === shrink) put(current() - STEP);
      }}
    />
  );
}
