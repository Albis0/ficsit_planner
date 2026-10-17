import { useT } from '../lib/i18n';
import type { Answers } from '../lib/save/apply';
import { forgetSave } from '../lib/save/store-idb';
import { useStore } from '../store';
import { openImport, refreshSave, useSaveLine } from './SaveButton';

/** One thing to take from the save, with a switch. The first import asks the same. */
export function AnswerRow({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="setting">
      <div className="setting-text">
        <span className="setting-label">{label}</span>
        {hint && <span className="setting-hint">{hint}</span>}
      </div>
      <div className="setting-control">
        <button type="button" role="switch" aria-checked={on} aria-label={label} className="toggle" onClick={() => onChange(!on)}>
          <span className="toggle-knob" />
        </button>
      </div>
    </div>
  );
}

/** Settings › Game save: the followed save in one line with what to do with it, and what is taken from it. */
export function SaveSection() {
  const { t } = useT();
  const save = useStore((s) => s.save);
  const line = useSaveLine();
  if (!save)
    return (
      <p className="save-small save-line">
        {t('saveNoneYet')}{' '}
        <button type="button" className="text-button" onClick={openImport}>
          {t('saveImport')}
        </button>
      </p>
    );
  const answer = (patch: Partial<Answers>) => useStore.setState({ save: { ...save, answers: { ...save.answers, ...patch } } });
  return (
    <>
      <p className="save-small save-line">
        {line} ·{' '}
        <button type="button" className="text-button" onClick={refreshSave}>
          {t('saveRefreshShort')}
        </button>{' '}
        ·{' '}
        <button type="button" className="text-button" onClick={openImport}>
          {t('saveChange')}
        </button>{' '}
        ·{' '}
        <button
          type="button"
          className="text-button danger"
          title={t('saveForgetHint')}
          onClick={() => {
            useStore.setState({ save: undefined });
            void forgetSave();
          }}
        >
          {t('saveForget')}
        </button>
      </p>
      <AnswerRow label={t('saveQProgress')} hint={t('saveFollow')} on={save.answers.progress} onChange={(on) => answer({ progress: on })} />
      <AnswerRow label={t('saveQInventory')} on={save.answers.inventory} onChange={(on) => answer({ inventory: on })} />
      <AnswerRow label={t('saveQFactories')} on={save.answers.factories} onChange={(on) => answer({ factories: on })} />
      <AnswerRow label={t('saveQPower')} on={save.answers.power} onChange={(on) => answer({ power: on })} />
    </>
  );
}
