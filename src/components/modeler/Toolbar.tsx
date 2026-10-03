import { useT } from '../../lib/i18n';
import { canRedo, canUndo } from '../../lib/model/history';
import { Glyph, type GlyphName } from '../Glyph';
import type { ModelHost } from './ModelEditor';

/** A square button with a line icon; its name shows on hover and is read out. */
function Tool({
  icon,
  label,
  title,
  onClick,
  disabled,
  pressed,
}: {
  icon: GlyphName;
  label: string;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      className="tool-button"
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <Glyph name={icon} size={22} />
    </button>
  );
}

/**
 * Over the hand-built floor: undo and redo side by side, tidying up and starting again, the numbers on or off, and what
 * an output with no belt does.
 */
export function ModelToolbar({
  host,
  onTidy,
  onRebuild,
  unbounded,
}: {
  host: ModelHost;
  onTidy: () => void;
  onRebuild?: () => void;
  unbounded?: boolean;
}) {
  const { t } = useT();
  const { model } = host;
  const numbers = model.calc !== 'off';
  const setStall = (on: boolean) =>
    host.edit((x) => {
      const { stall: _, ...rest } = x;
      return on ? { ...rest, stall: true } : rest;
    });
  return (
    <div className="model-toolbar">
      <div className="tool-group">
        <Tool icon="undo" label={t('undo')} title={t('undoKey')} disabled={!canUndo(host.key)} onClick={host.undo} />
        <Tool icon="redo" label={t('redo')} title={t('redoKey')} disabled={!canRedo(host.key)} onClick={host.redo} />
      </div>
      <div className="tool-group">
        <Tool icon="tidy" label={t('tidy')} disabled={model.nodes.length === 0} onClick={onTidy} />
        {onRebuild && <Tool icon="rebuild" label={t('rebuild')} onClick={onRebuild} />}
        <Tool
          icon={numbers ? 'eye' : 'eyeOff'}
          label={t('numbers')}
          title={numbers ? t('hideNumbers') : t('showNumbers')}
          pressed={numbers}
          onClick={() => host.edit((x) => ({ ...x, calc: numbers ? 'off' : 'basic' }))}
        />
      </div>
      <div className="segmented open-outputs" role="radiogroup" aria-label={t('openOutputs')}>
        <span className="seg-label" aria-hidden>
          {t('openOutputs')}
        </span>
        <button type="button" role="radio" aria-checked={!model.stall} title={t('openLeftOverHint')} onClick={() => setStall(false)}>
          {t('openLeftOver')}
        </button>
        <button type="button" role="radio" aria-checked={!!model.stall} title={t('openFillHint')} onClick={() => setStall(true)}>
          {t('openFill')}
        </button>
      </div>
      {unbounded && <span className="run-state bad">{t('unboundedHint')}</span>}
    </div>
  );
}
