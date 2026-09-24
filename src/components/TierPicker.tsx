import { useEffect, useRef } from 'react';
import { data } from '../lib/data';
import { useT } from '../lib/i18n';
import { useStore } from '../store';
import meta from '../data/meta.json';
import { Icon } from './Icon';

/** Space Elevator phases and the milestone tiers finishing each one unlocks (from the wiki). */
const GROUPS: { phase: number; tiers: number[] }[] = [
  { phase: 0, tiers: [0, 1, 2] },
  { phase: 1, tiers: [3, 4] },
  { phase: 2, tiers: [5, 6] },
  { phase: 3, tiers: [7, 8] },
  { phase: 4, tiers: [9] },
];

/** Buildings that open up at exactly this tier, so the choice is recognisable from the game. */
const unlocksAt = (tier: number) => [
  ...Object.values(data.machines).filter((m) => m.tier === tier).map((m) => m.id),
  ...data.extractors.filter((e) => e.tier === tier).map((e) => e.id),
  ...data.belts.filter((b) => b.tier === tier).map((b) => b.id),
  ...data.pipes.filter((p) => p.tier === tier).map((p) => p.id),
];

/** "Where are you in the game?" — asked once on first launch, reopened from the top bar. */
export function TierDialog({ onClose }: { onClose: () => void }) {
  const { t, name } = useT();
  const tier = useStore((s) => s.tier);
  const set = useStore((s) => s.set);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const pick = (step: number) => {
    set({ tier: step, onboarded: true });
    onClose();
  };

  const label = (id: string) =>
    name(data.machines[id] ?? data.extractors.find((e) => e.id === id)) !== '?'
      ? name(data.machines[id] ?? data.extractors.find((e) => e.id === id))
      : [...data.belts, ...data.pipes].find((x) => x.id === id)?.name ?? '';

  return (
    <dialog
      ref={dialog}
      className="tier-dialog"
      onCancel={(e) => {
        e.preventDefault();
        set({ onboarded: true });
        onClose();
      }}
    >
      <h2 className="quick-title">{t('whereAreYou')}</h2>
      <p className="hint">{t('whereHint')}</p>
      <div className="phase-list">
        {GROUPS.map((g) => (
          <section key={g.phase} className="phase">
            <h3 className="section-title">{g.phase === 0 ? t('phaseStart') : `${t('phase')} ${g.phase} ✓`}</h3>
            <div className="phase-tiers">
              {g.tiers.map((step) => (
                <button key={step} type="button" className={`tier-card ${tier === step ? 'current' : ''}`} onClick={() => pick(step)}>
                  <span className="tier-card-num">
                    {t('tier')} {step}
                  </span>
                  <span className="tier-card-unlocks">
                    {unlocksAt(step).map((id) => (
                      <span key={id} title={label(id)}>
                        <Icon id={id} size={34} />
                      </span>
                    ))}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      <p className="hint data-version">
        {t('dataFrom')} Satisfactory {meta.gameVersion} (build {meta.changelist}), {meta.extractedAt}
      </p>
    </dialog>
  );
}
