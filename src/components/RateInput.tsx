import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n';

interface Props {
  value: number;
  onChange: (v: number) => void;
  label: string;
  placeholder?: string;
  /** Allow clearing to "no value" (used for resource caps). */
  onClear?: () => void;
  /** Up and down buttons beside the field that move it one whole number at a time. */
  step?: boolean;
  /** The most it takes; typing past it shows and commits this instead. */
  max?: number;
}

/** A typed amount: "12,5", "12.5" or a fraction like "100/3". NaN when it isn't one. */
export function parseAmount(text: string): number {
  const t = text.replace(',', '.').trim();
  const frac = t.match(/^(\d*\.?\d+)\s*\/\s*(\d*\.?\d+)$/);
  if (frac) {
    const d = Number.parseFloat(frac[2]);
    return d > 0 ? Number.parseFloat(frac[1]) / d : Number.NaN;
  }
  return Number.parseFloat(t);
}

/** One whole number up or down: 12.5 goes to 13 or 12, never below zero. */
const up = (v: number) => Math.floor(v + 1e-9) + 1;
const down = (v: number) => Math.max(0, Math.ceil(v - 1e-9) - 1);

/** A long number gets smaller type down to this share of the field's own size; past that it scrolls inside. */
const MIN_TYPE = 0.6;
let ruler: CanvasRenderingContext2D | null | undefined;

/**
 * Shrinks the field's type until its text fits, no smaller than MIN_TYPE; the field keeps its height. The size the
 * stylesheet gives it is read once, before any shrinking: Chrome can go on reporting the shrunk size for a while after
 * the inline one is taken off, and refitting from that would shrink it again each time.
 */
function fitText(el: HTMLInputElement) {
  ruler ??= document.createElement('canvas').getContext('2d');
  if (!ruler) return;
  const cs = getComputedStyle(el);
  if (!el.dataset.type) {
    if (el.style.fontSize) return;
    el.dataset.type = `${cs.fontSize}|${cs.lineHeight}`;
  }
  const [type, line] = el.dataset.type.split('|');
  const size = Number.parseFloat(type);
  const room = el.clientWidth - Number.parseFloat(cs.paddingLeft) - Number.parseFloat(cs.paddingRight);
  // Firefox leaves the `font` shorthand empty in computed styles, so it's put together by hand.
  ruler.font = `${cs.fontStyle} ${cs.fontWeight} ${type} ${cs.fontFamily}`;
  const width = el.value ? ruler.measureText(el.value).width : 0;
  const fits = room <= 0 || width <= room;
  el.style.fontSize = fits ? '' : `${Math.max(MIN_TYPE, room / width) * size}px`;
  el.style.lineHeight = fits ? '' : line;
}

/** Numeric field that accepts "12,5", "12.5" and fractions ("100/3"), and only commits valid numbers. */
export function RateInput({ value, onChange, label, placeholder, onClear, step, max }: Props) {
  const { t } = useT();
  const [text, setText] = useState(Number.isNaN(value) ? '' : String(value));
  const ref = useRef<HTMLInputElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refit whenever the text changes.
  useLayoutEffect(() => {
    if (ref.current) fitText(ref.current);
  }, [text]);
  // Again once the field gets a width (a panel opening, a phone turning) and once the web fonts are in.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let width = -1;
    const refit = () => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fitText(el);
    };
    const watch = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(refit);
    watch?.observe(el);
    let live = true;
    document.fonts?.ready.then(() => live && fitText(el));
    return () => {
      live = false;
      watch?.disconnect();
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: only sync when the outside value changes, not while typing.
  useEffect(() => {
    const parsed = parseAmount(text);
    if (parsed !== value) setText(Number.isNaN(value) ? '' : String(value));
  }, [value]);

  const current = () => {
    const n = parseAmount(text);
    return Number.isFinite(n) ? n : Number.isNaN(value) ? 0 : value;
  };
  const nudge = (next: number) => {
    setText(String(next));
    onChange(next);
  };

  const input = (
    <input
      ref={ref}
      className="rate-input"
      inputMode="decimal"
      aria-label={label}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        if (v.trim() === '' && onClear) return onClear();
        const n = parseAmount(v);
        if (max !== undefined && n > max) {
          setText(String(max));
          return onChange(max);
        }
        if (Number.isFinite(n) && n >= 0) onChange(n);
      }}
      onKeyDown={(e) => {
        if (!step || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault();
        nudge(e.key === 'ArrowUp' ? up(current()) : down(current()));
      }}
      onFocus={(e) => e.target.select()}
    />
  );
  if (!step) return input;

  return (
    <span className="rate-field">
      {input}
      <span className="rate-step">
        <button type="button" className="step-up" aria-label={`${t('increase')}: ${label}`} onClick={() => nudge(up(current()))}>
          <span aria-hidden />
        </button>
        <button
          type="button"
          className="step-down"
          aria-label={`${t('decrease')}: ${label}`}
          disabled={current() <= 0}
          onClick={() => nudge(down(current()))}
        >
          <span aria-hidden />
        </button>
      </span>
    </span>
  );
}
