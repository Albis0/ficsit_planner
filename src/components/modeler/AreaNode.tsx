import { type Node, NodeResizer, type NodeProps, useStore as useFlowStore } from '@xyflow/react';
import { snapHalf } from '../../lib/model/layout';
import { useT } from '../../lib/i18n';
import { AREA_COLOR } from '../../lib/model/color';
import type { GroupNode, MNode } from '../../lib/model/types';
import { useStore } from '../../store';
import { Icon } from '../Icon';
import { EditCard } from './PartNode';
import { useContext } from 'react';

export interface AreaData extends Record<string, unknown> {
  node: GroupNode;
}

/** An area the Auto floor made for itself: it cannot be picked, moved or changed. */
export const isAuto = (id: string) => id.startsWith('auto:');

/** The flow nodes for a model's areas: behind everything, and picked from the panel rather than by a box drawn over the floor. */
export function areaNodes(nodes: MNode[], inspect: string | undefined, was?: Node[]): Node[] {
  const before = new Map(was?.map((n) => [n.id, n]));
  return nodes
    .filter((n): n is GroupNode => n.k === 'group')
    .map((n) => ({
      ...before.get(n.id),
      id: n.id,
      type: 'area',
      position: { x: n.x, y: n.y },
      width: n.w,
      height: n.h,
      zIndex: -1,
      dragHandle: '.area-grip, .area-edge',
      draggable: !isAuto(n.id),
      selectable: false,
      data: { node: n } satisfies AreaData,
      selected: inspect === n.id,
      className: isAuto(n.id) ? 'auto-area' : undefined,
    }));
}

/** Below this zoom an area's name hides when the setting says Auto, as belt labels do. */
const FAR_ZOOM = 0.4;
/** The name's size on screen when it's kept readable at any zoom (the Always setting). */
const READABLE = 0.55;
const zoomOf = (s: { transform: [number, number, number] }) => s.transform[2];

/**
 * A coloured area behind the cards. Only its title strip and its edge take the pointer, so the floor inside it pans,
 * takes right-click menus and passes clicks to the cards as before.
 */
export function AreaNode({ data }: NodeProps) {
  const n = (data as AreaData).node;
  const labels = useStore((s) => s.settings.areaLabels);
  const picked = useStore((s) => s.inspect === n.id);
  const zoom = useFlowStore(zoomOf);
  const { t } = useT();
  const edit = useContext(EditCard);
  const show = labels === 'always' || (labels === 'auto' && zoom >= FAR_ZOOM);
  const scale = labels === 'always' ? READABLE / zoom : 1;
  return (
    <div
      className={`area-node ${picked ? 'picked' : ''}`}
      style={{ '--area': n.color ?? AREA_COLOR, '--edge': `${Math.max(14, 10 / zoom)}px` } as React.CSSProperties}
    >
      {/* The edge takes the pointer too, so an area with no name is still there to be picked; the resize handles lie over it. */}
      {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
        <i key={side} className={`area-edge ${side}`} />
      ))}
      <NodeResizer
        isVisible={picked}
        minWidth={80}
        minHeight={80}
        color="#fff"
        onResizeEnd={(_, p) =>
          edit(n.id, { x: snapHalf(p.x), y: snapHalf(p.y), w: Math.max(80, snapHalf(p.width)), h: Math.max(80, snapHalf(p.height)) })
        }
      />
      <div className="area-grip" style={{ '--s': scale } as React.CSSProperties}>
        {show && (
          <>
            {n.icon && <Icon id={n.icon} size={38} />}
            {n.label && <b className="area-name">{n.label}</b>}
            {n.note && <span className="area-note">{n.note}</span>}
            {!n.icon && !n.label && !n.note && <b className="area-name empty">{t('area')}</b>}
          </>
        )}
      </div>
    </div>
  );
}
