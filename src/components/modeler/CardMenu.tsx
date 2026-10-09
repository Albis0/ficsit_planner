import { useEffect, useRef } from 'react';
import { useT } from '../../lib/i18n';

export interface CardMenuItem {
  label: string;
  /** Its keyboard shortcut, shown on the right. */
  keys?: string;
  danger?: boolean;
  /** A line under the label that says what picking it does. */
  note?: string;
  /** Marks a pick that sends something to the AWESOME Sink. */
  sink?: boolean;
  onPick: () => void;
}

/** What a right click on a card offers, beside the pointer (kept inside the floor by the caller): a short list in the build menu's look. */
export function CardMenu({
  at,
  items,
  onClose,
  fixed,
}: {
  at: { x: number; y: number };
  items: CardMenuItem[];
  onClose: () => void;
  /** Placed on the screen rather than in the floor, for a menu opened from a card in the flow. */
  fixed?: boolean;
}) {
  const { t } = useT();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    root.current?.querySelector('button')?.focus();
    const away = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('wheel', onClose, { passive: true });
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('wheel', onClose);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);
  return (
    <div
      ref={root}
      className="card-menu"
      role="menu"
      aria-label={t('cardMenu')}
      style={{ left: at.x, top: at.y, ...(fixed ? { position: 'fixed', zIndex: 60 } : {}) }}
    >
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          className={it.danger ? 'danger' : it.sink ? 'sink' : undefined}
          onClick={() => {
            onClose();
            it.onPick();
          }}
        >
          <span>
            {it.label}
            {it.note && <small className="menu-note">{it.note}</small>}
          </span>
          {it.keys && <kbd>{it.keys}</kbd>}
        </button>
      ))}
    </div>
  );
}
