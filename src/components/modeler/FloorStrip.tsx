import type { ReactNode } from 'react';
import { Slot } from '../Slot';

/** A strip low over the floor, clear of the toolbar and the buttons along the bottom: what's going on, and what to do. */
export function FloorStrip({ item, children, actions }: { item?: string; children: ReactNode; actions: ReactNode }) {
  return (
    <div className="floor-strip" role="status">
      {item && <Slot id={item} size={32} />}
      <span className="floor-strip-text">{children}</span>
      <span className="floor-strip-actions">{actions}</span>
    </div>
  );
}
