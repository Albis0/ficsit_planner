import { useEffect, useState } from 'react';
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
}

/** One whole number up or down: 12.5 goes to 13 or 12, never below zero. */
const up = (v: number) => Math.floor(v + 1e-9) + 1;
const down = (v: number) => Math.max(0, Math.ceil(v - 1e-9) - 1);

/** Numeric field that accepts both "12,5" and "12.5" and only commits valid numbers. */
export function RateInput({ value, onChange, label, placeholder, onClear, step }: Props) {
  const { t } = useT();
  const [text, setText] = useState(Number.isNaN(value) ? '' : String(value));

  // biome-ignore lint/correctness/useExhaustiveDependencies: only sync when the outside value changes, not while typing.
  useEffect(() => {
    const parsed = Number.parseFloat(text.replace(',', '.'));
    if (parsed !== value) setText(Number.isNaN(value) ? '' : String(value));
  }, [value]);

  const current = () => {
    const n = Number.parseFloat(text.replace(',', '.'));
    return Number.isFinite(n) ? n : Number.isNaN(value) ? 0 : value;
  };
  const nudge = (next: number) => {
    setText(String(next));
    onChange(next);
  };

  const input = (
    <input
      className="rate-input"
      inputMode="decimal"
      aria-label={label}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        if (v.trim() === '' && onClear) return onClear();
        const n = Number.parseFloat(v.replace(',', '.'));
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
