import { useMemo, type ReactNode } from 'react';
import { BELT_COLORS } from '../../lib/belts';
import { data, type Transport } from '../../lib/data';
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

/** Small chevrons running along a belt's path, each one following its curve. `speed` is the seconds one slat takes (20px). */
export function BeltChevrons({
  path,
  width,
  speed,
  lanes = 1,
  pitch = 0,
}: {
  path: string;
  width: number;
  speed: number;
  lanes?: number;
  pitch?: number;
}) {
  const { count, seconds } = useMemo(() => {
    const len = lengthOf(path);
    const n = Math.max(1, Math.min(MAX_CHEVRONS, Math.round(len / SPACING)));
    return { count: n, seconds: Math.max(0.5, len / (20 / speed)) };
  }, [path, speed]);
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
}: {
  path: string;
  item: string;
  transport: Transport;
  lanes?: number;
  state?: string;
  oneColor?: boolean;
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
