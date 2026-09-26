import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef } from 'react';
import { data } from '../lib/data';
import { PURITIES, PURITY } from '../lib/extraction';
import { useT } from '../lib/i18n';
import { MAP_SIZE, MAX_TILE_ZOOM, NODES, type WorldNode } from '../lib/world';
import { useStore } from '../store';

const base = import.meta.env.BASE_URL;
/** Leaflet's flat map: at zoom 0 the picture is one 256 px tile, so a picture pixel is 1/(size/256) of a unit. */
const SCALE = MAP_SIZE / 256;
const at = (x: number, y: number) => L.latLng(-y / SCALE, x / SCALE);
const BOUNDS = L.latLngBounds(at(0, MAP_SIZE), at(MAP_SIZE, 0));

const MINERS = ['Build_MinerMk1_C', 'Build_MinerMk2_C', 'Build_MinerMk3_C'];
const extractor = (id: string) => data.extractors.find((e) => e.id === id)!;
const geothermal = data.generators.find((g) => g.kind === 'geothermal');

/** A node's icon: geysers show the generator that sits on them. */
const iconOf = (item: string) => (item === 'Desc_Geyser_C' ? 'Build_GeneratorGeoThermal_C' : item);

/** The world map: the game's own map picture, every resource node, well and geyser on it, filtered from the panel. */
export default function WorldMap() {
  const { t, name, num } = useT();
  const filter = useStore((s) => s.mapFilter);
  const focus = useStore((s) => s.mapFocus);
  const set = useStore((s) => s.set);
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map>(undefined);
  const layer = useRef<L.LayerGroup>(undefined);

  const itemName = useMemo(() => (item: string) => (item === 'Desc_Geyser_C' ? t('geyser') : name(data.items[item])), [t, name]);

  // What a node gives: per miner mark for ores, the extractor for oil and wells, megawatts for a geyser.
  const yields = useMemo(
    () => (n: WorldNode) => {
      const k = PURITY[PURITIES[n.purity]];
      if (n.kind === 'geyser') return `${num((geothermal?.power ?? 200) * k)} MW`;
      if (n.kind === 'well') return `${num(extractor('Build_FrackingExtractor_C').rate * k)} m³${t('perMin')}`;
      if (n.item === 'Desc_LiquidOil_C') return `${num(extractor('Build_OilPump_C').rate * k)} m³${t('perMin')}`;
      return MINERS.map((m, i) => `Mk.${i + 1} ${num(extractor(m).rate * k)}`).join(' · ') + t('perMin');
    },
    [num, t],
  );

  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, {
      crs: L.CRS.Simple,
      zoomControl: false,
      attributionControl: false,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 90,
      maxBounds: BOUNDS.pad(0.15),
      maxBoundsViscosity: 0.9,
      maxZoom: MAX_TILE_ZOOM + 1,
    });
    L.tileLayer(`${base}map/{z}/{x}/{y}.webp`, {
      tileSize: 256,
      noWrap: true,
      bounds: BOUNDS,
      minNativeZoom: 0,
      maxNativeZoom: MAX_TILE_ZOOM,
    }).addTo(m);
    L.control.zoom({ position: 'bottomright', zoomInTitle: t('zoomIn'), zoomOutTitle: t('zoomOut') }).addTo(m);
    const fit = m.getBoundsZoom(BOUNDS, false);
    m.setMinZoom(fit - 0.5);
    m.fitBounds(BOUNDS);
    // Pins grow with the picture on screen: coloured dots while the whole world is in view, icons closer in.
    const size = () => {
      const pin = Math.round(Math.min(34, Math.max(6, (256 * 2 ** m.getZoom()) / 70)));
      box.current?.style.setProperty('--pin', `${pin}px`);
      box.current?.toggleAttribute('data-dots', pin < 15);
    };
    m.on('zoom', size);
    size();
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    const resize = new ResizeObserver(() => m.invalidateSize());
    resize.observe(box.current);
    return () => {
      resize.disconnect();
      m.remove();
      map.current = undefined;
    };
  }, [t]);

  // The pins for what the filter shows.
  useEffect(() => {
    const group = layer.current;
    if (!group) return;
    group.clearLayers();
    const hidden = new Set(filter.hidden);
    for (const n of NODES) {
      if (hidden.has(n.item) || !filter.purities.includes(n.purity)) continue;
      const icon = L.divIcon({
        className: '',
        html: `<span class="map-pin purity-${n.purity}${n.kind === 'well' ? ' well' : ''}"><i style="--icon:url('${base}icons/${iconOf(n.item)}.webp')"></i></span>`,
        iconSize: [0, 0],
      });
      const label = `<div class="map-pop"><b>${itemName(n.item)}</b><span class="map-pop-purity purity-${n.purity}">${t(PURITIES[n.purity])}</span>${n.kind === 'well' ? `<span class="map-pop-kind">${t('wellNode')}</span>` : ''}<span class="map-pop-yield">${yields(n)}</span></div>`;
      L.marker(at(n.x, n.y), { icon, keyboard: false, riseOnHover: true })
        .bindPopup(label, { closeButton: false, offset: [0, -6], className: 'map-popup' })
        .addTo(group);
    }
  }, [filter, itemName, yields, t]);

  // Asked to show one resource (from the Codex): frame its nodes.
  useEffect(() => {
    if (!focus || !map.current) return;
    const pts = NODES.filter((n) => n.item === focus).map((n) => at(n.x, n.y));
    if (pts.length) map.current.flyToBounds(L.latLngBounds(pts).pad(0.2), { duration: 0.6, maxZoom: MAX_TILE_ZOOM - 1 });
    set({ mapFocus: undefined });
  }, [focus, set]);

  return <div ref={box} className="world-map" />;
}
