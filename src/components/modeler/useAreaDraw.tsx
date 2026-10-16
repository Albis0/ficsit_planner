import { type RefObject, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Point = { x: number; y: number };

/**
 * An area is drawn by holding the right button and dragging over the empty floor. Gives back the box being drawn (a
 * portal to show it) and calls `onDraw` with the two screen corners when the button is let go. Touch screens don't draw.
 */
export function useAreaDraw(floor: RefObject<HTMLElement | null>, onDraw: (a: Point, b: Point) => void) {
  const [drawing, setDrawing] = useState<{ x0: number; y0: number; x1: number; y1: number }>();
  const draw = useRef(onDraw);
  draw.current = onDraw;
  useEffect(() => {
    const el = floor.current;
    if (!el) return;
    let from: Point | undefined;
    let live = false;
    const down = (e: PointerEvent) => {
      from = undefined;
      live = false;
      if (e.button === 2 && e.pointerType !== 'touch' && (e.target as HTMLElement).classList.contains('react-flow__pane'))
        from = { x: e.clientX, y: e.clientY };
    };
    const move = (e: PointerEvent) => {
      if (!from || !(e.buttons & 2)) return;
      if (!live && Math.hypot(e.clientX - from.x, e.clientY - from.y) < 8) return;
      live = true;
      setDrawing({ x0: from.x, y0: from.y, x1: e.clientX, y1: e.clientY });
    };
    const up = (e: PointerEvent) => {
      if (from && live && e.type === 'pointerup') draw.current(from, { x: e.clientX, y: e.clientY });
      from = undefined;
      live = false;
      setDrawing(undefined);
    };
    el.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [floor]);
  return (
    drawing &&
    createPortal(
      <div
        className="area-draw"
        style={{
          left: Math.min(drawing.x0, drawing.x1),
          top: Math.min(drawing.y0, drawing.y1),
          width: Math.abs(drawing.x1 - drawing.x0),
          height: Math.abs(drawing.y1 - drawing.y0),
        }}
      />,
      document.body,
    )
  );
}
