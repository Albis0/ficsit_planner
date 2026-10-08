import { MINERS, PURITIES, effectiveExtraction } from '../lib/extraction';
import { useT } from '../lib/i18n';
import { minerLabel } from '../lib/text';
import { usePlan, useStore } from '../store';
import { Icon } from './Icon';
import { RateInput } from './RateInput';

/** The plan's miner, node purity and extractor clock: the same three settings wherever the panel shows them. */
export function useExtraction() {
  const plan = usePlan();
  const tier = useStore((s) => s.tier);
  const updatePlan = useStore((s) => s.updatePlan);
  const ex = effectiveExtraction(plan.extraction, tier);
  const setEx = (patch: Partial<typeof ex>) => updatePlan({ extraction: { ...ex, ...patch } });
  return { ex, setEx, tier };
}

export function ExtractionControls() {
  const { t, name } = useT();
  const showLocked = useStore((s) => s.settings.showLocked);
  const { ex, setEx, tier } = useExtraction();

  return (
    <>
      <div className="miner-picker" role="radiogroup" aria-label={t('miner')}>
        {MINERS.filter((m) => showLocked || m.tier <= tier).map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={ex.miner === m.id}
            disabled={m.tier > tier}
            title={m.tier > tier ? `${t('locked')} (T${m.tier})` : undefined}
            onClick={() => setEx({ miner: m.id })}
          >
            <Icon id={m.id} size={44} />
            <span>{minerLabel(name(m))}</span>
          </button>
        ))}
      </div>
      <div className="field">
        <span className="control-label">{t('purity')}</span>
        <div className="segmented wide" role="radiogroup" aria-label={t('purity')}>
          {PURITIES.map((p) => (
            <button key={p} type="button" role="radio" aria-checked={ex.purity === p} onClick={() => setEx({ purity: p })}>
              {t(p)}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="control-label">{t('extractorClock')}</span>
        <span className="item-card-rate">
          <RateInput
            value={Math.round(ex.clock * 10000) / 100}
            label={t('extractorClock')}
            onChange={(v) => setEx({ clock: Math.min(2.5, Math.max(0.01, v / 100)) })}
          />
          <span className="unit">%</span>
        </span>
      </div>
      {ex.nodes && (
        <label className="check-row small" title={t('capByNodesHint')}>
          <input type="checkbox" checked={!!ex.capByNodes} onChange={(e) => setEx({ capByNodes: e.target.checked || undefined })} />
          <span>{t('capByNodes')}</span>
        </label>
      )}
    </>
  );
}
