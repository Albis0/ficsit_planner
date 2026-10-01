import {
  Background,
  BackgroundVariant,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  useInternalNode,
  useReactFlow,
  useStore as useFlowStore,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { groupClocks } from '../lib/clocks';
import { buildGroups, groupsLabel, isPipe } from '../lib/groups';
import { data } from '../lib/data';
import type { ExtractionUse } from '../lib/extraction';
import {
  buildGraph,
  type Consumer,
  type Direction,
  type EndpointNodeData,
  type FlowEdgeData,
  type MachineNodeData,
  type Point,
  type PowerEdgeData,
  type PowerNodeData,
  cardExtra,
  runExtra,
} from '../lib/graph';
import { useT } from '../lib/i18n';
import { generatorById } from '../lib/data';
import { minerLabel, recipeLabel } from '../lib/text';
import { COARSE, useMediaQuery } from '../lib/useMediaQuery';
import type { SolveResult } from '../lib/solver';
import { usePlan, useStore } from '../store';
import { beltStroke } from './floor/BeltStroke';
import { Glyph } from './Glyph';
import { Icon } from './Icon';
import { Slot } from './Slot';
import { SplitBadge, SplitTo } from './SplitText';

/**
 * Hovered node (or every card of the machine line being inspected) and their direct neighbours; everything else
 * fades so one line can be followed.
 */
const Focus = createContext<{ nodes?: Set<string>; near: Set<string>; edge?: string }>({ near: new Set() });
/** The belt whose label was clicked, which then says where it comes from and goes to. */
const PickEdge = createContext<(id?: string) => void>(() => {});

/** Which way the line runs, so node handles sit on the matching sides. */
const Flow = createContext<Direction>('LR');

/** Items this factory trades with other tabs: what it sends where, what it takes from where, and its own products. */
export interface FactoryLinks {
  to: Map<string, { name: string; rate: number }[]>;
  from: Map<string, string>;
  own: Set<string>;
}
const Links = createContext<FactoryLinks | undefined>(undefined);
const inSide = (dir: Direction) => (dir === 'TB' ? Position.Top : Position.Left);
const outSide = (dir: Direction) => (dir === 'TB' ? Position.Bottom : Position.Right);

/** Extractor counts per raw resource, shown on the ore/fluid source nodes. */
const Extraction = createContext<Map<string, ExtractionUse>>(new Map());

const useFaded = (id: string) => {
  const f = useContext(Focus);
  return f.nodes !== undefined && !f.near.has(id);
};

/** Below this zoom belt labels hide, so the machines stay readable. */
const FAR_ZOOM = 0.55;

const zoomSelector = (s: { transform: [number, number, number] }) =>
  s.transform[2] < FAR_ZOOM ? 'far' : s.transform[2] < 0.8 ? 'mid' : 'near';

/**
 * Below this zoom belts stop moving: slats a few pixels apart, redrawn slower on a big floor, strobe
 * and seem to race instead of moving.
 */
const STILL_ZOOM = 0.7;
const stillSelector = (s: { transform: [number, number, number] }) => s.transform[2] < STILL_ZOOM;

/** Bottom edge colour for machines holding power shards (blue), somersloops (pink) or both (half and half). */
export function modBar(shards: number, sloops: number): string | undefined {
  if (shards > 0 && sloops > 0) return 'linear-gradient(90deg, var(--shard) 50%, var(--sloop) 50%)';
  if (shards > 0) return 'var(--shard)';
  if (sloops > 0) return 'var(--sloop)';
  return undefined;
}

/** The count-and-clock line: "3 × 83.33%", or "2 × 150% + 1 × 100%" when a line is partly overclocked. */
export function RunLine({ clocks }: { clocks: number[] }) {
  const { num } = useT();
  return (
    <span className="machine-run">
      {groupClocks(clocks).map((g, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: clock groups are derived in a fixed order and never reordered.
        <span key={i} className={g.clock > 1 + 1e-6 ? 'over' : undefined}>
          {i > 0 && <span className="plus">+</span>}
          <b>{g.n}</b>
          <span className="times">×</span>
          {num(g.clock * 100)}%
        </span>
      ))}
    </span>
  );
}

/** "6 + 4 groups" when the line's belts or pipes don't fit one of the best unlocked; the title says which. */
function GroupsBadge({ use }: { use: MachineNodeData['use'] }) {
  const { t, name, num } = useT();
  const tier = useStore((s) => s.tier);
  const g = buildGroups(use, tier);
  if (!g) return null;
  const transport = t(isPipe(g.transport) ? 'pipeName' : 'beltName', { mk: g.transport.name });
  return (
    <span className="mod-badge groups" title={t('groupsWhy', { rate: num(g.rate), item: name(data.items[g.item]), transport })}>
      {t('groupsShort', { sizes: groupsLabel(g.sizes) })}
    </span>
  );
}

/** Which of a split line's groups this card is: "2/3". */
function GroupTag({ group }: { group: MachineNodeData['group'] }) {
  const { t } = useT();
  if (!group) return null;
  return (
    <span className="machine-group" title={t('machineGroup', { n: group.n, of: group.of })}>
      {group.n}/{group.of}
    </span>
  );
}

/** A row of generators: the strip names the fuel and what they put on the grid, the building below. */
function GeneratorNode({ id, data: d, selected }: NodeProps) {
  const { name, num } = useT();
  const { use, generation = 0, group } = d as MachineNodeData;
  const dir = useContext(Flow);
  const faded = useFaded(id);
  const gen = generatorById.get(use.recipe.machine);
  const fuel = use.recipe.inputs.find((i) => data.items[i.item]?.energy)?.item;
  return (
    <div
      className={`machine-node power gen-${gen?.kind ?? 'fuel'} ${faded ? 'faded' : ''} ${selected ? 'selected' : ''}`}
      style={{ ['--run-extra' as string]: runExtra(use), ...(use.shards > 0 ? { ['--mod-bar' as string]: 'var(--shard)' } : {}) }}
    >
      <Handle type="target" position={inSide(dir)} />
      <div className="machine-strip">
        <Icon id={fuel ?? use.recipe.machine} size={30} className="strip-icon" />
        <span className="machine-product">{fuel ? name(data.items[fuel]) : name(gen)}</span>
        <GroupTag group={group} />
        <span className="machine-power made">
          <Glyph name="bolt" size={15} />
          {num(generation)}
          <small>MW</small>
        </span>
      </div>
      <div className="machine-body">
        <Icon id={use.recipe.machine} size={60} className="machine-icon" />
        <span className="machine-info">
          <span className="machine-type">{name(gen)}</span>
          <RunLine clocks={use.clocks} />
          <span className="machine-mods">
            {use.shards > 0 && <span className="mod-badge shard">{use.shards} ◆</span>}
            <GroupsBadge use={use} />
          </span>
        </span>
      </div>
      <Handle type="source" position={outSide(dir)} />
    </div>
  );
}

function MachineNode(props: NodeProps) {
  const { id, data: d, selected } = props;
  const { name, num } = useT();
  const { use, split, part, group } = d as MachineNodeData;
  const dir = useContext(Flow);
  const { recipe } = use;
  const faded = useFaded(id);
  if (recipe.kind === 'power') return <GeneratorNode {...props} />;
  const bar = modBar(use.shards, use.sloops);
  return (
    <div
      className={`machine-node ${recipe.kind} ${faded ? 'faded' : ''} ${selected ? 'selected' : ''}`}
      style={{ ['--run-extra' as string]: cardExtra(use, split ?? part), ...(bar ? { ['--mod-bar' as string]: bar } : {}) }}
    >
      <Handle type="target" position={inSide(dir)} />
      {/* The in-game build menu look: a coloured strip naming what it makes, the building and its draw below. */}
      <div className="machine-strip">
        <Icon id={recipe.outputs[0].item} size={30} className="strip-icon" />
        <span className="machine-product" title={recipeLabel(name(recipe), recipe.kind)}>
          {recipeLabel(name(recipe), recipe.kind)}
        </span>
        <GroupTag group={group} />
      </div>
      <div className="machine-body">
        <Icon id={recipe.machine} size={60} className="machine-icon" />
        <span className="machine-info">
          <span className="machine-type">{name(data.machines[recipe.machine])}</span>
          {/* Count and clock read as one: "3 × 83.33%" is three machines at 83.33% each. */}
          <RunLine clocks={use.clocks} />
          <span className="machine-mods">
            <span className="machine-draw">
              {num(use.power)}
              <small>MW</small>
            </span>
            {use.shards > 0 && <span className="mod-badge shard">{use.shards} ◆</span>}
            {use.sloops > 0 && <span className="mod-badge sloop">{use.sloops} ●</span>}
            <GroupsBadge use={use} />
          </span>
          {split && <SplitBadge split={split} />}
          {part && <SplitTo part={part} />}
        </span>
      </div>
      <Handle type="source" position={outSide(dir)} />
    </div>
  );
}

/** Raw input amount you can click and retype; Enter or leaving the field pins it. */
function PinnableRate({ item, rate }: { item: string; rate: number }) {
  const { t, num } = useT();
  const fixed = usePlan().fixed[item];
  const setFixed = useStore((s) => s.setFixed);
  const power = useStore((s) => s.mode === 'power');
  const [editing, setEditing] = useState(false);

  if (power) {
    return (
      <span className="endpoint-rate">
        {num(rate)}
        <small>{t('perMin')}</small>
      </span>
    );
  }

  if (editing) {
    const commit = (text: string) => {
      const n = Number.parseFloat(text.replace(',', '.'));
      if (Number.isFinite(n) && n > 0) setFixed(item, n);
      setEditing(false);
    };
    return (
      <input
        className="rate-input pin-input nodrag"
        // biome-ignore lint/a11y/noAutofocus: the field only appears after the user clicks the rate to edit it.
        autoFocus
        inputMode="decimal"
        defaultValue={String(Math.round(rate * 100) / 100)}
        aria-label={t('pinInput')}
        onFocus={(e) => e.target.select()}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }
  return (
    <span className="pin">
      <button type="button" className="endpoint-rate editable nodrag" title={t('pinHint')} onClick={() => setEditing(true)}>
        {num(rate)}
        <small>{t('perMin')}</small>
      </button>
      {fixed !== undefined && (
        <button type="button" className="pin-badge nodrag" title={t('unpin')} onClick={() => setFixed(item, undefined)}>
          {t('pinned')} ×
        </button>
      )}
    </span>
  );
}

function EndpointNode({ id, data: d }: NodeProps) {
  const { name, num, t } = useT();
  const { kind, item, rate } = d as EndpointNodeData;
  const faded = useFaded(id);
  const ex = useContext(Extraction).get(item);
  const dir = useContext(Flow);
  const links = useContext(Links);
  const sent = kind === 'target' ? links?.to.get(item) : undefined;
  const source = kind === 'supply' ? links?.from.get(item) : undefined;
  const onlySent = sent && !links?.own.has(item);
  const label = onlySent
    ? t('toFactoryLabel', { name: sent.map((x) => x.name).join(', ') })
    : source
      ? t('fromFactoryLabel', { name: source })
      : { raw: t('rawInput'), supply: t('onHand'), missing: t('bringIn'), target: t('output'), surplus: t('surplus') }[kind];
  const it = data.items[item];
  const feeds = kind === 'raw' || kind === 'supply' || kind === 'missing';
  return (
    <div
      className={`endpoint-node ${kind} ${faded ? 'faded' : ''}`}
      style={it.form !== 'solid' ? { ['--fluid-color' as string]: it.color ?? 'var(--fluid)' } : undefined}
    >
      {!feeds && <Handle type="target" position={inSide(dir)} />}
      <Slot id={item} size={60} tone={kind === 'target' ? 'target' : 'default'} />
      <span className="endpoint-text">
        <span className="endpoint-kind">{label}</span>
        <span className={`endpoint-name ${name(it).length > 21 ? 'long' : ''}`} title={name(it)}>
          {name(it)}
        </span>
        {/* The amount under the name, so a long name or a wide typeface keeps the whole width; its miners or
            where part of it goes beside it. */}
        <span className="endpoint-line">
          {kind === 'raw' ? (
            <PinnableRate item={item} rate={rate} />
          ) : (
            <span className="endpoint-rate">
              {num(rate)}
              <small>{t('perMin')}</small>
            </span>
          )}
          {sent && !onlySent && (
            <span className="endpoint-extract">
              {sent.map((x) => t('alsoSent', { rate: `${num(x.rate)}${t('perMin')}`, name: x.name })).join(', ')}
            </span>
          )}
          {kind === 'raw' && ex && (
            <span className="endpoint-extract" title={`${ex.built}× ${name(ex.extractor)}`}>
              <Icon id={ex.extractor.id} size={20} />
              {/* A miner is its mark on its own ("8× Mk.3"), so the line fits beside the amount. */}
              {ex.built}× {minerLabel(name(ex.extractor))}
            </span>
          )}
        </span>
      </span>
      {feeds && <Handle type="source" position={outSide(dir)} />}
    </div>
  );
}

/** The grid itself, and each thing it feeds. */
function PowerNode({ id, data: d }: NodeProps) {
  const { t, num } = useT();
  const { kind, label, mw, tone, boost, balance = 0 } = d as PowerNodeData;
  const dir = useContext(Flow);
  const faded = useFaded(id);
  const hasOut = useFlowStore((s) => s.edges.some((e) => e.source === id));
  if (kind === 'grid') {
    const short = balance < -0.5;
    return (
      <div className={`power-node grid ${short ? 'short' : ''} ${faded ? 'faded' : ''}`}>
        <Handle type="target" position={inSide(dir)} />
        <span className="grid-head">
          <Glyph name="bolt" size={18} />
          {t('powerGrid')}
        </span>
        <span className="grid-mw">
          {num(mw)}
          <small>MW</small>
        </span>
        <span className="grid-foot">
          <span className={short ? 'bad' : 'good'}>{short ? t('shortBy', { mw: num(-balance) }) : t('spareBy', { mw: num(balance) })}</span>
          {!!boost && <span className="grid-boost">{t('boostTag', { boost: num(boost * 100) })}</span>}
        </span>
        {hasOut && <Handle type="source" position={outSide(dir)} />}
      </div>
    );
  }
  return (
    <div className={`power-node consumer ${tone ?? ''} ${faded ? 'faded' : ''}`}>
      <Handle type="target" position={inSide(dir)} />
      <Glyph name={tone === 'chain' || tone === 'out' ? 'bolt' : tone === 'other' ? 'sliders' : 'factory'} size={26} />
      <span className="consumer-text">
        <span className="consumer-kind">
          {tone === 'chain' ? t('fuelChain') : tone === 'other' ? t('otherLoad') : tone === 'out' ? t('gridOut') : t('planName')}
        </span>
        <span className="consumer-name">{label}</span>
        <span className="consumer-mw">
          {num(mw)}
          <small>MW</small>
        </span>
      </span>
    </div>
  );
}

/** A power line: a dark cable with current pulsing along its core. */
function PowerEdge({ source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data: d }: EdgeProps) {
  const { num } = useT();
  const focus = useContext(Focus);
  const zoom = useFlowStore(zoomSelector);
  const still = useFlowStore(stillSelector);
  const labels = useStore((s) => s.settings.beltLabels);
  const { mw, route } = d as PowerEdgeData;
  const dir = useContext(Flow);
  const from = useInternalNode(source)?.internals.positionAbsolute;
  const to = useInternalNode(target)?.internals.positionAbsolute;
  let path: string;
  let lx: number;
  let ly: number;
  if (route && !moved(from, route.from) && !moved(to, route.to)) {
    path = routePath([{ x: sourceX, y: sourceY }, ...route.points, { x: targetX, y: targetY }], dir);
    lx = route.label.x;
    ly = route.label.y;
  } else {
    [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  }
  const lit = focus.nodes !== undefined && (focus.nodes.has(source) || focus.nodes.has(target));
  const faded = focus.nodes !== undefined && !lit;
  const state = `${faded ? 'faded' : ''} ${lit ? 'lit' : ''} ${still ? 'still' : ''}`;
  const showLabel = labels === 'always' || lit || (labels === 'auto' && zoom !== 'far');
  return (
    <>
      <g className={`power-edge ${state}`}>
        <path d={path} className="cable" />
        <path d={path} className="cable-core" />
      </g>
      {showLabel && (
        <EdgeLabelRenderer>
          <div className="edge-anchor" style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}>
            <div className={`edge-label power ${state}`}>
              <Glyph name="bolt" size={16} />
              <span className="edge-rate">
                {num(mw)} <small>MW</small>
              </span>
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/** Radius of a belt's turn where a run across the flow meets one along it. */
const TURN = 36;

/**
 * A belt through the route's bends. Stretches that mostly go along the flow leave and arrive straight along it, so
 * belts never overshoot or loop where several meet at one input. Stretches that mostly go across it run straight,
 * with a rounded turn wherever they meet an along stretch. At a machine's handle the belt leaves (or arrives) along
 * the flow and eases into the run across, so belts sharing a handle fan out from it like a splitter.
 */
export function routePath(pts: Point[], dir: Direction): string {
  // In (u, v): u along the flow, v across it, so one rule serves both directions.
  type V = [number, number];
  const uv = (p: Point): V => (dir === 'LR' ? [p.x, p.y] : [p.y, p.x]);
  const xy = ([u, v]: V) => (dir === 'LR' ? `${u},${v}` : `${v},${u}`);
  const add = (a: V, b: V, k = 1): V => [a[0] + b[0] * k, a[1] + b[1] * k];
  const P = pts.map(uv);
  const n = P.length - 1;
  const delta = (i: number): V => [P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]];
  const len = (i: number) => Math.hypot(...delta(i));
  // Too little room along the flow to curve: a run across it.
  const across = Array.from({ length: n }, (_, i) => {
    const [du, dv] = delta(i);
    return Math.abs(du) < Math.min(2 * TURN, Math.abs(dv));
  });
  /** Which way stretch i heads where it starts and ends. */
  const heading = (i: number): V => {
    if (!across[i]) return [Math.sign(delta(i)[0]) || 1, 0];
    const l = len(i) || 1;
    return [delta(i)[0] / l, delta(i)[1] / l];
  };
  const room = (i: number) => (across[i] ? len(i) : Math.abs(delta(i)[0])) / 2;
  // A rounded corner at each point inside the route where an along stretch meets an across one.
  const turn = (k: number) => (k > 0 && k < n && across[k - 1] !== across[k] ? Math.min(TURN, room(k - 1), room(k)) : 0);
  /** How far across the ease at a handle reaches: a little more than it goes along, within half the run. */
  const ease = (i: number) => {
    const [du, dv] = delta(i);
    return Math.min(Math.abs(dv) / 2, Math.max(1.5 * Math.abs(du), TURN));
  };

  let d = `M${xy(P[0])}`;
  let from = P[0];
  for (let i = 0; i < n; i++) {
    const k = i + 1;
    const r = turn(k);
    const [du, dv] = delta(i);
    const side = Math.sign(dv) || 1;
    if (across[i] && i === 0) {
      // Leave the handle along the flow and ease into the run across: a quarter curve, then straight.
      // A run that is both the first and the last keeps half its way along for easing into the far handle.
      const go = i === n - 1 ? du / 2 : du;
      const e = ease(i) / (i === n - 1 ? 2 : 1);
      const to: V = [P[0][0] + go, P[0][1] + side * e];
      d += ` C${xy([P[0][0] + 0.55 * go, P[0][1]])} ${xy([to[0], to[1] - side * 0.55 * e])} ${xy(to)}`;
      from = to;
    }
    const last = across[i] && i === n - 1;
    const corner = P[k];
    let to = r ? add(corner, heading(i), -r) : corner;
    const easeIn = ease(i) / (i === 0 ? 2 : 1);
    if (last) to = [from[0], P[n][1] - side * easeIn];
    if (across[i]) d += ` L${xy(to)}`;
    else {
      const mid = (from[0] + to[0]) / 2;
      d += ` C${xy([mid, from[1]])} ${xy([mid, to[1]])} ${xy(to)}`;
    }
    if (last) {
      // Ease out of the run across into the handle, arriving along the flow.
      const gap = P[n][0] - to[0];
      d += ` C${xy([to[0], to[1] + side * 0.55 * easeIn])} ${xy([P[n][0] - 0.55 * gap, P[n][1]])} ${xy(P[n])}`;
      from = P[n];
    } else if (r) {
      const out = add(corner, heading(k), r);
      d += ` Q${xy(corner)} ${xy(out)}`;
      from = out;
    } else from = to;
  }
  return d;
}

/** What a node is called on a clicked belt's label: the part a machine makes, or the item at an endpoint. */
function nodeName(node: unknown, name: (x: { name: string }) => string): string {
  const d = (node ?? {}) as { use?: MachineNodeData['use']; item?: string; label?: string };
  if (d.use) return recipeLabel(name(d.use.recipe), d.use.recipe.kind);
  const item = d.item ? data.items[d.item] : undefined;
  return item ? name(item) : (d.label ?? '');
}

const moved = (a: Point | undefined, b: Point) => !a || Math.abs(a.x - b.x) > 0.5 || Math.abs(a.y - b.y) > 0.5;

const MAX_DRAWN_LANES = 6;

/** A conveyor belt (rails, bed, moving slats) or a pipe (casing, flowing fluid) along the edge. */
function FlowEdge({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data: d }: EdgeProps) {
  const { name, num, t } = useT();
  const focus = useContext(Focus);
  const zoom = useFlowStore(zoomSelector);
  const still = useFlowStore(stillSelector);
  const labels = useStore((s) => s.settings.beltLabels);
  const oneColor = useStore((s) => s.settings.beltColors === 'one');
  const { item, rate, transport, lanes, route } = d as FlowEdgeData;
  const it = data.items[item];
  const dir = useContext(Flow);
  const fromNode = useInternalNode(source);
  const toNode = useInternalNode(target);
  const from = fromNode?.internals.positionAbsolute;
  const to = toNode?.internals.positionAbsolute;
  const pick = useContext(PickEdge);
  const picked = focus.edge === id;
  let path: string;
  let lx: number;
  let ly: number;
  if (route && !moved(from, route.from) && !moved(to, route.to)) {
    // As laid out: follow the route around the machines, through the label's reserved spot.
    path = routePath([{ x: sourceX, y: sourceY }, ...route.points, { x: targetX, y: targetY }], dir);
    lx = route.label.x;
    ly = route.label.y;
  } else {
    [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  }
  // Side by side lines widen the belt, up to a point: past a few, the label's "123×" says how many.
  const drawn = Math.min(lanes, MAX_DRAWN_LANES);
  const lit = focus.edge ? picked : focus.nodes !== undefined && (focus.nodes.has(source) || focus.nodes.has(target));
  const faded = (focus.nodes !== undefined || focus.edge !== undefined) && !lit;
  const showLabel = labels === 'always' || lit || (labels === 'auto' && zoom !== 'far');
  const state = `${faded ? 'faded' : ''} ${lit ? 'lit' : ''} ${still ? 'still' : ''}`;
  const { body, color: tierColor } = beltStroke({ path, item, transport, lanes: drawn, state, oneColor });

  return (
    <>
      {body}
      {showLabel && (
        <EdgeLabelRenderer>
          <div className="edge-anchor" style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}>
            <button
              type="button"
              className={`edge-label pickable nopan ${state} ${picked ? 'picked' : ''}`}
              title={name(it)}
              tabIndex={-1}
              aria-pressed={picked}
              onClick={(e) => {
                e.stopPropagation();
                pick(picked ? undefined : id);
              }}
            >
              <Icon id={item} size={zoom === 'near' ? 30 : 24} />
              <span className="edge-text">
                {zoom === 'near' && <span className="edge-item">{name(it)}</span>}
                <span className="edge-meta">
                  <span className="edge-rate">
                    {num(rate)}
                    {t('perMin')}
                  </span>
                  <span className="edge-tier" style={{ background: tierColor }}>
                    {lanes > 1 && `${lanes}× `}
                    {transport.name}
                  </span>
                </span>
              </span>
              {picked && (
                <span className="edge-route">
                  {nodeName(fromNode?.data, name)} <span aria-hidden>→</span> {nodeName(toNode?.data, name)}
                </span>
              )}
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { machine: MachineNode, endpoint: EndpointNode, power: PowerNode };
const edgeTypes = { flow: FlowEdge, power: PowerEdge };

/** The direction switch (left to right or top to bottom) and fit to screen. */
function FloorControls() {
  const { t } = useT();
  const flow = useReactFlow();
  const dir = useContext(Flow);
  const set = useStore((s) => s.set);
  return (
    <div className="floor-controls">
      <div className="segmented" role="radiogroup" aria-label={t('direction')}>
        <button type="button" role="radio" aria-checked={dir === 'LR'} title={t('leftToRight')} onClick={() => set({ graphDir: 'LR' })}>
          <span aria-hidden>→</span>
          <span className="sr-only">{t('leftToRight')}</span>
        </button>
        <button type="button" role="radio" aria-checked={dir === 'TB'} title={t('topToBottom')} onClick={() => set({ graphDir: 'TB' })}>
          <span aria-hidden>↓</span>
          <span className="sr-only">{t('topToBottom')}</span>
        </button>
      </div>
      <button
        type="button"
        className="floor-button"
        title={t('fit')}
        onClick={() => flow.fitView({ padding: { top: '24px', left: '24px', right: '24px', bottom: `${BAR}px` }, duration: 250 })}
      >
        <span className="fit-icon" aria-hidden>
          ⤢
        </span>
        <span className="fit-label">{t('fit')}</span>
      </button>
    </div>
  );
}

let solveCount = 0;

/** Room kept along the floor's bottom edge for its buttons (view switch, direction, fit), so no card opens under them. */
const BAR = 76;

/** Below this zoom a machine's text is too small to read, so the camera never opens further out (phones sit closer to the eye). */
const readable = (width: number) => (width < 600 ? 0.5 : 0.72);
/** Nor closer in than this: a small factory still opens at a comfortable size rather than blown up. */
const MAX_OPEN = 1.05;
/** How far out the floor zooms, unless the factory needs more to fit the screen whole. */
const MIN_ZOOM = 0.15;

/** Zoom that shows every machine in a box this size. */
function wholeZoom(nodes: Node[], width: number, height: number): number {
  if (nodes.length === 0) return MIN_ZOOM;
  const minX = Math.min(...nodes.map((n) => n.position.x));
  const minY = Math.min(...nodes.map((n) => n.position.y));
  const maxX = Math.max(...nodes.map((n) => n.position.x + (n.width ?? 0)));
  const maxY = Math.max(...nodes.map((n) => n.position.y + (n.height ?? 0)));
  return Math.min(width / Math.max(1, maxX - minX), height / Math.max(1, maxY - minY));
}

/**
 * Opening camera: the whole factory when it fits at a readable zoom. Otherwise the whole height (or width, top to
 * bottom) if that's readable, starting from the ore end the way the line is built; a readable zoom failing that.
 */
export function openingViewport(nodes: Node[], width: number, height: number, dir: Direction): Viewport {
  const minX = Math.min(...nodes.map((n) => n.position.x));
  const minY = Math.min(...nodes.map((n) => n.position.y));
  const maxX = Math.max(...nodes.map((n) => n.position.x + (n.width ?? 0)));
  const maxY = Math.max(...nodes.map((n) => n.position.y + (n.height ?? 0)));
  const pad = width < 600 ? 16 : 32;
  const fitX = (width - pad * 2) / (maxX - minX);
  const fitY = (height - pad * 2) / (maxY - minY);
  const centred = (size: number, span: number, min: number, zoom: number) => (size - span * zoom) / 2 - min * zoom;
  const fit = Math.min(fitX, fitY, MAX_OPEN);
  const least = readable(width);
  if (fit >= least) {
    return { x: centred(width, maxX - minX, minX, fit), y: centred(height, maxY - minY, minY, fit), zoom: fit };
  }
  // Too big to show whole: fit it across the flow if that reads, and start at the inputs along it.
  const across = dir === 'LR' ? fitY : fitX;
  const zoom = Math.max(least, Math.min(across, MAX_OPEN));
  // Across the flow, aim at the first column of inputs rather than the bounding box's corner, which
  // on a big factory is often empty floor.
  const first = nodes.filter((n) => (dir === 'LR' ? n.position.x : n.position.y) < (dir === 'LR' ? minX : minY) + 120);
  const place = (lo: number, hi: number, min: number, max: number, size: number) => {
    if ((max - min) * zoom <= size - pad * 2) return centred(size, max - min, min, zoom);
    // Doesn't fit: start from the near edge when the first column shows from there, so no machine opens cut in half;
    // otherwise centre that column, without showing empty floor past either edge.
    const edge = pad - min * zoom;
    if (edge + hi * zoom <= size - pad) return edge;
    const aim = centred(size, hi - lo, lo, zoom);
    return Math.min(pad - min * zoom, Math.max(size - pad - max * zoom, aim));
  };
  const firstLo = (axis: 'x' | 'y') => Math.min(...first.map((n) => n.position[axis]));
  const firstHi = (axis: 'x' | 'y') => Math.max(...first.map((n) => n.position[axis] + ((axis === 'x' ? n.width : n.height) ?? 0)));
  const x = dir === 'LR' ? pad - minX * zoom : place(firstLo('x'), firstHi('x'), minX, maxX, width);
  const y = dir === 'TB' ? pad - minY * zoom : place(firstLo('y'), firstHi('y'), minY, maxY, height);
  return { x, y, zoom };
}

// Camera survives re-solves that keep the same machines (e.g. tweaking a clock speed).
let camera: { sig: string; viewport?: Viewport } = { sig: '' };

function Canvas({ nodes, edges, sig, dir }: { nodes: Node[]; edges: Edge[]; sig: string; dir: Direction }) {
  const inspect = useStore((s) => s.inspect);
  const set = useStore((s) => s.set);
  const gridLines = useStore((s) => s.settings.gridLines);
  const [hover, setHover] = useState<string>();
  const [edge, setEdge] = useState<string>();
  const [restore] = useState(() => (camera.sig === sig ? camera.viewport : undefined));
  // A huge factory may need to zoom out past the usual floor to fit the screen whole.
  const [minZoom] = useState(() => {
    const box = document.querySelector('.floor-view')?.getBoundingClientRect();
    return box ? Math.min(MIN_ZOOM, wholeZoom(nodes, box.width, box.height - BAR) * 0.9) : MIN_ZOOM;
  });
  // Dragging nodes with a finger fights panning; touch screens pan and pinch only.
  const coarse = useMediaQuery(COARSE);

  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const e of edges) {
      map.set(e.source, (map.get(e.source) ?? new Set([e.source])).add(e.target));
      map.set(e.target, (map.get(e.target) ?? new Set([e.target])).add(e.source));
    }
    return map;
  }, [edges]);

  // The inspected line's node, or all its cards when it's drawn as a card per destination or split to fit the belts.
  const inspected = useMemo(
    () =>
      inspect
        ? nodes
            .filter((n) => n.id === `recipe:${inspect}` || n.id.startsWith(`recipe:${inspect}#`) || n.id.startsWith(`recipe:${inspect}~`))
            .map((n) => n.id)
        : [],
    [inspect, nodes],
  );

  const flow = useReactFlow();
  useEffect(() => {
    const placed = inspected.flatMap((id) => flow.getNode(id) ?? []);
    if (!placed.length) return;
    // Centre on the first group: a long split line is often wider than the screen, and it starts there.
    const node = placed[0];
    const zoom = Math.max(flow.getZoom(), 0.9);
    // On a phone the machine panel is a sheet over the floor's lower part: centre the machine in what's left above it.
    const floor = document.querySelector('.floor-view')?.getBoundingClientRect();
    const sheet = document.querySelector('.inspector')?.getBoundingClientRect();
    const covered = floor && sheet && sheet.width >= floor.width - 1 ? Math.max(0, floor.bottom - sheet.top) : 0;
    flow.setCenter(node.position.x + (node.width ?? 0) / 2, node.position.y + (node.height ?? 0) / 2 + covered / 2 / zoom, {
      zoom,
      duration: 300,
    });
  }, [inspected, flow]);

  // Escape puts the machine panel away, unless a dialog or a field has the key.
  useEffect(() => {
    if (!inspect) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('dialog[open]')) return;
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select')) return;
      set({ inspect: undefined });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inspect, set]);

  // A clicked belt lights itself and the two machines it joins; otherwise the machine under the pointer, or the
  // selected one (every card of it), lights its belts and neighbours.
  const picked = edge ? edges.find((e) => e.id === edge) : undefined;
  const focus = useMemo(() => {
    if (picked) return { edge: picked.id, near: new Set([picked.source, picked.target]) };
    const ids = hover ? [hover] : inspected;
    if (!ids.length) return { near: new Set<string>() };
    return { nodes: new Set(ids), near: new Set(ids.flatMap((id) => [id, ...(neighbours.get(id) ?? [])])) };
  }, [picked, hover, inspected, neighbours]);

  return (
    <Focus.Provider value={focus}>
      <PickEdge.Provider value={setEdge}>
        <ReactFlow
          defaultNodes={nodes}
          defaultEdges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesConnectable={false}
          nodesDraggable={!coarse}
          edgesFocusable={false}
          minZoom={minZoom}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          defaultViewport={restore}
          onMoveStart={() => document.querySelector('.react-flow')?.classList.add('moving')}
          onMoveEnd={(_, viewport) => {
            document.querySelector('.react-flow')?.classList.remove('moving');
            camera = { sig, viewport };
          }}
          onInit={(flow) => {
            if (!restore) {
              const box = document.querySelector('.floor-view')?.getBoundingClientRect();
              if (box) flow.setViewport(openingViewport(nodes, box.width, box.height - BAR, dir));
            }
            camera = { sig, viewport: flow.getViewport() };
          }}
          // A finger has no hover: a tap would leave the whole floor faded around it until the next tap.
          onNodeMouseEnter={coarse ? undefined : (_, n) => setHover(n.id)}
          onNodeMouseLeave={coarse ? undefined : () => setHover(undefined)}
          onNodeClick={(_, n) => {
            setEdge(undefined);
            if (n.type === 'machine') set({ inspect: (n.data as MachineNodeData).use.recipe.id });
          }}
          onPaneClick={() => {
            setEdge(undefined);
            set({ inspect: undefined });
          }}
        >
          {/* Foundation grid: minor lines every 8 m tile, a heavier seam every 4 tiles. */}
          {gridLines && <Background id="minor" variant={BackgroundVariant.Lines} gap={40} lineWidth={1} color="#2f2f2f" />}
          {gridLines && <Background id="major" variant={BackgroundVariant.Lines} gap={160} lineWidth={1} color="#3b3b3b" />}
          <FloorControls />
        </ReactFlow>
      </PickEdge.Provider>
    </Focus.Provider>
  );
}

export function GraphView({
  result,
  extraction,
  consumers,
  links,
}: {
  result: SolveResult;
  extraction: ExtractionUse[];
  /** Power planner: what the grid feeds. */
  consumers?: Consumer[];
  links?: FactoryLinks;
}) {
  const tier = useStore((s) => s.tier);
  const chosen = useStore((s) => s.graphDir);
  const scale = useStore((s) => s.settings.cardScale);
  const text = useStore((s) => s.settings.textScale);
  const splitLines = useStore((s) => s.settings.splitLines);
  const spacing = useStore((s) => s.settings.spacing);
  const beltSplit = useStore((s) => s.settings.beltSplit);
  const pipeSplit = useStore((s) => s.settings.pipeSplit);
  // Uncontrolled flow remounted per solve: nodes stay draggable, and each new solve lays out fresh.
  const { nodes, edges, dir, key, sig } = useMemo(() => {
    const box = document.querySelector('.floor-view')?.getBoundingClientRect();
    const g = buildGraph(result, tier, {
      dir: chosen,
      box: box && { width: box.width, height: box.height },
      scale,
      text,
      spacing,
      consumers,
      splitLines,
      split: {
        belt: data.belts.find((b) => b.id === beltSplit)?.rate,
        pipe: data.pipes.find((p) => p.id === pipeSplit)?.rate,
      },
    });
    return {
      ...g,
      key: ++solveCount,
      sig:
        g.nodes
          .map((n) => n.id)
          .sort()
          .join('|') + g.dir,
    };
  }, [result, tier, chosen, scale, text, spacing, consumers, splitLines, beltSplit, pipeSplit]);
  const exMap = useMemo(() => new Map(extraction.map((u) => [u.item, u])), [extraction]);
  return (
    <Extraction.Provider value={exMap}>
      <Links.Provider value={links}>
        <Flow.Provider value={dir}>
          <ReactFlowProvider key={key}>
            <Canvas nodes={nodes} edges={edges} sig={sig} dir={dir} />
          </ReactFlowProvider>
        </Flow.Provider>
      </Links.Provider>
    </Extraction.Provider>
  );
}
