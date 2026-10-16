import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../lib/i18n';
import { useStore } from '../store';
import { CardMenu, type CardMenuItem } from './modeler/CardMenu';

type View = 'graph' | 'table' | 'transport';

/** The floor, the list or the transport view: one button that says which one is showing and opens the other two. */
export function ViewMenu({ powerMode }: { powerMode: boolean }) {
  const { t } = useT();
  const view = useStore((s) => s.view);
  const set = useStore((s) => s.set);
  const [at, setAt] = useState<{ x: number; y: number }>();
  // The power planner has no transport view; its view of that name is the floor.
  const now: View = powerMode && view === 'transport' ? 'graph' : view;
  const labels: Record<View, string> = { graph: t('graph'), table: t('table'), transport: t('transportView') };
  const items: CardMenuItem[] = (['graph', 'table', ...(powerMode ? [] : ['transport'])] as View[]).map((v) => ({
    label: labels[v],
    keys: v === now ? '✓' : undefined,
    onPick: () => set({ view: v }),
  }));
  return (
    <div className="segmented view-menu">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={!!at}
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          // The bar sits along the bottom, so the list opens above it.
          const room = items.length * 40 + 12;
          setAt({ x: Math.max(8, Math.min(box.left, window.innerWidth - 240)), y: Math.max(8, box.top - 4 - room) });
        }}
      >
        {labels[now]} <span aria-hidden>▾</span>
      </button>
      {at && createPortal(<CardMenu at={at} items={items} onClose={() => setAt(undefined)} fixed />, document.body)}
    </div>
  );
}
