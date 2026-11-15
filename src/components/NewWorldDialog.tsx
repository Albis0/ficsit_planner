import { type FormEvent, useEffect, useRef, useState } from 'react';
import { DEFAULT_GAME } from '../lib/game';
import { useT } from '../lib/i18n';
import { freeWorldName, MAX_TIER, useStore } from '../store';
import { Dialog } from './Dialog';
import { Glyph } from './Glyph';
import { GameRows, Row, Toggle } from './SettingsDialog';
import { TierSteps } from './TierPicker';

/** What New world opens, like the game's New Game screen: what to call the world and how its game was started. */
export function NewWorldDialog({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const [name, setName] = useState(() => {
    const s = useStore.getState();
    return freeWorldName([s.world.name, ...s.worlds.map((w) => w.name)]);
  });
  const [tier, setTier] = useState(MAX_TIER);
  const [game, setGame] = useState(DEFAULT_GAME);
  const [random, setRandom] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  // After the dialog has opened (its own effect runs first), which would leave focus on the close button.
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  const create = (e: FormEvent) => {
    e.preventDefault();
    useStore.getState().addWorld({ name, tier, game, randomNodes: random });
    onClose();
  };

  return (
    <Dialog title={t('worldNew')} icon="plus" className="new-world-dialog" onClose={onClose}>
      <form className="new-world" onSubmit={create}>
        <label className="field-block">
          <span className="field-label">{t('areaName')}</span>
          <input ref={field} className="text-field" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="field-block">
          <span className="field-label">{t('tier')}</span>
          <TierSteps tier={tier} onPick={setTier} />
        </div>
        <div>
          <GameRows game={game} onChange={setGame} />
          <Row label={t('worldRandomNodes')}>
            <Toggle on={random} label={t('worldRandomNodes')} onChange={setRandom} />
          </Row>
        </div>
        <div className="new-world-foot">
          <button type="button" className="ghost-button" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" className="primary-button">
            <Glyph name="check" size={18} />
            {t('worldCreate')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
