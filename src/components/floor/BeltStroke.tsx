import type { ReactNode } from 'react';
import { BELT_COLORS } from '../../lib/belts';
import { data, type Transport } from '../../lib/data';
import { type Arrival, arrowHead } from '../../lib/routes';

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

/**
 * A conveyor belt (rails, bed, moving slats) or a pipe (casing, flowing fluid) along a path, as both floors draw them.
 * Side by side lines widen it, and `end` puts an arrowhead where it arrives. Returns the drawing and the colour of its
 * tier, for the label's Mk badge.
 */
export function beltStroke({
  path,
  item,
  transport,
  lanes = 1,
  state = '',
  oneColor = false,
  end,
}: {
  path: string;
  item: string;
  transport: Transport;
  lanes?: number;
  state?: string;
  oneColor?: boolean;
  end?: Arrival;
}): { body: ReactNode; color: string } {
  const it = data.items[item];
  if (it && it.form !== 'solid') {
    const mk = pipeIndex(transport.id);
    const w = mk === 0 ? 9 : 12;
    const color = it.color ?? 'var(--fluid)';
    const wide = w + 4 * (lanes - 1);
    return {
      color,
      body: (
        <g className={`pipe-edge ${state}`}>
          <path d={path} className="pipe-casing" style={{ strokeWidth: wide }} />
          <path d={path} className="pipe-fluid" style={{ stroke: color, strokeWidth: w - 4 }} />
          {end && <polygon points={arrowHead(end, wide + 8, wide * 1.6 + 10)} className="pipe-arrow" style={{ fill: color }} />}
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
        <path d={path} className="belt-slats" style={{ strokeWidth: w - 5 }} />
        {end && <polygon points={arrowHead(end, w + 8, w * 1.6 + 10)} className="belt-arrow" />}
      </g>
    ),
  };
}
