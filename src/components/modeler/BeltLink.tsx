import {
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  useStore as useFlowStore,
} from '@xyflow/react';
import { createContext, useContext } from 'react';
import { data } from '../../lib/data';
import { useT } from '../../lib/i18n';
import type { LinkCalc } from '../../lib/model/calc/result';
import type { Transport } from '../../lib/data';
import type { MLink } from '../../lib/model/types';
import { useStore } from '../../store';
import { beltStroke } from '../floor/BeltStroke';
import { Icon } from '../Icon';

export interface BeltData extends Record<string, unknown> {
  link: MLink;
  /** What it can carry: the first item it may hold, for the drawing. */
  item?: string;
  transport: Transport;
  calc?: LinkCalc;
  /** On a floor running top to bottom. */
  down?: boolean;
}

/** Opens a belt in the panel, from its label. */
export const PickLink = createContext<(id: string) => void>(() => {});

/** Belts shorter than their label, in floor units, show none unless picked; a laid-out floor keeps room for it. */
const SHORT = 180;

/** How round a belt's square turns are, in floor units. */
const TURN = 12;

type Pt = { x: number; y: number };

/**
 * A belt in straight runs with rounded square turns, from one end through its bends to the other. The ends are where
 * the cards draw them, so the first and last bends line up with them; with no bends it steps across half way. On a
 * floor running down the same holds turned a quarter: it leaves and reaches its ends going down.
 */
export function squarePath(from: Pt, bends: Pt[], to: Pt, down = false): { path: string; runs: [Pt, Pt][] } {
  // Worked out as if left to right, then turned back.
  const turn = (p: Pt) => (down ? { x: p.y, y: p.x } : { ...p });
  const [a0, b0] = [turn(from), turn(to)];
  const mid = bends.map(turn);
  if (mid.length >= 2) {
    mid[0].y = a0.y;
    mid[mid.length - 1].y = b0.y;
  } else if (mid.length === 0 && Math.abs(a0.y - b0.y) > 0.5) {
    const x = (a0.x + b0.x) / 2;
    mid.push({ x, y: a0.y }, { x, y: b0.y });
  }
  const pts = [a0, ...mid, b0]
    .map(turn)
    .filter((p, i, all) => i === 0 || Math.abs(p.x - all[i - 1].x) + Math.abs(p.y - all[i - 1].y) > 0.5);
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]];
    const r = Math.min(TURN, Math.hypot(b.x - a.x, b.y - a.y) / 2, Math.hypot(c.x - b.x, c.y - b.y) / 2);
    const k1 = r / (Math.hypot(b.x - a.x, b.y - a.y) || 1);
    const k2 = r / (Math.hypot(c.x - b.x, c.y - b.y) || 1);
    d += ` L${b.x - (b.x - a.x) * k1},${b.y - (b.y - a.y) * k1} Q${b.x},${b.y} ${b.x + (c.x - b.x) * k2},${b.y + (c.y - b.y) * k2}`;
  }
  const last = pts[pts.length - 1];
  d += ` L${last.x},${last.y}`;
  return { path: d, runs: pts.slice(1).map((p, i) => [pts[i], p]) };
}

/** Below this zoom belt labels hide, so the machines stay readable. */
const FAR_ZOOM = 0.55;
const farSelector = (s: { transform: [number, number, number] }) => s.transform[2] < FAR_ZOOM;
const stillSelector = (s: { transform: [number, number, number] }) => s.transform[2] < 0.7;

/** A belt or pipe the player laid: its Mk, what it carries, and a red badge when it's full or jammed. */
export function BeltLink({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data: d, selected }: EdgeProps) {
  const { t, name, num } = useT();
  const far = useFlowStore(farSelector);
  const still = useFlowStore(stillSelector);
  const labels = useStore((s) => s.settings.beltLabels);
  const oneColor = useStore((s) => s.settings.beltColors === 'one');
  const { link, item, transport, calc, down } = d as BeltData;
  const pick = useContext(PickLink);
  const geo = { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition };
  let path: string;
  let lx: number;
  let ly: number;
  if (link.line === 'straight') [path, lx, ly] = getStraightPath(geo);
  else if (link.line === 'curve') [path, lx, ly] = getBezierPath(geo);
  else if ((down ? sourceY < targetY : sourceX < targetX) || link.pts?.length) {
    // Straight runs with square turns, through the bends the floor was laid out with; the label on its longest run.
    const square = squarePath(
      { x: sourceX, y: sourceY },
      (link.pts ?? []).map(([x, y]) => ({ x, y })),
      { x: targetX, y: targetY },
      down,
    );
    path = square.path;
    const [a, b] = square.runs.reduce((l, r) =>
      Math.hypot(r[1].x - r[0].x, r[1].y - r[0].y) > Math.hypot(l[1].x - l[0].x, l[1].y - l[0].y) ? r : l,
    );
    [lx, ly] = [(a.x + b.x) / 2, (a.y + b.y) / 2];
  } else [path, lx, ly] = getSmoothStepPath({ ...geo, borderRadius: TURN });
  if (link.lbl) [lx, ly] = link.lbl;
  const state = `${selected ? 'lit' : ''} ${still ? 'still' : ''} ${calc && calc.rate < 1e-6 ? 'stopped' : ''}`;
  const lanes = link.lanes ?? 1;
  const { body, color } = beltStroke({ path, item: item ?? 'Desc_OreIron_C', transport, lanes: Math.min(lanes, 6), state, oneColor });
  // A belt too short for its label (a machine into the splitter beside it) goes without one; the splitter says it.
  const short = !link.lbl && Math.hypot(targetX - sourceX, targetY - sourceY) < SHORT;
  const shown = item && (selected || labels === 'always' || (labels === 'auto' && !far && !short));
  const bad = calc?.status === 'jam' || calc?.status === 'unbounded';
  // Full at the Mk, not at a limit the player set lower.
  const full = calc?.status === 'capped' && !(link.lim !== undefined && link.lim < transport.rate * lanes);
  return (
    <>
      {/* A wide invisible line over the belt, so it's easy to click. */}
      <path d={path} className="belt-hit" />
      {body}
      {shown && (
        <EdgeLabelRenderer>
          <div className="edge-anchor" style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}>
            <button
              type="button"
              tabIndex={-1}
              className={`edge-label pickable manual nopan ${selected ? 'picked' : ''} ${bad ? 'bad' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                pick(link.id);
              }}
            >
              <Icon id={calc?.items[0]?.[0] ?? item} size={24} />
              <span className="edge-text">
                <span className="edge-meta">
                  {calc && (
                    <span className="edge-rate">
                      {num(calc.rate)}
                      {t('perMin')}
                    </span>
                  )}
                  <span
                    className={`edge-tier ${full ? 'full' : ''}`}
                    style={{ background: color }}
                    title={full ? t('beltFull', { mk: transport.name }) : undefined}
                  >
                    {lanes > 1 && `${lanes}× `}
                    {transport.name}
                  </span>
                </span>
                {calc?.status === 'jam' && <span className="edge-warn">{t('beltJam')}</span>}
                {calc?.status === 'unbounded' && <span className="edge-warn">{t('beltUnbounded')}</span>}
                {calc && calc.items.length > 1 && (
                  <span className="edge-mixed">{calc.items.map(([i, r]) => `${num(r)} ${name(data.items[i])}`).join(', ')}</span>
                )}
              </span>
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
