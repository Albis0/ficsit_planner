import { useMemo, useState } from 'react';
import {
  type Category,
  type CodexIndex,
  type Entry,
  GUIDE_ICON,
  GUIDES,
  nameOf,
  type Page,
  pageKey,
  parsePage,
  partSource,
  type Schematic,
  schematicIcon,
} from '../../lib/codex';
import { data } from '../../lib/data';
import { type Family, type Layer, LAYER_GROUPS, LAYER_ITEM } from '../../lib/finds';
import { useT } from '../../lib/i18n';
import { searchKey } from '../../lib/text';
import { versusStandard } from '../../lib/insights';
import { Icon } from '../Icon';
import { CodexLink } from './route';
import { Health } from './Hearts';
import { MamScreen } from './Mam';
import { MilestoneScreen } from './Milestones';

/** The category a page belongs to, for the index to mark. */
export function categoryOf(page: Page, index: CodexIndex | undefined): Category | undefined {
  if (page.kind === 'cat') return page.id;
  if (page.kind === 'creature') return 'creatures';
  if (page.kind === 'guide') return page.id === 'crashsites' ? 'world' : 'guides';
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
export const CATEGORY_ICON: Record<Category, string> = {
  parts: 'Desc_Motor_C',
  resources: 'Desc_OreIron_C',
  buildings: 'Build_ManufacturerMk1_C',
  vehicles: 'Desc_Truck_C',
  equipment: 'BP_EquipmentDescriptorJetPack_C',
  milestones: 'Build_TradingPost_C',
  research: 'Build_Mam_C',
  alternates: 'Desc_HardDrive_C',
  shop: 'Desc_ResourceSinkCoupon_C',
  world: 'Desc_WAT2_C',
  creatures: 'Desc_HogBasic_C',
  guides: 'Desc_CrystalShard_C',
};

export const FAMILIES: Family[] = ['hog', 'spitter', 'stinger', 'hatcher', 'passive'];

/** A share as a signed percentage: −35%, +12%. */
export const pct = (share: number) => `${share > 0 ? '+' : share < 0 ? '−' : '±'}${Math.round(Math.abs(share) * 100)}%`;

/** The Codex's own entries in a category, grouped under headings. */
export function categoryGroups(
  cat: Category,
  index: CodexIndex,
  { t, num }: Pick<ReturnType<typeof useT>, 't' | 'num'>,
): { title: string; entries: Entry[] }[] {
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
        note: it.sink ? `${num(it.sink)} ${t('pointsShort')}` : undefined,
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
      // Grouped by the building the recipe runs in, the way you'd look for a better one. Each says how its whole
      // line compares with the standard recipe's, and the ones that save the most come first, in a group of their own.
      const list = schematics('alternate').map((e) => {
        const recipe = e.s.unlocks.map((u) => data.recipes.find((r) => r.id === u)).find(Boolean);
        const vs = recipe && versusStandard(codex.insights.items[recipe.outputs[0].item], recipe.id);
        const note = vs && !vs.needsMore ? t('altSaves', { raw: pct(vs.raw), power: pct(vs.power) }) : undefined;
        return { ...e, note, vs, machine: recipe ? nameOf(recipe.machine, codex) : t('groupOther') };
      });
      const top = list
        .filter((e) => e.vs && !e.vs.needsMore && e.vs.raw < -0.1)
        .sort((a, b) => a.vs!.raw - b.vs!.raw)
        .slice(0, 12);
      const machines = [...new Set(list.map((e) => e.machine))].sort();
      return [
        { title: t('altTop'), entries: top },
        ...machines.map((m) => ({ title: m, entries: list.filter((e) => e.machine === m).sort(byName) })),
      ];
    }
    case 'shop':
      return groupBy(
        schematics('shop').map((e) => ({
          ...e,
          note: t('couponsN', { n: e.s.cost.find((c) => c.item === 'Desc_ResourceSinkCoupon_C')?.amount ?? 0 }),
        })),
        (e) => index.schematic.get((e.page as { id: string }).id)?.group ?? '',
      );
    case 'world':
      // Each find links to its item's page; crash sites, which aren't an item, to their own.
      return LAYER_GROUPS.map((g) => ({
        title: t(`mapGroup_${g.id}`),
        entries: (g.layers as readonly Layer[]).map((l) => ({
          page: (l === 'pod' ? { kind: 'guide', id: 'crashsites' } : { kind: 'item', id: LAYER_ITEM[l] }) as Page,
          name: l === 'pod' ? t('guide_crashsites') : nameOf(LAYER_ITEM[l], codex),
          icon: LAYER_ITEM[l],
          note: t('onMapN', { n: num(codex.counts[l]) }),
        })),
      }));
    case 'creatures':
      return FAMILIES.map((f) => ({
        title: t(`family_${f}`),
        entries: codex.creatures
          .filter((c) => c.family === f)
          .map((c) => ({
            page: { kind: 'creature', id: c.id } as Page,
            name: c.name,
            icon: c.id,
            note: c.health ? <Health hp={c.health} /> : undefined,
          })),
      })).filter((g) => g.entries.length);
    case 'guides':
      return [
        {
          title: '',
          entries: GUIDES.filter((id) => id !== 'crashsites').map((id) => ({
            page: { kind: 'guide', id } as Page,
            name: t(`guide_${id}`),
            icon: GUIDE_ICON[id],
            note: t(`guideLine_${id}`),
          })),
        },
      ];
  }
}

export function countOf(cat: Category, index: CodexIndex): number {
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
    case 'world':
      return LAYER_GROUPS.reduce((n, g) => n + g.layers.length, 0);
    case 'creatures':
      return codex.creatures.length;
    case 'guides':
      return GUIDES.length - 1;
  }
}

export const RECENT = 'ficsit-codex-recent';

/** Pages this viewer opened last, newest first; kept in this browser only. */
export function readRecent(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT) ?? '[]');
    return Array.isArray(list) ? list.filter((k) => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

export function remember(key: string) {
  try {
    localStorage.setItem(RECENT, JSON.stringify([key, ...readRecent().filter((k) => k !== key)].slice(0, 8)));
  } catch {
    // Private windows can refuse storage; the list is only a convenience.
  }
}

/** A page as a tile: its name and icon, for the recently opened list. */
export function entryOf(key: string, index: CodexIndex, t: ReturnType<typeof useT>['t']): Entry | undefined {
  const page = parsePage(key);
  if (page.kind === 'home' || page.kind === 'cat') return undefined;
  if (page.kind === 'guide') return { page, name: t(`guide_${page.id}`), icon: GUIDE_ICON[page.id] };
  return index.entries.find((e) => pageKey(e.page) === key);
}

/** The categories in three catalogs: the Codex's first page lists them, and its side panel folds them open. */
export const CATALOGS: [string, Category[]][] = [
  ['items', ['parts', 'resources', 'equipment', 'creatures', 'world']],
  ['buildings', ['buildings', 'vehicles']],
  ['unlocks', ['milestones', 'research', 'alternates', 'shop']],
];

export function Home({ index }: { index: CodexIndex }) {
  const { t } = useT();
  const [recent] = useState(() =>
    readRecent()
      .map((k) => entryOf(k, index, t))
      .filter((e): e is Entry => !!e),
  );
  return (
    <>
      <h2 className="codex-title">{t('codex')}</h2>
      <div className="codex-index">
        {CATALOGS.map(([group, cats]) => (
          <section key={group}>
            <h3 className="codex-index-head">{t(`codexGroup_${group}` as 'codexGroup_items')}</h3>
            {cats.map((c) => (
              <CodexLink key={c} page={{ kind: 'cat', id: c }} className="codex-index-row">
                <span>{t(`cat_${c}`)}</span>
                <span>{countOf(c, index)}</span>
              </CodexLink>
            ))}
          </section>
        ))}
        <section>
          <CodexLink page={{ kind: 'cat', id: 'guides' }} className="codex-index-row">
            <span>{t('cat_guides')}</span>
            <span>{countOf('guides', index)}</span>
          </CodexLink>
        </section>
      </div>
      {recent.length > 0 && (
        <div className="codex-recent">
          <span>{t('codexRecent')}</span>
          {recent.map((e) => (
            <CodexLink key={pageKey(e.page)} page={e.page}>
              {e.name}
            </CodexLink>
          ))}
        </div>
      )}
    </>
  );
}

export function CategoryPage({ cat, index }: { cat: Category; index: CodexIndex }) {
  const { t, num } = useT();
  const groups = useMemo(() => categoryGroups(cat, index, { t, num }), [cat, index, t, num]);
  const [filter, setFilter] = useState('');
  const q = searchKey(filter.trim());
  const shown = q
    ? groups.map((g) => ({ ...g, entries: g.entries.filter((e) => searchKey(e.name).includes(q)) })).filter((g) => g.entries.length)
    : groups;
  return (
    <>
      <header className="codex-cat-head">
        <Icon id={CATEGORY_ICON[cat]} size={72} />
        <h2 className="codex-title">{t(`cat_${cat}`)}</h2>
        {countOf(cat, index) > 20 && cat !== 'research' && cat !== 'milestones' && (
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
      {cat === 'research' && <MamScreen index={index} />}
      {cat === 'milestones' && <MilestoneScreen index={index} />}
      {cat !== 'research' &&
        cat !== 'milestones' &&
        shown.map((g) => (
          <section key={g.title || 'all'} className="codex-section">
            {g.title && <h3 className="codex-h">{g.title}</h3>}
            <div className={`codex-tiles${cat === 'guides' ? ' wide' : ''}`}>
              {g.entries.map((e) => (
                <Tile key={pageKey(e.page)} entry={e} />
              ))}
            </div>
          </section>
        ))}
      {cat !== 'research' && cat !== 'milestones' && shown.length === 0 && <p className="hint">{t('codexNoHits')}</p>}
    </>
  );
}

export function Tile({ entry }: { entry: Entry }) {
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
