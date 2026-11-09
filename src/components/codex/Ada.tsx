import { type CSSProperties, Fragment, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import ada from '../../data/ada.json';
import { useT } from '../../lib/i18n';
import { Glyph } from '../Glyph';
import { motionReduced } from '../ModeSwitch';

type Line = { a: string[]; c: [number, string, number][] };
const lines = ada as unknown as Record<string, Line[]>;
const base = import.meta.env.BASE_URL;

// The game shows ADA's notification for this long before her voice starts.
const INTRO = 3580;

// When the aliens speak through her the badge breaks up the way the game draws it (measured from a recording at 15 redraws a second):
// a flash of tiled little logos, one grey frame, then the three colour channels sliding sideways by growing amounts while the
// picture flips between positive and negative. The sideways slide is an SVG filter whose offsets are set straight on the DOM.
const TICK = 66;
const MOSAIC = 330;
const GREY = 70;
const AMP = 5; // px the colour channels slide at most
const rnd = (n: number) => Math.round((Math.random() * 2 - 1) * n);
const hue = () => Math.floor(Math.random() * 360);
const CHANNELS = [
  ['r', '1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0'],
  ['g', '0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0'],
  ['b', '0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0'],
] as const;

/** ADA's badge as the game draws it over her words: the logo, with the speech bubble that sits in its D. */
function Badge({ glitch }: { glitch: boolean }) {
  const fx = useRef<HTMLSpanElement>(null);
  const slide = useRef<SVGFEOffsetElement[]>([]);
  const [mosaic, setMosaic] = useState<number[] | 'grey' | null>(null);
  useEffect(() => {
    const el = fx.current;
    if (!glitch || !el || motionReduced()) return;
    const t0 = performance.now();
    let negative = false;
    let hold = 0;
    const tick = () => {
      const t = performance.now() - t0;
      if (t < MOSAIC) return setMosaic(Array.from({ length: 9 }, hue));
      if (t < MOSAIC + GREY) return setMosaic('grey');
      setMosaic(null);
      if (--hold <= 0) {
        negative = !negative;
        hold = 3 + Math.floor(Math.random() * 6);
      }
      const amp = Math.min(AMP, ((t - MOSAIC - GREY) / 450) * AMP);
      for (const o of slide.current) o?.setAttribute('dx', String(rnd(amp)));
      el.style.filter = `url(#ada-rgb)${negative ? ' invert(1)' : ''}`;
    };
    tick();
    const id = window.setInterval(tick, TICK);
    return () => {
      clearInterval(id);
      setMosaic(null);
      el.style.filter = '';
    };
  }, [glitch]);
  return (
    <span className="ada-badge" aria-hidden>
      {/* biome-ignore lint/a11y/noSvgWithoutTitle: holds only the filter, inside an aria-hidden badge */}
      <svg className="ada-defs" width="0" height="0">
        <filter id="ada-rgb" x="-25%" y="-10%" width="150%" height="120%" colorInterpolationFilters="sRGB">
          {CHANNELS.map(([k, values], i) => (
            <Fragment key={k}>
              <feColorMatrix in="SourceGraphic" type="matrix" values={values} result={k} />
              <feOffset
                ref={(o) => {
                  if (o) slide.current[i] = o;
                }}
                in={k}
                dx="0"
                result={`${k}o`}
              />
            </Fragment>
          ))}
          <feBlend in="ro" in2="go" mode="screen" result="rg" />
          <feBlend in="rg" in2="bo" mode="screen" />
        </filter>
      </svg>
      <span className={`ada-fx${glitch ? ' glitch' : ''}`} ref={fx}>
        <span className="ada-bg" />
        <span className="ada-plate">
          <img className="ada-logo" src={`${base}ada/logo.png`} alt="" />
        </span>
        <span className="ada-halo" />
        <img className="ada-bubble" src={`${base}ada/bubble.png`} alt="" />
      </span>
      {mosaic && (
        <span className={`ada-mosaic${mosaic === 'grey' ? ' grey' : ''}`}>
          {mosaic !== 'grey' &&
            mosaic.map((h, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: nine fixed tiles
              <span key={i} style={{ background: `hsl(${h} 100% 50%)` }}>
                <img src={`${base}ada/logo.png`} alt="" style={{ filter: `hue-rotate(${(h + 180) % 360}deg)` }} />
              </span>
            ))}
        </span>
      )}
    </span>
  );
}

// When the aliens speak through her the game scrambles the line: faint noise first, the real words coming in from the left a word
// at a time (a quarter of a second in the recording).
const NOISE = 'abcdefghijklmnopqrstuvwxyz0123456789#$%&@§€£/\\()[]{}<>?!*+=-';
const GARBLE = 260;
const noiseOf = (text: string) => [...text].map((c) => (c === ' ' ? c : NOISE[Math.floor(Math.random() * NOISE.length)])).join('');

function Subtitle({ text, garble }: { text: string; garble: boolean }) {
  const scrambled = garble && !motionReduced();
  // Starts as noise already, so the real line never shows for a frame before it is scrambled.
  const [mix, setMix] = useState<{ done: number; noise: string } | null>(() => (scrambled ? { done: 0, noise: noiseOf(text) } : null));
  useEffect(() => {
    if (!scrambled) return setMix(null);
    const t0 = performance.now();
    let id = 0;
    const tick = () => {
      const p = (performance.now() - t0) / GARBLE;
      if (p >= 1) return setMix(null);
      const done = text.lastIndexOf(' ', Math.floor(p * text.length)) + 1;
      setMix({ done, noise: noiseOf(text) });
      id = window.setTimeout(tick, TICK);
    };
    tick();
    return () => clearTimeout(id);
  }, [text, scrambled]);
  if (!mix) return <p>{text}</p>;
  return (
    <p>
      {text.slice(0, mix.done)}
      <span className="ada-noise">{mix.noise.slice(mix.done)}</span>
    </p>
  );
}

// One voice at a time, kept outside the page so it goes on when the player moves to another tab or milestone.
type Playing = { id?: string; open: boolean; cue?: { text: string; other: boolean } };
let state: Playing = { open: false };
let speaking: (() => void) | undefined;
const listeners = new Set<() => void>();
const set = (next: Playing) => {
  state = next;
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const useAda = () => useSyncExternalStore(subscribe, () => state);

const stop = () => speaking?.();

function play(id: string, list: Line[]) {
  speaking?.();
  let message = 0;
  let file = 0;
  let offset = 0; // seconds the finished files of this message took
  let shown = -1;
  let audio: HTMLAudioElement | undefined;
  let chime: HTMLAudioElement | undefined;
  let frame = 0;
  let wait = 0;
  let done = false;
  const finish = () => {
    done = true;
    cancelAnimationFrame(frame);
    clearTimeout(wait);
    window.removeEventListener('keydown', skip, true);
    audio?.pause();
    chime?.pause();
    if (speaking === finish) {
      speaking = undefined;
      set({ open: false });
    }
  };
  // Enter (or Escape) skips the whole message, like the game's "Skip (Enter)".
  const skip = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    finish();
  };
  const show = () => {
    if (done) return;
    if (audio) {
      const at = audio.currentTime + offset;
      const cues = list[message].c;
      let k = 0;
      while (k + 1 < cues.length && cues[k + 1][0] <= at) k++;
      if (k !== shown) {
        shown = k;
        set({ id, open: true, cue: { text: cues[k][1], other: cues[k][2] === 1 } });
      }
    }
    frame = requestAnimationFrame(show);
  };
  const next = () => {
    if (done) return;
    const m = list[message];
    if (file >= m.a.length) {
      message++;
      file = 0;
      offset = 0;
      shown = -1;
      audio = undefined;
      if (message >= list.length) return finish();
      return next();
    }
    if (audio?.duration) offset += audio.duration;
    audio = new Audio(`${base}ada/${m.a[file++]}.ogg`);
    audio.onended = next;
    audio.onerror = finish;
    audio.play().catch(finish);
  };
  speaking = finish;
  window.addEventListener('keydown', skip, true);
  set({ id, open: true });
  // The notification and its chime come before the first words, whoever says them.
  const intro = !motionReduced();
  if (intro) {
    chime = new Audio(`${base}ada/jingle.ogg`);
    chime.play().catch(() => {});
  }
  wait = window.setTimeout(
    () => {
      next();
      frame = requestAnimationFrame(show);
    },
    intro ? INTRO : 0,
  );
}

/** The small button that has ADA speak about a milestone or research; it shows nothing when the game has no line for it. */
export function AdaButton({ id }: { id: string }) {
  const { t } = useT();
  const now = useAda();
  const list = lines[id];
  if (!list) return null;
  const mine = now.open && now.id === id;

  return (
    <button
      type="button"
      className={`ada-chip${mine ? ' playing' : ''}`}
      aria-pressed={mine}
      aria-label={t('adaPlay')}
      title={t('adaPlay')}
      onClick={() => (mine ? stop() : play(id, list))}
    >
      <span className="ada-mark" aria-hidden>
        <span className="ada-mark-in">
          <img src={`${base}ada/logo.png`} alt="" />
          <img className="ada-mark-bubble" src={`${base}ada/bubble.png`} alt="" />
        </span>
      </span>
      <Glyph name={mine ? 'stop' : 'speaker'} size={16} />
    </button>
  );
}

/** ADA's words on the screen the way the game shows them; mounted once, so they stay when the page underneath changes. */
export function AdaBar() {
  const { t } = useT();
  const { open, cue } = useAda();
  if (!open) return null;
  // The game's bar is 890 px on a 1920 px screen; smaller screens get it a little smaller, not as small as the screen is.
  const zoom = Math.min(1, Math.max(0.75, window.innerWidth / 1920));
  return createPortal(
    <div className="ada-bar" role="status" style={{ '--u': zoom } as CSSProperties}>
      <div className="ada-panel" />
      <Badge glitch={!!cue?.other} />
      {cue && <Subtitle key={cue.text} text={cue.text} garble={cue.other} />}
      <button type="button" className="ada-skip" onClick={stop}>
        {t('adaSkip')}
      </button>
    </div>,
    document.body,
  );
}
