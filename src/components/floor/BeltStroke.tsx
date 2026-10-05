import { useMemo, type ReactNode } from 'react';
import { BELT_COLORS } from '../../lib/belts';
import { data, type Transport } from '../../lib/data';

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
export function BeltChevrons({ path, width, speed }: { path: string; width: number; speed: number }) {
  const { count, seconds } = useMemo(() => {
    const len = lengthOf(path);
    const n = Math.max(1, Math.min(MAX_CHEVRONS, Math.round(len / SPACING)));
    return { count: n, seconds: Math.max(0.5, len / (20 / speed)) };
  }, [path, speed]);
  const h = Math.max(2.5, width / 2);
  const d = `M${-h * 0.5},${-h} L${h * 0.5},0 L${-h * 0.5},${h}`;
  const offsetPath = `path("${path}")`;
  return (
    <g className="belt-chevrons">
      {Array.from({ length: count }, (_, i) => (
        <path
          key={i}
          d={d}
          className="belt-chev"
          style={{ offsetPath, offsetDistance: `${(i / count) * 100}%`, animationDuration: `${seconds}s`, animationDelay: `${-(i / count) * seconds}s` }}
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
}): { body: ReactNode; color: string } {
  const it = data.items[item];
  if (it && it.form !== 'solid') {
    const mk = pipeIndex(transport.id);
    const w = mk === 0 ? 9 : 12;
    const color = it.color ?? 'var(--fluid)';
    return {
      color,
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
  const w = 12 + 5 * (lanes - 1);
  return {
    color,
    body: (
      <g className={`belt-edge ${state}`} style={{ ['--belt' as string]: color, ['--belt-speed' as string]: `${2 / Math.sqrt(mk + 1)}s` }}>
        <path d={path} className="belt-rails" style={{ strokeWidth: w }} />
        <path d={path} className="belt-bed" style={{ strokeWidth: w - 5 }} />
        <BeltChevrons path={path} width={w - 5} speed={2 / Math.sqrt(mk + 1)} />
      </g>
    ),
  };
}
