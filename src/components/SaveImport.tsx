import { useEffect, useRef, useState } from 'react';
import { MILESTONES } from '../lib/unlocks';
import { type StringKey, useT } from '../lib/i18n';
import { ALL_ANSWERS, type Answers, conflicts, type Field, fieldsOf, unknownRecipes, type Values, valuesOf } from '../lib/save/apply';
import type { SaveStep } from '../lib/save/extract';
import { droppedFiles, type Found, findSaves, type Game, groupGames } from '../lib/save/files';
import {
  chooseSaves,
  copySavePath,
  handedOver,
  handOver,
  isPhone,
  type Os,
  osOf,
  SAVE_PATHS,
  saveTitle,
  savedWhen,
} from '../lib/save/pick';
import { importSave, type SaveProgress } from '../lib/save/saveClient';
import { mine, takeSave } from '../lib/save/take';
import type { SaveData } from '../lib/save/types';
import { gameVersion, isNewer, isSupported } from '../lib/save/version';
import { recipeById } from '../lib/data';
import { useStore } from '../store';
import { Dialog } from './Dialog';
import { Glyph } from './Glyph';
import { AnswerRow } from './SaveSection';

type Step =
  | { at: 'choose'; note?: StringKey }
  | { at: 'pick'; games: Game[]; game: string; save: Found }
  | { at: 'read'; found: Found; progress: SaveProgress }
  | { at: 'ask'; found: Found; save: SaveData }
  | { at: 'conflict'; found: Found; save: SaveData; fields: Field[] }
  | { at: 'done'; found: Found; save: SaveData; taken: Field[]; kept: Field[] };

const STEPS: { id: SaveStep; key: StringKey }[] = [
  { id: 'read', key: 'saveStepRead' },
  { id: 'inflate', key: 'saveStepInflate' },
  { id: 'parse', key: 'saveStepParse' },
  { id: 'extract', key: 'saveStepExtract' },
];

const FIELD_KEY: Record<Field, StringKey> = {
  tier: 'tier',
  recipes: 'saveFieldRecipes',
  sloops: 'saveFieldSloops',
  shards: 'saveFieldShards',
};

const when = savedWhen;
const hours = (s: number) => `${Math.floor(s / 3600)} h`;
const hoursMinutes = (s: number) => `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;

/**
 * Importing a game save, from choosing the folder to what came in. Started from the top bar, the phone menu or
 * Settings › Game save; Refresh hands over the files it already chose.
 */
export default function SaveImport({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const followed = useStore((s) => s.save);
  const [step, setStep] = useState<Step>({ at: 'choose' });
  const [busy, setBusy] = useState(false);
  const cancel = useRef<() => void>(undefined);
  const close = () => {
    cancel.current?.();
    handOver(undefined);
    onClose();
  };

  /** Starts reading one save in the worker, then asks, compares or takes it. */
  const read = (found: Found) => {
    const job = importSave(found.file, (progress) => setStep((s) => (s.at === 'read' ? { ...s, progress } : s)));
    cancel.current = job.cancel;
    setStep({ at: 'read', found, progress: { step: 'read', done: 0 } });
    job.result.then(
      (save) => {
        cancel.current = undefined;
        const current = useStore.getState().save;
        if (!current) return setStep({ at: 'ask', found, save });
        const fields = conflicts(mine(), current.seen, valuesOf(save), fieldsOf(current.answers));
        if (fields.length) return setStep({ at: 'conflict', found, save, fields });
        finish(found, save, current.answers, []);
      },
      (e: { reason?: string }) => {
        cancel.current = undefined;
        if (e.reason === 'cancelled') return;
        setStep({ at: 'choose', note: e.reason === 'damaged' ? 'saveDamaged' : 'saveUnreadable' });
      },
    );
  };

  const finish = (found: Found, save: SaveData, answers: Answers, keep: Field[]) => {
    const taken = takeSave(found, save, answers, keep);
    setStep({ at: 'done', found, save, taken, kept: keep });
  };

  /** Lists the saves in what was chosen. A refresh goes straight to the newest save of the game it follows. */
  const look = async (files: File[], refresh: boolean) => {
    setBusy(true);
    const games = groupGames(await findSaves(files));
    setBusy(false);
    if (!games.length) return setStep({ at: 'choose', note: 'saveNone' });
    const session = useStore.getState().save?.session;
    const same = games.find((g) => g.key === session);
    if (refresh && same && isSupported(same.saves[0].header)) return read(same.saves[0]);
    if (games.length === 1 && games[0].saves.length === 1 && isSupported(games[0].saves[0].header)) return read(games[0].saves[0]);
    const game = same ?? games[0];
    setStep({ at: 'pick', games, game: game.key, save: game.saves[0] });
  };

  // Refresh chose the files before this window loaded. Once only, though React may run this twice.
  const started = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, on opening
  useEffect(() => {
    const files = handedOver();
    if (files && !started.current) {
      started.current = true;
      void look(files, true);
    }
  }, []);

  if (step.at === 'read') return <Reading step={step} onCancel={close} />;
  if (step.at === 'pick')
    return <Picker step={step} onPick={(s) => setStep({ ...step, ...s })} onImport={() => read(step.save)} onClose={close} />;
  if (step.at === 'ask') return <Questions save={step.save} onImport={(a) => finish(step.found, step.save, a, [])} onClose={close} />;
  if (step.at === 'conflict')
    return (
      <Conflict
        step={step}
        game={followed?.game ?? ''}
        onRefresh={(keep) => finish(step.found, step.save, followed?.answers ?? ALL_ANSWERS, keep)}
        onClose={close}
      />
    );
  if (step.at === 'done') return <Result step={step} onClose={close} />;
  return <Choose note={step.note} busy={busy} onFiles={(files) => void look(files, false)} onClose={close} t={t} />;
}

/** The import window: a picture of the system's own chooser on one side, the ways to hand over a save on the other. */
function Choose({
  note,
  busy,
  onFiles,
  onClose,
  t,
}: {
  note?: StringKey;
  busy: boolean;
  onFiles: (files: File[]) => void;
  onClose: () => void;
  t: ReturnType<typeof useT>['t'];
}) {
  const [os] = useState(osOf);
  const phone = isPhone(os);
  const [copied, setCopied] = useState<boolean>();
  const [over, setOver] = useState(false);
  // Opening the window copies the path, so it is ready for the chooser's address bar.
  useEffect(() => {
    void copySavePath(os).then(setCopied);
  }, [os]);
  const step: StringKey = phone ? 'saveStepPhone' : os === 'mac' ? 'saveStepMac' : os === 'linux' ? 'saveStepLinux' : 'saveStepWindows';
  return (
    <Dialog title={t('saveImport')} icon="import" className="save-dialog wide" onClose={onClose}>
      <div className="save-body save-two">
        <div className="save-col">
          <span className="save-label">{t(phone ? 'saveOnPhone' : 'saveInWindow')}</span>
          <ChooserPicture os={os} path={SAVE_PATHS[os]} />
          <p className="save-small">{t(step)}</p>
        </div>
        <div className="save-col">
          <button type="button" className="primary-button save-big" disabled={busy} onClick={() => chooseSaves(!phone, onFiles)}>
            <Glyph name="import" size={20} />
            {t(phone ? 'saveChooseFilePhone' : 'saveChooseFolder')}
          </button>
          {!phone && (
            <>
              <button type="button" className="ghost-button save-wide" disabled={busy} onClick={() => chooseSaves(false, onFiles)}>
                {t('saveChooseFile')}
              </button>
              {/* biome-ignore lint/a11y/noStaticElementInteractions: dropping is a mouse shortcut; the two buttons above do the same by keyboard */}
              <div
                className="save-drop"
                data-over={over || undefined}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(true);
                }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(false);
                  void droppedFiles(e.dataTransfer).then(onFiles);
                }}
              >
                {t('saveDrop')}
              </div>
            </>
          )}
          {phone && <span className="save-label">{t('saveOnPc')}</span>}
          <div className="save-path">
            <code title={SAVE_PATHS[os]}>{SAVE_PATHS[os]}</code>
            <button type="button" className="ghost-button small" onClick={() => void copySavePath(os).then(setCopied)}>
              <Glyph name={copied ? 'check' : 'copy'} size={16} />
              {copied ? t('copied') : t('copy')}
            </button>
          </div>
          {busy && <p className="save-small">{t('saveLooking')}</p>}
          {note && (
            <p className="setting-note bad" role="alert">
              {t(note)}
            </p>
          )}
          <p className="save-safe">
            <Glyph name="lock" size={16} /> {t('saveSafe')}
          </p>
        </div>
      </div>
    </Dialog>
  );
}

/** A small drawing of the chooser the system will open, with the path in its address bar. */
function ChooserPicture({ os, path }: { os: Os; path: string }) {
  if (isPhone(os))
    return (
      <div className={`save-win ${os}`} aria-hidden>
        <div className="save-win-bar">
          <span>{os === 'ios' ? 'Browse' : 'Recent'}</span>
        </div>
        <div className="save-win-files">
          <span className="save-win-file sel">MyFactory.sav</span>
          <span className="save-win-file">MyFactory_autosave_0.sav</span>
        </div>
      </div>
    );
  return (
    <div className={`save-win ${os}`} aria-hidden>
      <div className="save-win-bar">
        {os === 'mac' && <span className="save-win-lights" />}
        <span className="save-win-address">{path}</span>
      </div>
      <div className="save-win-files">
        <span className="save-win-folder sel">SaveGames</span>
        <span className="save-win-folder">Config</span>
        <span className="save-win-folder">Logs</span>
      </div>
      <div className="save-win-foot">
        <span className="save-win-btn">{os === 'windows' ? 'Select Folder' : 'Upload'}</span>
      </div>
    </div>
  );
}

/** Games on the left, the chosen game's saves on the right; the newest save is picked to start with. */
function Picker({
  step,
  onPick,
  onImport,
  onClose,
}: {
  step: Extract<Step, { at: 'pick' }>;
  onPick: (s: { game: string; save: Found }) => void;
  onImport: () => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const game = step.games.find((g) => g.key === step.game) ?? step.games[0];
  const newest = game.saves[0].header;
  const total = step.games.reduce((n, g) => n + g.saves.length, 0);
  const ok = isSupported(step.save.header);
  return (
    <Dialog title={t('saveChooseGame')} icon="import" className="save-dialog wide" onClose={onClose}>
      <div className="save-body save-split">
        <div className="save-side" role="radiogroup" aria-label={t('saveChooseGame')}>
          {step.games.map((g) => (
            <button
              key={g.key}
              type="button"
              role="radio"
              aria-checked={g.key === game.key}
              className="save-side-row"
              onClick={() => onPick({ game: g.key, save: g.saves.find((s) => isSupported(s.header)) ?? g.saves[0] })}
            >
              <b>{g.name}</b>
              <small>
                {hours(g.saves[0].header.playSeconds)} · {t(g.saves.length === 1 ? 'saveOne' : 'saveMany', { n: g.saves.length })}
              </small>
              {isNewer(g.saves[0].header) && (
                <span className="save-badge warn" title={t('saveNewer')}>
                  !
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="save-col save-saves">
          <h3 className="save-h">{game.name}</h3>
          <p className="save-small">
            {t('saveLastSaved', { version: gameVersion(newest.saveVersion), when: when(newest.savedAt, t('today')) })}
          </p>
          {isNewer(newest) && <p className="save-warn">{t('saveNewer')}</p>}
          <div className="save-list" role="radiogroup" aria-label={game.name}>
            {game.saves.map((s) => (
              <label
                key={`${s.file.webkitRelativePath}/${s.file.name}`}
                className="save-list-row"
                data-off={!isSupported(s.header) || undefined}
              >
                <input
                  type="radio"
                  name="save"
                  checked={s === step.save}
                  disabled={!isSupported(s.header)}
                  onChange={() => onPick({ game: game.key, save: s })}
                />
                <b>{saveTitle(s)}</b>
                <span>{when(s.header.savedAt, t('today'))}</span>
                <span>{isSupported(s.header) ? hoursMinutes(s.header.playSeconds) : t('saveTooOld')}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="save-foot">
        <span className="save-small">
          {t(step.games.length === 1 ? 'saveCountOne' : 'saveCount', { saves: total, games: step.games.length })}
        </span>
        <button type="button" className="primary-button" disabled={!ok} onClick={onImport}>
          {t('saveImportThis', { name: saveTitle(step.save) })}
        </button>
      </div>
    </Dialog>
  );
}

/** Covers the whole app while the save is read: nothing can be touched until it is done or cancelled. */
function Reading({ step, onCancel }: { step: Extract<Step, { at: 'read' }>; onCancel: () => void }) {
  const { t } = useT();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  const at = STEPS.findIndex((s) => s.id === step.progress.step);
  const pct = Math.round(step.progress.done * 100);
  const name = saveTitle(step.found);
  return (
    <dialog ref={ref} className="save-block" aria-label={t('saveImporting', { name })} onCancel={(e) => e.preventDefault()}>
      <div className="save-panel">
        <h3 className="save-h">{t('saveImporting', { name })}</h3>
        <ul className="save-progress">
          {STEPS.map((s, i) => (
            <li key={s.id} data-state={i < at ? 'done' : i === at ? 'now' : 'next'}>
              <span className="save-mark">{i < at && <Glyph name="check" size={14} />}</span>
              {t(s.key)}
              {i === at && <small>{pct}%</small>}
            </li>
          ))}
        </ul>
        <div
          className="save-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(((at + step.progress.done) / STEPS.length) * 100)}
        >
          <span style={{ width: `${((at + step.progress.done) / STEPS.length) * 100}%` }} />
        </div>
        <button type="button" className="text-button" onClick={onCancel}>
          {t('cancel')}
        </button>
      </div>
    </dialog>
  );
}

/** "2 milestones not bought", "every milestone bought". */
const skippedWords = (n: number, t: ReturnType<typeof useT>['t']) =>
  n === 0 ? t('saveAllBought') : n === 1 ? t('saveOneSkipped') : t('saveSkipped', { n });

/** "1 alternate recipe", "34 alternate recipes". */
const altCount = (n: number, t: ReturnType<typeof useT>['t']) => (n === 1 ? t('saveAlt') : t('saveAlts', { n }));

/** The first import asks once what to take; Settings › Game save changes it later. */
function Questions({ save, onImport, onClose }: { save: SaveData; onImport: (a: Answers) => void; onClose: () => void }) {
  const { t } = useT();
  const [a, setA] = useState<Answers>(ALL_ANSWERS);
  const v = valuesOf(save);
  const machines = save.buildings.filter((b) => b.kind === 'machine' || b.kind === 'extractor' || b.kind === 'generator').length;
  const rows: { id: keyof Answers; label: StringKey; hint: string }[] = [
    {
      id: 'progress',
      label: 'saveQProgress',
      hint: `${t('tier')} ${v.tier}, ${skippedWords(v.skipped.length, t)}, ${altCount(v.unlocked.length, t)}`,
    },
    { id: 'inventory', label: 'saveQInventory', hint: t('saveQInventoryHint', { sloops: v.sloops, shards: v.shards }) },
    { id: 'factories', label: 'saveQFactories', hint: t('saveMachines', { n: machines }) },
    { id: 'power', label: 'saveQPower', hint: t(save.circuits.length === 1 ? 'saveCircuit' : 'saveCircuits', { n: save.circuits.length }) },
  ];
  return (
    <Dialog
      title={t('saveTakeFrom', { game: save.header.sessionName || save.header.saveName })}
      icon="import"
      className="save-dialog"
      onClose={onClose}
    >
      <div className="save-body">
        {rows.map((r) => (
          <AnswerRow key={r.id} label={t(r.label)} hint={r.hint} on={a[r.id]} onChange={(on) => setA({ ...a, [r.id]: on })} />
        ))}
      </div>
      <div className="save-foot">
        <span className="save-small">{t('saveQFoot')}</span>
        <button type="button" className="primary-button" onClick={() => onImport(a)}>
          {t('saveImportButton')}
        </button>
      </div>
    </Dialog>
  );
}

/** What one side of a refresh says about a field, in words. */
function describe(field: Field, v: Values, other: Values, t: ReturnType<typeof useT>['t']): string {
  switch (field) {
    case 'tier': {
      const off = v.skipped.filter((id) => MILESTONES.some((m) => m.id === id && m.tier <= v.tier)).length;
      return off ? `${t('tier')} ${v.tier} · ${skippedWords(off, t)}` : `${t('tier')} ${v.tier}`;
    }
    case 'recipes': {
      const more = v.unlocked.filter((id) => !other.unlocked.includes(id));
      if (!more.length) return altCount(v.unlocked.length, t);
      const names = more.slice(0, 3).map((id) => recipeById.get(id)?.name ?? id);
      return `+${more.length}: ${names.join(', ')}${more.length > 3 ? '…' : ''}`;
    }
    default:
      return String(v[field]);
  }
}

/** On a refresh, what the player changed since the last import and the game now says otherwise: theirs or the game's, line by line. */
function Conflict({
  step,
  game,
  onRefresh,
  onClose,
}: {
  step: Extract<Step, { at: 'conflict' }>;
  game: string;
  onRefresh: (keep: Field[]) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const [keep, setKeep] = useState<Field[]>([]);
  const yours = mine();
  const theirs = valuesOf(step.save);
  return (
    <Dialog
      title={t('saveRefreshFrom', { game: game || step.save.header.sessionName })}
      icon="reset"
      className="save-dialog wide"
      onClose={onClose}
    >
      <div className="save-body">
        <table className="ov-table save-table">
          <thead>
            <tr>
              <th>{t('saveChanged')}</th>
              <th>{t('saveYours')}</th>
              <th>{t('saveTheirs')}</th>
            </tr>
          </thead>
          <tbody>
            {step.fields.map((f) => (
              <tr key={f}>
                <td data-label={t('saveChanged')}>
                  <b>{t(FIELD_KEY[f])}</b>
                </td>
                <td data-label={t('saveYours')}>
                  <label className="save-radio">
                    <input type="radio" name={f} checked={keep.includes(f)} onChange={() => setKeep([...keep, f])} />
                    {describe(f, yours, theirs, t)}
                  </label>
                </td>
                <td data-label={t('saveTheirs')}>
                  <label className="save-radio">
                    <input type="radio" name={f} checked={!keep.includes(f)} onChange={() => setKeep(keep.filter((x) => x !== f))} />
                    {describe(f, theirs, yours, t)}
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="save-foot">
        <span className="save-small">{t('saveRest')}</span>
        <button type="button" className="primary-button" onClick={() => onRefresh(keep)}>
          {t('saveRefreshButton')}
        </button>
      </div>
    </Dialog>
  );
}

/** What came in, and what did not with a short reason why. */
function Result({ step, onClose }: { step: Extract<Step, { at: 'done' }>; onClose: () => void }) {
  const { t } = useT();
  const { save, taken, kept } = step;
  const v = valuesOf(save);
  const answers = useStore((s) => s.save?.answers) ?? ALL_ANSWERS;
  const map = useStore((s) => s.save?.map);
  const came: [string, string][] = [];
  const not: string[] = [];
  const parts = (c: SaveData['sloops']) =>
    [
      c.free && t('saveFree', { n: c.free }),
      c.inMachines && t('saveInMachines', { n: c.inMachines }),
      c.inDepot && t('saveInDepot', { n: c.inDepot }),
    ]
      .filter(Boolean)
      .join(', ');
  if (taken.includes('tier')) came.push([`${t('tier')} ${v.tier}`, skippedWords(v.skipped.length, t)]);
  if (taken.includes('recipes')) came.push([altCount(v.unlocked.length, t), t('saveAltsOn')]);
  if (taken.includes('sloops')) came.push([t('saveSloops', { n: v.sloops }), parts(save.sloops)]);
  if (taken.includes('shards')) came.push([t('saveShards', { n: v.shards }), parts(save.shards)]);
  if (map) {
    const picked = Object.values(map.picked).reduce((n, l) => n + l.length, 0);
    const n = map.factories.length;
    came.push([
      t('saveMap'),
      [
        picked && t('saveMapPicked', { n: picked }),
        map.miners.length && t(map.miners.length === 1 ? 'saveMapMinedOne' : 'saveMapMined', { n: map.miners.length }),
        n && t(n === 1 ? 'saveMapFactoriesOne' : 'saveMapFactories', { n }),
      ]
        .filter(Boolean)
        .join(', '),
    ]);
    if (map.missed) not.push(t('saveMapMissed', { n: map.missed }));
  }
  for (const f of kept) not.push(t('saveKept', { what: t(FIELD_KEY[f]) }));
  if (!answers.progress) not.push(t('saveLeftOff', { what: t('saveQProgress') }));
  if (!answers.inventory) not.push(t('saveLeftOff', { what: t('saveQInventory') }));
  const unknown = unknownRecipes(save);
  if (unknown.ficsmas) not.push(t('saveFicsmas', { n: unknown.ficsmas }));
  if (unknown.alternates)
    not.push(
      t(unknown.alternates === 1 ? 'saveUnknownAlt' : 'saveUnknownAlts', {
        n: unknown.alternates,
        why: t(save.header.modded ? 'saveWhyMods' : 'saveWhyNewer'),
      }),
    );
  const unread = Object.values(save.unknown).reduce((n, x) => n + x, 0);
  if (unread) not.push(t('saveUnread', { n: unread }));
  return (
    <Dialog
      title={t('saveImported', { game: save.header.sessionName || save.header.saveName })}
      icon="check"
      className="save-dialog"
      onClose={onClose}
    >
      <div className="save-body">
        {came.length > 0 && (
          <>
            <span className="save-label">{t('saveCameIn')}</span>
            <ul className="save-came">
              {came.map(([a, b]) => (
                <li key={a}>
                  <Glyph name="check" size={16} />
                  <span>
                    <b>{a}</b> {b && <span className="save-small">{b}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        {not.length > 0 && (
          <>
            <span className="save-label">{t('saveDidnt')}</span>
            <ul className="save-came not">
              {not.map((a) => (
                <li key={a}>
                  <Glyph name="close" size={16} />
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="save-foot">
        <span />
        <button type="button" className="primary-button" onClick={onClose}>
          {t('saveDone')}
        </button>
      </div>
    </Dialog>
  );
}
