import { useMemo, type ReactNode } from 'react';
import { BELT_COLORS } from '../../lib/belts';
import { data, type Transport } from '../../lib/data';
import { LANE_PITCH } from '../../lib/graph';
import { pipeColor } from '../../lib/pipe';
import { inkOn } from '../../lib/settings';

const beltIndex = (id: string) =>
  Math.max(
    0,
    data.belts.findIndex((b) => b.id === id),
  );
const pipeIndex = (id: string) =>
  Math.max(
    0,
    data.pipes.findIndex((p) => p.id === id),
  );

const SPACING = 15;
const MAX_CHEVRONS = 80;
let ruler: SVGPathElement | null = null;
const lengthOf = (d: string) => {
  ruler ??= document.createElementNS('http://www.w3.org/2000/svg', 'path');
  ruler.setAttribute('d', d);
  return ruler.getTotalLength();
};

// How far from a handle the belts run together into one, and how far apart the points are that a belt is drawn through.
const FAN = 30;
const STEP = 6;
const MAX_POINTS = 240;
const lanesCache = new Map<string, string[]>();

/**
 * The path shifted sideways into `lanes` paths side by side, `pitch` apart, each following the bends of the first. They
 * run together into the path's two ends, so what meets a handle is one belt. Null where it can't be measured.
 */
export function lanePaths(path: string, lanes: number, pitch = LANE_PITCH, wide = { from: false, to: false }): string[] | null {
  if (lanes < 2 || typeof document === 'undefined') return null;
  const key = `${lanes}|${pitch}|${wide.from}|${wide.to}|${path}`;
  const hit = lanesCache.get(key);
  if (hit) return hit;
  const probe = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  probe.setAttribute('d', path);
  const len = probe.getTotalLength();
  if (!(len > 1)) return null;
  const n = Math.min(MAX_POINTS, Math.max(2, Math.ceil(len / STEP)));
  const out = Array.from({ length: lanes }, () => '');
  for (let k = 0; k <= n; k++) {
    const at = (k / n) * len;
    const a = probe.getPointAtLength(Math.max(0, at - 1));
    const b = probe.getPointAtLength(Math.min(len, at + 1));
    const p = probe.getPointAtLength(at);
    const tx = b.x - a.x;
    const ty = b.y - a.y;
    const m = Math.hypot(tx, ty) || 1;
    // Full spread in the middle, none at either end.
    // An end as wide as the belts takes them in parallel, so they don't close up there.
    const edge = Math.min(wide.from ? 1 : at / FAN, wide.to ? 1 : (len - at) / FAN, 1);
    const spread = edge * edge * (3 - 2 * edge);
    for (let i = 0; i < lanes; i++) {
      const o = (i - (lanes - 1) / 2) * pitch * spread;
      out[i] += `${k === 0 ? 'M' : 'L'}${(p.x - (ty / m) * o).toFixed(1)},${(p.y + (tx / m) * o).toFixed(1)} `;
    }
  }
  const paths = out.map((d) => d.trim());
  lanesCache.set(key, paths);
  if (lanesCache.size > 400) lanesCache.delete(lanesCache.keys().next().value as string);
  return paths;
}

/** Small chevrons running along a belt's path, each one following its curve. `speed` is the seconds one slat takes (20px). */
export function BeltChevrons({
  path,
  width,
  speed,
  lanes = 1,
  pitch = 0,
  most = MAX_CHEVRONS,
}: {
  path: string;
  width: number;
  speed: number;
  lanes?: number;
  pitch?: number;
  /** The most chevrons on this path. */
  most?: number;
}) {
  const { count, seconds } = useMemo(() => {
    const len = lengthOf(path);
    const n = Math.max(1, Math.min(most, Math.round(len / SPACING)));
    return { count: n, seconds: Math.max(0.5, len / (20 / speed)) };
  }, [path, speed, most]);
  const h = Math.max(2.5, width / 2);
  // One chevron per belt side by side, all in one shape so the slats stay in step.
  const d = Array.from({ length: lanes }, (_, i) => {
    const o = (i - (lanes - 1) / 2) * pitch;
    return `M${-h * 0.5},${o - h} L${h * 0.5},${o} L${-h * 0.5},${o + h}`;
  }).join(' ');
  const offsetPath = `path("${path}")`;
  return (
    <g className="belt-chevrons">
      {Array.from({ length: count }, (_, i) => i / count).map((at) => (
        <path
          key={at}
          d={d}
          className="belt-chev"
          style={{ offsetPath, offsetDistance: `${at * 100}%`, animationDuration: `${seconds}s`, animationDelay: `${-at * seconds}s` }}
        />
      ))}
    </g>
  );
}

/**
 * A conveyor belt (rails, bed, moving slats) or a pipe (casing, flowing fluid) along a path, as both floors draw them.
 * Side by side lines widen it. Returns the drawing and the colour of its tier, for the label's Mk badge.
 */
export function beltStroke({
  path,
  item,
  transport,
  lanes = 1,
  state = '',
  oneColor = false,
  wide,
  maxWidth,
}: {
  path: string;
  item: string;
  transport: Transport;
  lanes?: number;
  state?: string;
  oneColor?: boolean;
  /** Which ends are as wide as the belts side by side. */
  wide?: { from: boolean; to: boolean };
  /** The most the belts side by side may take across, where the ends are small and close to others. */
  maxWidth?: number;
}): { body: ReactNode; color: string; ink?: string } {
  const it = data.items[item];
  if (it && it.form !== 'solid') {
    const mk = pipeIndex(transport.id);
    const w = mk === 0 ? 9 : 12;
    const color = pipeColor(it) ?? 'var(--fluid)';
    return {
      color,
      ink: pipeColor(it) ? inkOn(color) : undefined,
      body: (
        <g className={`pipe-edge ${state}`}>
          <path d={path} className="pipe-casing" style={{ strokeWidth: w + 4 * (lanes - 1) }} />
          <path d={path} className="pipe-fluid" style={{ stroke: color, strokeWidth: w - 4 }} />
        </g>
      ),
    };
  }
  const mk = beltIndex(transport.id);
  const color = oneColor ? BELT_COLORS[0] : BELT_COLORS[Math.min(mk, BELT_COLORS.length - 1)];
  const across = Math.max(5, Math.min(LANE_PITCH, (maxWidth ?? Number.POSITIVE_INFINITY) / lanes));
  const apart = lanePaths(path, lanes, across, wide);
  if (apart) {
    // Each belt is its own path, so the line stays readable round a bend and the belts join only at the handles.
    const speed = 2 / Math.sqrt(mk + 1);
    return {
      color,
      body: (
        <g className={`belt-edge ${state}`} style={{ ['--belt' as string]: color, ['--belt-speed' as string]: `${speed}s` }}>
          {/* All the rails first, then the beds, so where the belts run together the rails never cut across a bed. */}
          {apart.map((d, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the belts of one line are alike and only ever redrawn together.
            <path key={i} d={d} className="belt-rails" style={{ strokeWidth: across }} />
          ))}
          {apart.map((d, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: as above.
            <path key={i} d={d} className="belt-bed" style={{ strokeWidth: Math.max(2, across - 4) }} />
          ))}
          {apart.map((d, i) => (
            <BeltChevrons
              // biome-ignore lint/suspicious/noArrayIndexKey: as above.
              key={i}
              path={d}
              width={Math.max(2, across - 4)}
              speed={speed}
              most={Math.max(24, Math.floor((MAX_CHEVRONS * 2) / apart.length))}
            />
          ))}
        </g>
      ),
    };
  }
  // One belt is a 7px bed in 2.5px rails. Several are that many beds side by side, a wall between each.
  const [bed, wall] = lanes > 1 ? [6, 2] : [7, 2.5];
  const pitch = bed + wall;
  const w = lanes * pitch + wall;
  // Walls between the beds, outermost first: each is a wide stroke in the wall's colour with the bed colour narrower on top.
  const first = lanes % 2 ? pitch / 2 : 0;
  const walls = Array.from({ length: Math.floor(lanes / 2) }, (_, i) => first + i * pitch).reverse();
  return {
    color,
    body: (
      <g className={`belt-edge ${state}`} style={{ ['--belt' as string]: color, ['--belt-speed' as string]: `${2 / Math.sqrt(mk + 1)}s` }}>
        <path d={path} className="belt-rails" style={{ strokeWidth: w }} />
        <path d={path} className="belt-bed" style={{ strokeWidth: w - 2 * wall }} />
        {walls.map((d) => (
          <g key={d}>
            <path d={path} className="belt-rails" style={{ strokeWidth: 2 * d + wall }} />
            {d > 0 && <path d={path} className="belt-bed" style={{ strokeWidth: 2 * d - wall }} />}
          </g>
        ))}
        <BeltChevrons path={path} width={bed} speed={2 / Math.sqrt(mk + 1)} lanes={lanes} pitch={pitch} />
      </g>
    ),
  };
}
