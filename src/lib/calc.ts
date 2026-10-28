/** The pocket calculator: sums typed as text, worked out without `eval`. */

/** Sums with + - × ÷ (also * and /), brackets, % after a number, a comma or a point for decimals. Undefined when it isn't a sum. */
export function calculate(text: string): number | undefined {
  const src = text.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/,/g, '.').replace(/\s+/g, '');
  if (!src) return undefined;
  let i = 0;
  const peek = () => src[i];
  const number = (): number => {
    const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
    if (!m) throw new Error('number');
    i += m[0].length;
    let v = Number(m[0]);
    while (peek() === '%') {
      i++;
      v /= 100;
    }
    return v;
  };
  const factor = (): number => {
    if (peek() === '-') {
      i++;
      return -factor();
    }
    if (peek() === '+') {
      i++;
      return factor();
    }
    if (peek() === '(') {
      i++;
      const v = sum();
      if (peek() !== ')') throw new Error('bracket');
      i++;
      return v;
    }
    return number();
  };
  const product = (): number => {
    let v = factor();
    while (peek() === '*' || peek() === '/') {
      const op = src[i++];
      const r = factor();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (peek() === '+' || peek() === '-') {
      const op = src[i++];
      const r = product();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  try {
    const v = sum();
    return i === src.length && Number.isFinite(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/** A result as short text: no trailing zeros, no float dust. */
export function shown(v: number): string {
  if (Math.abs(v) >= 1e15 || (v !== 0 && Math.abs(v) < 1e-6)) return v.toExponential(4).replace(/\.?0+e/, 'e');
  return String(Number(v.toPrecision(10)));
}

export interface Done {
  sum: string;
  result: string;
}

const KEY = 'ficsit-calc';
const KEEP = 40;

export function loadCalc(): { done: Done[]; at?: { x: number; y: number }; small: boolean } {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const done = Array.isArray(s.done)
      ? s.done.filter((d: Done) => typeof d?.sum === 'string' && typeof d?.result === 'string').slice(-KEEP)
      : [];
    const at = Number.isFinite(s.at?.x) && Number.isFinite(s.at?.y) ? { x: s.at.x, y: s.at.y } : undefined;
    return { done, at, small: s.small === true };
  } catch {
    return { done: [], small: false };
  }
}

export function saveCalc(s: { done: Done[]; at?: { x: number; y: number }; small: boolean }) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...s, done: s.done.slice(-KEEP) }));
  } catch {}
}
