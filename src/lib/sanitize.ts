import { DEFAULT_GAME, GAME_RANGE, type GameRules } from './game';
import type { Plan, PowerPlan, Route, Supply } from '../store';
import { data, generatorById, recipeById } from './data';
import { DEFAULT_EXTRACTION, type ExtractionSettings, MINERS, PURITIES, type Purity } from './extraction';
import { POOL } from './pool';
import { PLANT_NAMES, type Plant, type PlantSize, type SizeBy } from './power';
import { clampSetting, DEFAULT_COLORS, DEFAULT_SETTINGS, FONTS, type Settings } from './settings';
import type { RecipeMod, Target } from './solver';
import { CARRIERS, type Carrier } from './transport';
import { cleanModel } from './model/sanitize';

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

/** On-hand items: like targets, each may name the factory tab it comes from. */
function supplies(x: unknown): Supply[] {
  const from = new Map(list(x).map((s) => [obj(s).item, obj(s).from]));
  return targets(x).map((t) => {
    const f = from.get(t.item);
    return typeof f === 'string' && f ? { ...t, from: f.slice(0, 40) } : t;
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
    ...(Object.keys(obj(e.overclock)).length
      ? {
          overclock: Object.fromEntries(
            Object.entries(obj(e.overclock)).filter(([id, v]) => data.items[id]?.raw && finite(v) && v > 0 && v <= 2.5),
          ) as Record<string, number>,
        }
      : {}),
    ...(nodesOf(e.nodes) ? { nodes: nodesOf(e.nodes) } : {}),
    ...(e.capByNodes === true && nodesOf(e.nodes) ? { capByNodes: true } : {}),
  };
}

/** The player's own nodes per raw resource: whole counts per purity, empty resources dropped. */
function nodesOf(x: unknown): ExtractionSettings['nodes'] {
  const out: NonNullable<ExtractionSettings['nodes']> = {};
  for (const [id, v] of Object.entries(obj(x))) {
    if (!data.items[id]?.raw) continue;
    const counts: Partial<Record<Purity, number>> = {};
    for (const p of PURITIES) {
      const n = obj(v)[p];
      if (finite(n) && n >= 1) counts[p] = Math.min(999, Math.floor(n));
    }
    if (Object.keys(counts).length) out[id] = counts;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Carriers chosen for a factory's inputs and outputs: known items, known carriers, 0 to 100 km. */
function transportOf(x: unknown): Record<string, Route> | undefined {
  const out: Record<string, Route> = {};
  for (const [key, v] of Object.entries(obj(x))) {
    const m = key.match(/^(in|out):(.+)$/);
    const { by, distance } = obj(v);
    if (!m || !data.items[m[2]] || !CARRIERS.includes(by as Carrier)) continue;
    out[key] = { by: by as Carrier, distance: within(distance, 0, 100_000, 1000) };
  }
  return Object.keys(out).length ? out : undefined;
}

/** A factory tab, cleaned against the current game data. */
export function cleanPlan(saved: unknown, fallback: Plan): Plan {
  const p = obj(saved);
  const model = cleanModel(p.model);
  const built = Array.isArray(p.built)
    ? [...new Set(p.built.filter((id): id is string => typeof id === 'string' && recipeById.has(id)))]
    : [];
  const aims = targets(p.targets ?? fallback.targets);
  // What each resource costs, as typed: a number from zero up.
  const weights = amounts(p.weights);
  // Only a product the factory makes can be on a line of its own.
  const separate = Array.isArray(p.separate)
    ? [...new Set(p.separate.filter((i): i is string => typeof i === 'string' && aims.some((t) => t.item === i)))]
    : [];
  return {
    id: text(p.id, fallback.id, 40),
    name: text(p.name, fallback.name),
    targets: aims,
    supplies: supplies(p.supplies ?? fallback.supplies),
    enabled: Array.isArray(p.enabled)
      ? p.enabled.filter((id): id is string => typeof id === 'string' && recipeById.has(id))
      : fallback.enabled,
    caps: amounts(p.caps),
    fixed: amounts(p.fixed),
    mods: mods(p.mods),
    extraction: extraction(p.extraction ?? fallback.extraction),
    ...(transportOf(p.transport) ? { transport: transportOf(p.transport) } : {}),
    ...(p.floor === 'manual' ? { floor: 'manual' as const } : {}),
    ...(model ? { model } : {}),
    ...(built.length ? { built } : {}),
    ...(separate.length ? { separate } : {}),
    ...(Object.keys(weights).length ? { weights } : {}),
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

/** A power plant tab, its fuel plan cleaned like any factory. */
export function cleanPowerPlan(saved: unknown, fallback: PowerPlan): PowerPlan {
  const g = obj(saved);
  const pp: PowerPlan = {
    id: text(g.id, fallback.id, 40),
    name: text(g.name, fallback.name),
    plants: plants(g.plants),
    sizeBy: oneOf<SizeBy>(g.sizeBy, ['have', 'want', 'factories'], fallback.sizeBy),
    // Only the pool is a source a plant can take from.
    have: supplies(g.have).map((x) => (x.from && x.from !== POOL ? { item: x.item, rate: x.rate } : x)),
    want: within(g.want, 0, 1e7, fallback.want),
    factories:
      g.factories === 'all'
        ? 'all'
        : Array.isArray(g.factories)
          ? [...new Set(g.factories.filter((id): id is string => typeof id === 'string'))].slice(0, 1000)
          : fallback.factories,
    extra: within(g.extra, 0, 1e7, fallback.extra),
    headroom: within(g.headroom, 0, 2, fallback.headroom),
    ownLoad: typeof g.ownLoad === 'boolean' ? g.ownLoad : fallback.ownLoad,
    backup: within(g.backup, 0, 1e5, fallback.backup),
    chain: cleanPlan(g.chain, fallback.chain),
  };
  if (g.autoName === true) pp.autoName = true;
  return pp;
}

/**
 * The single power grid saved before plant tabs: it becomes a plant sized to the factories it fed,
 * keeping its generators, loads and fuel plan.
 */
export function gridToPower(saved: unknown, fallback: PowerPlan, factories: string[]): PowerPlan {
  const g = obj(saved);
  const exclude = new Set(list(g.exclude).filter((id): id is string => typeof id === 'string'));
  const pp = cleanPowerPlan(
    {
      ...g,
      id: fallback.id,
      name: fallback.name,
      sizeBy: 'factories',
      factories: exclude.size ? factories.filter((id) => !exclude.has(id)) : 'all',
    },
    fallback,
  );
  pp.chain.id = fallback.chain.id;
  // Named after its first generator, like a new plant; an empty one keeps waiting for one.
  const first = pp.plants[0];
  if (first) pp.name = PLANT_NAMES[first.generator] ?? pp.name;
  else pp.autoName = true;
  return pp;
}

const COLOR = /^#[\da-f]{6}$/i;

/** The save's multipliers, each within what the game allows; anything else is the game as shipped. */
function gameOf(x: unknown): GameRules {
  const g = obj(x);
  const one = (k: keyof GameRules) =>
    finite(g[k]) && (g[k] as number) >= GAME_RANGE.min && (g[k] as number) <= GAME_RANGE.max ? (g[k] as number) : DEFAULT_GAME[k];
  return { parts: one('parts'), power: one('power'), elevator: one('elevator') };
}

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
    autoBelts: oneOf(s.autoBelts, ['curve', 'square'] as const, d.autoBelts),
    beltMotion: typeof s.beltMotion === 'boolean' ? s.beltMotion : d.beltMotion,
    gridLines: typeof s.gridLines === 'boolean' ? s.gridLines : d.gridLines,
    addWith: oneOf(s.addWith, ['right', 'double'] as const, d.addWith),
    beltColors: oneOf(s.beltColors, ['tier', 'one'] as const, d.beltColors),
    colors,
    decimals: finite(s.decimals) ? Math.round(clampSetting('decimals', s.decimals as number)) : d.decimals,
    motion: oneOf(s.motion, ['system', 'reduce', 'full'] as const, d.motion),
    font: oneOf(
      s.font,
      FONTS.map((f) => f.id),
      d.font,
    ),
    showLocked: typeof s.showLocked === 'boolean' ? s.showLocked : d.showLocked,
    summary: oneOf(s.summary, ['compact', 'full'] as const, d.summary),
    splitLines: oneOf(s.splitLines, ['each', 'one'] as const, d.splitLines),
    game: gameOf(s.game),
  };
}

/** Plain numbers and choices saved alongside the plans. */
export const cleanNumber = within;
export const cleanChoice = oneOf;
