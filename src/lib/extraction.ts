import { data, type Extractor } from './data';
import type { Target } from './solver';

export type Purity = 'impure' | 'normal' | 'pure';
export const PURITY: Record<Purity, number> = { impure: 0.5, normal: 1, pure: 2 };
export const PURITIES: Purity[] = ['impure', 'normal', 'pure'];

export const MINERS = data.extractors.filter((e) => e.resources.length === 0);

export interface ExtractionSettings {
  miner: string;
  purity: Purity;
  /** Extractor clock, 1 = 100%, up to 2.5. */
  clock: number;
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
    const per = (p: Purity) => extractor.rate * (extractor.purity ? PURITY[p] : 1) * settings.clock;
    const counts = Object.fromEntries(PURITIES.map((p) => [p, Math.ceil(r.rate / per(p) - 1e-6)])) as Record<Purity, number>;
    const built = counts[settings.purity];
    // Spread the load evenly: each building underclocks to exactly what's needed.
    const clock = built > 0 ? (r.rate / (built * per(settings.purity))) * settings.clock : 0;
    uses.push({ item: r.item, rate: r.rate, extractor, counts, built, power: built * extractor.power * clock ** extractor.powerExp });
  }
  return uses;
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
