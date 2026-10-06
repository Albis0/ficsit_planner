import { useEffect, useMemo, useRef, useState } from 'react';
import { type Item, SPECIAL_ITEMS } from '../lib/data';
import { useT } from '../lib/i18n';
import { laterMatches } from '../lib/later';
import { searchKey } from '../lib/text';
import { Icon } from './Icon';

interface Props {
  items: Item[];
  label: string;
  onPick: (id: string) => void;
  exclude?: string[];
  /** Items left out of the list for being above the tier: a search that finds none of `items` says when these open up. */
  hidden?: Item[];
}

/** A button that unfolds into a searchable item list. Type to filter, arrows to move, Enter to pick. */
export function ItemPicker({ items, label, onPick, exclude = [], hidden }: Props) {
  const { t, name } = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const root = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const f = searchKey(q.trim());
    const skip = new Set(exclude);
    return items
      .filter((i) => !skip.has(i.id))
      .filter((i) => !f || searchKey(name(i)).includes(f))
      .sort((a, b) => Number(SPECIAL_ITEMS.has(a.id)) - Number(SPECIAL_ITEMS.has(b.id)) || name(a).localeCompare(name(b)));
  }, [q, items, exclude, name]);
  const later = useMemo(() => (hidden && q.trim() ? laterMatches(q, hidden, name) : []), [q, hidden, name]);
  // Gear (ammo, equipment, power shards) comes last, under a heading of its own.
  const firstSpecial = matches.findIndex((i) => SPECIAL_ITEMS.has(i.id));

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  useEffect(() => {
    list.current?.querySelectorAll('[role=option]')[cursor]?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const pick = (id: string) => {
    onPick(id);
    setOpen(false);
    setQ('');
  };

  if (!open) {
    return (
      <button type="button" className="add-button" onClick={() => setOpen(true)}>
        <span aria-hidden className="add-plus">
          +
        </span>
        {label}
      </button>
    );
  }

  return (
    <div className="picker" ref={root}>
      <input
        ref={input}
        className="picker-search"
        placeholder={t('searchItems')}
        aria-label={label}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setCursor(0);
        }}
        role="combobox"
        aria-expanded
        aria-controls="picker-list"
        aria-activedescendant={matches[cursor] ? `pick-${matches[cursor].id}` : undefined}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setCursor((c) => Math.min(c + 1, matches.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setCursor((c) => Math.max(c - 1, 0));
          } else if (e.key === 'Enter' && matches[cursor]) {
            pick(matches[cursor].id);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {/* Combobox pattern: focus stays in the search field and aria-activedescendant points at the option. */}
      {/* biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: listbox of the combobox above */}
      <ul className="picker-list" id="picker-list" role="listbox" ref={list}>
        {matches.length === 0 && (
          <li className="picker-empty">
            {later.length
              ? t('notInTierYet', { list: later.map((x) => `${name(x.item)} (${t('tierTag', { tier: x.tier })})`).join(', ') })
              : t('noResults')}
          </li>
        )}
        {matches.map((i, k) => [
          k === firstSpecial && (
            <li key="special" className="picker-heading" role="presentation">
              {t('choose_special')}
            </li>
          ),
          // biome-ignore lint/a11y/useFocusableInteractive: options are reached through aria-activedescendant, not focus.
          <li
            key={i.id}
            id={`pick-${i.id}`}
            // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: an option of the listbox above.
            role="option"
            aria-selected={k === cursor}
            className={k === cursor ? 'active' : undefined}
            onMouseEnter={() => setCursor(k)}
            onMouseDown={(e) => {
              e.preventDefault();
              pick(i.id);
            }}
          >
            <Icon id={i.id} size={38} />
            {name(i)}
          </li>,
        ])}
      </ul>
    </div>
  );
}
