import { useEffect, useState } from 'react';

interface Props {
  value: number;
  onChange: (v: number) => void;
  label: string;
  placeholder?: string;
  /** Allow clearing to "no value" (used for resource caps). */
  onClear?: () => void;
}

/** Numeric field that accepts both "12,5" and "12.5" and only commits valid numbers. */
export function RateInput({ value, onChange, label, placeholder, onClear }: Props) {
  const [text, setText] = useState(Number.isNaN(value) ? '' : String(value));

  useEffect(() => {
    const parsed = Number.parseFloat(text.replace(',', '.'));
    if (parsed !== value) setText(Number.isNaN(value) ? '' : String(value));
    // Only sync when the outside value changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
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
      onFocus={(e) => e.target.select()}
    />
  );
}
