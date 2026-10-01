import { data, type Transport, transportFor } from './data';
import type { RecipeUse } from './solver';

/** Whether a transport is a pipe, for naming it "Pipeline Mk.2" rather than "Conveyor Belt Mk.2". */
export const isPipe = (t: Transport) => data.pipes.some((p) => p.id === t.id);

export interface BuildGroups {
  /** Machines in each group, biggest first: [6, 4]. */
  sizes: number[];
  /** The item that sets the split and the belt or pipe it would overflow. */
  item: string;
  rate: number;
  transport: Transport;
}

const EPS = 1e-6;

/**
 * How to build a line so every belt and pipe in and out of each group fits on one of the best unlocked
 * at this tier: ten blenders making 1,000 m³/min of rocket fuel on 600 m³/min pipes are built as 6 + 4.
 * Machines are packed in order, each group taking as many as fit. Undefined when the whole line fits.
 * An item a single machine already needs more than one belt for is left out (that's lanes, not groups).
 */
export function buildGroups(use: RecipeUse, tier: number): BuildGroups | undefined {
  const total = use.clocks.reduce((a, c) => a + c, 0);
  if (use.clocks.length < 2 || total <= 0) return undefined;
  const flows = [...use.inputs, ...use.outputs]
    .map((f) => {
      const item = data.items[f.item];
      return item && f.rate > EPS
        ? { item: f.item, rate: f.rate, cap: transportFor(item, Number.POSITIVE_INFINITY, tier).transport }
        : undefined;
    })
    .filter((f) => f !== undefined)
    .filter((f) => Math.max(...use.clocks) * (f.rate / total) <= f.cap.rate + EPS);
  let worst: (typeof flows)[number] | undefined;
  for (const f of flows) if (f.rate > f.cap.rate + EPS && (!worst || f.rate / f.cap.rate > worst.rate / worst.cap.rate)) worst = f;
  if (!worst) return undefined;

  const sizes: number[] = [];
  let load = flows.map(() => 0);
  let n = 0;
  for (const c of use.clocks) {
    const add = flows.map((f) => f.rate * (c / total));
    if (n > 0 && flows.some((f, i) => load[i] + add[i] > f.cap.rate + EPS)) {
      sizes.push(n);
      load = flows.map(() => 0);
      n = 0;
    }
    load = load.map((l, i) => l + add[i]);
    n++;
  }
  sizes.push(n);
  if (sizes.length < 2) return undefined;
  return { sizes: sizes.sort((a, b) => b - a), item: worst.item, rate: worst.rate, transport: worst.cap };
}

/** "6 + 4", or "3 × 6 + 2" when several groups are the same size. */
export function groupsLabel(sizes: number[]): string {
  const runs: { size: number; n: number }[] = [];
  for (const s of sizes) {
    const last = runs.at(-1);
    if (last && last.size === s) last.n++;
    else runs.push({ size: s, n: 1 });
  }
  return runs.map((r) => (r.n > 1 ? `${r.n} × ${r.size}` : `${r.size}`)).join(' + ');
}
