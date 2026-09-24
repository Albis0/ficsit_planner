import { useEffect, useRef } from 'react';
import { useT } from '../lib/i18n';
import { usePlan, useStore } from '../store';
import { ObjectiveSwitch } from './ObjectiveSwitch';
import { PlanActions } from './PlanTabs';
import { InstallButton } from './PwaStatus';

/** Phone navigation along the bottom edge: the three side panels, then the factory floor. */
export function MobileNav() {
  const { t } = useT();
  const plan = usePlan();
  const tab = useStore((s) => s.tab);
  const pane = useStore((s) => s.pane);
  const set = useStore((s) => s.set);

  const items = [
    ['targets', t('targets'), plan.targets.length],
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

/** Phone sheet holding what the desktop top bar shows inline: tier, objective, install, factory actions. */
export function MobileMenu({ onClose, onTier }: { onClose: () => void; onTier: () => void }) {
  const { t } = useT();
  const tier = useStore((s) => s.tier);
  const dialog = useRef<HTMLDialogElement>(null);

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
        <div className="sheet-row column">
          <span className="control-label">{t('objective')}</span>
          <ObjectiveSwitch wide />
        </div>
        <div className="sheet-row">
          <span className="control-label">{t('planName')}</span>
          <PlanActions rename onDone={onClose} />
        </div>
        <InstallButton className="primary-button" />
        <button type="button" className="text-button sheet-close" onClick={onClose}>
          {t('close')}
        </button>
      </div>
    </dialog>
  );
}
