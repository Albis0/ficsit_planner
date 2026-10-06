import { useEffect, useMemo, useState } from 'react';
import { CATEGORIES, type CodexIndex, GUIDE_ICON, GUIDES, type Page, pageKey, parsePage, search, useCodex } from '../lib/codex';
import { useT } from '../lib/i18n';
import { useStore } from '../store';
import { GuidePage } from './CodexGuides';
import { Glyph } from './Glyph';
import { Icon } from './Icon';
import { CATEGORY_ICON, categoryOf, countOf, Home, CategoryPage, remember } from './codex/browse';
import { ItemPage } from './codex/ItemPage';
import { BuildingPage } from './codex/BuildingPage';
import { CreaturePage, VehiclePage } from './codex/OtherPages';
import { SchematicPage } from './codex/SchematicPage';
import { CodexLink } from './codex/route';
export { CodexLink, goCodex, useCodexRoute } from './codex/route';

/** The Codex's side panel: a search over every page, and the categories. */
export function CodexNav() {
  const { t } = useT();
  const index = useCodex();
  const page = parsePage(useStore((s) => s.codexPage));
  const [query, setQuery] = useState('');
  const guides = useMemo(
    () => GUIDES.map((id) => ({ page: { kind: 'guide', id } as Page, name: t(`guide_${id}`), icon: GUIDE_ICON[id] })),
    [t],
  );
  const hits = useMemo(() => (index ? search(index, query, guides) : []), [index, query, guides]);
  const current = categoryOf(page, index);

  return (
    <div className="panel-body codex-nav">
      <div className="codex-nav-head">
        <CodexLink page={{ kind: 'home' }} className="codex-home-link">
          <Glyph name="book" size={22} />
          {t('codex')}
        </CodexLink>
        <input
          className="search"
          type="search"
          placeholder={t('codexSearch')}
          aria-label={t('codexSearch')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {query.trim() ? (
        <ul className="codex-hits">
          {hits.map((e) => (
            <li key={pageKey(e.page)}>
              <CodexLink page={e.page} className="codex-hit">
                {e.icon ? <Icon id={e.icon} size={32} /> : <span className="codex-hit-blank" />}
                <span className="codex-hit-name">{e.name}</span>
                <span className="codex-hit-kind">{t(`pageKind_${e.page.kind}` as 'pageKind_item')}</span>
              </CodexLink>
            </li>
          ))}
          {index && hits.length === 0 && <li className="hint codex-none">{t('codexNoHits')}</li>}
        </ul>
      ) : (
        <nav className="codex-cats" aria-label={t('codex')}>
          {CATEGORIES.map((c) => (
            <CodexLink key={c} page={{ kind: 'cat', id: c }} className={`codex-cat${current === c ? ' current' : ''}`}>
              <Icon id={CATEGORY_ICON[c]} size={34} />
              <span className="codex-cat-name">{t(`cat_${c}`)}</span>
              {index && <span className="codex-cat-count">{countOf(c, index)}</span>}
            </CodexLink>
          ))}
        </nav>
      )}
    </div>
  );
}

/** The page on the floor. */

export function CodexPage() {
  const { t } = useT();
  const index = useCodex();
  const key = useStore((s) => s.codexPage);
  const page = parsePage(key);
  useEffect(() => {
    if (key && page.kind !== 'cat') remember(key);
  }, [key, page.kind]);
  if (!index) return <div className="floor-message">{t('codexLoading')}</div>;
  return (
    <div className="codex-scroll" key={key}>
      <article className="codex-page">
        <Crumbs page={page} index={index} />
        {page.kind === 'home' && <Home index={index} />}
        {page.kind === 'cat' && <CategoryPage cat={page.id} index={index} />}
        {page.kind === 'item' && <ItemPage id={page.id} index={index} />}
        {page.kind === 'building' && <BuildingPage id={page.id} index={index} />}
        {page.kind === 'vehicle' && <VehiclePage id={page.id} index={index} />}
        {page.kind === 'schematic' && <SchematicPage id={page.id} index={index} />}
        {page.kind === 'guide' && <GuidePage id={page.id} />}
        {page.kind === 'creature' && <CreaturePage id={page.id} index={index} />}
      </article>
    </div>
  );
}

function Crumbs({ page, index }: { page: Page; index: CodexIndex }) {
  const { t } = useT();
  if (page.kind === 'home') return null;
  const cat = categoryOf(page, index);
  return (
    <nav className="codex-crumbs" aria-label={t('codex')}>
      <CodexLink page={{ kind: 'home' }}>{t('codex')}</CodexLink>
      {cat && page.kind !== 'cat' && (
        <>
          <span aria-hidden>›</span>
          <CodexLink page={{ kind: 'cat', id: cat }}>{t(`cat_${cat}`)}</CodexLink>
        </>
      )}
    </nav>
  );
}
