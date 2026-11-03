import type { Highs } from 'highs';
import { isRunner } from '../types';
import { type Arc, type CNode, fullIn, fullOut, type Net } from './compile';
import type { CalcResult, LinkCalc, NodeCalc, NodeStatus } from './result';

/*
  Max flow: the most every machine can run within its count and clock, every belt within its Mk, every source and
  output within its limit. Two linear programs: first as many machines as busy as can be, then, holding that, as much
  as can reach the outputs with as little going round in circles as possible. A machine set to size itself has no
  count to fill: it takes as many machines as what reaches it keeps busy, so it follows the miners and inputs feeding it. It finds an answer the game could run,
  but not how the game's splitters would share things out; the game rules calculator does that.
*/

/** Stands in for "no limit", so a model with nothing limiting it still has an answer, flagged as unbounded. */
const BIG = 1e6;
const EPS = 1e-7;

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(9).replace(/0+$/, ''));

/** Why a part can't run at all before any numbers: a missing belt, a wrong item, a loop, a lost recipe. */
export function blocker(net: Net, c: CNode): NodeStatus | undefined {
  if (c.node.k === 'unknown' || (isRunner(c.node) && !c.recipe)) return 'unknown';
  if (!isRunner(c.node)) return net.started.has(c.node.id) || c.node.k === 'in' ? undefined : 'idle';
  if (c.inArcs.some((a) => !a)) return 'noInput';
  if (c.inArcs.some((a) => a?.jam)) return 'jam';
  if (!net.drain && c.outArcs.some((a) => !a)) return 'noOutput';
  if (c.outArcs.some((a) => a?.jam)) return 'jam';
  if (!net.started.has(c.node.id)) return 'deadlock';
  return undefined;
}

interface Lp {
  text: (objective: string, sense: 'Maximize' | 'Minimize', extra: string[]) => string;
  /** Machine busy shares, by node; machines in use for a node that sizes itself. */
  u: Map<CNode, string>;
  /** Flow of each item on each belt. */
  f: Map<Arc, Map<string, string>>;
  /** What reaches an output, a sink or a filling container, and what's left over on open outputs: weight and variable. */
  terminal: [number, string][];
  /** What leaves the inputs and emptying containers. */
  sources: string[];
}

/** With `relax`, what a far end can't take is surplus rather than something the machine has to stop for. */
function build(net: Net, relax: boolean): Lp {
  const u = new Map<CNode, string>();
  const f = new Map<Arc, Map<string, string>>();
  const rows: string[] = [];
  const bounds: string[] = [];
  let r = 0;
  const row = (terms: string[], rhs: string) => {
    if (terms.length) rows.push(` c${r++}: ${terms.join(' ')} ${rhs}`);
  };
  const term = (k: number, v: string) => `${k < 0 ? '-' : '+'} ${fmt(Math.abs(k))} ${v}`;

  for (const a of net.arcs) {
    const vars = new Map<string, string>();
    // A jammed belt, or one leaving a part that never starts, moves nothing.
    const dead = a.jam || !net.started.has(a.from.node.id);
    a.items.forEach((item, i) => {
      const name = `f${a.index}_${i}`;
      vars.set(item, name);
      bounds.push(dead ? ` ${name} = 0` : ` 0 <= ${name} <= ${BIG}`);
    });
    f.set(a, vars);
    if (vars.size && Number.isFinite(a.cap))
      row(
        [...vars.values()].map((v) => `+ ${v}`),
        `<= ${fmt(a.cap)}`,
      );
  }
  const flows = (arcs: (Arc | undefined)[], item?: string) =>
    arcs.flatMap((a) => (a ? [...(f.get(a) ?? [])].filter(([i]) => !item || i === item).map(([, v]) => v) : []));

  const terminal: [number, string][] = [];
  const sources: string[] = [];
  net.nodes.forEach((c, i) => {
    const n = c.node;
    if (isRunner(n)) {
      const name = `u${i}`;
      u.set(c, name);
      bounds.push(blocker(net, c) ? ` ${name} = 0` : ` 0 <= ${name} <= ${c.auto ? BIG : 1}`);
      c.inArcs.forEach((a, p) => {
        const item = c.recipe?.inputs[p]?.item;
        if (!a || !item) return;
        row([...flows([a], item).map((v) => `+ ${v}`), term(-fullIn(c, p), name)], '= 0');
      });
      c.outArcs.forEach((a, q) => {
        const item = c.recipe?.outputs[q]?.item;
        if (!item) return;
        // Left over on an open output counts as made, so a line ending in a machine still runs.
        if (!a) {
          if (net.drain && fullOut(c, q) > 0) terminal.push([fullOut(c, q), name]);
          return;
        }
        // Relaxed: what the far end can't take is surplus, as on an open output; the belt still caps what the machine makes.
        if (relax) {
          row([...flows([a], item).map((v) => `+ ${v}`), term(-fullOut(c, q), name)], '<= 0');
          if (Number.isFinite(a.cap) && fullOut(c, q) > 0) row([term(fullOut(c, q), name)], `<= ${fmt(a.cap)}`);
        } else row([...flows([a], item).map((v) => `+ ${v}`), term(-fullOut(c, q), name)], '= 0');
      });
      return;
    }
    const inAll = flows(c.inArcs);
    const outAll = flows(c.outArcs);
    switch (n.k) {
      case 'in':
        sources.push(...outAll);
        if (n.lim !== undefined)
          row(
            outAll.map((v) => `+ ${v}`),
            `<= ${fmt(n.lim)}`,
          );
        break;
      case 'out':
        if (n.lim !== undefined)
          row(
            inAll.map((v) => `+ ${v}`),
            `<= ${fmt(n.lim)}`,
          );
        terminal.push(...inAll.map((v): [number, string] => [1, v]));
        break;
      case 'sink':
        terminal.push(...inAll.map((v): [number, string] => [1, v]));
        break;
      case 'storage':
        if (n.mode === 'fill') {
          if (n.lim !== undefined)
            row(
              inAll.map((v) => `+ ${v}`),
              `<= ${fmt(n.lim)}`,
            );
          terminal.push(...inAll.map((v): [number, string] => [1, v]));
        } else if (n.mode === 'empty') {
          sources.push(...outAll);
          if (n.lim !== undefined)
            row(
              outAll.map((v) => `+ ${v}`),
              `<= ${fmt(n.lim)}`,
            );
        } else conserve(c);
        break;
      case 'logistic':
        conserve(c);
        break;
      default:
        // Unknown parts take and give nothing.
        for (const v of [...inAll, ...outAll]) bounds.push(` ${v} = 0`);
    }
  });

  /** What comes in goes out, item by item. */
  function conserve(c: CNode) {
    const items = new Set<string>();
    for (const a of [...c.inArcs, ...c.outArcs]) if (a) for (const i of a.items) items.add(i);
    for (const item of items) {
      row([...flows(c.inArcs, item).map((v) => `+ ${v}`), ...flows(c.outArcs, item).map((v) => `- ${v}`)], '= 0');
    }
  }

  const text = (objective: string, sense: 'Maximize' | 'Minimize', extra: string[]) =>
    [
      sense,
      ` obj: ${objective || '0'}`,
      'Subject To',
      ...rows,
      ...extra,
      ...(rows.length || extra.length ? [] : [' c_empty: u_none >= 0']),
      'Bounds',
      ...bounds,
      'End',
    ].join('\n');
  return { text, u, f, terminal, sources };
}

/**
 * For each splitter with more than one belt out: a variable for the least it sends down any of them, held under what
 * each one carries. Raising those spreads its load out evenly wherever nothing after it says otherwise.
 */
function splitShares(net: Net, lp: Lp): { least: string; rows: string[] }[] {
  const out: { least: string; rows: string[] }[] = [];
  net.nodes.forEach((c, i) => {
    if (c.node.k !== 'logistic' || c.node.kind === 'merger' || c.node.kind === 'prio') return;
    const arcs = c.outArcs.filter((a): a is Arc => !!a && !a.jam && (lp.f.get(a)?.size ?? 0) > 0);
    if (arcs.length < 2) return;
    const least = `m${i}`;
    out.push({
      least,
      rows: arcs.map((a, q) => ` s${i}_${q}: ${[...(lp.f.get(a)?.values() ?? [])].map((v) => `+ ${v}`).join(' ')} - ${least} >= 0`),
    });
  });
  return out;
}

const solveLp = (highs: Highs, text: string) => {
  const res = highs.solve(text, { output_flag: false });
  if (res.Status !== 'Optimal') throw new Error(`model calc: ${res.Status}`);
  return res;
};

/** The solved columns, and how much reaches the outputs. `floor`: at least that much must, whatever else changes. */
function solve(highs: Highs, net: Net, lp: Lp, floor?: number): { cols: Record<string, { Primal?: number }>; reached: number } {
  // Machines with a count to fill; one that sizes itself has none, and follows what feeds it.
  const uVars = [...lp.u].filter(([c]) => !c.auto).map(([, v]) => v);
  const allF = [...lp.f.values()].flatMap((m) => [...m.values()]);
  // One term per variable: the LP format doesn't add up a variable named twice.
  const made = new Map<string, number>();
  for (const [k, v] of lp.terminal) made.set(v, (made.get(v) ?? 0) + k);
  const sum = (weights: Map<string, number>) => [...weights].map(([v, k]) => `${k < 0 ? '-' : '+'} ${fmt(Math.abs(k))} ${v}`).join(' ');
  const keepMade = floor === undefined || !made.size ? [] : [` made: ${sum(made)} >= ${fmt(Math.max(0, floor * (1 - 1e-7) - 1e-7))}`];
  let cols: Record<string, { Primal?: number }> = {};
  if (lp.u.size || allF.length) {
    // First: as many machines as busy as can be.
    const first = solveLp(highs, lp.text(uVars.map((v) => `+ ${v}`).join(' '), 'Maximize', keepMade));
    const busy = uVars.reduce((s, v) => s + Math.max(0, first.Columns[v]?.Primal ?? 0), 0);
    // A hair under the best, so rounding in a big model can't make holding it impossible.
    const hold = [
      ...(uVars.length ? [` hold: ${uVars.map((v) => `+ ${v}`).join(' ')} >= ${fmt(Math.max(0, busy * (1 - 1e-7) - 1e-7))}`] : []),
      ...keepMade,
    ];
    // Then, keeping that: as much reaching the outputs as can, with as little looping as can be.
    const loops = new Map(allF.map((v) => [v, -0.000001]));
    const second = solveLp(
      highs,
      lp.text(sum(new Map([...loops, ...[...made].map(([v, k]) => [v, k + (loops.get(v) ?? 0)] as const)])), 'Maximize', hold),
    );
    cols = second.Columns as typeof cols;
    // Last, keeping the machines as busy and as much coming in: a splitter shares out as evenly as what's after it
    // lets it, as the game's does, rather than sending everything down the side that makes the most items.
    const shares = splitShares(net, lp);
    if (shares.length) {
      const taken = new Map(lp.sources.map((v) => [v, 1]));
      const total = lp.sources.reduce((t, v) => t + Math.max(0, cols[v]?.Primal ?? 0), 0);
      const keep = taken.size ? [` keep: ${sum(taken)} >= ${fmt(Math.max(0, total * (1 - 1e-9) - 1e-9))}`] : [];
      const obj = [...shares.map((x) => `+ ${x.least}`), sum(loops)].join(' ');
      // With surplus allowed nothing else ties the splitters' sharing to what reaches the outputs, so hold that too.
      const reachedNow = [...made].reduce((t, [v, k]) => t + k * Math.max(0, cols[v]?.Primal ?? 0), 0);
      const holdMade =
        floor !== undefined && made.size ? [` made2: ${sum(made)} >= ${fmt(Math.max(0, reachedNow * (1 - 1e-7) - 1e-7))}`] : [];
      cols = solveLp(highs, lp.text(obj, 'Maximize', [...shares.flatMap((x) => x.rows), ...keep, ...hold, ...holdMade]))
        .Columns as typeof cols;
    }
  }
  const reached = [...made].reduce((t, [v, k]) => t + k * Math.max(0, cols[v]?.Primal ?? 0), 0);
  return { cols, reached };
}

export function basicCalc(highs: Highs, net: Net): CalcResult {
  const result = (lp: Lp, cols: Record<string, { Primal?: number }>) => {
    const val = (name: string | undefined) => (name ? Math.max(0, cols[name]?.Primal ?? 0) : 0);
    return read(
      net,
      (c) => val(lp.u.get(c)),
      (a, item) => val(lp.f.get(a)?.get(item)),
      'basic',
    );
  };
  const strictLp = build(net, false);
  const strict = solve(highs, net, strictLp);
  const out = result(strictLp, strict.cols);
  // A machine stopped for want of a taker for all it makes, while its source has more to give: let what can't be taken
  // be surplus instead, so the line runs. It never reaches the outputs less than it did without.
  if (!net.drain || !Object.values(out.nodes).some((n) => n.status === 'blocked')) return out;
  const relaxedLp = build(net, true);
  return result(relaxedLp, solve(highs, net, relaxedLp, strict.reached).cols);
}

/** A calculator's numbers as a result: each part's ends and status, each belt's load. */
export function read(net: Net, uOf: (c: CNode) => number, flowOf: (a: Arc, item: string) => number, mode: CalcResult['mode']): CalcResult {
  const links: Record<string, LinkCalc> = {};
  let unbounded = false;
  for (const a of net.arcs) {
    const items: [string, number][] = a.items.map((i) => [i, flowOf(a, i)]);
    const rate = items.reduce((s, [, x]) => s + x, 0);
    const status = a.jam
      ? 'jam'
      : rate > BIG / 2
        ? 'unbounded'
        : Number.isFinite(a.cap) && rate >= a.cap * (1 - 1e-6)
          ? 'capped'
          : undefined;
    if (status === 'unbounded') unbounded = true;
    links[a.link.id] = { rate, items: items.filter(([, x]) => x > EPS), cap: a.cap, ...(status ? { status } : {}) };
  }
  const nodes: Record<string, NodeCalc> = {};
  for (const c of net.nodes) {
    const sum = (a: Arc | undefined) => (a ? (links[a.link.id]?.rate ?? 0) : 0);
    const ins = c.inArcs.map(sum);
    const outs = c.outArcs.map(sum);
    if (isRunner(c.node)) {
      // A machine sizing itself runs every machine it takes at full speed; how many is its count.
      const raw = uOf(c);
      const u = c.auto ? (raw > EPS ? 1 : 0) : Math.min(1, raw);
      const block = blocker(net, c);
      const status: NodeStatus = block ?? (u >= 1 - 1e-6 ? 'full' : u > 1e-6 ? 'partial' : 'idle');
      // Made but not taken: nothing on an output end, or a far end that takes less than the machine makes.
      const spare = net.drain
        ? c.outArcs.map((_, q) => {
            const left = fullOut(c, q) * Math.min(c.auto ? BIG : 1, raw) - outs[q];
            return left > EPS ? left : 0;
          })
        : undefined;
      nodes[c.node.id] = {
        u,
        ins,
        outs,
        status,
        ...(c.auto ? { n: raw > EPS ? raw : 0 } : {}),
        ...(c.node.k === 'extract' && u < 1 - 1e-6 ? { unused: fullOut(c, 0) * (1 - u) } : {}),
        ...(spare?.some((x) => x > EPS) ? { spare } : {}),
      };
    } else {
      const block = blocker(net, c);
      const moving = ins.some((x) => x > EPS) || outs.some((x) => x > EPS);
      nodes[c.node.id] = { u: moving ? 1 : 0, ins, outs, status: block ?? (moving ? 'full' : 'idle') };
    }
  }
  flagBlocked(net, nodes);
  return { mode, nodes, links, ...(unbounded ? { unbounded } : {}) };
}

/**
 * A machine with a count that stands idle although a source upstream has more to give isn't short of supply: what it
 * makes can't all be taken in the amounts it makes, so it would back up and stop. Machines sizing themselves follow
 * what feeds them and are left as idle.
 */
function flagBlocked(net: Net, nodes: Record<string, NodeCalc>) {
  const spare = (c: CNode) => {
    const n = nodes[c.node.id];
    if (c.node.k === 'extract') return n.status === 'partial';
    return c.node.k === 'in' && (c.node.lim === undefined || n.outs[0] < c.node.lim - EPS);
  };
  const seen = new Set<CNode>(net.nodes.filter(spare));
  const queue = [...seen];
  for (const c of queue)
    for (const a of c.outArcs)
      if (a && !seen.has(a.to)) {
        seen.add(a.to);
        queue.push(a.to);
      }
  for (const c of seen) if (nodes[c.node.id].status === 'idle' && c.node.k === 'machine' && !c.auto) nodes[c.node.id].status = 'blocked';
}
