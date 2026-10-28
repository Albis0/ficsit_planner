import { useEffect, useRef, useState } from 'react';
import { calculate, type Done, loadCalc, saveCalc, shown } from '../lib/calc';
import { useT } from '../lib/i18n';
import { Glyph } from './Glyph';

// Laid out as a number pad: seven eight nine on top, the sign keys down the right, and = as tall as its two rows.
// The last key is one bracket key: it opens, and the next press closes.
const KEYS = ['C', '⌫', '÷', '×', '7', '8', '9', '−', '4', '5', '6', '+', '1', '2', '3', '=', '0', '.', '()'];
const WIDE = 240;

/** The bracket the bracket key puts next: a closing one once there is a bracket open and a number to close behind. */
const nextBracket = (text: string) => {
  const open = (text.match(/\(/g)?.length ?? 0) - (text.match(/\)/g)?.length ?? 0);
  return open > 0 && /[\d.%)]$/.test(text.trimEnd()) ? ')' : '(';
};

/** A calculator window over the page: dragged by its title bar, shrunk to the bar with the last result, its sums kept in the browser. */
export function Calculator({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const first = useRef(loadCalc()).current;
  const [done, setDone] = useState<Done[]>(first.done);
  const [small, setSmall] = useState(first.small);
  const [at, setAt] = useState(first.at ?? { x: Math.max(8, window.innerWidth - WIDE - 16), y: 76 });
  const [text, setText] = useState('');
  const [history, setHistory] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const live = calculate(text);

  useEffect(() => {
    saveCalc({ done, at, small });
  }, [done, at, small]);
  useEffect(() => {
    if (!small) field.current?.focus();
  }, [small]);

  const enter = () => {
    if (live === undefined) return;
    const result = shown(live);
    setDone((d) => [...d, { sum: text.trim(), result }].slice(-40));
    setText(result);
  };
  const key = (k: string) => {
    if (k === 'C') setText('');
    else if (k === '⌫') setText((x) => x.slice(0, -1));
    else if (k === '=') enter();
    else if (k === '()') setText((x) => x + nextBracket(x));
    else setText((x) => x + k);
    field.current?.focus();
  };
  // The title bar drags the window, kept inside the screen.
  const drag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const [sx, sy, ox, oy] = [e.clientX, e.clientY, at.x, at.y];
    const move = (ev: PointerEvent) => {
      const w = box.current?.offsetWidth ?? WIDE;
      setAt({
        x: Math.min(Math.max(0, ox + ev.clientX - sx), Math.max(0, window.innerWidth - w)),
        y: Math.min(Math.max(0, oy + ev.clientY - sy), Math.max(0, window.innerHeight - 40)),
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const last = done[done.length - 1];
  // The history opens beside the window where there is room for it, and under it on a narrow screen.
  const room = [at.x, window.innerWidth - at.x - WIDE];
  const side = room[0] >= 214 ? 'left' : room[1] >= 214 ? 'right' : 'below';

  return (
    <div
      ref={box}
      className="calc"
      role="dialog"
      aria-label={t('calculator')}
      style={{ left: at.x, top: at.y }}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className="calc-bar" onPointerDown={drag}>
        <span className="calc-title">{t('calculator')}</span>
        {small && last && <span className="calc-last">= {last.result}</span>}
        <button type="button" className="calc-tool" aria-label={small ? t('calcOpen') : t('calcShrink')} onClick={() => setSmall(!small)}>
          <Glyph name={small ? 'chevronDown' : 'chevronUp'} size={16} weight={2.2} />
        </button>
        <button type="button" className="calc-tool" aria-label={t('close')} onClick={onClose}>
          <Glyph name="close" size={16} weight={2.2} />
        </button>
      </div>
      {!small && (
        <div className="calc-body">
          <input
            ref={field}
            className="calc-field"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            aria-label={t('calcSum')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') enter();
            }}
          />
          <div className="calc-keys">
            {KEYS.map((k) => (
              <button
                key={k}
                type="button"
                className={k === '=' ? 'equals' : /\d|\./.test(k) ? 'num' : ''}
                disabled={k === '=' && live === undefined}
                onClick={() => key(k)}
              >
                {k === '()' ? nextBracket(text) : k}
              </button>
            ))}
          </div>
        </div>
      )}
      {!small && done.length > 0 && (
        <div className="calc-side" data-side={side}>
          <button
            type="button"
            className="calc-handle"
            aria-label={t('calcHistory')}
            aria-expanded={history}
            onClick={() => setHistory(!history)}
          >
            <Glyph
              name={
                side === 'below' ? (history ? 'chevronUp' : 'chevronDown') : (side === 'left') === history ? 'chevronRight' : 'chevronLeft'
              }
              size={16}
              weight={2.2}
            />
          </button>
          {history && (
            <section className="calc-history" aria-label={t('calcHistory')}>
              <header>
                <span>{t('calcHistory')}</span>
                <button type="button" className="calc-tool" aria-label={t('calcClear')} title={t('calcClear')} onClick={() => setDone([])}>
                  <Glyph name="trash" size={16} weight={2} />
                </button>
              </header>
              <ul>
                {[...done].reverse().map((d, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a sum can repeat, the list only grows at its top
                  <li key={i}>
                    <button type="button" title={t('calcUse')} onClick={() => setText(d.result)}>
                      <span className="calc-sum">{d.sum}</span>
                      <b>{d.result}</b>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
