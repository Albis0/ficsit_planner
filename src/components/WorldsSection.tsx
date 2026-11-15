import { useRef, useState } from 'react';
import { useT } from '../lib/i18n';
import { MAX_WORLDS, useStore } from '../store';
import { Glyph } from './Glyph';

/**
 * Settings › Worlds: every world with the open one marked, a button to open another, rename, delete (asked first),
 * and New world. A world's tabs, power plants, progress and game multipliers stay its own.
 * `onSwitched` runs after the open world changed, so the settings draft takes the new world's multipliers.
 */
export function WorldsSection({ onSwitched }: { onSwitched: () => void }) {
  const { t } = useT();
  const world = useStore((s) => s.world);
  const worlds = useStore((s) => s.worlds);
  const [editing, setEditing] = useState<string>();
  const [asking, setAsking] = useState<string>();
  const list = useRef<HTMLUListElement>(null);
  const store = useStore.getState;
  // The button that was pressed goes away or changes; keyboard focus goes back to a button of the same row.
  const refocus = (id: string, cls: string) =>
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-world="${id}"] .${cls}`)?.focus());
  const all = [world, ...worlds];
  return (
    <>
      <ul className="world-list" ref={list} aria-label={t('worlds')}>
        {all.map((w) => {
          const open = w.id === world.id;
          return (
            <li key={w.id} className="setting world-item" data-world={w.id} data-open={open ? '' : undefined}>
              {w.id === editing ? (
                <input
                  className="world-input"
                  defaultValue={w.name}
                  aria-label={t('rename')}
                  maxLength={40}
                  // biome-ignore lint/a11y/noAutofocus: the field opens because the player pressed Rename
                  autoFocus
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={(e) => {
                    store().renameWorld(w.id, e.target.value);
                    setEditing(undefined);
                    refocus(w.id, 'world-rename');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    // Escape ends the rename, not the settings.
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      setEditing(undefined);
                      refocus(w.id, 'world-rename');
                    }
                  }}
                />
              ) : (
                <div className="setting-text">
                  <span className="setting-label world-name">{w.name}</span>
                  {open && <span className="world-badge">{t('worldOpenNow')}</span>}
                </div>
              )}
              {w.id === asking ? (
                <div className="world-ask" role="alert">
                  <span>{t('worldDeleteAsk', { name: w.name })}</span>
                  <span className="setting-control">
                    <button
                      type="button"
                      className="ghost-button danger"
                      onClick={() => {
                        store().removeWorld(w.id);
                        setAsking(undefined);
                        if (open) onSwitched();
                      }}
                    >
                      <Glyph name="trash" size={18} />
                      {t('worldDelete')}
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      // biome-ignore lint/a11y/noAutofocus: asked to confirm; the safe answer is the one in reach
                      autoFocus
                      onClick={() => {
                        setAsking(undefined);
                        refocus(w.id, 'world-delete');
                      }}
                    >
                      {t('cancel')}
                    </button>
                  </span>
                </div>
              ) : (
                <div className="setting-control">
                  {!open && (
                    <button
                      type="button"
                      className="ghost-button world-open"
                      aria-label={`${t('worldOpen')}: ${w.name}`}
                      onClick={() => {
                        store().openWorld(w.id);
                        onSwitched();
                      }}
                    >
                      {t('worldOpen')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="world-act world-rename"
                    title={t('rename')}
                    aria-label={`${t('rename')}: ${w.name}`}
                    onClick={() => setEditing(w.id)}
                  >
                    <Glyph name="rename" size={18} />
                  </button>
                  {worlds.length > 0 && (
                    <button
                      type="button"
                      className="world-act world-delete"
                      title={t('worldDelete')}
                      aria-label={`${t('worldDelete')}: ${w.name}`}
                      onClick={() => setAsking(w.id)}
                    >
                      <Glyph name="trash" size={18} />
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="setting-foot">
        <button
          type="button"
          className="ghost-button"
          disabled={all.length >= MAX_WORLDS}
          // One window at a time: the New world window replaces the settings.
          onClick={() => store().set({ dialog: 'newWorld' })}
        >
          <Glyph name="plus" size={18} />
          {t('worldNew')}
        </button>
      </div>
    </>
  );
}
