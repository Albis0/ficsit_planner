import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/*
  The app's own hover tips, in place of the browser's plain ones. Anything with a title gets one: on the first hover
  the title moves to data-tip (so the browser's own never shows) and a dark box with an arrow comes up under it, or
  over it near the bottom of the screen. Keyboard focus shows it too; a touch never does. Moving straight on to the
  next button shows its tip at once, as a toolbar's should.
*/

/** How long a pointer rests before the tip comes up, and how long after one goes the next comes up at once. */
const WAIT = 400;
const WARM = 600;
/** Kept this far from the screen's edges. */
const EDGE = 8;

/** "Undo (Ctrl+Z)": the name, and the key in a box of its own. */
const KEYED = /^(.*\S)\s*\(((?:Ctrl|Shift|Alt|Cmd|⌘)[^)]*)\)$/;

interface Shown {
  text: string;
  key?: string;
  /** The middle of what it's for, and the edge it hangs off. */
  x: number;
  y: number;
  below: boolean;
}

/** The tip an element carries, taking over its title on the way. */
function tipOf(el: Element): string | undefined {
  const title = el.getAttribute('title');
  if (title) {
    el.setAttribute('data-tip', title);
    el.removeAttribute('title');
    // A button that's only an icon was named by its title: it keeps the name.
    if (!el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby') && !el.textContent?.trim())
      el.setAttribute('aria-label', title);
  }
  return el.getAttribute('data-tip') || undefined;
}

export function TipLayer() {
  const [shown, setShown] = useState<Shown>();
  const box = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);

  useEffect(() => {
    let timer = 0;
    let over: Element | undefined;
    let lastHidden = 0;
    const hide = () => {
      clearTimeout(timer);
      over = undefined;
      setShown((s) => {
        if (s) lastHidden = performance.now();
        return undefined;
      });
    };
    const show = (el: Element) => {
      const text = tipOf(el);
      if (!text) return;
      clearTimeout(timer);
      over = el;
      const open = () => {
        if (over !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        const below = r.bottom + 48 < window.innerHeight;
        const m = KEYED.exec(text);
        setShown({ text: m ? m[1] : text, key: m?.[2], x: r.left + r.width / 2, y: below ? r.bottom : r.top, below });
      };
      if (performance.now() - lastHidden < WARM) open();
      else timer = window.setTimeout(open, WAIT);
    };
    const target = (e: Event) => (e.target instanceof Element ? e.target.closest('[title], [data-tip]') : null);
    // A screen with no pointer to rest (a phone) shows none.
    const noHover = window.matchMedia('(hover: none)');
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || noHover.matches) return;
      const el = target(e);
      if (el === over) return;
      if (!el) {
        if (over) hide();
        return;
      }
      if (over) {
        // From one tip straight to the next.
        setShown((s) => {
          if (s) lastHidden = performance.now();
          return undefined;
        });
      }
      show(el);
    };
    const onFocus = (e: FocusEvent) => {
      if (noHover.matches) return;
      const el = target(e);
      if (el && el === e.target && el.matches(':focus-visible')) show(el);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    const opts = { capture: true, passive: true } as const;
    document.addEventListener('pointerover', onOver, opts);
    document.addEventListener('focusin', onFocus, opts);
    document.addEventListener('focusout', hide, opts);
    document.addEventListener('pointerdown', hide, opts);
    document.addEventListener('wheel', hide, opts);
    document.addEventListener('scroll', hide, opts);
    document.addEventListener('keydown', onKey, opts);
    window.addEventListener('blur', hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerover', onOver, opts);
      document.removeEventListener('focusin', onFocus, opts);
      document.removeEventListener('focusout', hide, opts);
      document.removeEventListener('pointerdown', hide, opts);
      document.removeEventListener('wheel', hide, opts);
      document.removeEventListener('scroll', hide, opts);
      document.removeEventListener('keydown', onKey, opts);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // Pushed in from the screen's edges; the arrow stays over what it's for.
  useLayoutEffect(() => {
    if (!shown || !box.current) return;
    const half = box.current.offsetWidth / 2;
    const left = Math.max(EDGE + half, Math.min(window.innerWidth - EDGE - half, shown.x));
    setShift(left - shown.x);
  }, [shown]);

  if (!shown) return null;
  return createPortal(
    <div
      ref={box}
      className={`tip ${shown.below ? 'below' : 'above'}`}
      role="tooltip"
      style={{ left: shown.x + shift, top: shown.y, ['--arrow' as string]: `${-shift}px` }}
    >
      <span>{shown.text}</span>
      {shown.key && <kbd>{shown.key}</kbd>}
    </div>,
    document.body,
  );
}
