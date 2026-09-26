import { useEffect, useRef } from 'react';
import { useT } from '../lib/i18n';
import { activePowerPlan, usePlan, useStore } from '../store';
import { Glyph } from './Glyph';
import { PlanActions, ShareButton } from './PlanTabs';
import { InstallButton } from './PwaStatus';

/** Phone navigation along the bottom edge: the three side panels, then the factory floor. */
export function MobileNav() {
  const { t } = useT();
  const plan = usePlan();
  const tab = useStore((s) => s.tab);
  const pane = useStore((s) => s.pane);
  const set = useStore((s) => s.set);
  const power = useStore((s) => s.mode === 'power');
  const plants = useStore((s) => activePowerPlan(s).plants.length);
  const mode = useStore((s) => s.mode);

  // The Codex and the map have just two panes: the index (or the filter) and the page (or the map).
  if (mode === 'codex' || mode === 'map')
    return (
      <nav className="mobile-nav" aria-label={t('menu')}>
        <button type="button" aria-current={pane === 'side' ? 'page' : undefined} onClick={() => set({ pane: 'side' })}>
          {mode === 'map' ? t('mapFilterTab') : t('codexIndex')}
        </button>
        <button
          type="button"
          className="factory"
          aria-current={pane === 'floor' ? 'page' : undefined}
          onClick={() => set({ pane: 'floor' })}
        >
          {mode === 'map' ? t('mapTab') : t('codexPageTab')}
        </button>
      </nav>
    );

  const items = [
    ['targets', power ? t('powerTab') : t('targets'), power ? plants : plan.targets.length],
    ['recipes', t('recipes'), null],
    ['resources', t('resources'), null],
  ] as const;

  return (
    <nav className="mobile-nav" aria-label={t('menu')}>
      {items.map(([id, label, badge]) => (
        <button
          key={id}
          type="button"
          aria-current={pane === 'side' && tab === id ? 'page' : undefined}
          onClick={() => set({ tab: id, pane: 'side' })}
        >
          {label}
          {badge ? <span className="tab-badge">{badge}</span> : null}
        </button>
      ))}
      <button type="button" className="factory" aria-current={pane === 'floor' ? 'page' : undefined} onClick={() => set({ pane: 'floor' })}>
        {t('graph')}
      </button>
    </nav>
  );
}

/** Phone sheet holding what the desktop top bar shows inline: tier, install, factory actions, settings, feedback. */
export function MobileMenu({ onClose, onTier }: { onClose: () => void; onTier: () => void }) {
  const { t } = useT();
  const tier = useStore((s) => s.tier);
  const set = useStore((s) => s.set);
  const power = useStore((s) => s.mode === 'power');
  // The Codex and the map have no tab of their own to share, rename or delete.
  const codex = useStore((s) => s.mode === 'codex' || s.mode === 'map');
  const dialog = useRef<HTMLDialogElement>(null);
  const open = (d: 'settings' | 'report') => {
    onClose();
    set({ dialog: d });
  };

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  // A tap on the backdrop lands on the dialog element itself; Escape is handled by onCancel.
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users close the sheet with Escape or the Close button.
    <dialog
      ref={dialog}
      className="sheet"
      aria-label={t('menu')}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === dialog.current && onClose()}
    >
      <div className="sheet-body">
        <div className="sheet-row">
          <span className="control-label">{t('unlockedTier')}</span>
          <button
            type="button"
            className="tier-button"
            onClick={() => {
              onClose();
              onTier();
            }}
          >
            {t('tier')} <b>{tier}</b>
          </button>
        </div>
        {!codex && (
          <div className="sheet-group">
            <span className="control-label">{power ? t('plantName') : t('planName')}</span>
            <ShareButton className="ghost-button" onDone={onClose} />
            <div className="sheet-actions">
              <PlanActions onDone={onClose} />
            </div>
          </div>
        )}
        <div className="sheet-row sheet-links">
          <button type="button" className="ghost-button" onClick={() => open('settings')}>
            <Glyph name="gear" size={18} />
            {t('settings')}
          </button>
          <button type="button" className="ghost-button" onClick={() => open('report')}>
            <Glyph name="flag" size={18} />
            {t('feedback')}
          </button>
        </div>
        <InstallButton className="primary-button" />
        <button type="button" className="text-button sheet-close" onClick={onClose}>
          {t('close')}
        </button>
      </div>
    </dialog>
  );
}
