import { data } from '../lib/data';
import { useT } from '../lib/i18n';
import { PURITIES } from '../lib/extraction';
import { DEFAULT_MAP_FILTER, MAP_GROUPS, NODES, purityCounts } from '../lib/world';
import { useStore } from '../store';
import { Glyph } from './Glyph';
import { Icon } from './Icon';

/** Whether a resource has nodes on the map. */
export const onMap = (item: string) => NODES.some((n) => n.item === item);

/** Opens the map on one resource: the others hidden, every purity shown, the view framed on its nodes. */
export function openMapOn(item: string) {
  const all = MAP_GROUPS.flatMap((g) => g.items);
  useStore.getState().set({
    mode: 'map',
    pane: 'floor',
    inspect: undefined,
    mapFilter: { hidden: all.filter((i) => i !== item), purities: [0, 1, 2] },
    mapFocus: item,
  });
}

/** The map's panel: which purities show, and which resources, each with how many nodes of each purity it has. */
export function MapNav() {
  const { t, name } = useT();
  const filter = useStore((s) => s.mapFilter);
  const set = useStore((s) => s.set);
  const hidden = new Set(filter.hidden);
  const all = MAP_GROUPS.flatMap((g) => g.items);

  const toggle = (item: string) =>
    set({ mapFilter: { ...filter, hidden: hidden.has(item) ? filter.hidden.filter((i) => i !== item) : [...filter.hidden, item] } });
  const purity = (p: number) =>
    set({
      mapFilter: {
        ...filter,
        purities: filter.purities.includes(p) ? filter.purities.filter((x) => x !== p) : [...filter.purities, p].sort(),
      },
    });

  return (
    <div className="panel-body map-nav">
      <h2 className="map-nav-title">
        <Glyph name="map" size={22} />
        {t('worldMap')}
      </h2>
      <section className="stack">
        <h3 className="section-title">{t('purity')}</h3>
        <div className="map-purities" role="group" aria-label={t('purity')}>
          {PURITIES.map((p, i) => (
            <button
              key={p}
              type="button"
              className={`map-purity purity-${i}`}
              aria-pressed={filter.purities.includes(i)}
              onClick={() => purity(i)}
            >
              <span className="map-dot" aria-hidden />
              {t(p)}
            </button>
          ))}
        </div>
      </section>
      {MAP_GROUPS.map((g) => (
        <section key={g.id} className="stack">
          <div className="section-head">
            <h3 className="section-title">{t(`mapGroup_${g.id}`)}</h3>
            {g.id === 'ores' && (
              <span className="map-bulk">
                <button
                  type="button"
                  className="text-button"
                  disabled={filter.hidden.length === 0}
                  onClick={() => set({ mapFilter: { ...filter, hidden: [] } })}
                >
                  {t('showAll')}
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={filter.hidden.length === all.length}
                  onClick={() => set({ mapFilter: { ...filter, hidden: all } })}
                >
                  {t('hideAll')}
                </button>
              </span>
            )}
          </div>
          <ul className="map-items">
            {g.items.map((item) => {
              const [impure, normal, pure] = purityCounts(item);
              return (
                <li key={item}>
                  <button type="button" className="map-item" aria-pressed={!hidden.has(item)} onClick={() => toggle(item)}>
                    <Icon id={item === 'Desc_Geyser_C' ? 'Build_GeneratorGeoThermal_C' : item} size={30} />
                    <span className="map-item-name">{item === 'Desc_Geyser_C' ? t('geyser') : name(data.items[item])}</span>
                    <span className="map-counts" title={`${t('impure')} ${impure} · ${t('normal')} ${normal} · ${t('pure')} ${pure}`}>
                      <span className="purity-0">{impure}</span>
                      <span className="purity-1">{normal}</span>
                      <span className="purity-2">{pure}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {(filter.hidden.length > 0 || filter.purities.length < 3) && (
        <button type="button" className="text-button map-reset" onClick={() => set({ mapFilter: DEFAULT_MAP_FILTER })}>
          {t('resetFilter')}
        </button>
      )}
    </div>
  );
}
