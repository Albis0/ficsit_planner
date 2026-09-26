import { data } from '../lib/data';
import type { ExtractionUse } from '../lib/extraction';
import { useT } from '../lib/i18n';
import type { SolveResult } from '../lib/solver';
import { usePlan, useStore } from '../store';
import { Icon } from './Icon';
import { MissingList } from './MissingList';
import { RateInput } from './RateInput';
import { Slot } from './Slot';

export function Summary({ result, extraction }: { result: SolveResult; extraction: ExtractionUse[] }) {
  const { t, num } = useT();
  const set = useStore((s) => s.set);
  const inventory = useStore((s) => s.inventory);
  const updatePlan = useStore((s) => s.updatePlan);
  const fixed = usePlan().fixed;
  const pinned = Object.keys(fixed).length > 0;
  const machines = result.recipes.reduce((s, u) => s + u.built, 0);
  const extractors = extraction.reduce((s, u) => s + u.built, 0);
  const extractionPower = extraction.reduce((s, u) => s + u.power, 0);

  return (
    <div className="summary">
      <div className="readouts">
        <div className="readout power">
          <span className="readout-label">{t('power')}</span>
          <span className="readout-value">
            {num(result.power + extractionPower)} <small>MW</small>
          </span>
          <span className="readout-sub">
            {num(result.power)} {t('factoryPower')}, {num(extractionPower)} {t('extraction').toLocaleLowerCase()}
          </span>
        </div>
        <div className="readout">
          <span className="readout-label">{t('machines')}</span>
          <span className="readout-value">{machines}</span>
        </div>
        <button type="button" className="readout link" onClick={() => set({ tab: 'resources' })}>
          <span className="readout-label">{t('extractors')}</span>
          <span className="readout-value">{extractors}</span>
        </button>
        {result.shards > 0 && (
          <div className="readout">
            <span className="readout-label">{t('shards')}</span>
            <span className={`readout-value shard ${result.shards > inventory.shards ? 'over' : ''}`}>
              {result.shards}
              <small> / {inventory.shards}</small>
            </span>
          </div>
        )}
        {result.sloops > 0 && (
          <div className="readout">
            <span className="readout-label">{t('sloops')}</span>
            <span className={`readout-value sloop ${result.sloops > inventory.sloops ? 'over' : ''}`}>
              {result.sloops}
              <small> / {inventory.sloops}</small>
            </span>
          </div>
        )}
        <div className="readout wide">
          <span className="readout-label">
            {t('rawInput')}
            <span className="readout-note">{t('rawEditHint')}</span>
          </span>
          <RawInputs raw={result.raw} />
        </div>
        {result.surplus.length > 0 && (
          <div className="readout">
            <span className="readout-label">{t('surplus')}</span>
            <span className="slots">
              {result.surplus.map((r) => (
                <Slot key={r.item} id={r.item} rate={r.rate} size={48} tone="muted" />
              ))}
            </span>
          </div>
        )}
      </div>
      {pinned && (
        <div className="scaled" role="status">
          <span>{t('scaledBanner')}</span>
          <b>×{num(result.scale)}</b>
          {result.targets.map((x) => (
            <span key={x.item} className="chip">
              <Icon id={x.item} size={24} />
              {num(x.rate)}
              {t('perMin')}
            </span>
          ))}
          <button type="button" className="text-button" onClick={() => updatePlan({ fixed: {} })}>
            {t('unpinAll')}
          </button>
        </div>
      )}
      {result.missing.length > 0 && result.recipes.length > 0 && (
        <div className="missing-banner" role="alert">
          <span className="missing-title">{t('missing')}</span>
          <MissingList missing={result.missing} />
        </div>
      )}
    </div>
  );
}

/**
 * Raw inputs you can retype or step right here, not only on the graph. Changing one pins it: the
 * factory is built around that amount and the targets scale to fit.
 */
function RawInputs({ raw }: { raw: SolveResult['raw'] }) {
  const { t, name } = useT();
  const fixed = usePlan().fixed;
  const setFixed = useStore((s) => s.setFixed);
  return (
    <span className="raw-inputs">
      {raw.map((r) => {
        const it = data.items[r.item];
        const pinned = fixed[r.item] !== undefined;
        return (
          <span key={r.item} className={`raw-chip ${pinned ? 'pinned' : ''}`} title={`${name(it)}: ${t('pinHint')}`}>
            <Icon id={r.item} size={32} />
            <RateInput
              value={Math.round((fixed[r.item] ?? r.rate) * 100) / 100}
              label={`${t('rawInput')}: ${name(it)}`}
              onChange={(v) => v > 0 && setFixed(r.item, v)}
              step
            />
            {pinned && (
              <button
                type="button"
                className="icon-button unpin"
                aria-label={`${t('unpin')}: ${name(it)}`}
                onClick={() => setFixed(r.item, undefined)}
              >
                ×
              </button>
            )}
          </span>
        );
      })}
    </span>
  );
}
