import { data } from '../lib/data';
import type { ExtractionUse } from '../lib/extraction';
import { useT } from '../lib/i18n';
import type { SolveResult } from '../lib/solver';
import { usePlan, useStore } from '../store';
import { Icon } from './Icon';
import { Slot } from './Slot';

export function Summary({ result, extraction }: { result: SolveResult; extraction: ExtractionUse[] }) {
  const { t, name, num } = useT();
  const addSupply = useStore((s) => s.addSupply);
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
        <span className="readout-label">{t('rawInput')}</span>
        <span className="slots">
          {result.raw.map((r) => (
            <Slot key={r.item} id={r.item} rate={r.rate} size={52} />
          ))}
        </span>
      </div>
      {result.surplus.length > 0 && (
        <div className="readout">
          <span className="readout-label">{t('surplus')}</span>
          <span className="slots">
            {result.surplus.map((r) => (
              <Slot key={r.item} id={r.item} rate={r.rate} size={52} tone="muted" />
            ))}
          </span>
        </div>
      )}
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
      {result.missing.length > 0 && (
        <div className="missing" role="alert">
          <span>{t('missing')}</span>
          {result.missing.map((m) => (
            <button key={m.item} type="button" className="chip alert" onClick={() => addSupply(m.item, Math.ceil(m.rate))}>
              <Icon id={m.item} size={24} />+ {name(data.items[m.item])} {num(m.rate)}
              {t('perMin')}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
