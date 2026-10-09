import { createContext, useEffect, useRef, useState } from 'react';
import { data } from '../lib/data';
import { useT } from '../lib/i18n';
import { LOGISTICS } from '../lib/model/catalog';
import { settingsStyle, type Settings } from '../lib/settings';
import { recipeLabel } from '../lib/text';
import { RunLine } from './GraphView';
import { Icon } from './Icon';
import { Slot } from './Slot';
import { beltStroke } from './floor/BeltStroke';

/** The spots on the little floor a setting changes. The row you point at lights its spots up. */
export type Spot =
  | 'size'
  | 'text'
  | 'spacing'
  | 'belts'
  | 'splitters'
  | 'labels'
  | 'motion'
  | 'grid'
  | 'beltColors'
  | 'accent'
  | 'standard'
  | 'alternate';

export const SpotContext = createContext<{ spot?: Spot; set: (spot?: Spot) => void }>({ set: () => {} });

const PAD = 14;

/** Where everything sits on the little floor, in its own pixels, from the settings that size and space it. */
function geometry(s: Pick<Settings, 'cardScale' | 'textScale' | 'spacing'>, compact: boolean) {
  const t = s.textScale;
  const c = s.cardScale;
  const tf = 0.6 + 0.4 * t;
  const hf = 0.3 + 0.7 * t;
  const mw = 310 * tf * c;
  const mh = 130 * hf * c;
  // On a narrow screen the stock and the product are left off and the belts run off the edges, so the machines stay big enough to read.
  const ew = compact ? 0 : 330 * tf * c;
  const eh = 100 * hf * c;
  const sw = 96;
  const gap = (compact ? 110 : 150) * s.spacing;
  const first = (compact ? 130 : 170) * s.spacing;
  const rows = 40 * s.spacing;
  const xS = ew + first;
  const xM = xS + sw + gap;
  const xO = xM + mw + gap;
  const H = 2 * mh + rows;
  const cy = H / 2;
  return {
    mw,
    mh,
    ew,
    eh,
    sw,
    xS,
    xM,
    xO,
    cy,
    yA: mh / 2,
    yB: mh + rows + mh / 2,
    W: xO + ew + 2 * PAD,
    H: H + 2 * PAD,
  };
}

const REFERENCE = {
  wide: geometry({ cardScale: 1, textScale: 1, spacing: 1 }, false),
  compact: geometry({ cardScale: 1, textScale: 1, spacing: 1 }, true),
};

/** A belt from one handle to another: a curve, or straight runs with rounded square turns. */
function beltPath(x1: number, y1: number, x2: number, y2: number, square: boolean): string {
  const m = (x1 + x2) / 2;
  if (Math.abs(y2 - y1) < 1) return `M${x1},${y1} L${x2},${y2}`;
  if (!square) return `M${x1},${y1} C${m},${y1} ${m},${y2} ${x2},${y2}`;
  const r = Math.min(24, Math.abs(y2 - y1) / 2, (x2 - x1) / 4);
  const d = Math.sign(y2 - y1);
  return `M${x1},${y1} H${m - r} Q${m},${y1} ${m},${y1 + d * r} V${y2 - d * r} Q${m},${y2} ${m + r},${y2} H${x2}`;
}

const recipe = (id: string) => data.recipes.find((r) => r.id === id)!;

/**
 * A little factory floor drawn with the draft settings: a stock of ingots, a splitter, two machines and the product.
 * It looks like the real floor because it is drawn from the same cards, belts and labels; the row being pointed at
 * rings the spots it changes.
 */
export function Preview({ settings: s, spot }: { settings: Settings; spot?: Spot }) {
  const { t, name, num } = useT();
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const watch = new ResizeObserver(() => setWidth(el.clientWidth));
    watch.observe(el);
    setWidth(el.clientWidth);
    return () => watch.disconnect();
  }, []);

  const compact = width < 520;
  const g = geometry(s, compact);
  const ref = compact ? REFERENCE.compact : REFERENCE.wide;
  const maxHeight = compact ? 150 : 230;
  // The picture's size is fixed by the default settings, so a bigger card really is bigger; only far past the room does it shrink.
  const kRef = Math.min(width / ref.W, maxHeight / ref.H, 0.7);
  const kFit = Math.min(width / g.W, maxHeight / g.H);
  const k = Math.max(Math.min(kRef, kFit), kRef * 0.8);
  const height = ref.H * kRef;

  const plates = recipe('Recipe_IronPlate_C');
  const screws = recipe('Recipe_Alternate_Screw_C');
  const square = s.autoBelts === 'square';
  const oneColor = s.beltColors === 'one';
  const transport = data.belts[1];
  const ingot = 'Desc_IronIngot_C';

  const belts: { key: string; path: string; item: string; lanes: number; rate: number; at: [number, number] }[] = [];
  const add = (key: string, x1: number, y1: number, x2: number, y2: number, item: string, lanes: number, rate: number) =>
    belts.push({ key, path: beltPath(x1, y1, x2, y2, square), item, lanes, rate, at: [(x1 + x2) / 2, (y1 + y2) / 2] });
  const out = g.xM + g.mw;
  if (s.autoSplitters) {
    add('in', g.ew, g.cy, g.xS, g.cy, ingot, 2, 240);
    add('a', g.xS + g.sw, g.cy, g.xM, g.yA, ingot, 1, 120);
    add('b', g.xS + g.sw, g.cy, g.xM, g.yB, ingot, 1, 120);
  } else {
    add('a', g.ew, g.cy, g.xM, g.yA, ingot, 1, 120);
    add('b', g.ew, g.cy, g.xM, g.yB, ingot, 1, 120);
  }
  add('plates', out, g.yA, g.xO, g.cy, 'Desc_IronPlate_C', 1, 80);
  add('screws', out, g.yB, g.xO, g.cy, 'Desc_IronScrew_C', 1, 100);

  const drawn = belts.map((b) => ({ ...b, ...beltStroke({ path: b.path, item: b.item, transport, lanes: b.lanes, oneColor }) }));

  const machine = (r: ReturnType<typeof recipe>, n: number, top: number, spots: string) => (
    <div className="preview-spot" data-for={`size text ${spots}`} style={{ left: g.xM, top, width: g.mw, height: g.mh }}>
      <div className={`machine-node ${r.kind}`}>
        <div className="machine-strip">
          <Icon id={r.outputs[0].item} size={30} className="strip-icon" />
          <span className="machine-product">{recipeLabel(name(r), r.kind)}</span>
        </div>
        <div className="machine-body">
          <Icon id={r.machine} size={60} className="machine-icon" />
          <span className="machine-info">
            <span className="machine-type">{name(data.machines[r.machine])}</span>
            <RunLine clocks={Array.from({ length: n }, () => 1)} />
            <span className="machine-mods">
              <span className="machine-draw">
                {num(r.power * n)}
                <small>MW</small>
              </span>
            </span>
          </span>
        </div>
      </div>
    </div>
  );

  const endpoint = (kind: 'supply' | 'target', item: string, rate: number, left: number, spots: string) => (
    <div className="preview-spot" data-for={`size text ${spots}`} style={{ left, top: g.cy - g.eh / 2, width: g.ew, height: g.eh }}>
      <div className={`endpoint-node ${kind}`}>
        <Slot id={item} size={60} tone={kind === 'target' ? 'target' : 'default'} />
        <span className="endpoint-text">
          <span className="endpoint-kind">{kind === 'supply' ? t('onHand') : t('output')}</span>
          <span className="endpoint-name">{name(data.items[item])}</span>
          <span className="endpoint-line">
            <span className="endpoint-rate">
              {num(rate)}
              <small>{t('perMin')}</small>
            </span>
          </span>
        </span>
      </div>
    </div>
  );

  const geo = g;
  return (
    <figure
      className="settings-preview"
      aria-label={t('preview')}
      data-belt-motion={s.beltMotion ? undefined : 'off'}
      data-focus={spot}
      style={settingsStyle(s)}
    >
      <div className={`preview-floor ${s.gridLines ? 'lines' : ''}`} ref={box} style={{ height }} data-for="grid">
        <div
          className="preview-scene"
          aria-hidden
          style={{
            width: geo.W,
            height: geo.H,
            transform: `translate(${(width - geo.W * k) / 2}px, ${(height - geo.H * k) / 2}px) scale(${k})`,
          }}
        >
          <div className="preview-inner">
            {!compact && endpoint('supply', ingot, 240, 0, '')}
            {s.autoSplitters && (
              <div className="preview-spot" data-for="splitters" style={{ left: geo.xS, top: geo.cy - 48, width: geo.sw, height: 96 }}>
                <div className="logistic-node">
                  <Icon id={LOGISTICS.splitter.icon} size={44} />
                  <span className="logistic-rate">
                    {num(240)}
                    <small>{t('perMin')}</small>
                  </span>
                </div>
              </div>
            )}
            <svg className="preview-belts" width={geo.W - 2 * PAD} height={geo.H - 2 * PAD} aria-hidden>
              <g data-for="belts motion beltColors spacing">
                {drawn.map((b) => (
                  <g key={b.key}>{b.body}</g>
                ))}
              </g>
            </svg>
            {machine(plates, 2, 0, 'standard')}
            {machine(screws, 2, geo.yB - geo.mh / 2, 'alternate')}
            {!compact && endpoint('target', 'Desc_IronPlateReinforced_C', 6, geo.xO, 'accent')}
            {s.beltLabels !== 'never' &&
              drawn.map((b) => (
                <div key={b.key} className="preview-anchor" style={{ left: b.at[0], top: b.at[1] }}>
                  <div className="edge-label" data-for="labels text">
                    <Icon id={b.item} size={24} />
                    <span className="edge-text">
                      <span className="edge-meta">
                        <span className="edge-rate">
                          {num(b.rate)}
                          {t('perMin')}
                        </span>
                        <span className="edge-tier" style={{ background: b.color }}>
                          {b.lanes > 1 && `${b.lanes} × `}
                          {transport.name}
                        </span>
                      </span>
                    </span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </figure>
  );
}
