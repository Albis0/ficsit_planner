import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef } from 'react';
import { data } from '../lib/data';
import { PURITIES, PURITY } from '../lib/extraction';
import { CREATURE_RING, type Layer, LAYER_GROUPS, LAYER_ITEM, LAYER_RING, type PointLayer, useWorld } from '../lib/finds';
import { useT } from '../lib/i18n';
import type { PickedLayer } from '../lib/save/map';
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
const PURITY_RING = ['#e0685c', '#f2c14e', '#7cc46a'];

/** A part's name for a crash site's price; every part a crash site asks for is in the planner's data. */
const partName = (id: string) => data.items[id]?.name ?? id;

/** A node's icon: geysers show the generator that sits on them. */
const iconOf = (item: string) => (item === 'Desc_Geyser_C' ? 'Build_GeneratorGeoThermal_C' : item);

/** Pin size on screen, shared by every pin and set on zoom; below 15 px pins are plain dots. */
const pin = { size: 22 };

/** Icons drawn into the canvas, loaded once each; the map redraws as they arrive. */
const images = new Map<string, HTMLImageElement>();
let redraw = () => {};
function image(id: string): HTMLImageElement | undefined {
  let img = images.get(id);
  if (!img) {
    img = new Image();
    img.onload = () => redraw();
    img.src = `${base}icons/${id}.webp`;
    images.set(id, img);
  }
  return img.complete && img.naturalWidth ? img : undefined;
}

interface PinOptions extends L.CircleMarkerOptions {
  ring: string;
  icon: string;
  /** Scale against the other pins: well nodes and plants are smaller. */
  scale: number;
  /** What the popup says, built when it opens. */
  label: () => string;
  /** Picked up, by the followed save: drawn faint with a cross. */
  picked?: boolean;
  /** Mined, by the followed save: an arc around the pin as far round as the clock (a full turn is 250%). */
  arc?: number;
}

const ARC = '#fa9549';
/** How many production buildings and generators a save factory has. */
const size = (f: { count: Record<string, number> }) => Object.values(f.count).reduce((n, c) => n + c, 0);
/** A building, by its id: production buildings, generators, extractors. */
const building = (id: string) => data.machines[id] ?? data.generators.find((g) => g.id === id) ?? data.extractors.find((e) => e.id === id);

/*
  A pin drawn on the map's one canvas instead of an element of its own: thousands of them stay smooth.
  It's a circle marker whose radius follows the shared pin size and whose drawing is the game-style pin: a dark
  disc ringed in its colour with the icon on it, or from far away a dot in that colour.
*/
// biome-ignore lint/suspicious/noExplicitAny: Leaflet's canvas internals aren't in its types.
const Pin: new (at: L.LatLng, options: PinOptions) => L.CircleMarker = (L.CircleMarker as any).extend({
  _project() {
    this._radius = (pin.size / 2) * this.options.scale;
    // biome-ignore lint/suspicious/noExplicitAny: see above.
    (L.CircleMarker.prototype as any)._project.call(this);
  },
  _updatePath() {
    const r = this._renderer;
    if (!r._drawing || this._empty()) return;
    const ctx: CanvasRenderingContext2D = r._ctx;
    const p = this._point;
    const rad = this._radius;
    const o: PinOptions = this.options;
    // A dashed factory box drawn before leaves its dashes on the canvas.
    ctx.setLineDash([]);
    const far = pin.size < 15;
    if (o.arc) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, rad + (far ? 2.5 : 4), -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, o.arc));
      ctx.lineWidth = far ? 2.5 : 3.5;
      ctx.strokeStyle = ARC;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
    if (o.picked) {
      // From far away a dark dot with a cross; closer in the pin itself, faint, with the cross on its shoulder.
      if (far) {
        ctx.fillStyle = 'rgba(20,21,22,0.92)';
        ctx.fill();
      } else {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = 'rgba(20,21,22,0.88)';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = o.ring;
        ctx.stroke();
        const img = image(o.icon);
        if (img) {
          const s = rad * 1.56;
          ctx.drawImage(img, p.x - s / 2, p.y - s / 2, s, s);
        }
        ctx.globalAlpha = 1;
      }
      const c = far ? 0 : rad * 0.72;
      const r = far ? rad : Math.max(5, rad * 0.42);
      const cx = p.x + c;
      const cy = p.y - c;
      if (!far) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = '#141516';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#e8e6e1';
        ctx.stroke();
      }
      const k = r * 0.45;
      ctx.beginPath();
      ctx.moveTo(cx - k, cy - k);
      ctx.lineTo(cx + k, cy + k);
      ctx.moveTo(cx + k, cy - k);
      ctx.lineTo(cx - k, cy + k);
      ctx.lineWidth = far ? 1.5 : 2;
      ctx.strokeStyle = '#e8e6e1';
      ctx.stroke();
      return;
    }
    if (far) {
      ctx.fillStyle = o.ring;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.stroke();
      return;
    }
    ctx.fillStyle = 'rgba(20,21,22,0.88)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = o.ring;
    ctx.stroke();
    const img = image(o.icon);
    if (img) {
      const s = rad * 1.56;
      ctx.drawImage(img, p.x - s / 2, p.y - s / 2, s, s);
    }
  },
});

/** The world map: the game's own map picture, every resource node, well and geyser on it, and whatever else the filter turns on. */
export default function WorldMap() {
  const { t, name, num } = useT();
  const filter = useStore((s) => s.mapFilter);
  const focus = useStore((s) => s.mapFocus);
  const saved = useStore((s) => s.save?.map);
  const set = useStore((s) => s.set);
  const world = useWorld();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map>(undefined);
  const layer = useRef<L.FeatureGroup>(undefined);
  /** Hides factory names that would overlap; run again after each zoom. */
  const declutter = useRef(() => {});

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
    const renderer = L.canvas({ padding: 0.3, tolerance: 3 });
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
      preferCanvas: true,
      renderer,
    });
    L.tileLayer(`${base}map/{z}/{x}/{y}.webp`, {
      tileSize: 256,
      noWrap: true,
      bounds: BOUNDS,
      minNativeZoom: 0,
      maxNativeZoom: MAX_TILE_ZOOM,
      keepBuffer: 3,
    }).addTo(m);
    L.control.zoom({ position: 'bottomright', zoomInTitle: t('zoomIn'), zoomOutTitle: t('zoomOut') }).addTo(m);
    // The whole world in view to start with, and no further out than a little past it. A map opened while its
    // pane is hidden (a phone showing the filter) has no size yet: it frames the world once it's shown.
    // A view from the start, so Leaflet counts the map as loaded and measures it again once it's shown.
    m.setView(BOUNDS.getCenter(), 0);
    let framed = false;
    const frame = () => {
      const size = m.getSize();
      if (!size.x || !size.y) return;
      m.setMinZoom(m.getBoundsZoom(BOUNDS, false) - 0.5);
      if (framed) return;
      m.fitBounds(BOUNDS);
      framed = true;
    };
    frame();
    // Pins grow with the picture on screen: coloured dots while the whole world is in view, icons closer in.
    const size = () => {
      pin.size = Math.round(Math.min(34, Math.max(6, (256 * 2 ** m.getZoom()) / 70)));
    };
    m.on('zoom', size);
    m.on('zoomend moveend', () => declutter.current());
    size();
    // biome-ignore lint/suspicious/noExplicitAny: Leaflet's canvas internals aren't in its types.
    redraw = () => (renderer as any)._redraw?.();
    const group = L.featureGroup().addTo(m);
    group.on('click', (e: L.LeafletMouseEvent) => {
      const o = (e.propagatedFrom as L.CircleMarker).options as PinOptions;
      L.popup({ closeButton: false, offset: [0, -4], className: 'map-popup' })
        .setLatLng(e.latlng)
        .setContent(o.label())
        .openOn(m);
    });
    layer.current = group;
    map.current = m;
    const resize = new ResizeObserver(() => {
      m.invalidateSize();
      frame();
    });
    resize.observe(box.current);
    return () => {
      resize.disconnect();
      redraw = () => {};
      // Leaflet ends a zoom on timers that fire after the map is gone and trip over its removed panes; stop them first.
      const left = m as unknown as { _animatingZoom: boolean; scrollWheelZoom: { _timer?: number } };
      left._animatingZoom = false;
      clearTimeout(left.scrollWheelZoom._timer);
      m.stop();
      m.remove();
      map.current = undefined;
    };
  }, [t]);

  // The pins for what the filter shows.
  useEffect(() => {
    const group = layer.current;
    if (!group) return;
    group.clearLayers();
    const add = (x: number, y: number, o: Omit<PinOptions, 'interactive'>) =>
      group.addLayer(new Pin(at(x, y), { ...o, interactive: true }));
    const hidden = new Set(filter.hidden);
    const pop = (title: string, ...lines: string[]) =>
      `<div class="map-pop"><b>${title}</b>${lines
        .filter(Boolean)
        .map((l) => `<span class="map-pop-kind">${l}</span>`)
        .join('')}</div>`;
    const pct = (clock: number) => `${num(Math.round(clock * 1000) / 10)}%`;
    // The followed save's factories, under everything else: a dashed box and its name above it. Where names would
    // overlap, the bigger factory's shows.
    const labels: L.Tooltip[] = [];
    const factories = [...(saved?.factories ?? [])].sort((a, b) => size(b) - size(a));
    for (const f of factories) {
      const [x0, y0, x1, y1] = f.box;
      const title = data.items[f.item] ? itemName(f.item) : name(building(f.item));
      const lines = Object.entries(f.count)
        .sort((a, b) => b[1] - a[1])
        .map(([cls, n]) => `${n} × ${name(building(cls))}`);
      group.addLayer(
        L.rectangle(L.latLngBounds(at(x0, y1), at(x1, y0)), {
          color: ARC,
          weight: 2,
          dashArray: '6 5',
          fillColor: ARC,
          fillOpacity: 0.06,
          interactive: true,
          label: () => pop(title, t('mapFromSave'), ...lines),
        } as L.PolylineOptions),
      );
      const tip = L.tooltip({ permanent: true, direction: 'top', className: 'map-factory-label', offset: [0, -2], interactive: false })
        .setLatLng(at((x0 + x1) / 2, y0))
        .setContent(title);
      group.addLayer(tip);
      labels.push(tip);
    }
    declutter.current = () => {
      const view = box.current?.getBoundingClientRect();
      const shown: DOMRect[] = [];
      for (const tip of labels) {
        const el = tip.getElement();
        if (!el) continue;
        el.style.visibility = '';
        const r = el.getBoundingClientRect();
        const cut = view && (r.left < view.left || r.right > view.right || r.top < view.top);
        if (cut || shown.some((s) => r.left < s.right + 4 && r.right + 4 > s.left && r.top < s.bottom + 2 && r.bottom + 2 > s.top))
          el.style.visibility = 'hidden';
        else shown.push(r);
      }
    };
    requestAnimationFrame(() => declutter.current());
    const mined = new Map((saved?.miners ?? []).map(([i, cls, clock]) => [i, { cls, clock }]));
    NODES.forEach((n, i) => {
      if (hidden.has(n.item) || !filter.purities.includes(n.purity)) return;
      const m = mined.get(i);
      add(n.x, n.y, {
        ring: PURITY_RING[n.purity],
        icon: iconOf(n.item),
        scale: n.kind === 'well' ? 0.78 : 1,
        arc: m && m.clock / 2.5,
        label: () =>
          `<div class="map-pop"><b>${itemName(n.item)}</b><span class="map-pop-purity purity-${n.purity}">${t(PURITIES[n.purity])}</span>${n.kind === 'well' ? `<span class="map-pop-kind">${t('wellNode')}</span>` : ''}<span class="map-pop-yield">${yields(n)}</span>${m ? `<span class="map-pop-miner">${name(building(m.cls))} · ${pct(m.clock)}</span>` : ''}</div>`,
      });
    });
    for (const [cls, x, y] of saved?.landmarks ?? [])
      add(x, y, {
        ring: '#e8e6e1',
        icon: cls,
        scale: 1.1,
        label: () => pop(t(`landmark_${cls}` as 'landmark_Build_Mam_C'), t('mapFromSave')),
      });
    if (!world) return;
    const on = new Set(filter.layers);
    const pickedIn = (l: string) => new Set(filter.picked === 'show' ? [] : (saved?.picked[l as PickedLayer] ?? []));
    for (const g of LAYER_GROUPS)
      for (const l of g.layers as readonly Layer[]) {
        if (!on.has(l)) continue;
        const item = LAYER_ITEM[l];
        const picked = pickedIn(l);
        const gone = (i: number) => picked.has(i) && filter.picked === 'hide';
        if (l === 'pod') {
          world.finds.pod.forEach(([x, y, cost], i) => {
            if (gone(i)) return;
            add(x, y, {
              ring: LAYER_RING.pod,
              icon: item,
              scale: 1,
              picked: picked.has(i),
              label: () =>
                pop(
                  t('crashSite'),
                  !cost
                    ? t('crashSiteFree')
                    : 'mw' in cost
                      ? t('crashSitePower', { mw: num(cost.mw) })
                      : t('crashSiteItems', { n: cost.amount, item: partName(cost.item) }),
                  t('crashSiteGives'),
                  picked.has(i) ? t('mapPicked') : '',
                ),
            });
          });
          continue;
        }
        world.finds[l as PointLayer].forEach(([x, y], i) => {
          if (gone(i)) return;
          add(x, y, {
            ring: LAYER_RING[l],
            icon: item,
            scale: g.id === 'plants' ? 0.8 : 1,
            picked: picked.has(i),
            label: () => pop(t(`layer_${l}` as 'layer_sloop'), picked.has(i) ? t('mapPicked') : ''),
          });
        });
      }
    world.creatures.forEach((c, i) => {
      if (!on.has(c.id)) return;
      for (const [x, y, k, count] of world.finds.spawn) {
        if (k !== i) continue;
        add(x, y, {
          ring: CREATURE_RING[c.family],
          icon: c.id,
          scale: 0.9,
          label: () => pop(c.name, t('spawnsHere', { n: count }), c.health ? t('healthN', { n: num(c.health) }) : ''),
        });
      }
    });
  }, [filter, itemName, yields, t, num, name, world, saved]);

  // Asked to show one resource or layer (from the Codex): frame its points.
  useEffect(() => {
    if (!focus || !map.current) return;
    let pts = NODES.filter((n) => n.item === focus).map((n) => at(n.x, n.y));
    if (!pts.length && world) {
      const i = world.creatures.findIndex((c) => c.id === focus);
      const list: number[][] =
        i >= 0 ? world.finds.spawn.filter((s) => s[2] === i) : ((world.finds as unknown as Record<string, number[][]>)[focus] ?? []);
      pts = list.map(([x, y]) => at(x, y));
    }
    if (!pts.length && !world) return;
    if (pts.length) map.current.flyToBounds(L.latLngBounds(pts).pad(0.2), { duration: 0.6, maxZoom: MAX_TILE_ZOOM - 1 });
    set({ mapFocus: undefined });
  }, [focus, set, world]);

  return <div ref={box} className="world-map" />;
}
