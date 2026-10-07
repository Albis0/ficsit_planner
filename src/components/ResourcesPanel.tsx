import { useMemo, useState } from 'react';
import { data, rawItems, resourceWeights } from '../lib/data';
import {
  type ExtractionSettings,
  type ExtractionUse,
  effectiveExtraction,
  MINERS,
  PURITIES,
  type Purity,
  planExtraction,
} from '../lib/extraction';
import { useT } from '../lib/i18n';
import { minerLabel } from '../lib/text';
import { plantRecipe, plantValid } from '../lib/power';
import { reachableRaw, useExports, usableRecipes } from '../lib/solution';
import type { SolveResult } from '../lib/solver';
import { activePowerPlan, aimOf, usePlan, useStore } from '../store';
import { Icon } from './Icon';
import { RateInput } from './RateInput';
import { Slot } from './Slot';

const sorted = [...rawItems].sort((a, b) => (data.worldLimits[b.id] ?? Infinity) - (data.worldLimits[a.id] ?? Infinity));

export function ResourcesPanel({ result }: { result?: SolveResult }) {
  const { t, name, num } = useT();
  const plan = usePlan();
  const setCap = useStore((s) => s.setCap);
  const setWeight = useStore((s) => s.setWeight);
  const updatePlan = useStore((s) => s.updatePlan);
  const tier = useStore((s) => s.tier);
  const showLocked = useStore((s) => s.settings.showLocked);
  const aim = useStore(aimOf);
  const set = useStore((s) => s.set);
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
      </section>

      <section className="stack resource-list">
        <h3 className="section-title">{t('resources')}</h3>
        <p className="hint">{t('resourceHint')}</p>
        <div className="field" title={t('resourceCostHint')}>
          <span className="control-label">{t('resourceCost')}</span>
          <div className="segmented wide" role="radiogroup" aria-label={t('resourceCost')}>
            <button
              type="button"
              role="radio"
              aria-checked={aim === 'rarity'}
              onClick={() => set({ equalWeights: false, fewestBuildings: false, customWeights: false })}
            >
              {t('byRarity')}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={aim === 'equal'}
              onClick={() => set({ equalWeights: true, fewestBuildings: false, customWeights: false })}
            >
              {t('allEqual')}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={aim === 'custom'}
              title={t('customCostHint')}
              onClick={() => set({ customWeights: true, equalWeights: false, fewestBuildings: false })}
            >
              {t('customCost')}
            </button>
            <button type="button" role="radio" aria-checked={aim === 'buildings'} onClick={() => set({ fewestBuildings: true })}>
              {t('fewestBuildings')}
              <span className="beta-tag">{t('beta')}</span>
            </button>
          </div>
        </div>
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
                {aim === 'custom' && (
                  <div className="field cost-field">
                    <span className="control-label">{t('costOf')}</span>
                    <span className="item-card-rate">
                      <RateInput
                        value={plan.weights?.[item.id] ?? Number.NaN}
                        label={`${t('costOf')}: ${name(item)}`}
                        placeholder={num(Math.round((resourceWeights[item.id] ?? 1) * 100) / 100)}
                        onChange={(v) => setWeight(item.id, v)}
                        onClear={() => setWeight(item.id, undefined)}
                      />
                    </span>
                  </div>
                )}
                {use && (
                  <>
                    <div className="meter" aria-hidden>
                      <span style={{ width: `${share * 100}%` }} className={share > 0.999 ? 'full' : undefined} />
                    </div>
                    {/* A hand-built floor can mine past the limit; the Auto floor never does. */}
                    {cap != null && use.rate > cap + 1e-6 && (
                      <p className="run-state bad over-cap">{t('overCap', { rate: num(use.rate), cap: num(cap) })}</p>
                    )}
                    <ExtractRow item={item.id} use={use} ex={ex} setEx={setEx} />
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

/** More than any map has of one purity (50 at most in the base game), with room for modded maps; three digits fit the box. */
const MAX_NODES = 999;

/**
 * The extractors a resource needs: how many on each node purity, or, with the player's own nodes set, how many go on
 * each. Setting them puts a box under each purity's count, so the numbers line up in any card width.
 */
function ExtractRow({
  item,
  use,
  ex,
  setEx,
}: {
  item: string;
  use: ExtractionUse;
  ex: ExtractionSettings;
  setEx: (patch: Partial<ExtractionSettings>) => void;
}) {
  const { t, name } = useT();
  const mine = ex.nodes?.[item];
  const [open, setOpen] = useState(false);
  const editing = use.extractor.purity && (open || !!mine);
  const save = (next: Partial<Record<Purity, number>> | undefined) => {
    const nodes = { ...ex.nodes };
    if (next && Object.keys(next).length) nodes[item] = next;
    else delete nodes[item];
    setEx({ nodes: Object.keys(nodes).length ? nodes : undefined });
  };
  const put = (p: Purity, n: number | undefined) => {
    const next = { ...mine, [p]: n && n >= 1 ? Math.min(MAX_NODES, Math.floor(n)) : undefined };
    for (const k of PURITIES) if (!next[k]) delete next[k];
    save(next);
  };
  return (
    <>
      <div className="extract-row">
        <Icon id={use.extractor.id} size={28} />
        <span className="extract-name">{name(use.extractor)}</span>
        {use.extractor.purity ? (
          PURITIES.map((p) => (
            <span
              key={p}
              className={`extract-count ${(use.onNodes ? use.onNodes.placed[p] > 0 : p === ex.purity) ? 'chosen' : ''}`}
              title={t(p)}
            >
              <b>{use.onNodes ? use.onNodes.placed[p] : use.counts[p]}</b>
              <small>{t(p)}</small>
              {editing && (
                <span className="node-count">
                  <RateInput
                    value={mine?.[p] ?? Number.NaN}
                    placeholder="0"
                    label={`${t('yourNodes')}, ${t(p)}: ${name(data.items[item])}`}
                    max={MAX_NODES}
                    onChange={(v) => put(p, v)}
                    onClear={() => put(p, undefined)}
                  />
                </span>
              )}
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
      {use.extractor.purity &&
        (editing ? (
          <p className="nodes-line">
            <span>{t('nodesInBoxes')}</span>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                save(undefined);
                setOpen(false);
              }}
            >
              {t('clearNodes')}
            </button>
          </p>
        ) : (
          <button type="button" className="text-button set-nodes" onClick={() => setOpen(true)}>
            {t('setNodes')}
          </button>
        ))}
      {use.onNodes && use.onNodes.extra > 0 && (
        <p className="hint nodes-short">{t('nodesShort', { n: use.onNodes.extra, purity: t(ex.purity).toLowerCase() })}</p>
      )}
    </>
  );
}
