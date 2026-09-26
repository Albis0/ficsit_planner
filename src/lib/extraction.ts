import { data, type Extractor } from './data';
import { shardsFor, type Target } from './solver';

export type Purity = 'impure' | 'normal' | 'pure';
export const PURITY: Record<Purity, number> = { impure: 0.5, normal: 1, pure: 2 };
export const PURITIES: Purity[] = ['impure', 'normal', 'pure'];

export const MINERS = data.extractors.filter((e) => e.resources.length === 0);

export interface ExtractionSettings {
  miner: string;
  purity: Purity;
  /** Extractor clock, 1 = 100%, up to 2.5. */
  clock: number;
  /** Per resource, a clock set by placing power shards in its extractors (Use all); beats `clock`. */
  overclock?: Record<string, number>;
}

export const DEFAULT_EXTRACTION: ExtractionSettings = { miner: 'Build_MinerMk2_C', purity: 'normal', clock: 1 };

export interface ExtractionUse {
  item: string;
  rate: number;
  extractor: Extractor;
  /** Buildings needed for each node purity, at the chosen clock. */
  counts: Record<Purity, number>;
  /** Buildings needed on the chosen purity. */
  built: number;
  power: number;
  /** Clock each of them runs at, the load spread evenly. */
  clock: number;
  /** Power shards in them: one per 50% over 100%, each. */
  shards: number;
}

/** Picks the extractor for a raw resource: the chosen miner for solids, the dedicated pump for fluids. */
export function extractorFor(item: string, settings: ExtractionSettings): Extractor | undefined {
  if (data.items[item]?.form === 'solid') return data.extractors.find((e) => e.id === settings.miner) ?? MINERS.at(-1);
  // Prefer a node pump (oil/water) over resource wells; nitrogen only comes from wells.
  const options = data.extractors.filter((e) => e.resources.includes(item));
  return options.find((e) => e.id !== 'Build_FrackingExtractor_C') ?? options[0];
}

/** The chosen miner, or the best one unlocked at this tier when the chosen one isn't unlocked yet. */
export function effectiveExtraction(settings: ExtractionSettings, tier: number): ExtractionSettings {
  const chosen = MINERS.find((m) => m.id === settings.miner);
  if (chosen && chosen.tier <= tier) return settings;
  const best = MINERS.filter((m) => m.tier <= tier).at(-1) ?? MINERS[0];
  return { ...settings, miner: best.id };
}

export function planExtraction(raw: Target[], settings: ExtractionSettings): ExtractionUse[] {
  const uses: ExtractionUse[] = [];
  for (const r of raw) {
    const extractor = extractorFor(r.item, settings);
    if (!extractor) continue;
    const set = settings.overclock?.[r.item] ?? settings.clock;
    const per = (p: Purity) => extractor.rate * (extractor.purity ? PURITY[p] : 1) * set;
    const counts = Object.fromEntries(PURITIES.map((p) => [p, Math.ceil(r.rate / per(p) - 1e-6)])) as Record<Purity, number>;
    const built = counts[settings.purity];
    // Spread the load evenly: each building underclocks to exactly what's needed.
    const clock = built > 0 ? (r.rate / (built * per(settings.purity))) * set : 0;
    uses.push({
      item: r.item,
      rate: r.rate,
      extractor,
      counts,
      built,
      power: built * extractor.power * clock ** extractor.powerExp,
      clock,
      shards: built * shardsFor(clock),
    });
  }
  return uses;
}

/** Output of one extractor at 100% on the chosen purity. */
export function extractorRate(item: string, settings: ExtractionSettings): number {
  const e = extractorFor(item, settings);
  return e ? e.rate * (e.purity ? PURITY[settings.purity] : 1) : 0;
}

/**
 * Puts spare power shards into extractors, the resources with the most buildings first: each drops to
 * as few buildings as the shards allow (at most 250% each). Returns a clock per resource it changed.
 */
export function overclockExtractors(raw: Target[], settings: ExtractionSettings, spare: number): Record<string, number> {
  const out: Record<string, number> = {};
  let left = spare;
  const now = planExtraction(raw, { ...settings, overclock: undefined });
  const lines = now
    .map((u) => ({ u, units: u.rate / extractorRate(u.item, settings) }))
    .filter((x) => Number.isFinite(x.units))
    .sort((a, b) => b.u.built - a.u.built);
  for (const { u, units } of lines) {
    if (left <= 0) break;
    for (let built = Math.max(1, Math.ceil(units / 2.5 - 1e-6)); built < u.built; built++) {
      const clock = units / built;
      const extra = built * shardsFor(clock) - u.shards;
      if (extra <= left) {
        out[u.item] = clock;
        left -= extra;
        break;
      }
    }
  }
  return out;
}

/**
 * MW each raw resource's extractors draw per unit/min, at these settings. The power planner adds it
 * to the load, so the miners and pumps feeding the generators are paid for too.
 */
export function extractionPowerPerUnit(settings: ExtractionSettings): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of Object.values(data.items)) {
    if (!item.raw) continue;
    const e = extractorFor(item.id, settings);
    if (!e) continue;
    const rate = e.rate * (e.purity ? PURITY[settings.purity] : 1) * settings.clock;
    out[item.id] = (e.power * settings.clock ** e.powerExp) / rate;
  }
  return out;
}
