import { type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  CATEGORIES,
  type Category,
  type CodexIndex,
  type Entry,
  funFacts,
  GUIDE_ICON,
  GUIDES,
  loadCodex,
  nameOf,
  type Page,
  pageKey,
  pageOf,
  parsePage,
  partSource,
  recipesFor,
  type Schematic,
  schematicIcon,
  search,
  useCodex,
} from '../lib/codex';
import { type Cost, data, generatorById, type Recipe, recipeTier } from '../lib/data';
import { PURITIES, PURITY } from '../lib/extraction';
import { useT } from '../lib/i18n';
import { fuelRate } from '../lib/power';
import { recipeLabel, searchKey } from '../lib/text';
import { useStore } from '../store';
import { GuidePage } from './CodexGuides';
import { Glyph } from './Glyph';
import { Icon } from './Icon';

const HASH = '#codex';

/** Opens a Codex page, as a new step in the browser's history so Back returns to the last one. */
export function goCodex(page: Page) {
  const key = pageKey(page);
  const hash = key ? `${HASH}/${key}` : HASH;
  if (location.hash !== hash) history.pushState(null, '', hash);
  useStore.getState().set({ mode: 'codex', codexPage: key, pane: 'floor', inspect: undefined });
}

/**
 * Keeps the address and the Codex in step: #codex/item/Desc_Motor_C opens that page (a shared link,
 * or Back and Forward), and leaving the Codex clears it again.
 */
export function useCodexRoute() {
  const mode = useStore((s) => s.mode);
  const page = useStore((s) => s.codexPage);
  useEffect(() => {
    const read = () => {
      if (!location.hash.startsWith(HASH)) return;
      const key = pageKey(parsePage(location.hash.slice(HASH.length + 1)));
      // A link to a page opens on the page, also on phones where the index might be showing.
      useStore.getState().set({ mode: 'codex', codexPage: key, ...(key ? { pane: 'floor' as const } : {}) });
    };
    read();
    window.addEventListener('popstate', read);
    window.addEventListener('hashchange', read);
    return () => {
      window.removeEventListener('popstate', read);
      window.removeEventListener('hashchange', read);
    };
  }, []);
  useEffect(() => {
    const hash = page ? `${HASH}/${page}` : HASH;
    if (mode === 'codex' && location.hash !== hash) history.replaceState(null, '', hash);
    if (mode !== 'codex' && location.hash.startsWith(HASH)) history.replaceState(null, '', location.pathname + location.search);
  }, [mode, page]);
  // Warm the file up once the planner has settled, so the first visit opens at once.
  useEffect(() => {
    const id = setTimeout(() => loadCodex(), 4000);
    return () => clearTimeout(id);
  }, []);
}

/** A link to a Codex page: a real link (so it opens in a new tab too), handled in place on a plain click. */
export function CodexLink({ page, className, children, title }: { page: Page; className?: string; children: ReactNode; title?: string }) {
  const key = pageKey(page);
  // The page on screen: marked, so a press that stays put reads as intended.
  const here = useStore((s) => s.mode === 'codex' && s.codexPage === key);
  return (
    <a
      className={className}
      href={key ? `${HASH}/${key}` : HASH}
      title={title}
      aria-current={here ? 'page' : undefined}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        goCodex(page);
      }}
    >
      {children}
    </a>
  );
}

/** The category a page belongs to, for the index to mark. */
function categoryOf(page: Page, index: CodexIndex | undefined): Category | undefined {
  if (page.kind === 'cat') return page.id;
  if (page.kind === 'guide') return 'guides';
  if (page.kind === 'building') return 'buildings';
  if (page.kind === 'vehicle') return 'vehicles';
  if (!index) return undefined;
  if (page.kind === 'item') {
    const kind = index.data.items[page.id]?.kind;
    return kind === 'resource' ? 'resources' : kind === 'part' ? 'parts' : 'equipment';
  }
  if (page.kind === 'schematic') {
    const type = index.schematic.get(page.id)?.type;
    return type === 'mam' ? 'research' : type === 'alternate' ? 'alternates' : type === 'shop' ? 'shop' : 'milestones';
  }
  return undefined;
}

/** Picture for each category, from the game itself. */
const CATEGORY_ICON: Record<Category, string> = {
  parts: 'Desc_Motor_C',
  resources: 'Desc_OreIron_C',
  buildings: 'Build_ManufacturerMk1_C',
  vehicles: 'Desc_Truck_C',
  equipment: 'BP_EquipmentDescriptorJetPack_C',
  milestones: 'Build_TradingPost_C',
  research: 'Build_Mam_C',
  alternates: 'Desc_HardDrive_C',
  shop: 'Desc_ResourceSinkCoupon_C',
  guides: 'Desc_CrystalShard_C',
};

/** The Codex's own entries in a category, grouped under headings. */
function categoryGroups(cat: Category, index: CodexIndex, t: ReturnType<typeof useT>['t']): { title: string; entries: Entry[] }[] {
  const { data: codex } = index;
  const byName = (a: Entry, b: Entry) => a.name.localeCompare(b.name);
  const groupBy = (entries: Entry[], key: (e: Entry) => string, order?: string[]) => {
    const groups = new Map<string, Entry[]>();
    for (const e of entries) {
      const k = key(e);
      groups.set(k, [...(groups.get(k) ?? []), e]);
    }
    const keys = order ? order.filter((k) => groups.has(k)) : [...groups.keys()].sort();
    return keys.map((k) => ({ title: k, entries: groups.get(k)!.sort(byName) }));
  };
  const items = (kinds: string[]) =>
    Object.entries(codex.items)
      .filter(([, it]) => kinds.includes(it.kind))
      .map(([id, it]) => ({
        page: { kind: 'item', id } as Page,
        name: it.name,
        icon: id,
        note: it.sink ? `${it.sink} ${t('pointsShort')}` : undefined,
      }));
  const schematics = (type: Schematic['type'] | Schematic['type'][]) =>
    codex.schematics
      .filter((s) => (Array.isArray(type) ? type.includes(s.type) : s.type === type))
      .map((s) => ({ page: { kind: 'schematic', id: s.id } as Page, name: s.name, icon: schematicIcon(s, codex), s }));

  switch (cat) {
    case 'parts': {
      const tierOf = (e: Entry) => {
        const id = (e.page as { id: string }).id;
        if (id.startsWith('Desc_SpaceElevatorPart')) return t('groupElevator');
        const source = partSource(id, index);
        if (!source) return t('groupFound');
        return 'tier' in source ? t('tierN', { tier: source.tier }) : t('groupMam');
      };
      const order = [...Array.from({ length: 10 }, (_, i) => t('tierN', { tier: i })), t('groupMam'), t('groupElevator'), t('groupFound')];
      return groupBy(items(['part']), tierOf, order);
    }
    case 'resources':
      return [{ title: '', entries: items(['resource']).sort(byName) }];
    case 'equipment':
      return groupBy(
        items(['equipment', 'ammo', 'consumable']),
        (e) => t(`kind_${codex.items[(e.page as { id: string }).id].kind}` as 'kind_equipment'),
        [t('kind_equipment'), t('kind_ammo'), t('kind_consumable')],
      );
    case 'buildings': {
      const entries = Object.entries(codex.buildings).map(([id, b]) => ({
        page: { kind: 'building', id } as Page,
        name: b.name,
        icon: id,
        g: b.group,
      }));
      const order = ['production', 'extraction', 'power', 'logistics', 'fluids', 'storage', 'transport', 'special'] as const;
      return order
        .map((g) => ({ title: t(`group_${g}`), entries: entries.filter((e) => e.g === g).sort(byName) }))
        .filter((g) => g.entries.length);
    }
    case 'vehicles':
      return [
        {
          title: '',
          entries: Object.entries(codex.vehicles)
            .map(([id, v]) => ({ page: { kind: 'vehicle', id } as Page, name: v.name, icon: id }))
            .sort(byName),
        },
      ];
    case 'milestones': {
      const list = schematics(['hub', 'milestone']);
      const tiers = [...new Set(list.map((e) => e.s.tier))].sort((a, b) => a - b);
      return tiers.map((tier) => ({
        title: tier === 0 ? t('groupHub') : t('tierN', { tier }),
        entries: list
          .filter((e) => e.s.tier === tier)
          .map((e) => ({ ...e, note: e.s.time ? t('minutesShort', { n: Math.round(e.s.time / 60) }) : undefined })),
      }));
    }
    case 'research':
      return groupBy(schematics('mam'), (e) => index.schematic.get((e.page as { id: string }).id)?.group ?? '');
    case 'alternates': {
      // Grouped by the building the recipe runs in, the way you'd look for a better one.
      const list = schematics('alternate').map((e) => {
        const recipe = e.s.unlocks.map((u) => data.recipes.find((r) => r.id === u)).find(Boolean);
        return { ...e, machine: recipe ? nameOf(recipe.machine, codex) : t('groupOther') };
      });
      const machines = [...new Set(list.map((e) => e.machine))].sort();
      return machines.map((m) => ({ title: m, entries: list.filter((e) => e.machine === m).sort(byName) }));
    }
    case 'shop':
      return groupBy(
        schematics('shop').map((e) => ({
          ...e,
          note: t('couponsN', { n: e.s.cost.find((c) => c.item === 'Desc_ResourceSinkCoupon_C')?.amount ?? 0 }),
        })),
        (e) => index.schematic.get((e.page as { id: string }).id)?.group ?? '',
      );
    case 'guides':
      return [
        {
          title: '',
          entries: GUIDES.map((id) => ({
            page: { kind: 'guide', id } as Page,
            name: t(`guide_${id}`),
            icon: GUIDE_ICON[id],
            note: t(`guideSub_${id}`),
          })),
        },
      ];
  }
}

function countOf(cat: Category, index: CodexIndex): number {
  const { data: codex } = index;
  const items = (kinds: string[]) => Object.values(codex.items).filter((it) => kinds.includes(it.kind)).length;
  const schematics = (types: string[]) => codex.schematics.filter((s) => types.includes(s.type)).length;
  switch (cat) {
    case 'parts':
      return items(['part']);
    case 'resources':
      return items(['resource']);
    case 'equipment':
      return items(['equipment', 'ammo', 'consumable']);
    case 'buildings':
      return Object.keys(codex.buildings).length;
    case 'vehicles':
      return Object.keys(codex.vehicles).length;
    case 'milestones':
      return schematics(['hub', 'milestone']);
    case 'research':
      return schematics(['mam']);
    case 'alternates':
      return schematics(['alternate']);
    case 'shop':
      return schematics(['shop']);
    case 'guides':
      return GUIDES.length;
  }
}

/** The Codex's side panel: a search over every page, and the categories. */
export function CodexNav() {
  const { t } = useT();
  const index = useCodex();
  const page = parsePage(useStore((s) => s.codexPage));
  const [query, setQuery] = useState('');
  const hits = useMemo(() => (index ? search(index, query) : []), [index, query]);
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

function Home({ index }: { index: CodexIndex }) {
  const { t } = useT();
  const facts = useMemo(() => funFacts(index), [index]);
  // A different pair of facts each day.
  const day = Math.floor(Date.now() / 864e5);
  const shown = [facts[day % facts.length], facts[(day + 1) % facts.length]];
  return (
    <>
      <header className="codex-hero">
        <h2 className="codex-title">{t('codexTitle')}</h2>
        <p className="codex-lead">{t('codexLead')}</p>
      </header>
      <div className="codex-cat-grid">
        {CATEGORIES.map((c) => (
          <CodexLink key={c} page={{ kind: 'cat', id: c }} className="codex-cat-card">
            <Icon id={CATEGORY_ICON[c]} size={64} />
            <span className="codex-cat-card-name">{t(`cat_${c}`)}</span>
            <span className="codex-cat-card-sub">{t(`catSub_${c}`)}</span>
            <span className="codex-cat-card-count">{countOf(c, index)}</span>
          </CodexLink>
        ))}
      </div>
      <section className="codex-section">
        <h3 className="codex-h">{t('didYouKnow')}</h3>
        <div className="codex-facts">
          {shown.map((f) => (
            <CodexLink key={f.key} page={f.page} className="codex-fact">
              {t(f.key as 'factSink', f.vars)}
            </CodexLink>
          ))}
        </div>
      </section>
    </>
  );
}

function CategoryPage({ cat, index }: { cat: Category; index: CodexIndex }) {
  const { t } = useT();
  const groups = useMemo(() => categoryGroups(cat, index, t), [cat, index, t]);
  const [filter, setFilter] = useState('');
  const q = searchKey(filter.trim());
  const shown = q
    ? groups.map((g) => ({ ...g, entries: g.entries.filter((e) => searchKey(e.name).includes(q)) })).filter((g) => g.entries.length)
    : groups;
  return (
    <>
      <header className="codex-cat-head">
        <Icon id={CATEGORY_ICON[cat]} size={72} />
        <div>
          <h2 className="codex-title">{t(`cat_${cat}`)}</h2>
          <p className="codex-lead">{t(`catLead_${cat}`)}</p>
        </div>
        {countOf(cat, index) > 20 && (
          <input
            className="search codex-filter"
            type="search"
            placeholder={t('codexFilter')}
            aria-label={t('codexFilter')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        )}
      </header>
      {shown.map((g) => (
        <section key={g.title || 'all'} className="codex-section">
          {g.title && <h3 className="codex-h">{g.title}</h3>}
          <div className={`codex-tiles${cat === 'guides' ? ' wide' : ''}`}>
            {g.entries.map((e) => (
              <Tile key={pageKey(e.page)} entry={e} />
            ))}
          </div>
        </section>
      ))}
      {shown.length === 0 && <p className="hint">{t('codexNoHits')}</p>}
    </>
  );
}

function Tile({ entry }: { entry: Entry }) {
  return (
    <CodexLink page={entry.page} className="codex-tile">
      <span className="slot">{entry.icon ? <Icon id={entry.icon} size={40} /> : null}</span>
      <span className="codex-tile-text">
        <span className="codex-tile-name">{entry.name}</span>
        {entry.note && <span className="codex-tile-note">{entry.note}</span>}
      </span>
    </CodexLink>
  );
}

/** Title block: the big icon, name, what kind of thing it is, key figures and the game's own words. */
function Head({
  icon,
  name,
  tag,
  stats,
  desc,
  actions,
}: {
  icon?: string;
  name: string;
  tag: string;
  stats: [string, ReactNode][];
  desc?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="codex-head">
      <span className="slot codex-head-icon">{icon && <Icon id={icon} size={88} />}</span>
      <div className="codex-head-main">
        <span className="codex-tag">{tag}</span>
        <h2 className="codex-title">{name}</h2>
        {stats.length > 0 && (
          <dl className="codex-stats">
            {stats.map(([label, value]) => (
              <div key={label} className="codex-stat">
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {actions && <div className="codex-actions">{actions}</div>}
      {desc && (
        <blockquote className="codex-desc">
          {desc.split('\n\n').map((p) => (
            <p key={p}>{p}</p>
          ))}
        </blockquote>
      )}
    </header>
  );
}

function Section({ title, children, count }: { title: string; children: ReactNode; count?: number }) {
  return (
    <section className="codex-section">
      <h3 className="codex-h">
        {title}
        {count !== undefined && <span className="codex-h-count">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

/** An item as a slot with its amount, linking to its page. */
function Amount({ item, amount, unit, index }: { item: string; amount?: number; unit?: string; index: CodexIndex }) {
  const { num } = useT();
  const page = pageOf(item, index.data);
  const name = nameOf(item, index.data);
  const body = (
    <>
      <span className="slot">
        <Icon id={item} size={34} />
      </span>
      <span className="codex-amount-text">
        {amount !== undefined && (
          <b>
            {num(amount)}
            {unit && <small>{unit}</small>}
          </b>
        )}
        <span>{name}</span>
      </span>
    </>
  );
  return page ? (
    <CodexLink page={page} className="codex-amount" title={name}>
      {body}
    </CodexLink>
  ) : (
    <span className="codex-amount" title={name}>
      {body}
    </span>
  );
}

function Amounts({ list, index, unit }: { list: Cost[]; index: CodexIndex; unit?: string }) {
  return (
    <div className="codex-amounts">
      {list.map((c) => (
        <Amount key={c.item} item={c.item} amount={c.amount} unit={unit} index={index} />
      ))}
    </div>
  );
}

/** One way of making something: ingredients, results, where, how long and how much power. */
/** `build`: the item a "Build with this recipe" button makes a factory for. */
function RecipeCard({ recipe, index, build }: { recipe: Recipe; index: CodexIndex; build?: string }) {
  const { t, num } = useT();
  const buildable = build && data.items[build] && !data.items[build].raw;
  const unlock = index.data.recipeUnlock[recipe.id];
  const s = unlock ? index.schematic.get(unlock) : undefined;
  const fluid = (item: string) => data.items[item]?.form !== 'solid';
  const perMin = (list: Recipe['inputs']) =>
    list.map((x) => ({ item: x.item, amount: x.rate, unit: fluid(x.item) ? t('m3PerMin') : t('perMin') }));
  return (
    <div className={`codex-recipe ${recipe.kind}`}>
      <div className="codex-recipe-head">
        <span className="codex-recipe-name">{recipeLabel(recipe.name, recipe.kind)}</span>
        {recipe.kind === 'alternate' && <span className="codex-pill alt">{t('alternate')}</span>}
        {index.data.handCraft.includes(recipe.id) && <span className="codex-pill">{t('handCraft')}</span>}
        {buildable && (
          <button
            type="button"
            className="text-button codex-build"
            title={t('buildWithHint')}
            onClick={() => useStore.getState().buildFactory(build, nameOf(build, index.data), recipe.id)}
          >
            <Glyph name="factory" size={16} />
            {t('buildWith')}
          </button>
        )}
      </div>
      <div className="codex-recipe-flow">
        <div className="codex-amounts">
          {perMin(recipe.inputs).map((x) => (
            <Amount key={x.item} {...x} index={index} />
          ))}
        </div>
        <span className="codex-arrow" aria-hidden>
          →
        </span>
        <div className="codex-amounts">
          {perMin(recipe.outputs).map((x) => (
            <Amount key={x.item} {...x} index={index} />
          ))}
        </div>
      </div>
      <div className="codex-recipe-foot">
        <CodexLink page={{ kind: 'building', id: recipe.machine }} className="codex-machine">
          <Icon id={recipe.machine} size={24} />
          {nameOf(recipe.machine, index.data)}
        </CodexLink>
        <span>{t('secondsN', { n: num(recipe.duration) })}</span>
        <span>
          {recipe.powerRange ? `${num(recipe.powerRange[0])}–${num(recipe.powerRange[1])}` : num(recipe.power)} {t('mw')}
        </span>
        <span>{t('tierN', { tier: recipeTier(recipe) })}</span>
        {s && s.type !== 'milestone' && s.type !== 'hub' && (
          <CodexLink page={{ kind: 'schematic', id: s.id }} className="codex-unlock">
            {s.type === 'alternate' ? t('fromHardDrive') : s.type === 'mam' ? t('fromMam', { tree: s.group ?? '' }) : s.name}
          </CodexLink>
        )}
      </div>
    </div>
  );
}

function UnlockLine({ id, index }: { id: string | undefined; index: CodexIndex }) {
  const { t } = useT();
  const s = id ? index.schematic.get(id) : undefined;
  if (!s) return null;
  return (
    <p className="codex-unlock-line">
      {t('unlockedBy')} <CodexLink page={{ kind: 'schematic', id: s.id }}>{s.name}</CodexLink>
      <span className="codex-unlock-where">{schematicWhere(s, t)}</span>
    </p>
  );
}

function schematicWhere(s: Schematic, t: ReturnType<typeof useT>['t']): string {
  if (s.type === 'milestone') return t('whereMilestone', { tier: s.tier });
  if (s.type === 'hub') return t('whereHub');
  if (s.type === 'mam') return t('whereMam', { tree: s.group ?? '' });
  if (s.type === 'alternate') return t('whereHardDrive');
  return t('whereShop');
}

function ItemPage({ id, index }: { id: string; index: CodexIndex }) {
  const { t, num } = useT();
  const buildFactory = useStore((s) => s.buildFactory);
  const buildPlant = useStore((s) => s.buildPlant);
  const it = index.data.items[id];
  if (!it) return <p className="hint">{t('codexMissing')}</p>;
  const planned = data.items[id];
  const recipes = recipesFor(id);
  const uses = (index.usedIn.get(id) ?? []).filter((r) => r.kind !== 'power');
  const burners = data.generators.filter((g) => g.fuels.some((f) => f.item === id));
  const built = index.builtWith.get(id) ?? [];
  const paid = index.paidWith.get(id) ?? [];
  const sold = index.soldAs.get(id) ?? [];
  const crafts = index.data.crafts[id] ?? [];
  const extractors =
    it.kind === 'resource' ? data.extractors.filter((e) => (e.resources.length ? e.resources.includes(id) : it.form === 'solid')) : [];
  const source = partSource(id, index);
  const fluidUnit = it.form !== 'solid';
  const stats: [string, ReactNode][] = [];
  if (source) stats.push('tier' in source ? [t('statTier'), source.tier] : [t('statResearch'), source.mam]);
  if (it.stack) stats.push([t('statStack'), num(it.stack)]);
  if (it.sink) stats.push([t('statSink'), `${num(it.sink)} ${t('pointsShort')}`]);
  if (it.energy) stats.push([t('statEnergy'), `${num(it.energy)} MJ`]);
  if (it.radioactive) stats.push([t('statRadioactive'), t('yes')]);
  if (it.kind === 'resource' && data.worldLimits[id] !== undefined)
    stats.push([t('statWorld'), data.worldLimits[id] === null ? t('unlimited') : `${num(data.worldLimits[id]!)}${t('perMin')}`]);
  const tag = it.kind === 'part' ? (fluidUnit ? t(`form_${it.form}`) : t('kind_part')) : t(`kind_${it.kind}`);
  const canPlan = !!planned && !planned.raw && recipes.length > 0;

  return (
    <>
      <Head
        icon={id}
        name={it.name}
        tag={tag}
        stats={stats}
        desc={it.desc}
        actions={
          canPlan || burners.length ? (
            <>
              {canPlan && (
                <button type="button" className="primary-button" title={t('buildFactoryHint')} onClick={() => buildFactory(id, it.name)}>
                  <Glyph name="factory" size={18} />
                  {t('buildFactory')}
                </button>
              )}
              {burners.length > 0 && (
                <button type="button" className="ghost-button" title={t('burnThisHint')} onClick={() => buildPlant(burners[0].id, id)}>
                  <Glyph name="bolt" size={18} />
                  {t('burnThis')}
                </button>
              )}
            </>
          ) : undefined
        }
      />
      {extractors.length > 0 && (
        <Section title={t('howToGet')}>
          <table className="codex-table">
            <thead>
              <tr>
                <th>{t('extractor')}</th>
                {PURITIES.map((p) => (
                  <th key={p}>{t(p)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {extractors.map((e) => (
                <tr key={e.id}>
                  <td>
                    <CodexLink page={{ kind: 'building', id: e.id }} className="codex-machine">
                      <Icon id={e.id} size={24} />
                      {e.name}
                    </CodexLink>
                  </td>
                  {PURITIES.map((p) => (
                    <td key={p}>{e.purity ? num(e.rate * PURITY[p]) : p === 'normal' ? num(e.rate) : '–'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">{t('extractorNote', { unit: fluidUnit ? t('unitM3') : t('unitItems') })}</p>
        </Section>
      )}
      {recipes.length > 0 && (
        <Section title={t('howToMake')} count={recipes.length}>
          <div className="codex-recipes">
            {recipes.map((r) => (
              <RecipeCard key={r.id} recipe={r} index={index} build={canPlan ? id : undefined} />
            ))}
          </div>
        </Section>
      )}
      {crafts.length > 0 && (
        <Section title={t('craftedAt')}>
          {crafts.map((c) => (
            <div key={c.id} className="codex-craft">
              <Amounts list={c.inputs} index={index} />
              <span className="codex-arrow" aria-hidden>
                →
              </span>
              <Amount item={id} amount={c.amount} index={index} />
              <UnlockLine id={c.unlock} index={index} />
            </div>
          ))}
        </Section>
      )}
      {burners.length > 0 && (
        <Section title={t('burnedIn')}>
          <table className="codex-table">
            <thead>
              <tr>
                <th>{t('generator')}</th>
                <th>{t('mw')}</th>
                <th>{t('burns')}</th>
                <th>{t('waterUse')}</th>
              </tr>
            </thead>
            <tbody>
              {burners.map((g) => {
                const rate = fuelRate(g, id);
                const water = g.supplement ? (g.power * 60 * g.supplementRatio) / 1000 : 0;
                return (
                  <tr key={g.id}>
                    <td>
                      <CodexLink page={{ kind: 'building', id: g.id }} className="codex-machine">
                        <Icon id={g.id} size={24} />
                        {g.name}
                      </CodexLink>
                    </td>
                    <td>{num(g.power)}</td>
                    <td>
                      {num(rate)}
                      {fluidUnit ? t('m3PerMin') : t('perMin')}
                    </td>
                    <td>{water ? `${num(water)}${t('m3PerMin')}` : '–'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
      )}
      {uses.length > 0 && (
        <Section title={t('usedToMake')} count={uses.length}>
          <div className="codex-uses">
            {uses
              .sort((a, b) => a.outputs[0].item.localeCompare(b.outputs[0].item))
              .map((r) => (
                <CodexLink key={r.id} page={{ kind: 'item', id: r.outputs[0].item }} className="codex-use">
                  <Icon id={r.outputs[0].item} size={30} />
                  <span className="codex-use-name">{recipeLabel(r.name, r.kind)}</span>
                  {r.kind === 'alternate' && <span className="codex-pill alt">{t('altShort')}</span>}
                  <span className="codex-use-rate">
                    {num(r.inputs.find((x) => x.item === id)!.rate)}
                    {fluidUnit ? t('m3PerMin') : t('perMin')}
                  </span>
                </CodexLink>
              ))}
          </div>
        </Section>
      )}
      {built.length > 0 && (
        <Section title={t('usedToBuild')} count={built.length}>
          <div className="codex-amounts wrap">
            {built
              .sort((a, b) => b.amount - a.amount)
              .map((b) => (
                <CodexLink key={pageKey(b.page)} page={b.page} className="codex-amount">
                  <span className="slot">
                    <Icon id={(b.page as { id: string }).id} size={34} />
                  </span>
                  <span className="codex-amount-text">
                    <b>× {num(b.amount)}</b>
                    <span>{nameOf((b.page as { id: string }).id, index.data)}</span>
                  </span>
                </CodexLink>
              ))}
          </div>
        </Section>
      )}
      {paid.length > 0 && (
        <Section title={t('paidInto')} count={paid.length}>
          <div className="codex-uses">
            {paid.map((p) => {
              const s = index.schematic.get(p.id)!;
              return (
                <CodexLink key={p.id} page={{ kind: 'schematic', id: p.id }} className="codex-use">
                  <Icon id={schematicIcon(s, index.data) ?? id} size={30} />
                  <span className="codex-use-name">{s.name}</span>
                  <span className="codex-use-where">{schematicWhere(s, t)}</span>
                  <span className="codex-use-rate">× {num(p.amount)}</span>
                </CodexLink>
              );
            })}
          </div>
        </Section>
      )}
      {sold.length > 0 && (
        <Section title={t('soldInShop')}>
          <div className="codex-uses">
            {sold.map((p) => {
              const s = index.schematic.get(p.id)!;
              const coupons = s.cost.find((c) => c.item === 'Desc_ResourceSinkCoupon_C')?.amount ?? 0;
              return (
                <CodexLink key={p.id} page={{ kind: 'schematic', id: p.id }} className="codex-use">
                  <Icon id="Desc_ResourceSinkCoupon_C" size={30} />
                  <span className="codex-use-name">{t('shopDeal', { n: num(p.amount), coupons })}</span>
                </CodexLink>
              );
            })}
          </div>
        </Section>
      )}
    </>
  );
}

function BuildingPage({ id, index }: { id: string; index: CodexIndex }) {
  const { t, num } = useT();
  const b = index.data.buildings[id];
  if (!b) return <p className="hint">{t('codexMissing')}</p>;
  const machine = data.machines[id];
  const generator = generatorById.get(id);
  const extractor = data.extractors.find((e) => e.id === id);
  const recipes = data.recipes.filter((r) => r.machine === id && r.kind !== 'power');
  const stats: [string, ReactNode][] = [];
  const tier = machine?.tier ?? generator?.tier ?? extractor?.tier;
  if (tier !== undefined) stats.push([t('statTier'), tier]);
  for (const [k, v] of b.stats ?? []) stats.push([t(`stat_${k}`), `${num(v)}${t(`statUnit_${k}`)}`]);
  if (machine?.variable) {
    const ranges = recipes.map((r) => r.powerRange).filter(Boolean) as [number, number][];
    if (ranges.length)
      stats.push([
        t('stat_power'),
        `${num(Math.min(...ranges.map((r) => r[0])))}–${num(Math.max(...ranges.map((r) => r[1])))}${t('statUnit_power')}`,
      ]);
  }
  if (generator?.kind === 'geothermal')
    stats.push([t('stat_makes'), t('geyserRange', { impure: generator.power / 2, pure: generator.power * 2 })]);
  if (generator?.kind === 'augmenter') stats.push([t('stat_makes'), `${num(generator.power)}${t('statUnit_power')}`]);

  return (
    <>
      <Head icon={id} name={b.name} tag={t(`group_${b.group}`)} stats={stats} desc={b.desc} />
      {(b.cost || b.unlock) && (
        <Section title={t('buildCost')}>
          {b.cost && <Amounts list={b.cost} index={index} />}
          <UnlockLine id={b.unlock} index={index} />
        </Section>
      )}
      {extractor && (
        <Section title={t('extractionRates')}>
          <table className="codex-table">
            <thead>
              <tr>
                <th>{t('clock')}</th>
                {extractor.purity ? PURITIES.map((p) => <th key={p}>{t(p)}</th>) : <th>{t('rate')}</th>}
              </tr>
            </thead>
            <tbody>
              {[1, 1.5, 2, 2.5].map((c) => (
                <tr key={c}>
                  <td>{num(c * 100)}%</td>
                  {extractor.purity ? (
                    PURITIES.map((p) => <td key={p}>{num(extractor.rate * PURITY[p] * c)}</td>)
                  ) : (
                    <td>{num(extractor.rate * c)}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">
            {extractor.resources.length
              ? t('extractsThese', { list: extractor.resources.map((r) => nameOf(r, index.data)).join(', ') })
              : t('extractsSolids')}
          </p>
        </Section>
      )}
      {generator && generator.kind === 'fuel' && (
        <Section title={t('fuelsTitle')}>
          <table className="codex-table">
            <thead>
              <tr>
                <th>{t('fuel')}</th>
                <th>{t('burns')}</th>
                <th>{t('waterUse')}</th>
                <th>{t('waste')}</th>
              </tr>
            </thead>
            <tbody>
              {generator.fuels.map((f) => {
                const rate = fuelRate(generator, f.item);
                const fluid = data.items[f.item]?.form !== 'solid';
                const water = generator.supplement ? (generator.power * 60 * generator.supplementRatio) / 1000 : 0;
                return (
                  <tr key={f.item}>
                    <td>
                      <CodexLink page={{ kind: 'item', id: f.item }} className="codex-machine">
                        <Icon id={f.item} size={24} />
                        {nameOf(f.item, index.data)}
                      </CodexLink>
                    </td>
                    <td>
                      {num(rate)}
                      {fluid ? t('m3PerMin') : t('perMin')}
                    </td>
                    <td>{water ? `${num(water)}${t('m3PerMin')}` : '–'}</td>
                    <td>
                      {f.byproduct && f.byproductAmount
                        ? `${num(rate * f.byproductAmount)}${t('perMin')} ${nameOf(f.byproduct, index.data)}`
                        : '–'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="hint">{t('fuelsNote', { mw: num(generator.power) })}</p>
        </Section>
      )}
      {generator?.kind === 'augmenter' && generator.booster && (
        <Section title={t('augmenterTitle')}>
          <p className="codex-text">
            {t('augmenterText', {
              boost: num((generator.boost ?? 0) * 100),
              fed: num((generator.booster.boost + (generator.boost ?? 0)) * 100),
              item: nameOf(generator.booster.item, index.data),
              seconds: num(generator.booster.duration),
            })}
          </p>
        </Section>
      )}
      {machine && machine.somersloopSlots > 0 && (
        <Section title={t('sloopTitle')}>
          <p className="codex-text">{t('sloopText', { n: machine.somersloopSlots })}</p>
          <CodexLink page={{ kind: 'guide', id: 'sloops' }} className="text-button">
            {t('readGuide')}
          </CodexLink>
        </Section>
      )}
      {recipes.length > 0 && (
        <Section title={t('runsRecipes')} count={recipes.length}>
          <div className="codex-uses">
            {[...recipes]
              .sort((a, b) => Number(a.kind === 'alternate') - Number(b.kind === 'alternate') || a.name.localeCompare(b.name))
              .map((r) => (
                <CodexLink key={r.id} page={{ kind: 'item', id: r.outputs[0].item }} className="codex-use">
                  <Icon id={r.outputs[0].item} size={30} />
                  <span className="codex-use-name">{recipeLabel(r.name, r.kind)}</span>
                  {r.kind === 'alternate' && <span className="codex-pill alt">{t('altShort')}</span>}
                  {r.kind === 'converter' && <span className="codex-pill conv">{t('converter')}</span>}
                  <span className="codex-use-rate">
                    {num(r.outputs[0].rate)}
                    {data.items[r.outputs[0].item]?.form !== 'solid' ? t('m3PerMin') : t('perMin')}
                  </span>
                </CodexLink>
              ))}
          </div>
        </Section>
      )}
    </>
  );
}

function VehiclePage({ id, index }: { id: string; index: CodexIndex }) {
  const { t, num } = useT();
  const v = index.data.vehicles[id];
  if (!v) return <p className="hint">{t('codexMissing')}</p>;
  const stats: [string, ReactNode][] = [];
  if (v.slots) stats.push([v.fluid ? t('statTank') : t('stat_slots'), num(v.slots)]);
  return (
    <>
      <Head icon={id} name={v.name} tag={t('kind_vehicle')} stats={stats} desc={v.desc} />
      {(v.cost || v.unlock) && (
        <Section title={t('buildCost')}>
          {v.cost && <Amounts list={v.cost} index={index} />}
          <UnlockLine id={v.unlock} index={index} />
        </Section>
      )}
    </>
  );
}

function SchematicPage({ id, index }: { id: string; index: CodexIndex }) {
  const { t, num } = useT();
  const s = index.schematic.get(id);
  if (!s) return <p className="hint">{t('codexMissing')}</p>;
  const recipes = s.unlocks.map((u) => data.recipes.find((r) => r.id === u)).filter(Boolean) as Recipe[];
  const others = s.unlocks.filter((u) => !recipes.some((r) => r.id === u));
  const stats: [string, ReactNode][] = [];
  if (s.type === 'milestone' || s.type === 'hub') stats.push([t('statTier'), s.tier]);
  if (s.group) stats.push([s.type === 'mam' ? t('statTree') : t('statShelf'), s.group]);
  if (s.time) stats.push([t('statTime'), s.time >= 60 ? t('minutesShort', { n: num(s.time / 60) }) : t('secondsN', { n: num(s.time) })]);
  const standard = s.type === 'alternate' && recipes[0] ? recipesFor(recipes[0].outputs[0].item).filter((r) => r.kind === 'standard') : [];
  const tagKey = {
    hub: 'schem_hub',
    milestone: 'schem_milestone',
    mam: 'schem_mam',
    alternate: 'schem_alternate',
    shop: 'schem_shop',
  } as const;

  return (
    <>
      <Head icon={schematicIcon(s, index.data)} name={s.name} tag={t(tagKey[s.type])} stats={stats} />
      {s.cost.length > 0 && (
        <Section title={s.type === 'shop' ? t('priceTitle') : s.type === 'mam' ? t('researchCost') : t('deliverTitle')}>
          <Amounts list={s.cost} index={index} />
        </Section>
      )}
      {s.type === 'alternate' && (
        <Section title={t('hardDriveTitle')}>
          <p className="codex-text">{t('hardDriveText')}</p>
        </Section>
      )}
      {recipes.length > 0 && (
        <Section
          title={s.type === 'alternate' ? t('theRecipe') : t('unlocksRecipes')}
          count={s.type === 'alternate' ? undefined : recipes.length}
        >
          <div className="codex-recipes">
            {recipes.map((r) => (
              <RecipeCard key={r.id} recipe={r} index={index} build={r.outputs[0]?.item} />
            ))}
          </div>
        </Section>
      )}
      {standard.length > 0 && (
        <Section title={t('comparedTo')}>
          <div className="codex-recipes">
            {standard.map((r) => (
              <RecipeCard key={r.id} recipe={r} index={index} />
            ))}
          </div>
        </Section>
      )}
      {(others.length > 0 || s.gives || s.extras) && (
        <Section title={s.type === 'shop' ? t('youGet') : t('unlocksTitle')}>
          <div className="codex-amounts wrap">
            {s.gives?.map((g) => (
              <Amount key={g.item} item={g.item} amount={g.amount} index={index} />
            ))}
            {others.map((u) => (
              <Amount key={u} item={u} index={index} />
            ))}
          </div>
          {s.extras && (
            <ul className="codex-extras">
              {s.extras.map((x) => (
                <li key={x.k}>
                  {x.k === 'scan'
                    ? t('extra_scan', { list: x.items.map((i) => nameOf(i, index.data)).join(', ') })
                    : 'n' in x
                      ? t(`extra_${x.k}`, { n: x.n })
                      : t(`extra_${x.k}`)}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
      {s.after.length > 0 && (
        <Section title={t('requiresFirst')}>
          <div className="codex-uses">
            {s.after
              .map((a) => index.schematic.get(a))
              .filter(Boolean)
              .map((a) => (
                <CodexLink key={a!.id} page={{ kind: 'schematic', id: a!.id }} className="codex-use">
                  <Icon id={schematicIcon(a!, index.data) ?? ''} size={30} />
                  <span className="codex-use-name">{a!.name}</span>
                  <span className="codex-use-where">{schematicWhere(a!, t)}</span>
                </CodexLink>
              ))}
          </div>
        </Section>
      )}
    </>
  );
}
