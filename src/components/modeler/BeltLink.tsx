import {
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  useReactFlow,
  useStore as useFlowStore,
} from '@xyflow/react';
import { createContext, type PointerEvent as ReactPointer, useContext, useState } from 'react';
import { data } from '../../lib/data';
import { useT } from '../../lib/i18n';
import type { LinkCalc } from '../../lib/model/calc/result';
import type { Transport } from '../../lib/data';
import { snapHalf } from '../../lib/model/layout';
import type { MLink } from '../../lib/model/types';
import { useStore } from '../../store';
import { beltStroke } from '../floor/BeltStroke';
import { PORT_CELL } from './PartNode';
import { longestRunMid, SQUARE_TURN as TURN, squarePath } from '../floor/squarePath';
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

/** Sets the stop points of a belt the player routes by hand. */
export const LayStops = createContext<(id: string, pts: [number, number][]) => void>(() => {});

type Stops = [number, number][];

/** Belts shorter than their label, in floor units, show none unless picked; a laid-out floor keeps room for it. */
const SHORT = 180;

/** Below this zoom belt labels hide, so the machines stay readable. */
const FAR_ZOOM = 0.55;
const farSelector = (s: { transform: [number, number, number] }) => s.transform[2] < FAR_ZOOM;
const stillSelector = (s: { transform: [number, number, number] }) => s.transform[2] < 0.7;

/** A belt or pipe the player laid: its Mk, what it carries, and a red badge when it's full or jammed. */
export function BeltLink({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data: d, selected }: EdgeProps) {
  const { t, name, num } = useT();
  const far = useFlowStore(farSelector);
  const still = useFlowStore(stillSelector);
  // The dots keep a size a finger or a pointer can hit when the floor is zoomed out.
  const zoom = useFlowStore((s) => s.transform[2]);
  const labels = useStore((s) => s.settings.beltLabels);
  const oneColor = useStore((s) => s.settings.beltColors === 'one');
  const { link, item, transport, calc, down } = d as BeltData;
  const pick = useContext(PickLink);
  const lay = useContext(LayStops);
  const flow = useReactFlow();
  // While a stop is dragged the belt follows the pointer; the model is written once it's let go.
  const [live, setLive] = useState<Stops>();
  const stops = live ?? link.pts ?? [];
  const own = !!link.own;
  const geo = { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition };
  let path: string;
  let lx: number;
  let ly: number;
  if (!own && link.line === 'straight') [path, lx, ly] = getStraightPath(geo);
  else if (!own && link.line === 'curve') [path, lx, ly] = getBezierPath(geo);
  else if ((down ? sourceY < targetY : sourceX < targetX) || stops.length) {
    // Straight runs with square turns, through the bends the floor was laid out with; the label on its longest run.
    const square = squarePath(
      { x: sourceX, y: sourceY },
      stops.map(([x, y]) => ({ x, y })),
      { x: targetX, y: targetY },
      down,
      own,
    );
    path = square.path;
    [lx, ly] = longestRunMid(square.runs);
  } else [path, lx, ly] = getSmoothStepPath({ ...geo, borderRadius: TURN });
  if (link.lbl) [lx, ly] = link.lbl;
  const state = `${selected ? 'lit' : ''} ${still ? 'still' : ''} ${calc && calc.rate < 1e-6 ? 'stopped' : ''}`;
  const lanes = link.lanes ?? 1;
  const { body, color, ink } = beltStroke({
    path,
    item: item ?? 'Desc_OreIron_C',
    transport,
    lanes: Math.min(lanes, 6),
    state,
    oneColor,
    wide: { from: true, to: true },
    pitch: PORT_CELL,
  });
  // A belt too short for its label (a machine into the splitter beside it) goes without one; the splitter says it.
  const short = !link.lbl && Math.hypot(targetX - sourceX, targetY - sourceY) < SHORT;
  const shown = item && !(own && selected) && (selected || labels === 'always' || (labels === 'auto' && !far && !short));
  // Dragging a stop (or a "+" between two, which first becomes one) moves it with the pointer, snapped to the floor's half squares.
  const grab = (e: ReactPointer, base: Stops, i: number) => {
    e.stopPropagation();
    e.preventDefault();
    let cur = base;
    const move = (ev: PointerEvent) => {
      const p = flow.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      cur = base.map((q, j) => (j === i ? [snapHalf(p.x), snapHalf(p.y)] : q));
      setLive(cur);
    };
    const drop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', drop);
      window.removeEventListener('pointercancel', drop);
      setLive(undefined);
      lay(link.id, cur);
      // Let go over bare floor, the click that follows would take the belt off the selection and its dots with it.
      const swallow = (ev: Event) => ev.stopPropagation();
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 100);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', drop);
    window.addEventListener('pointercancel', drop);
  };
  const ends: [number, number][] = [[sourceX, sourceY], ...stops, [targetX, targetY]];
  const bad = calc?.status === 'jam' || calc?.status === 'unbounded';
  // Full at the Mk, not at a limit the player set lower.
  const full = calc?.status === 'capped' && !(link.lim !== undefined && link.lim < transport.rate * lanes);
  return (
    <>
      {/* A wide invisible line over the belt, so it's easy to click. */}
      <path d={path} className="belt-hit" />
      {body}
      {own && selected && (
        <g className="stops nopan">
          {ends.slice(1).map(([x, y], i) => {
            const [px, py] = ends[i];
            // The "+" sits where the run between two stops turns, so a stop added there leaves the belt as it is.
            const flip = ([a, b]: [number, number]): [number, number] => (down ? [b, a] : [a, b]);
            const [fx, fy] = flip([x, y]);
            const [fpx, fpy] = flip([px, py]);
            const turns = Math.abs(fx - fpx) > 0.5 && Math.abs(fy - fpy) > 0.5;
            const mid = flip(turns ? (i === ends.length - 2 ? [fpx, fy] : [fx, fpy]) : [(fpx + fx) / 2, (fpy + fy) / 2]);
            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: a drag handle, pointer only
              <circle
                // biome-ignore lint/suspicious/noArrayIndexKey: the stops have no ids; a drag keeps the index
                key={`add${i}`}
                className="stop-add"
                cx={mid[0]}
                cy={mid[1]}
                r={Math.min(14, 5 / zoom)}
                aria-label={t('routeAdd')}
                onPointerDown={(e) => grab(e, [...stops.slice(0, i), mid, ...stops.slice(i)], i)}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
              />
            );
          })}
          {stops.map(([x, y], i) => (
            // biome-ignore lint/a11y/noStaticElementInteractions: a drag handle, pointer only
            <circle
              // biome-ignore lint/suspicious/noArrayIndexKey: the stops have no ids; a drag keeps the index
              key={`stop${i}`}
              className="stop"
              cx={x}
              cy={y}
              r={Math.min(22, 8 / zoom)}
              aria-label={t('routeStop')}
              onPointerDown={(e) => grab(e, stops, i)}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => {
                e.stopPropagation();
                lay(
                  link.id,
                  stops.filter((_, j) => j !== i),
                );
              }}
            />
          ))}
        </g>
      )}
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
                    style={{ background: color, ...(ink ? { color: ink } : {}) }}
                    title={full ? t('beltFull', { mk: transport.name }) : undefined}
                  >
                    {lanes > 1 && `${lanes} × `}
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
