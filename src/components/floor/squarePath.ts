/** How round a belt's square turns are, in floor units. */
export const SQUARE_TURN = 12;

export type Pt = { x: number; y: number };

/**
 * A belt in straight runs with rounded square turns, from one end through its bends to the other. The ends are where
 * the cards draw them, so the first and last bends line up with them; with no bends it steps across half way. On a
 * floor running down the same holds turned a quarter: it leaves and reaches its ends going down.
 */
export function squarePath(from: Pt, bends: Pt[], to: Pt, down = false, free = false): { path: string; runs: [Pt, Pt][] } {
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
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]];
    const r = Math.min(SQUARE_TURN, Math.hypot(b.x - a.x, b.y - a.y) / 2, Math.hypot(c.x - b.x, c.y - b.y) / 2);
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
