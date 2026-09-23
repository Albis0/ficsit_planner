import { useEffect, useMemo, useRef, useState } from 'react';
import type { Item } from '../lib/data';
import { useT } from '../lib/i18n';
import { Icon } from './Icon';

interface Props {
  items: Item[];
  label: string;
  onPick: (id: string) => void;
  exclude?: string[];
}

const fold = (s: string) => s.toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');

/** A button that unfolds into a searchable item list. Type to filter, arrows to move, Enter to pick. */
export function ItemPicker({ items, label, onPick, exclude = [] }: Props) {
  const { t, name } = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const root = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const f = fold(q.trim());
    const skip = new Set(exclude);
    return items
      .filter((i) => !skip.has(i.id))
      .filter((i) => !f || fold(i.nameTr).includes(f) || fold(i.name).includes(f))
      .sort((a, b) => name(a).localeCompare(name(b)));
  }, [q, items, exclude, name]);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  useEffect(() => setCursor(0), [q]);

  useEffect(() => {
    list.current?.children[cursor]?.scrollIntoView({ block: 'nearest' });
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
        <span aria-hidden className="add-plus">+</span>
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
        value={q}
        onChange={(e) => setQ(e.target.value)}
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
      <ul className="picker-list" id="picker-list" role="listbox" ref={list}>
        {matches.length === 0 && <li className="picker-empty">{t('noResults')}</li>}
        {matches.map((i, k) => (
          <li
            key={i.id}
            id={`pick-${i.id}`}
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
          </li>
        ))}
      </ul>
    </div>
  );
}
