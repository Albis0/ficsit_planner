import { useEffect, useRef } from 'react';
import { data, recipeById } from '../lib/data';
import { useT } from '../lib/i18n';
import { type Milestone, MILESTONES, offAt } from '../lib/unlocks';
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
  ...Object.values(data.machines)
    .filter((m) => m.tier === tier)
    .map((m) => m.id),
  ...data.extractors.filter((e) => e.tier === tier).map((e) => e.id),
  ...data.belts.filter((b) => b.tier === tier).map((b) => b.id),
  ...data.pipes.filter((p) => p.tier === tier).map((p) => p.id),
];

/** What a milestone shows as: the first building it opens, else the first thing its recipes make. */
const chipIcon = (m: Milestone) => {
  const building = m.unlocks.find((id) => id.startsWith('Build_') || id.startsWith('Desc_'));
  return building ?? recipeById.get(m.unlocks[0])?.outputs[0]?.item ?? m.unlocks[0];
};

/** The tier window: asked once on first launch, reopened from the top bar. */
export function TierDialog({ onClose }: { onClose: () => void }) {
  const { t, name } = useT();
  const tier = useStore((s) => s.tier);
  const set = useStore((s) => s.set);
  const skipped = useStore((s) => s.skipped);
  const markSkipped = useStore((s) => s.markSkipped);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
    // Open on the tier you're at, not on the first card.
    dialog.current?.querySelector<HTMLButtonElement>('.tier-card.current')?.focus();
  }, []);

  // Picking a tier leaves the window open: the milestones under it are the next thing to set.
  const pick = (step: number) => set({ tier: step });
  const close = () => {
    set({ onboarded: true });
    onClose();
  };
  const off = new Set(skipped);
  const here = MILESTONES.filter((m) => m.tier === tier);
  const earlier = [...new Set(MILESTONES.filter((m) => m.tier < tier).map((m) => m.tier))];
  const earlierOff = offAt(tier - 1, skipped);

  const chip = (m: Milestone) => {
    const skippedIt = off.has(m.id);
    return (
      <button
        key={m.id}
        type="button"
        className={`milestone-chip ${skippedIt ? 'off' : ''}`}
        aria-pressed={!skippedIt}
        title={skippedIt ? t('boughtHint') : t('notBoughtHint')}
        onClick={() => markSkipped([m.id], !skippedIt)}
      >
        <span className="milestone-icon">
          <Icon id={chipIcon(m)} size={26} />
        </span>
        {m.name}
      </button>
    );
  };

  const label = (id: string) =>
    name(data.machines[id] ?? data.extractors.find((e) => e.id === id)) !== '?'
      ? name(data.machines[id] ?? data.extractors.find((e) => e.id === id))
      : ([...data.belts, ...data.pipes].find((x) => x.id === id)?.name ?? '');

  return (
    <dialog
      ref={dialog}
      className="tier-dialog"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <h2 className="quick-title">{t('unlockedTier')}</h2>
      <div className="phase-list">
        {GROUPS.map((g) => (
          <section key={g.phase} className="phase">
            <h3 className="section-title">{g.phase === 0 ? t('phaseStart') : `${t('phase')} ${g.phase}`}</h3>
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
      {here.length > 0 && (
        <section className="milestones">
          <h3 className="section-title">{t('milestonesAt', { tier })}</h3>
          <div className="milestone-row">
            <span className="milestone-tier">
              {t('tier')} {tier}
            </span>
            {here.map(chip)}
          </div>
        </section>
      )}
      {earlier.length > 0 && (
        <details className="earlier-tiers">
          <summary>
            {t('earlierTiers', { n: earlier.length })}
            {earlierOff > 0 && <b> · {t('tierOff', { n: earlierOff })}</b>}
          </summary>
          {earlier.map((step) => (
            <div key={step} className="milestone-row">
              <span className="milestone-tier">
                {t('tier')} {step}
              </span>
              {MILESTONES.filter((m) => m.tier === step).map(chip)}
            </div>
          ))}
        </details>
      )}
      <div className="tier-foot">
        <span>{offAt(tier, skipped) > 0 && t('notBought', { n: offAt(tier, skipped) })}</span>
        <button type="button" className="primary-button" onClick={close}>
          {t('done')}
        </button>
      </div>
      <p className="hint data-version">
        {t('dataFrom')} Satisfactory {meta.gameVersion} (build {meta.changelist}), {meta.extractedAt}
      </p>
    </dialog>
  );
}
