import { data } from '../lib/data';
import { useT } from '../lib/i18n';
import { PURITIES } from '../lib/extraction';
import { type Layer, LAYER_GROUPS, LAYER_ITEM, LAYER_RING, CREATURE_RING, layerCount, layerOfItem, useWorld } from '../lib/finds';
import { DEFAULT_MAP_FILTER, MAP_GROUPS, NODES, purityCounts } from '../lib/world';
import { useStore } from '../store';
import { Glyph } from './Glyph';
import { Icon } from './Icon';

/** Whether a resource has nodes on the map. */
export const onMap = (item: string) => NODES.some((n) => n.item === item);

/** Whether an item has points of its own on the map: a resource's nodes, or a find like somersloops. */
export const onMapAny = (item: string) => onMap(item) || !!layerOfItem(item);

/**
 * Opens the map on one resource, find or creature: everything else hidden, every purity shown, the view framed
 * on its points.
 */
export function openMapOn(id: string) {
  const all = MAP_GROUPS.flatMap((g) => g.items);
  const layer = onMap(id) ? undefined : (layerOfItem(id) ?? id);
  useStore.getState().set({
    mode: 'map',
    pane: 'floor',
    inspect: undefined,
    mapFilter: { hidden: layer ? all : all.filter((i) => i !== id), purities: [0, 1, 2], layers: layer ? [layer] : [] },
    mapFocus: layer ?? id,
  });
}

/** The map's panel: which purities show, and which resources, each with how many nodes of each purity it has. */
export function MapNav() {
  const { t, name, num } = useT();
  const world = useWorld();
  const filter = useStore((s) => s.mapFilter);
  const layers = new Set(filter.layers);
  const flip = (id: string) =>
    set({ mapFilter: { ...filter, layers: layers.has(id) ? filter.layers.filter((l) => l !== id) : [...filter.layers, id] } });
  const layerRow = (id: string, icon: string, label: string, ring: string) => (
    <li key={id}>
      <button type="button" className="map-item" aria-pressed={layers.has(id)} onClick={() => flip(id)}>
        <Icon id={icon} size={30} />
        <span className="map-item-name">{label}</span>
        <span className="map-layer-count" style={{ ['--ring' as string]: ring }}>
          {world ? num(layerCount(world, id)) : ''}
        </span>
      </button>
    </li>
  );
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
      {LAYER_GROUPS.map((g) => (
        <section key={g.id} className="stack">
          <h3 className="section-title">{t(`mapGroup_${g.id}`)}</h3>
          <ul className="map-items">
            {(g.layers as readonly Layer[]).map((l) => layerRow(l, LAYER_ITEM[l], t(`layer_${l}`), LAYER_RING[l]))}
          </ul>
        </section>
      ))}
      <section className="stack">
        <h3 className="section-title">{t('mapGroup_creatures')}</h3>
        {world ? (
          <ul className="map-items">{world.creatures.map((c) => layerRow(c.id, c.id, c.name, CREATURE_RING[c.family]))}</ul>
        ) : (
          <p className="hint">{t('mapLoading')}</p>
        )}
      </section>
      {(filter.hidden.length > 0 || filter.purities.length < 3 || filter.layers.join() !== DEFAULT_MAP_FILTER.layers.join()) && (
        <button type="button" className="text-button map-reset" onClick={() => set({ mapFilter: DEFAULT_MAP_FILTER })}>
          {t('resetFilter')}
        </button>
      )}
    </div>
  );
}
