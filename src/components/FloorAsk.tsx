import { useState } from 'react';
import { data } from '../lib/data';
import { useT } from '../lib/i18n';
import { useStore } from '../store';
import { Dialog } from './Dialog';

/** A little drawing of what each way builds: iron ore into smelters, as one card or as three. */
function Sketch({ each }: { each: boolean }) {
  const { name } = useT();
  const ore = name(data.items.Desc_OreIron_C);
  const smelter = name(data.machines.Build_SmelterMk1_C);
  return (
    <span className="floor-ask-sketch" aria-hidden>
      <span className="fa-card fa-raw">{ore}</span>
      <span className="fa-belt" />
      {each ? (
        <>
          <span className="fa-splitter" />
          <span className="fa-belt" />
          <span className="fa-stack">
            {[0, 1, 2].map((i) => (
              <span key={i} className="fa-card fa-machine">
                {smelter}
              </span>
            ))}
          </span>
        </>
      ) : (
        <span className="fa-card fa-machine">
          {smelter}
          <small>3 ×</small>
        </span>
      )}
    </span>
  );
}

/** Asked when the first Manual floor of a factory is started from what Auto worked out. */
export function FloorAsk({ onPick, onClose }: { onPick: (eachBuilding: boolean) => void; onClose: () => void }) {
  const { t } = useT();
  const setSettings = useStore((s) => s.setSettings);
  const [each, setEach] = useState(false);
  const [remember, setRemember] = useState(false);
  const start = () => {
    if (remember) setSettings({ newFloor: each ? 'building' : 'kind' });
    onPick(each);
  };
  return (
    <Dialog title={t('floorAskTitle')} icon="floor" className="floor-ask" onClose={onClose}>
      <div className="floor-ask-body">
        <div className="floor-ask-ways" role="radiogroup" aria-label={t('floorAskTitle')}>
          {[false, true].map((b) => (
            <button
              key={String(b)}
              type="button"
              role="radio"
              aria-checked={each === b}
              className="floor-ask-way"
              onClick={() => setEach(b)}
            >
              <b>{t(b ? 'floorAskBuilding' : 'floorAskKind')}</b>
              <Sketch each={b} />
            </button>
          ))}
        </div>
        <div className="floor-ask-foot">
          <span className="floor-ask-remember">
            <button
              type="button"
              role="switch"
              aria-checked={remember}
              aria-label={t('floorAskRemember')}
              className="toggle"
              onClick={() => setRemember(!remember)}
            >
              <span className="toggle-knob" />
            </button>
            {t('floorAskRemember')}
          </span>
          <span className="floor-ask-where">{t('floorAskWhere')}</span>
          <button type="button" className="primary-button" onClick={start}>
            {t('floorAskStart')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
