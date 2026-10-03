import { useEffect, useRef } from 'react';
import { useT } from '../../lib/i18n';

export interface CardMenuItem {
  label: string;
  /** Its keyboard shortcut, shown on the right. */
  keys?: string;
  danger?: boolean;
  onPick: () => void;
}

/** What a right click on a card offers, beside the pointer (kept inside the floor by the caller): a short list in the build menu's look. */
export function CardMenu({ at, items, onClose }: { at: { x: number; y: number }; items: CardMenuItem[]; onClose: () => void }) {
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
    <div ref={root} className="card-menu" role="menu" aria-label={t('cardMenu')} style={{ left: at.x, top: at.y }}>
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          className={it.danger ? 'danger' : undefined}
          onClick={() => {
            onClose();
            it.onPick();
          }}
        >
          <span>{it.label}</span>
          {it.keys && <kbd>{it.keys}</kbd>}
        </button>
      ))}
    </div>
  );
}
