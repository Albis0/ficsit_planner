import type { Grid, Plan } from '../store';
import { data, generatorById, recipeById } from './data';
import { DEFAULT_EXTRACTION, type ExtractionSettings, MINERS, PURITIES, type Purity } from './extraction';
import type { Plant, PlantSize } from './power';
import { clampSetting, DEFAULT_COLORS, DEFAULT_SETTINGS, type Settings } from './settings';
import type { RecipeMod, Target } from './solver';

/*
  Saved state and loaded copies are data from outside the code: an older version, a hand-edited
  file, a plan attached to a report. Everything here keeps only what has the right shape, so a bad
  value can't reach a render and break the app on every load.
*/

type Loose = Record<string, unknown>;

const obj = (x: unknown): Loose => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Loose) : {});
const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const text = (x: unknown, fallback: string, max = 80) => (typeof x === 'string' && x.trim() ? x.slice(0, max) : fallback);
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const within = (x: unknown, lo: number, hi: number, fallback: number) => (finite(x) ? Math.min(hi, Math.max(lo, x)) : fallback);
const oneOf = <T extends string>(x: unknown, options: readonly T[], fallback: T): T => (options.includes(x as T) ? (x as T) : fallback);

function targets(x: unknown): Target[] {
  const seen = new Set<string>();
  return list(x).flatMap((t) => {
    const { item, rate } = obj(t);
    if (typeof item !== 'string' || !data.items[item] || seen.has(item) || !finite(rate) || rate < 0) return [];
    seen.add(item);
    return [{ item, rate }];
  });
}

/** Per-item amounts (resource caps, pinned inputs): known items, finite and not negative. */
function amounts(x: unknown): Record<string, number> {
  return Object.fromEntries(Object.entries(obj(x)).filter(([id, v]) => data.items[id] && finite(v) && v >= 0)) as Record<string, number>;
}

function mods(x: unknown): Record<string, RecipeMod> {
  const out: Record<string, RecipeMod> = {};
  for (const [id, m] of Object.entries(obj(x))) {
    const { clock, sloops } = obj(m);
    if (!recipeById.has(id) || !finite(clock) || clock <= 0) continue;
    out[id] = { clock: Math.min(2.5, clock), sloops: within(sloops, 0, 4, 0) };
  }
  return out;
}

function extraction(x: unknown): ExtractionSettings {
  const e = obj(x);
  return {
    miner: MINERS.some((m) => m.id === e.miner) ? (e.miner as string) : DEFAULT_EXTRACTION.miner,
    purity: oneOf<Purity>(e.purity, PURITIES, DEFAULT_EXTRACTION.purity),
    clock: within(e.clock, 0.01, 2.5, DEFAULT_EXTRACTION.clock),
  };
}

/** A factory tab, cleaned against the current game data. */
export function cleanPlan(saved: unknown, fallback: Plan): Plan {
  const p = obj(saved);
  return {
    id: text(p.id, fallback.id, 40),
    name: text(p.name, fallback.name),
    targets: targets(p.targets ?? fallback.targets),
    supplies: targets(p.supplies ?? fallback.supplies),
    enabled: Array.isArray(p.enabled)
      ? p.enabled.filter((id): id is string => typeof id === 'string' && recipeById.has(id))
      : fallback.enabled,
    caps: amounts(p.caps),
    fixed: amounts(p.fixed),
    mods: mods(p.mods),
    extraction: extraction(p.extraction ?? fallback.extraction),
  };
}

const SIZES: PlantSize[] = ['auto', 'count', 'power'];

function plants(x: unknown): Plant[] {
  // Two plants with one id would share one solver column; later ones get a fresh id.
  const seen = new Set<string>();
  return list(x).flatMap((raw, i) => {
    const p = obj(raw);
    if (typeof p.generator !== 'string' || !generatorById.has(p.generator) || typeof p.id !== 'string') return [];
    let id = p.id.slice(0, 40);
    for (let n = 2; seen.has(id); n++) id = `${p.id.slice(0, 30)}-${i}-${n}`;
    seen.add(id);
    const plant: Plant = {
      id,
      generator: p.generator,
      by: oneOf(p.by, SIZES, 'count'),
      amount: within(p.amount, 0, 1e6, 1),
      clock: within(p.clock, 0.01, 2.5, 1),
    };
    if (typeof p.fuel === 'string') plant.fuel = p.fuel;
    if (p.purity !== undefined) plant.purity = oneOf<Purity>(p.purity, PURITIES, 'normal');
    if (p.fed === true) plant.fed = true;
    return [plant];
  });
}

/** The power grid, its fuel plan cleaned like any factory. */
export function cleanGrid(saved: unknown, fallback: Grid): Grid {
  const g = obj(saved);
  return {
    plants: plants(g.plants),
    exclude: list(g.exclude).filter((id): id is string => typeof id === 'string'),
    extra: within(g.extra, 0, 1e7, fallback.extra),
    headroom: within(g.headroom, 0, 2, fallback.headroom),
    backup: within(g.backup, 0, 1e5, fallback.backup),
    chain: cleanPlan(g.chain, fallback.chain),
  };
}

const COLOR = /^#[\da-f]{6}$/i;

export function cleanSettings(saved: unknown): Settings {
  const s = obj(saved);
  const c = obj(s.colors);
  const colors = Object.fromEntries(
    Object.entries(DEFAULT_COLORS).map(([k, v]) => [k, typeof c[k] === 'string' && COLOR.test(c[k] as string) ? c[k] : v]),
  ) as Settings['colors'];
  const d = DEFAULT_SETTINGS;
  const scale = (k: 'cardScale' | 'textScale' | 'uiScale' | 'spacing') => (finite(s[k]) ? clampSetting(k, s[k] as number) : d[k]);
  return {
    panel: oneOf(s.panel, ['top', 'left', 'right'] as const, d.panel),
    cardScale: scale('cardScale'),
    textScale: scale('textScale'),
    uiScale: scale('uiScale'),
    spacing: scale('spacing'),
    beltLabels: oneOf(s.beltLabels, ['auto', 'always', 'never'] as const, d.beltLabels),
    beltMotion: typeof s.beltMotion === 'boolean' ? s.beltMotion : d.beltMotion,
    gridLines: typeof s.gridLines === 'boolean' ? s.gridLines : d.gridLines,
    beltColors: oneOf(s.beltColors, ['tier', 'one'] as const, d.beltColors),
    colors,
    decimals: finite(s.decimals) ? Math.round(clampSetting('decimals', s.decimals as number)) : d.decimals,
    motion: oneOf(s.motion, ['system', 'reduce', 'full'] as const, d.motion),
  };
}

/** Plain numbers and choices saved alongside the plans. */
export const cleanNumber = within;
export const cleanChoice = oneOf;
