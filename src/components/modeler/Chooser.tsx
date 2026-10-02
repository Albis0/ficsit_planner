import { useEffect, useMemo, useRef, useState } from 'react';
import { data, recipeById, type Stack } from '../../lib/data';
import { useT } from '../../lib/i18n';
import { LOGISTICS, SINK } from '../../lib/model/catalog';
import { CHOICE_TABS, type Choice, type ChoiceTab, choicesFor, choiceWords, type Want } from '../../lib/model/choices';
import { extractorById } from '../../lib/model/ports';
import { recipeLabel, searchKey } from '../../lib/text';
import { Icon } from '../Icon';

/** Rows drawn at once; typing narrows the rest down. */
const SHOWN = 120;

const io = (list: Stack[]) => list.map((s) => <Icon key={s.item} id={s.item} size={20} />);

/**
 * The build menu of a hand-built floor: every recipe, miner, splitter and end that can go down, by tab, with a search.
 * Opened from a belt let go on the floor, it lists only what can take (or give) that belt's item.
 */
export function Chooser({
  want,
  tier,
  marked,
  at,
  onPick,
  onClose,
}: {
  want?: Want;
  tier: number;
  marked?: ReadonlySet<string>;
  /** Where it opens, in the floor's screen coordinates; unset opens it in the middle. */
  at?: { x: number; y: number };
  onPick: (c: Choice) => void;
  onClose: () => void;
}) {
  const { t, name, num } = useT();
  const all = useMemo(() => choicesFor(want, tier, marked), [want, tier, marked]);
  // An input wanting ore or water starts on the miners and pumps.
  const order: ChoiceTab[] =
    want?.side === 'out' && want.item && data.items[want.item]?.raw ? ['raw', 'make', 'logistic', 'io'] : CHOICE_TABS;
  const tabs = order.filter((x) => all.some((c) => c.tab === x));
  const [tab, setTab] = useState<ChoiceTab>(tabs[0] ?? 'make');
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const root = useRef<HTMLDivElement>(null);

  // Typing looks through every tab; the tabs then say how many each has.
  const f = searchKey(q.trim());
  // Names that start with what's typed come first, then names holding it, then what only takes or makes it.
  const found = useMemo(() => {
    if (!f) return all;
    const score = (c: Choice) => {
      const [own, ...rest] = choiceWords(c).map(searchKey);
      if (own?.startsWith(f)) return 0;
      if (own?.includes(f)) return 1;
      return rest.some((w) => w.includes(f)) ? 2 : 3;
    };
    return all
      .map((c) => ({ c, s: score(c) }))
      .filter((x) => x.s < 3)
      .sort((a, b) => a.s - b.s)
      .map((x) => x.c);
  }, [all, f]);
  const shownTab = found.some((c) => c.tab === tab) ? tab : (tabs.find((x) => found.some((c) => c.tab === x)) ?? tab);
  const rows = found.filter((c) => c.tab === shownTab);

  useEffect(() => {
    // A finger gets the list first; the keyboard would cover half of it.
    if (!window.matchMedia('(pointer: coarse)').matches) input.current?.focus();
  }, []);
  useEffect(() => {
    list.current?.children[cursor]?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Next tick, so the click that opened it doesn't close it.
    const id = setTimeout(() => window.addEventListener('pointerdown', close), 0);
    window.addEventListener('keydown', key);
    return () => {
      clearTimeout(id);
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);

  const label = (c: Choice): { icon: string; title: string; sub?: React.ReactNode } => {
    const n = c.init;
    if (n.k === 'machine') {
      const r = recipeById.get(n.recipe);
      if (!r) return { icon: '', title: n.recipe };
      return {
        icon: r.outputs[0]?.item ?? r.machine,
        title: recipeLabel(name(r), r.kind),
        sub: (
          <>
            <span className="chooser-io">
              {io(r.inputs)}
              <span aria-hidden>›</span>
              {io(r.outputs)}
            </span>
            <span className="chooser-machine">{name(data.machines[r.machine])}</span>
            {r.kind !== 'standard' && <span className={`kind ${r.kind}`}>{t(r.kind)}</span>}
          </>
        ),
      };
    }
    if (n.k === 'extract') {
      const e = extractorById.get(n.extractor);
      return { icon: n.item, title: name(data.items[n.item]), sub: e ? name(e) : '' };
    }
    if (n.k === 'logistic') return { icon: LOGISTICS[n.kind].icon, title: LOGISTICS[n.kind].name };
    if (n.k === 'sink') return { icon: SINK.icon, title: SINK.name };
    if (n.k === 'out') return { icon: n.item ?? '', title: t('output'), sub: n.item ? name(data.items[n.item]) : t('anything') };
    if (n.k === 'in') return { icon: n.item ?? '', title: n.item ? name(data.items[n.item]) : '', sub: t('comesIn') };
    return { icon: '', title: '' };
  };

  const pick = (c: Choice | undefined) => c && onPick(c);

  return (
    <div
      className={`chooser ${at ? 'at' : ''}`}
      ref={root}
      role="dialog"
      aria-label={t('addPart')}
      style={at ? { left: at.x, top: at.y } : undefined}
    >
      <header className="chooser-head">
        <input
          ref={input}
          className="picker-search"
          type="text"
          enterKeyHint="go"
          placeholder={want?.item ? t('chooseFor', { item: name(data.items[want.item]) }) : t('searchParts')}
          aria-label={t('searchParts')}
          value={q}
          role="combobox"
          aria-expanded
          aria-controls="chooser-list"
          onChange={(e) => {
            setQ(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, Math.min(rows.length, SHOWN) - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (e.key === 'Enter') pick(rows[cursor]);
          }}
        />
        <button type="button" className="icon-button" aria-label={t('close')} onClick={onClose}>
          ×
        </button>
      </header>
      {tabs.length > 1 && (
        <div className="chooser-tabs" role="tablist">
          {tabs.map((x) => {
            const n = found.filter((c) => c.tab === x).length;
            return (
              <button
                key={x}
                type="button"
                role="tab"
                aria-selected={x === shownTab}
                disabled={n === 0}
                onClick={() => {
                  setTab(x);
                  setCursor(0);
                }}
              >
                {t(`choose_${x}`)}
                {f && <span className="tab-badge">{n}</span>}
              </button>
            );
          })}
        </div>
      )}
      {/* biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: listbox of the combobox above */}
      <ul className="chooser-list" id="chooser-list" role="listbox" ref={list}>
        {rows.length === 0 && <li className="picker-empty">{t('noResults')}</li>}
        {rows.slice(0, SHOWN).map((c, k) => {
          const l = label(c);
          const locked = c.tier > tier;
          return (
            // biome-ignore lint/a11y/useFocusableInteractive: options are reached through aria-activedescendant, not focus.
            <li
              key={c.key}
              // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: an option of the listbox above.
              role="option"
              aria-selected={k === cursor}
              className={`${k === cursor ? 'active' : ''} ${locked ? 'locked' : ''}`}
              onMouseEnter={() => setCursor(k)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
            >
              {l.icon ? <Icon id={l.icon} size={40} /> : <span className="chooser-blank" />}
              <span className="chooser-text">
                <span className="chooser-title">
                  {l.title}
                  {locked && <span className="tier-tag">{t('tierTag', { tier: c.tier })}</span>}
                </span>
                {l.sub && <span className="chooser-sub">{l.sub}</span>}
              </span>
            </li>
          );
        })}
        {rows.length > SHOWN && <li className="picker-empty">{t('moreResults', { n: num(rows.length - SHOWN) })}</li>}
      </ul>
    </div>
  );
}
