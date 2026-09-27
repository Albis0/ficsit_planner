import { useMemo, useState } from 'react';
import { data, rawItems } from '../lib/data';
import { effectiveExtraction, MINERS, PURITIES, planExtraction } from '../lib/extraction';
import { useT } from '../lib/i18n';
import { minerLabel } from '../lib/text';
import { plantRecipe, plantValid } from '../lib/power';
import { reachableRaw, useExports, usableRecipes } from '../lib/solution';
import type { SolveResult } from '../lib/solver';
import { activePowerPlan, usePlan, useStore } from '../store';
import { Icon } from './Icon';
import { RateInput } from './RateInput';
import { Slot } from './Slot';

const sorted = [...rawItems].sort((a, b) => (data.worldLimits[b.id] ?? Infinity) - (data.worldLimits[a.id] ?? Infinity));

export function ResourcesPanel({ result }: { result?: SolveResult }) {
  const { t, name, num } = useT();
  const plan = usePlan();
  const setCap = useStore((s) => s.setCap);
  const updatePlan = useStore((s) => s.updatePlan);
  const tier = useStore((s) => s.tier);
  const ex = effectiveExtraction(plan.extraction, tier);
  const setEx = (patch: Partial<typeof ex>) => updatePlan({ extraction: { ...ex, ...patch } });

  const uses = useMemo(() => new Map(planExtraction(result?.raw ?? [], ex).map((u) => [u.item, u])), [result, ex]);
  const usesWell = [...uses.values()].some((u) => u.extractor.id === 'Build_FrackingExtractor_C');

  // Only the resources this plan can use: what its products (or its generators' fuel) are made from.
  const power = useStore((s) => (s.mode === 'power' ? activePowerPlan(s) : undefined));
  const active = useStore((s) => s.active);
  const exports = useExports(active);
  const [showAll, setShowAll] = useState(false);
  const relevant = useMemo(() => {
    const goals = power
      ? power.plants.filter(plantValid).flatMap((p) => plantRecipe(p).inputs.map((i) => i.item))
      : [...plan.targets, ...exports].map((x) => x.item);
    return reachableRaw(goals, usableRecipes(plan, tier));
  }, [power, plan, exports, tier]);
  const counts = (id: string) => relevant.has(id) || uses.has(id) || plan.caps[id] != null;
  const shown = sorted.filter((i) => counts(i.id));
  const hidden = sorted.length - shown.length;

  return (
    <div className="panel-body resources">
      <section className="stack extraction">
        <h3 className="section-title">{t('extraction')}</h3>
        <div className="miner-picker" role="radiogroup" aria-label={t('miner')}>
          {MINERS.map((m) => (
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
      </section>

      <section className="stack resource-list">
        <h3 className="section-title">{t('resources')}</h3>
        <p className="hint">{t('resourceHint')}</p>
        <div className="resource-cards">
          {(showAll ? sorted : shown).map((item) => {
            const world = data.worldLimits[item.id];
            const cap = plan.caps[item.id] ?? world;
            const use = uses.get(item.id);
            const share = cap && use ? Math.min(use.rate / cap, 1) : 0;
            return (
              <div key={item.id} className={`resource-card ${use ? 'used' : ''}`}>
                <div className="item-card flat">
                  <Slot id={item.id} rate={use?.rate} size={52} />
                  <span className="item-card-name">{name(item)}</span>
                  <span className="item-card-rate">
                    <RateInput
                      value={plan.caps[item.id] ?? Number.NaN}
                      label={`${t('limit')}: ${name(item)}`}
                      placeholder={world == null ? t('unlimited') : num(world)}
                      onChange={(v) => setCap(item.id, v)}
                      onClear={() => setCap(item.id, undefined)}
                    />
                    <span className="unit">{t('perMin')}</span>
                  </span>
                </div>
                {use && (
                  <>
                    <div className="meter" aria-hidden>
                      <span style={{ width: `${share * 100}%` }} className={share > 0.999 ? 'full' : undefined} />
                    </div>
                    <div className="extract-row">
                      <Icon id={use.extractor.id} size={28} />
                      <span className="extract-name">{name(use.extractor)}</span>
                      {use.extractor.purity ? (
                        PURITIES.map((p) => (
                          <span key={p} className={`extract-count ${p === ex.purity ? 'chosen' : ''}`} title={t(p)}>
                            <b>{use.counts[p]}</b>
                            <small>{t(p)}</small>
                          </span>
                        ))
                      ) : (
                        <span className="extract-count chosen">
                          <b>{use.built}</b>
                        </span>
                      )}
                      {use.shards > 0 && (
                        <span className="mod-badge shard" title={`${Math.round(use.clock * 1000) / 10}%`}>
                          {use.shards} ◆
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
        {hidden > 0 && (
          <button type="button" className="text-button more-resources" onClick={() => setShowAll(!showAll)}>
            {showAll ? t('hideResources') : t('moreResources', { n: hidden })}
          </button>
        )}
        {usesWell && <p className="hint">{t('wellNote')}</p>}
      </section>
    </div>
  );
}
