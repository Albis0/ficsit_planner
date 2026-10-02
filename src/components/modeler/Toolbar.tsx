import { useT } from '../../lib/i18n';
import { canRedo, canUndo } from '../../lib/model/history';
import type { CalcMode } from '../../lib/model/types';
import type { ModelHost } from './ModelEditor';

/** Calculators the hand-built floor offers so far. */
const MODES: CalcMode[] = ['basic', 'off'];

/** Over the hand-built floor: how it's worked out, what an open output does, undo and redo, starting again. */
export function ModelToolbar({ host, onRebuild, unbounded }: { host: ModelHost; onRebuild?: () => void; unbounded?: boolean }) {
  const { t } = useT();
  const { model } = host;
  return (
    <div className="model-toolbar">
      <div className="segmented" role="radiogroup" aria-label={t('calcMode')}>
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={(model.calc === 'full' || model.calc === 'sheet' ? 'basic' : model.calc) === m}
            title={t(`calcHint_${m}`)}
            onClick={() => host.edit((x) => ({ ...x, calc: m }))}
          >
            {t(`calc_${m}`)}
          </button>
        ))}
      </div>
      <label className="check model-drain" title={t('drainHint')}>
        <input
          type="checkbox"
          checked={!!model.drain}
          onChange={(e) =>
            host.edit((x) => {
              const { drain: _, ...rest } = x;
              return e.target.checked ? { ...rest, drain: true } : rest;
            })
          }
        />
        {t('drain')}
      </label>
      <div className="model-history">
        <button type="button" className="floor-button" disabled={!canUndo(host.key)} title={t('undoKey')} onClick={host.undo}>
          {t('undo')}
        </button>
        <button type="button" className="floor-button" disabled={!canRedo(host.key)} title={t('redoKey')} onClick={host.redo}>
          {t('redo')}
        </button>
      </div>
      {onRebuild && (
        <button type="button" className="floor-button" title={t('rebuildHint')} onClick={onRebuild}>
          {t('rebuild')}
        </button>
      )}
      {unbounded && <span className="run-state bad">{t('unboundedHint')}</span>}
    </div>
  );
}
