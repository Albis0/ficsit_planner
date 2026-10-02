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
import { routePath } from '../GraphView';
import { Icon } from '../Icon';

export interface BeltData extends Record<string, unknown> {
  link: MLink;
  /** What it can carry: the first item it may hold, for the drawing. */
  item?: string;
  transport: Transport;
  calc?: LinkCalc;
}

/** Opens a belt in the panel, from its label. */
export const PickLink = createContext<(id: string) => void>(() => {});

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
  const labels = useStore((s) => s.settings.beltLabels);
  const oneColor = useStore((s) => s.settings.beltColors === 'one');
  const { link, item, transport, calc } = d as BeltData;
  const pick = useContext(PickLink);
  const geo = { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition };
  let [path, lx, ly] =
    link.line === 'straight'
      ? getStraightPath(geo)
      : link.line === 'step'
        ? getSmoothStepPath({ ...geo, borderRadius: 16 })
        : getBezierPath(geo);
  if (link.pts?.length) {
    // Through its bends, like the Auto floor's belts, with the label on the middle one.
    const pts = link.pts.map(([x, y]) => ({ x, y }));
    path = routePath([{ x: sourceX, y: sourceY }, ...pts, { x: targetX, y: targetY }], 'LR');
    ({ x: lx, y: ly } = pts[Math.floor(pts.length / 2)]);
  }
  const state = `${selected ? 'lit' : ''} ${still ? 'still' : ''} ${calc && calc.rate < 1e-6 ? 'stopped' : ''}`;
  const lanes = link.lanes ?? 1;
  const { body, color } = beltStroke({ path, item: item ?? 'Desc_OreIron_C', transport, lanes: Math.min(lanes, 6), state, oneColor });
  // A belt too short for its label (a machine into the splitter beside it) goes without one; the splitter says it.
  const short = Math.hypot(targetX - sourceX, targetY - sourceY) < SHORT;
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
