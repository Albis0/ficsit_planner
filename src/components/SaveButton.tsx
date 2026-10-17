import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n';
import { chooseSaves, copySavePath, handOver, isPhone, osOf, savedWhen } from '../lib/save/pick';
import { useStore } from '../store';
import { Glyph } from './Glyph';

const SaveImport = lazy(() => import('./SaveImport'));

/** Opens the import window. */
export const openImport = () => useStore.getState().set({ dialog: 'save' });

/**
 * Reads the followed game again: the chooser opens straight away (on the folder, with its path copied) and the
 * newest save of the game goes in. Has to run from a click.
 */
export function refreshSave() {
  const os = osOf();
  void copySavePath(os);
  chooseSaves(!isPhone(os), (files) => {
    if (!files.length) return;
    handOver(files);
    openImport();
  });
}

/** "Dunarr · saved today 18:42" for the followed save. */
export function useSaveLine(): string | undefined {
  const { t } = useT();
  const save = useStore((s) => s.save);
  if (!save) return undefined;
  return t('saveLine', { game: save.game, when: savedWhen(save.savedAt, t('today')) });
}

/** Top bar: Import save, or once a game is followed, a menu to refresh it, choose another, or open its settings. */
export function SaveButton() {
  const { t } = useT();
  const followed = useStore((s) => !!s.save);
  const line = useSaveLine();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    addEventListener('pointerdown', away);
    addEventListener('keydown', key);
    return () => {
      removeEventListener('pointerdown', away);
      removeEventListener('keydown', key);
    };
  }, [open]);
  if (!followed)
    return (
      <button type="button" className="chrome-button save-button" title={t('saveImport')} onClick={openImport}>
        <Glyph name="import" size={20} />
        <span className="chrome-label">{t('saveImport')}</span>
      </button>
    );
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <span className="save-anchor" ref={box}>
      <button
        type="button"
        className="chrome-button save-button"
        title={t('saveMenu')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Glyph name="import" size={20} />
        <Glyph name="chevronDown" size={16} />
      </button>
      {open && (
        <span className="save-menu" role="menu">
          <span className="save-menu-head">{line}</span>
          <button type="button" role="menuitem" className="menu-item" onClick={pick(refreshSave)}>
            <Glyph name="reset" size={18} />
            {t('saveRefresh')}
          </button>
          <button type="button" role="menuitem" className="menu-item" onClick={pick(openImport)}>
            <Glyph name="import" size={18} />
            {t('saveAnother')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={pick(() => useStore.getState().set({ dialog: 'settings', settingsAt: 'save' }))}
          >
            <Glyph name="gear" size={18} />
            {t('saveSettings')}
          </button>
        </span>
      )}
    </span>
  );
}

/** Phone menu: one row like the tier's, the followed game under its label and one button to refresh or import. */
export function SaveSheetRow({ onDone }: { onDone: () => void }) {
  const { t } = useT();
  const followed = useStore((s) => !!s.save);
  const line = useSaveLine();
  return (
    <div className="sheet-row">
      <span className="save-sheet-text">
        <span className="control-label">{t('saveMenu')}</span>
        {line && <small>{line}</small>}
      </span>
      <button
        type="button"
        className="tier-button save-sheet-button"
        onClick={() => {
          onDone();
          if (followed) refreshSave();
          else openImport();
        }}
      >
        <Glyph name={followed ? 'reset' : 'import'} size={18} />
        {followed ? t('saveRefreshShort') : t('saveImportShort')}
      </button>
    </div>
  );
}

/** The import window, loaded the first time it opens. */
export function SaveFlow() {
  const open = useStore((s) => s.dialog === 'save');
  const set = useStore((s) => s.set);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <SaveImport onClose={() => set({ dialog: undefined })} />
    </Suspense>
  );
}
