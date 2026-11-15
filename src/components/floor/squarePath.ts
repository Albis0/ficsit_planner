/** How round a belt's square turns are, in floor units. */
export const SQUARE_TURN = 12;

export type Pt = { x: number; y: number };

/**
 * The turn radius for a belt of `lanes` side by side, `pitch` apart: more than the outer lane's distance from the middle,
 * or the inner lane's line folds over itself in the bend.
 */
export const turnFor = (lanes: number, pitch: number) => Math.max(SQUARE_TURN, ((lanes - 1) / 2) * pitch + 12);

/**
 * A laid-out belt's bends kept between its two ends along the flow, `lead` clear of each. The layout puts a belt's first
 * and last bends on the cards' borders, but the ends stand out from them, so the belt would run past its end and turn
 * back into it; belts side by side then swing round that point like a fan. A belt running back against the flow is left as it is.
 */
export function keepBetween(bends: Pt[], from: Pt, to: Pt, down: boolean, lead: number): Pt[] {
  const k = down ? 'y' : 'x';
  if (to[k] <= from[k]) return bends;
  let [lo, hi] = [from[k] + lead, to[k] - lead];
  if (lo > hi) lo = hi = (from[k] + to[k]) / 2;
  return bends.map((p) => ({ ...p, [k]: Math.min(hi, Math.max(lo, p[k])) }));
}

/**
 * A belt in straight runs with rounded square turns, from one end through its bends to the other. The ends are where
 * the cards draw them, so the first and last bends line up with them; with no bends it steps across half way. On a
 * floor running down the same holds turned a quarter: it leaves and reaches its ends going down.
 */
export function squarePath(
  from: Pt,
  bends: Pt[],
  to: Pt,
  down = false,
  free = false,
  radius = SQUARE_TURN,
): { path: string; runs: [Pt, Pt][] } {
  // Worked out as if left to right, then turned back.
  const turn = (p: Pt) => (down ? { x: p.y, y: p.x } : { ...p });
  const [a0, b0] = [turn(from), turn(to)];
  const mid = bends.map(turn);
  // The player's own stops are exactly where they put them: not squared up to the ends.
  const squared = !(free && mid.length);
  if (!squared) {
    const all = [a0, ...mid, b0];
    const out = stopTurns(all).flatMap((bend, i) => [...bend, all[i + 1]]);
    mid.splice(0, mid.length, ...out.slice(0, -1));
  } else if (mid.length >= 2) {
    mid[0].y = a0.y;
    mid[mid.length - 1].y = b0.y;
  } else if (mid.length === 0 && Math.abs(a0.y - b0.y) > 0.5) {
    const x = (a0.x + b0.x) / 2;
    mid.push({ x, y: a0.y }, { x, y: b0.y });
  }
  const pts = [a0, ...mid, b0]
    .map(turn)
    .filter((p, i, all) => i === 0 || Math.abs(p.x - all[i - 1].x) + Math.abs(p.y - all[i - 1].y) > 0.5);
  let d = `M${pts[0].x},${pts[0].y}`;
  const far = (p: Pt, q: Pt) => Math.hypot(q.x - p.x, q.y - p.y);
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]];
    const e = pts[i + 2];
    // Belts side by side stepping aside less than their turns need, and going on the same way: one easy S, since two
    // square turns that close fold the inner belts over themselves.
    if (radius > SQUARE_TURN && e && i + 1 < pts.length - 1 && far(b, c) < 2 * radius) {
      const [u, w] = [far(a, b), far(c, e)];
      if ((b.x - a.x) * (e.x - c.x) + (b.y - a.y) * (e.y - c.y) > 0) {
        const s1 = Math.min(radius, u / (i === 1 ? 1 : 2)) / (u || 1);
        const s2 = Math.min(radius, w / (i + 1 === pts.length - 2 ? 1 : 2)) / (w || 1);
        d += ` L${b.x - (b.x - a.x) * s1},${b.y - (b.y - a.y) * s1} C${b.x},${b.y} ${c.x},${c.y} ${c.x + (e.x - c.x) * s2},${c.y + (e.y - c.y) * s2}`;
        i++;
        continue;
      }
    }
    // A run between two turns gives each half of it; the first and last runs have only the one turn.
    const r = Math.min(
      radius,
      Math.hypot(b.x - a.x, b.y - a.y) / (i === 1 ? 1 : 2),
      Math.hypot(c.x - b.x, c.y - b.y) / (i === pts.length - 2 ? 1 : 2),
    );
    const k1 = r / (Math.hypot(b.x - a.x, b.y - a.y) || 1);
    const k2 = r / (Math.hypot(c.x - b.x, c.y - b.y) || 1);
    d += ` L${b.x - (b.x - a.x) * k1},${b.y - (b.y - a.y) * k1} Q${b.x},${b.y} ${b.x + (c.x - b.x) * k2},${b.y + (c.y - b.y) * k2}`;
  }
  const last = pts[pts.length - 1];
  d += ` L${last.x},${last.y}`;
  return { path: d, runs: pts.slice(1).map((p, i) => [pts[i], p]) };
}

/**
 * Where a belt through the player's own stops turns between each two points, worked out left to right: across first,
 * then up or down, and into the card along the last run. Where that would send it straight back the way it came (a stop
 * pulled off a straight belt), it goes up or down first instead, or on the last run steps across half way.
 */
export function stopTurns(all: Pt[]): Pt[][] {
  const turns: Pt[][] = [];
  // It leaves the card going right.
  let dir = { x: 1, y: 0 };
  const back = (x: number, y: number) => x * dir.x + y * dir.y < 0;
  for (let i = 1; i < all.length; i++) {
    const [p, q] = [all[i - 1], all[i]];
    const [dx, dy] = [q.x - p.x, q.y - p.y];
    let bend: Pt[] = [];
    if (Math.abs(dx) > 0.5 && Math.abs(dy) > 0.5) {
      if (i < all.length - 1) bend = i > 1 && back(Math.sign(dx), 0) ? [{ x: p.x, y: q.y }] : [{ x: q.x, y: p.y }];
      else if (back(0, Math.sign(dy))) {
        const x = (p.x + q.x) / 2;
        bend = [
          { x, y: p.y },
          { x, y: q.y },
        ];
      } else bend = [{ x: p.x, y: q.y }];
    }
    turns.push(bend);
    const from = bend.at(-1) ?? p;
    const [ex, ey] = [q.x - from.x, q.y - from.y];
    if (Math.abs(ex) > 0.5 || Math.abs(ey) > 0.5)
      dir = { x: Math.abs(ex) > 0.5 ? Math.sign(ex) : 0, y: Math.abs(ey) > 0.5 ? Math.sign(ey) : 0 };
  }
  return turns;
}

/** The middle of the longest straight run of a belt: where its label sits. */
export function longestRunMid(runs: [Pt, Pt][]): [number, number] {
  const [a, b] = runs.reduce((l, r) =>
    Math.hypot(r[1].x - r[0].x, r[1].y - r[0].y) > Math.hypot(l[1].x - l[0].x, l[1].y - l[0].y) ? r : l,
  );
  return [(a.x + b.x) / 2, (a.y + b.y) / 2];
}
