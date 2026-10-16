import { lockWords, skipKey } from '../lib/unlocks';
import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { data, recipeLock, recipeTier, recipeUnlocked, type Recipe, type RecipeKind, type Stack } from '../lib/data';
import { useT } from '../lib/i18n';
import { recipeLabel, searchKey } from '../lib/text';
import { MAX_TIER, useStore, useTier } from '../store';
import { Glyph } from './Glyph';
import { Icon } from './Icon';
import { Slot } from './Slot';

type Filter = 'all' | RecipeKind;

const tiers = Array.from({ length: MAX_TIER + 1 }, (_, i) => i);

const optionalKind = (r: Recipe) => r.kind === 'alternate' || r.kind === 'converter';

interface Props {
  /** The recipes that are on, in the list being edited. */
  enabled: string[];
  onToggle: (id: string) => void;
  onSet: (ids: string[], on: boolean) => void;
  /** The All page's list: alternate and converter recipes only, and the tier is set in the top bar. */
  optionalOnly?: boolean;
  /** More buttons at the end of the row under the kinds. */
  extra?: ReactNode;
}

/** Recipes grouped by what they make, each with a tick: the list a factory uses, or the one every new factory starts with. */
export function RecipeBrowser({ enabled, onToggle: toggle, onSet: setRecipes, optionalOnly, extra }: Props) {
  const { t, name, num } = useT();
  const tier = useTier();
  const set = useStore((s) => s.set);
  const [filter, setFilter] = useState<Filter>('alternate');
  const [q, setQ] = useState('');
  const [asked, setShowLocked] = useState(false);
  // Off in Settings, what the tier can't use stays out entirely; on, it waits behind a button here.
  const allowed = useStore((s) => s.settings.showLocked);
  const showLocked = allowed && asked;

  const on = useMemo(() => new Set(enabled), [enabled]);

  // Group by main product so every way to make screws sits together.
  // biome-ignore lint/correctness/useExhaustiveDependencies: skipKey() changes when the milestones bought do
  const listed = useMemo(() => {
    const f = searchKey(q.trim());
    const match = (r: Recipe) =>
      !f || searchKey(name(r)).includes(f) || [...r.inputs, ...r.outputs].some((s) => searchKey(name(data.items[s.item])).includes(f));
    const map = new Map<string, Recipe[]>();
    let hidden = 0;
    for (const r of data.recipes) {
      if (optionalOnly && !optionalKind(r)) continue;
      if (filter !== 'all' && r.kind !== filter) continue;
      if (!match(r)) continue;
      // Recipes the player can't use yet stay out of the way unless asked for.
      if (!showLocked && !recipeUnlocked(r, tier)) {
        hidden++;
        continue;
      }
      const key = r.outputs[0].item;
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    const sorted = [...map].sort(([a], [b]) => name(data.items[a]).localeCompare(name(data.items[b])));
    // A search that finds nothing under this filter may still find standard or converter recipes.
    const elsewhere =
      f && filter !== 'all' && sorted.length === 0
        ? data.recipes.filter((r) => (!optionalOnly || optionalKind(r)) && match(r) && (showLocked || recipeUnlocked(r, tier))).length
        : 0;
    return { groups: sorted, hidden, elsewhere };
  }, [filter, q, name, showLocked, tier, optionalOnly, skipKey()]);
  const { groups, hidden, elsewhere } = listed;

  // Bulk buttons leave recipes above the tier alone; those can't be picked one by one either.
  const visibleIds = groups.flatMap(([, rs]) => rs.filter((r) => recipeUnlocked(r, tier)).map((r) => r.id));
  const visibleOn = visibleIds.filter((id) => on.has(id)).length;

  const stacks = (list: Stack[]) => list.map((s) => <Slot key={s.item} id={s.item} rate={s.rate} size={46} />);

  // A card that a product's list carries over to the top of the next column lines up with the cards under the
  // headings beside it, instead of sitting a heading higher.
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = list.current;
    if (!box) return;
    const align = () => {
      const conts = [...box.querySelectorAll<HTMLElement>('.recipe-cont')];
      for (const c of conts) c.style.paddingTop = '';
      const lead = box.querySelector<HTMLElement>('.recipe-lead');
      const card = lead?.querySelector<HTMLElement>('.recipe-row');
      if (!lead || !card || getComputedStyle(box).columnWidth === 'auto') return;
      const gap = Number.parseFloat(getComputedStyle(card).marginTop) || 0;
      const drop = card.getBoundingClientRect().top - lead.getBoundingClientRect().top - gap;
      const top = () => box.getBoundingClientRect().top;
      // Pushing one card down can carry another to a column top; a few passes settle it.
      for (let pass = 0; pass < 4; pass++) {
        const t = top();
        const fresh = conts.filter((c) => !c.style.paddingTop && Math.abs(c.getBoundingClientRect().top - t) < 2);
        if (fresh.length === 0) break;
        for (const c of fresh) c.style.paddingTop = `${drop}px`;
      }
    };
    align();
    const watch = new ResizeObserver(align);
    watch.observe(box);
    return () => watch.disconnect();
  });

  const row = (r: Recipe) => {
    const lock = recipeLock(r, tier);
    const locked = !!lock;
    return (
      <label
        key={r.id}
        className={`recipe-row ${on.has(r.id) ? 'on' : ''} ${locked ? 'locked' : ''}`}
        title={lock ? lockWords(lock, t) : undefined}
      >
        <input type="checkbox" checked={on.has(r.id)} disabled={locked} onChange={() => toggle(r.id)} />
        <span className="recipe-main">
          <span className="recipe-name">
            {recipeLabel(name(r), r.kind)}
            {r.kind !== 'standard' && (
              <span className={`kind ${r.kind}`} title={t(r.kind)}>
                <span className="when-wide">{t(r.kind)}</span>
                <span className="when-narrow">{r.kind === 'alternate' ? t('altShort') : t('converterShort')}</span>
              </span>
            )}
            {(r.tier !== undefined || r.kind === 'alternate') && (
              <span className="recipe-tier" title={locked ? t('aboveTier') : undefined}>
                T{recipeTier(r)}
              </span>
            )}
          </span>
          <span className="recipe-io">
            <span className="io-in">{stacks(r.inputs)}</span>
            <span className="io-arrow" aria-hidden>
              ›
            </span>
            <span className="io-out">{stacks(r.outputs)}</span>
          </span>
          <span className="recipe-machine">
            <Icon id={r.machine} size={20} />
            {name(data.machines[r.machine])}
            <span className="recipe-duration">
              {num(r.duration)} {t('seconds')}
            </span>
          </span>
        </span>
      </label>
    );
  };

  const kinds: Filter[] = optionalOnly ? ['alternate', 'converter', 'all'] : ['alternate', 'standard', 'converter', 'all'];

  return (
    <div className="panel-body recipes">
      <div className="recipe-tools">
        <label className="search-box">
          <Glyph name="search" size={20} />
          <input
            className="search"
            type="search"
            placeholder={t('searchRecipes')}
            aria-label={t('searchRecipes')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        {!optionalOnly && (
          <div className="tier-picker">
            <span className="control-label" title={t('unlockedTier')}>
              <span className="when-wide">{t('unlockedTier')}</span>
              <span className="when-narrow">{t('tierShort')}</span>
            </span>
            <div className="tier-steps" role="radiogroup" aria-label={t('unlockedTier')}>
              {tiers.map((step) => (
                <button
                  key={step}
                  type="button"
                  role="radio"
                  aria-checked={tier === step}
                  className={step <= tier ? 'reached' : undefined}
                  onClick={() => set({ tier: step })}
                >
                  {step}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="segmented" role="radiogroup" aria-label={t('recipes')}>
          {kinds.map((f) => (
            <button key={f} type="button" role="radio" aria-checked={filter === f} onClick={() => setFilter(f)}>
              {t(f)}
            </button>
          ))}
        </div>
        <div className="bulk">
          <span className="bulk-count">
            {visibleOn}/{visibleIds.length} {t('enabledCount')}
          </span>
          <button
            type="button"
            className="text-button"
            disabled={visibleOn === visibleIds.length}
            onClick={() => setRecipes(visibleIds, true)}
          >
            {t('enableAll')}
          </button>
          <button type="button" className="text-button" disabled={visibleOn === 0} onClick={() => setRecipes(visibleIds, false)}>
            {t('disableAll')}
          </button>
          {extra}
        </div>
      </div>

      <div className="recipe-list">
        {groups.length === 0 && hidden === 0 && elsewhere === 0 && <p className="hint">{t('noResults')}</p>}
        {elsewhere > 0 && (
          <p className="hint">
            {t('noKindResults', { kind: t(filter).toLocaleLowerCase() })}{' '}
            <button type="button" className="text-button" onClick={() => setFilter('all')}>
              {t('showAllMatches', { n: elsewhere })}
            </button>
          </p>
        )}
        {/* Columns as many as fit across, as tall as they need: the list scrolls down, never sideways. */}
        <div className="recipe-flow" ref={list}>
          {groups.map(([item, rs]) => (
            <section key={item} className="recipe-group">
              {/* The heading and the first card stay together, so a heading never ends a column on its own. */}
              <div className="recipe-lead">
                <h3 className="section-title with-icon">
                  <Icon id={item} size={22} />
                  {name(data.items[item])}
                </h3>
                {row(rs[0])}
              </div>
              {rs.slice(1).map((r) => (
                <div key={r.id} className="recipe-cont">
                  {row(r)}
                </div>
              ))}
            </section>
          ))}
        </div>
        {allowed && (hidden > 0 || showLocked) && (
          <p className="hint locked-note">
            {!showLocked && `${t('lockedHidden', { n: hidden })} `}
            <button type="button" className="text-button" onClick={() => setShowLocked(!showLocked)}>
              {showLocked ? t('hideLocked') : t('showLocked')}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
