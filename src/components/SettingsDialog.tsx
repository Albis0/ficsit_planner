import { DEFAULT_GAME, GAME_RANGE, type GameRules } from '../lib/game';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { data } from '../lib/data';
import { useT } from '../lib/i18n';
import {
  ACCENTS,
  clampSetting,
  DEFAULT_COLORS,
  DEFAULT_SETTINGS,
  EFFORTS,
  FONTS,
  type LIMITS,
  type PanelSide,
  PLACEMENTS,
  ROUTINGS,
  type Settings,
  sameSettings,
  settingsStyle,
} from '../lib/settings';
import { BELT_COLORS } from '../lib/belts';
import { exportAll, importFile, wipeLocal } from '../lib/backup';
import meta from '../data/meta.json';
import { LATEST_UPDATE, UPDATES } from '../locales/updates.en';
import { useStore } from '../store';
import { RateInput } from './RateInput';
import { Dialog } from './Dialog';
import { Glyph, type GlyphName } from './Glyph';
import { Icon } from './Icon';

type Section = 'layout' | 'floor' | 'colors' | 'interface' | 'game' | 'data' | 'help' | 'updates';

const SECTIONS: { id: Section; glyph: GlyphName }[] = [
  { id: 'layout', glyph: 'layout' },
  { id: 'floor', glyph: 'floor' },
  { id: 'colors', glyph: 'palette' },
  { id: 'interface', glyph: 'sliders' },
  { id: 'game', glyph: 'factory' },
  { id: 'data', glyph: 'database' },
  { id: 'help', glyph: 'help' },
  { id: 'updates', glyph: 'news' },
];

type Dir = 'LR' | 'TB' | undefined;

/**
 * What the dialog edits: a draft of the settings (and the graph direction), shown in the preview
 * but only applied to the app on Save. Changing the interface size live would resize the dialog
 * under the pointer mid-drag.
 */
const Draft = createContext<{ settings: Settings; set: (patch: Partial<Settings>) => void; dir: Dir; setDir: (d: Dir) => void } | null>(
  null,
);

/** Settings: where the panel goes, how the factory floor looks, colours, text size and your data. */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const unseen = useStore((s) => s.seenUpdates !== LATEST_UPDATE);
  // Opened from the dot on the gear: straight to what's new.
  const [section, setSection] = useState<Section>(unseen ? 'updates' : 'layout');
  // On a phone the sections scroll sideways; bring the one it opened on into view.
  const nav = useRef<HTMLElement>(null);
  // In braces: newer browsers return a promise from scrolling, and an effect may only return its clean-up.
  useEffect(() => {
    nav.current?.querySelector('[aria-current]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, []);
  const saved = useStore((s) => s.settings);
  const savedDir = useStore((s) => s.graphDir);
  const setSettings = useStore((s) => s.setSettings);
  const setStore = useStore((s) => s.set);
  const [draft, setDraft] = useState(saved);
  const [dir, setDir] = useState<Dir>(savedDir);
  const [asking, setAsking] = useState(false);
  const dirty = !sameSettings(draft, saved) || dir !== savedDir;
  const save = () => {
    setSettings(draft);
    setStore({ graphDir: dir });
    setAsking(false);
  };
  const discard = () => {
    setDraft(saved);
    setDir(savedDir);
    setAsking(false);
  };
  // Ctrl+S (Cmd+S) saves, like everywhere else.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const titles: Record<Section, string> = {
    layout: t('setLayout'),
    floor: t('setFloor'),
    colors: t('setColors'),
    interface: t('setInterface'),
    game: t('setGame'),
    data: t('setData'),
    help: t('setHelp'),
    updates: t('setUpdates'),
  };

  return (
    <Dialog
      title={t('settings')}
      icon="gear"
      className="settings-dialog"
      onClose={onClose}
      canClose={() => {
        if (!dirty) return true;
        setAsking(true);
        return false;
      }}
    >
      <Draft.Provider value={{ settings: draft, set: (patch) => setDraft((d) => ({ ...d, ...patch })), dir, setDir }}>
        <div className="settings-body">
          <nav className="settings-nav" aria-label={t('settings')} ref={nav}>
            {SECTIONS.map((s) => (
              <button key={s.id} type="button" aria-current={section === s.id ? 'page' : undefined} onClick={() => setSection(s.id)}>
                <Glyph name={s.glyph} size={20} />
                <span>{titles[s.id]}</span>
                {s.id === 'updates' && unseen && <span className="new-dot" role="img" aria-label={t('newUpdates')} />}
              </button>
            ))}
          </nav>
          <div className="settings-main">
            <div className="settings-controls" key={section}>
              <h3 className="settings-heading">{titles[section]}</h3>
              {(section === 'floor' || section === 'colors') && <Preview />}
              {section === 'layout' && <LayoutSection />}
              {section === 'floor' && <FloorSection />}
              {section === 'colors' && <ColorsSection />}
              {section === 'interface' && <InterfaceSection />}
              {section === 'game' && <GameSection />}
              {section === 'data' && <DataSection />}
              {section === 'help' && <HelpSection />}
              {section === 'updates' && <UpdatesSection />}
            </div>
          </div>
        </div>
      </Draft.Provider>
      <footer className="settings-foot" data-state={asking ? 'asking' : dirty ? 'dirty' : 'clean'} aria-live="polite">
        <span className="settings-status">
          <span className="status-dot" aria-hidden />
          {asking ? t('unsavedAsk') : dirty ? t('unsaved') : t('allSaved')}
        </span>
        <span className="settings-actions">
          {asking && (
            <button type="button" className="ghost-button" onClick={() => setAsking(false)}>
              {t('keepEditing')}
            </button>
          )}
          <button
            type="button"
            className="ghost-button"
            disabled={!dirty}
            onClick={() => {
              discard();
              if (asking) onClose();
            }}
          >
            {asking ? t('discardClose') : t('discard')}
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!dirty}
            onClick={() => {
              save();
              if (asking) onClose();
            }}
          >
            <Glyph name="check" size={18} />
            {asking ? t('saveClose') : t('save')}
          </button>
        </span>
      </footer>
    </Dialog>
  );
}

function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const d = useContext(Draft)!;
  return [d.settings, d.set];
}

/**
 * One setting: a label, what it does, and the control. `onReset` null keeps the reset button's place
 * while there's nothing to reset, so the slider beside it doesn't move when it appears.
 */
function Row({
  label,
  hint,
  children,
  onReset,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  onReset?: (() => void) | null;
}) {
  const { t } = useT();
  return (
    <div className="setting">
      <div className="setting-text">
        <span className="setting-label">{label}</span>
        {hint && <span className="setting-hint">{hint}</span>}
      </div>
      <div className="setting-control">
        {onReset !== undefined && (
          <button
            type="button"
            className="setting-reset"
            data-idle={onReset ? undefined : ''}
            tabIndex={onReset ? undefined : -1}
            aria-hidden={onReset ? undefined : true}
            title={t('resetDefault')}
            aria-label={`${t('resetDefault')}: ${label}`}
            onClick={onReset ?? undefined}
          >
            <Glyph name="reset" size={16} />
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

function Choice<T extends string | number>({
  value,
  options,
  onChange,
  label,
  wrap,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  /** Many options: let them wrap onto a second row rather than push the dialog wider. */
  wrap?: boolean;
}) {
  return (
    <div className={`segmented ${wrap ? 'wrap' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.id)} type="button" role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A percentage slider with the number beside it, e.g. card size 70% to 160%. */
function Percent({ k, label, hint }: { k: keyof typeof LIMITS & keyof Settings; label: string; hint?: string }) {
  const [s, set] = useSettings();
  const value = s[k] as number;
  const [lo, hi] = [clampSetting(k, 0), clampSetting(k, 99)];
  const pct = Math.round(value * 100);
  const put = (v: number) => set({ [k]: clampSetting(k, Math.round(v * 100) / 100) } as Partial<Settings>);
  return (
    <Row
      label={label}
      hint={hint}
      onReset={value !== DEFAULT_SETTINGS[k] ? () => set({ [k]: DEFAULT_SETTINGS[k] } as Partial<Settings>) : null}
    >
      <input
        type="range"
        className="setting-range"
        min={Math.round(lo * 100)}
        max={Math.round(hi * 100)}
        step={5}
        value={pct}
        aria-label={label}
        onChange={(e) => put(Number(e.target.value) / 100)}
        style={{ ['--fill' as string]: `${((pct - lo * 100) / ((hi - lo) * 100)) * 100}%` }}
      />
      <output className="setting-value">{pct}%</output>
    </Row>
  );
}

function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="toggle" onClick={() => onChange(!on)}>
      <span className="toggle-knob" />
    </button>
  );
}

/** A miniature of the whole window: which way the panel sits. */
function PanelDiagram({ side }: { side: PanelSide }) {
  return (
    <span className={`panel-diagram ${side}`} aria-hidden>
      <span className="pd-top" />
      <span className="pd-panel" />
      <span className="pd-floor">
        <span />
        <span />
        <span />
      </span>
    </span>
  );
}

function LayoutSection() {
  const { t } = useT();
  const [s, set] = useSettings();
  const { dir: graphDir, setDir } = useContext(Draft)!;
  const sides: { id: PanelSide; label: string }[] = [
    { id: 'top', label: t('panelTop') },
    { id: 'left', label: t('panelLeft') },
    { id: 'right', label: t('panelRight') },
  ];
  return (
    <>
      <div className="setting column">
        <div className="setting-text">
          <span className="setting-label">{t('panelSide')}</span>
          <span className="setting-hint">{t('panelSideHint')}</span>
        </div>
        <div className="panel-sides" role="radiogroup" aria-label={t('panelSide')}>
          {sides.map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={s.panel === o.id}
              className="panel-side"
              onClick={() => set({ panel: o.id })}
            >
              <PanelDiagram side={o.id} />
              <span>{o.label}</span>
            </button>
          ))}
        </div>
      </div>
      <Row label={t('direction')} hint={t('directionHint')}>
        <Choice
          label={t('direction')}
          value={graphDir ?? 'auto'}
          options={[
            { id: 'auto', label: t('auto') },
            { id: 'LR', label: `→ ${t('leftToRight')}` },
            { id: 'TB', label: `↓ ${t('topToBottom')}` },
          ]}
          onChange={(v) => setDir(v === 'auto' ? undefined : v)}
        />
      </Row>
      <Row label={t('summarySize')} hint={t('summarySizeHint')}>
        <Choice
          label={t('summarySize')}
          value={s.summary}
          options={[
            { id: 'compact', label: t('summaryCompact') },
            { id: 'full', label: t('summaryFull') },
          ]}
          onChange={(v) => set({ summary: v })}
        />
      </Row>
    </>
  );
}

/** The multipliers the save was started with, so the numbers match the game. */
function GameSection() {
  const { t } = useT();
  const [s, set] = useSettings();
  const row = (k: keyof GameRules, label: string, hint: string) => (
    <Row
      label={label}
      hint={hint}
      onReset={s.game[k] !== DEFAULT_GAME[k] ? () => set({ game: { ...s.game, [k]: DEFAULT_GAME[k] } }) : null}
    >
      <span className="game-mult">
        <RateInput
          value={s.game[k]}
          label={label}
          onChange={(v) => v >= GAME_RANGE.min && v <= GAME_RANGE.max && set({ game: { ...s.game, [k]: Math.round(v * 1000) / 1000 } })}
        />
        <span className="unit">×</span>
      </span>
    </Row>
  );
  return (
    <>
      <p className="setting-hint game-intro">{t('gameIntro')}</p>
      {row('parts', t('gameParts'), t('gamePartsHint'))}
      {row('power', t('gamePower'), t('gamePowerHint'))}
      {row('elevator', t('gameElevator'), t('gameElevatorHint'))}
    </>
  );
}

function FloorSection() {
  const { t } = useT();
  const [s, set] = useSettings();
  return (
    <>
      <Percent k="cardScale" label={t('cardSize')} hint={t('cardSizeHint')} />
      <Percent k="textScale" label={t('textSize')} hint={t('textSizeHint')} />
      <Percent k="spacing" label={t('spacing')} hint={t('spacingHint')} />
      <Row label={t('splitLines')} hint={t('splitLinesHint')}>
        <Choice
          label={t('splitLines')}
          value={s.splitLines}
          options={[
            { id: 'each', label: t('splitLinesEach') },
            { id: 'one', label: t('splitLinesOne') },
          ]}
          onChange={(v) => set({ splitLines: v })}
        />
      </Row>
      <Row label={t('beltLabels')} hint={t('beltLabelsHint')}>
        <Choice
          label={t('beltLabels')}
          value={s.beltLabels}
          options={[
            { id: 'auto', label: t('auto') },
            { id: 'always', label: t('always') },
            { id: 'never', label: t('never') },
          ]}
          onChange={(v) => set({ beltLabels: v })}
        />
      </Row>
      <Row label={t('beltMotion')} hint={t('beltMotionHint')}>
        <Toggle label={t('beltMotion')} on={s.beltMotion} onChange={(v) => set({ beltMotion: v })} />
      </Row>
      <Row label={t('gridLines')} hint={t('gridLinesHint')}>
        <Toggle label={t('gridLines')} on={s.gridLines} onChange={(v) => set({ gridLines: v })} />
      </Row>
      <Row label={t('addWith')} hint={t('addWithHint')}>
        <Choice
          label={t('addWith')}
          value={s.addWith}
          options={[
            { id: 'right', label: t('addWithRight') },
            { id: 'double', label: t('addWithDouble') },
          ]}
          onChange={(v) => set({ addWith: v })}
        />
      </Row>
      <Row label={t('layoutPlacement')} hint={t('layoutPlacementHint')}>
        <Choice
          label={t('layoutPlacement')}
          wrap
          value={s.layoutPlacement}
          options={PLACEMENTS.map((p) => ({ id: p, label: t(`placement_${p}`) }))}
          onChange={(v) => set({ layoutPlacement: v })}
        />
      </Row>
      <Row label={t('edgeRouting')} hint={t('edgeRoutingHint')}>
        <Choice
          label={t('edgeRouting')}
          value={s.edgeRouting}
          options={ROUTINGS.map((r) => ({ id: r, label: t(`routing_${r}`) }))}
          onChange={(v) => set({ edgeRouting: v })}
        />
      </Row>
      <Row label={t('layoutEffort')} hint={t('layoutEffortHint')}>
        <Choice
          label={t('layoutEffort')}
          value={s.layoutEffort}
          options={EFFORTS.map((e) => ({ id: e, label: t(`effort_${e}`) }))}
          onChange={(v) => set({ layoutEffort: v })}
        />
      </Row>
    </>
  );
}

function ColorPick({ k, label }: { k: keyof Settings['colors']; label: string }) {
  const [s, set] = useSettings();
  const value = s.colors[k];
  return (
    <Row label={label} onReset={value !== DEFAULT_COLORS[k] ? () => set({ colors: { ...s.colors, [k]: DEFAULT_COLORS[k] } }) : null}>
      <label className="color-pick" style={{ ['--swatch' as string]: value }}>
        <input type="color" value={value} aria-label={label} onChange={(e) => set({ colors: { ...s.colors, [k]: e.target.value } })} />
        <code>{value.toUpperCase()}</code>
      </label>
    </Row>
  );
}

function ColorsSection() {
  const { t } = useT();
  const [s, set] = useSettings();
  return (
    <>
      <Row label={t('accent')} hint={t('accentHint')}>
        <div className="swatches" role="radiogroup" aria-label={t('accent')}>
          {ACCENTS.map((a) => (
            <button
              key={a.value}
              type="button"
              role="radio"
              aria-checked={s.colors.accent === a.value}
              className="swatch"
              title={a.name}
              aria-label={a.name}
              style={{ ['--swatch' as string]: a.value }}
              onClick={() =>
                set({
                  colors: { ...s.colors, accent: a.value, standard: s.colors.standard === s.colors.accent ? a.value : s.colors.standard },
                })
              }
            />
          ))}
          <label
            className="swatch custom"
            title={t('custom')}
            data-checked={!ACCENTS.some((a) => a.value === s.colors.accent) || undefined}
            style={{ ['--swatch' as string]: s.colors.accent }}
          >
            <input
              type="color"
              value={s.colors.accent}
              aria-label={t('custom')}
              onChange={(e) => set({ colors: { ...s.colors, accent: e.target.value } })}
            />
            <Glyph name="plus" size={16} />
          </label>
        </div>
      </Row>
      <ColorPick k="standard" label={t('standardStrip')} />
      <ColorPick k="alternate" label={t('alternateStrip')} />
      <ColorPick k="converter" label={t('converterStrip')} />
      <ColorPick k="power" label={t('powerColor')} />
      <Row label={t('beltColors')} hint={t('beltColorsHint')}>
        <Choice
          label={t('beltColors')}
          value={s.beltColors}
          options={[
            { id: 'tier', label: t('byTier') },
            { id: 'one', label: t('oneColor') },
          ]}
          onChange={(v) => set({ beltColors: v })}
        />
      </Row>
      <div className="setting-foot">
        <button
          type="button"
          className="text-button"
          // Nothing to reset while every colour is the default.
          disabled={
            s.beltColors === 'tier' &&
            (Object.keys(DEFAULT_COLORS) as (keyof Settings['colors'])[]).every((k) => s.colors[k] === DEFAULT_COLORS[k])
          }
          onClick={() => set({ colors: DEFAULT_COLORS, beltColors: 'tier' })}
        >
          {t('resetColors')}
        </button>
      </div>
    </>
  );
}

type HelpKey = Parameters<ReturnType<typeof useT>['t']>[0];

/** What each word on screen means: term (as the app labels it) and a plain explanation. */
const HELP: { title: HelpKey; terms: [HelpKey, HelpKey][] }[] = [
  {
    title: 'helpBasics',
    terms: [
      ['helpModes', 'helpText_modes'],
      ['tier', 'helpText_tier'],
      ['helpSaved', 'helpText_saved'],
      ['codex', 'helpText_codex'],
      ['worldMap', 'helpText_map'],
    ],
  },
  {
    title: 'helpFactory',
    terms: [
      ['targets', 'helpText_targets'],
      ['suppliesTitle', 'helpText_supplies'],
      ['takeFromFactory', 'helpText_take'],
      ['rawInput', 'helpText_rawInput'],
      ['inventory', 'helpText_inventory'],
      ['useAll', 'helpText_useAll'],
      ['share', 'helpText_share'],
      ['recipes', 'helpText_recipes'],
      ['resources', 'helpText_resources'],
      ['surplus', 'helpText_surplus'],
      ['helpBelts', 'helpText_belts'],
      ['clockSpeed', 'helpText_clock'],
    ],
  },
  {
    title: 'helpPower',
    terms: [
      ['byHave', 'helpText_byHave'],
      ['byWant', 'helpText_byWant'],
      ['byFactories', 'helpText_byFactories'],
      ['fixCount', 'helpText_fixCount'],
      ['headroom', 'helpText_headroom'],
      ['otherLoad', 'helpText_otherLoad'],
      ['helpOwnLoad', 'helpText_ownLoad'],
      ['covers', 'helpText_covers'],
      ['forTheGrid', 'helpText_forTheGrid'],
      ['helpMakesNeeds', 'helpText_makesNeeds'],
      ['moreOptions', 'helpText_backup'],
    ],
  },
];

/** A glossary of the app, searchable, for words like "spare capacity" that don't explain themselves. */
function HelpSection() {
  const { t } = useT();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const groups = HELP.map((g) => ({
    ...g,
    terms: g.terms.filter(([term, text]) => !q || `${t(term)} ${t(text)}`.toLowerCase().includes(q)),
  })).filter((g) => g.terms.length);
  return (
    <div className="help">
      <input
        className="search"
        type="search"
        placeholder={t('helpFilter')}
        aria-label={t('helpFilter')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {groups.map((g) => (
        <section key={g.title} className="help-group">
          <h4 className="help-title">{t(g.title)}</h4>
          <dl className="help-list">
            {g.terms.map(([term, text]) => (
              <div key={term} className="help-term">
                <dt>{t(term)}</dt>
                <dd>{t(text)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      {groups.length === 0 && <p className="hint">{t('codexNoHits')}</p>}
    </div>
  );
}

/** A few plain lines per version, newest first. Opening it clears the dot on the gear. */
function UpdatesSection() {
  const { t } = useT();
  const set = useStore((s) => s.set);
  useEffect(() => {
    set({ seenUpdates: LATEST_UPDATE });
  }, [set]);
  return (
    <div className="updates">
      {UPDATES.map((u) => (
        <section key={u.version} className="update">
          <h4 className="update-title">
            {u.version} <time dateTime={u.date}>{u.date}</time>
          </h4>
          <ul className="update-notes">
            {u.notes.map(([kind, text]) => (
              <li key={text}>
                <span className={`update-tag ${kind}`}>{t(`update_${kind}`)}</span>
                {text}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="update-made">
        FICSIT Planner {LATEST_UPDATE} · {t('madeWith')}
      </p>
    </div>
  );
}

function InterfaceSection() {
  const { t } = useT();
  const [s, set] = useSettings();
  return (
    <>
      <div className="setting column">
        <div className="setting-text">
          <span className="setting-label">{t('font')}</span>
          <span className="setting-hint">{t('fontHint')}</span>
        </div>
        <div className="font-choices" role="radiogroup" aria-label={t('font')}>
          {FONTS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={s.font === f.id}
              className="font-choice"
              style={{ ['--font-display' as string]: f.display, ['--font-body' as string]: f.body }}
              onClick={() => set({ font: f.id })}
            >
              <span className="font-sample">FICSIT 1,234.5</span>
              <span className="font-name">{f.name}</span>
            </button>
          ))}
        </div>
      </div>
      <Percent k="uiScale" label={t('uiSize')} hint={t('uiSizeHint')} />
      <Row label={t('showLockedSetting')} hint={t('showLockedSettingHint')}>
        <Toggle label={t('showLockedSetting')} on={s.showLocked} onChange={(v) => set({ showLocked: v })} />
      </Row>
      <Row label={t('decimals')} hint={t('decimalsHint', { example: (100 / 3).toFixed(s.decimals) })}>
        <Choice
          label={t('decimals')}
          value={s.decimals}
          options={[0, 1, 2, 3].map((n) => ({ id: n, label: String(n) }))}
          onChange={(v) => set({ decimals: v })}
        />
      </Row>
      <Row label={t('motion')} hint={t('motionHint')}>
        <Choice
          label={t('motion')}
          value={s.motion}
          options={[
            { id: 'system', label: t('motionSystem') },
            { id: 'reduce', label: t('motionReduce') },
            { id: 'full', label: t('motionFull') },
          ]}
          onChange={(v) => set({ motion: v })}
        />
      </Row>
    </>
  );
}

function DataSection() {
  const { t } = useT();
  const { settings, set, dir, setDir } = useContext(Draft)!;
  const file = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string }>();
  const [wipe, setWipe] = useState(false);

  return (
    <>
      <Row label={t('exportPlans')} hint={t('exportHint')}>
        <button type="button" className="ghost-button" onClick={exportAll}>
          <Glyph name="download" size={18} />
          {t('exportFile')}
        </button>
      </Row>
      <Row label={t('importPlans')} hint={t('importHint')}>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            const r = await importFile(f);
            if (!r.ok) return setNote({ ok: false, text: t('importFailed') });
            const added = r.count === 0 ? t('importedNone') : r.count === 1 ? t('importedOne') : t('imported', { count: r.count });
            const plants = r.power === 0 ? '' : r.power === 1 ? t('importedPlant') : t('importedPlants', { count: r.power });
            const settings = r.settings === 'loaded' ? t('importedSettings') : r.settings === 'kept' ? t('importSettingsKept') : '';
            setNote({ ok: true, text: [added, plants, settings].filter(Boolean).join(' ') });
          }}
        />
        <button type="button" className="ghost-button" onClick={() => file.current?.click()}>
          <Glyph name="upload" size={18} />
          {t('importFile')}
        </button>
      </Row>
      {note && (
        <p className={`setting-note ${note.ok ? 'ok' : 'bad'}`} role="status">
          {note.text}
        </p>
      )}
      <Row label={t('resetSettings')} hint={t('resetSettingsHint')}>
        <button
          type="button"
          className="ghost-button"
          disabled={sameSettings(settings, DEFAULT_SETTINGS) && dir === undefined}
          onClick={() => {
            set(DEFAULT_SETTINGS);
            setDir(undefined);
          }}
        >
          <Glyph name="reset" size={18} />
          {t('reset')}
        </button>
      </Row>
      <Row label={t('wipeAll')} hint={t('wipeHint')}>
        <button
          type="button"
          className={`ghost-button ${wipe ? 'danger' : ''}`}
          onBlur={() => setWipe(false)}
          onClick={() => {
            if (!wipe) return setWipe(true);
            wipeLocal();
            location.reload();
          }}
        >
          <Glyph name="trash" size={18} />
          {wipe ? t('wipeConfirm') : t('wipe')}
        </button>
      </Row>
      <p className="hint data-version">
        {t('dataFrom')} Satisfactory {meta.gameVersion} (build {meta.changelist}), {meta.extractedAt}
      </p>
    </>
  );
}

const recipe = (id: string) => data.recipes.find((r) => r.id === id)!;

/**
 * A patch of factory floor drawn with the live settings: two machines and the belt between them. The screws also go
 * out as a product, so the split setting shows too: a card for each place, or one card with a note.
 */
function Preview() {
  const { t, name, num } = useT();
  const [s] = useSettings();
  const screws = recipe('Recipe_Alternate_Screw_C');
  const plates = recipe('Recipe_IronPlateReinforced_C');
  const belt = s.beltColors === 'one' ? BELT_COLORS[0] : BELT_COLORS[1];
  const card = (r: typeof screws, n: number, clock: number, note?: string) => (
    <div className={`machine-node ${r.kind}`}>
      <div className="machine-strip">
        <Icon id={r.outputs[0].item} size={30} className="strip-icon" />
        <span className="machine-product">{name(r).replace(/^[^:]+:\s*/, '')}</span>
      </div>
      <div className="machine-body">
        <Icon id={r.machine} size={60} className="machine-icon" />
        <span className="machine-info">
          <span className="machine-type">{name(data.machines[r.machine])}</span>
          <span className="machine-run">
            <span>
              <b>{n}</b>
              <span className="times">×</span>
              {num(clock * 100)}%
            </span>
          </span>
          <span className="machine-mods">
            <span className="machine-draw">
              {num(r.power * n)}
              <small>MW</small>
            </span>
          </span>
          {note && <span className="mod-badge split">{note}</span>}
        </span>
      </div>
    </div>
  );
  return (
    <figure
      className="settings-preview"
      aria-label={t('preview')}
      data-belt-motion={s.beltMotion ? undefined : 'off'}
      style={settingsStyle(s)}
    >
      <figcaption>{t('preview')}</figcaption>
      <div className={`preview-floor ${s.gridLines ? 'lines' : ''}`}>
        <div className={`preview-stage ${s.splitLines === 'each' ? 'split' : ''}`}>
          {s.splitLines === 'each' ? (
            <div className="preview-card a preview-split">
              {card(screws, 1, 1, t('splitTo', { to: name(plates) }))}
              {card(screws, 1, 1, t('splitTo', { to: t('productLabel') }))}
            </div>
          ) : (
            <div className="preview-card a">{card(screws, 2, 1, t('splitShort', { sizes: '1 + 1' }))}</div>
          )}
          <svg className="preview-belt" viewBox="0 0 240 20" aria-hidden>
            <g className="belt-edge" style={{ ['--belt' as string]: belt, ['--belt-speed' as string]: '1s' }}>
              <path d="M0,10 L240,10" className="belt-rails" style={{ strokeWidth: 12 }} />
              <path d="M0,10 L240,10" className="belt-bed" style={{ strokeWidth: 7 }} />
              <path d="M0,10 L240,10" className="belt-slats" style={{ strokeWidth: 7 }} />
            </g>
          </svg>
          {s.beltLabels !== 'never' && (
            <div className="preview-label">
              <div className="edge-label">
                <Icon id="Desc_IronScrew_C" size={30} />
                <span className="edge-text">
                  <span className="edge-item">{name(data.items.Desc_IronScrew_C)}</span>
                  <span className="edge-meta">
                    <span className="edge-rate">
                      {num(s.splitLines === 'each' ? 50 : 100)}
                      {t('perMin')}
                    </span>
                    <span className="edge-tier" style={{ background: belt }}>
                      {data.belts[1].name}
                    </span>
                  </span>
                </span>
              </div>
            </div>
          )}
          <div className="preview-card b">{card(plates, 4, 1)}</div>
        </div>
      </div>
    </figure>
  );
}
