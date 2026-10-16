import { NodeResizer, type NodeProps, useStore as useFlowStore } from '@xyflow/react';
import { snap } from '../../lib/model/layout';
import { AREA_COLOR } from '../../lib/model/color';
import type { GroupNode } from '../../lib/model/types';
import { useStore } from '../../store';
import { Icon } from '../Icon';
import { EditCard } from './PartNode';
import { useContext } from 'react';

export interface AreaData extends Record<string, unknown> {
  node: GroupNode;
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
  const edit = useContext(EditCard);
  const show = labels === 'always' || (labels === 'auto' && zoom >= FAR_ZOOM);
  const scale = labels === 'always' ? READABLE / zoom : 1;
  return (
    <div className={`area-node ${picked ? 'picked' : ''}`} style={{ '--area': n.color ?? AREA_COLOR } as React.CSSProperties}>
      <NodeResizer
        isVisible={picked}
        minWidth={80}
        minHeight={80}
        color="#fff"
        onResizeEnd={(_, p) => edit(n.id, { x: snap(p.x), y: snap(p.y), w: Math.max(80, snap(p.width)), h: Math.max(80, snap(p.height)) })}
      />
      <div className="area-grip" style={{ '--s': scale } as React.CSSProperties}>
        {show && (
          <>
            {n.icon && <Icon id={n.icon} size={38} />}
            {n.label && <b className="area-name">{n.label}</b>}
            {n.note && <span className="area-note">{n.note}</span>}
          </>
        )}
      </div>
    </div>
  );
}
