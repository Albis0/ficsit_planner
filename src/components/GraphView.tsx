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
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { groupClocks } from '../lib/clocks';
import { data } from '../lib/data';
import type { ExtractionUse } from '../lib/extraction';
import { buildGraph, type Direction, type EndpointNodeData, type FlowEdgeData, type MachineNodeData, type Point } from '../lib/graph';
import { useT } from '../lib/i18n';
import { recipeLabel } from '../lib/text';
import { COARSE, useMediaQuery } from '../lib/useMediaQuery';
import type { SolveResult } from '../lib/solver';
import { usePlan, useStore } from '../store';
import { Icon } from './Icon';
import { Slot } from './Slot';

/** Hovered node and its direct neighbours; everything else fades so one line can be followed. */
const Focus = createContext<{ node?: string; near: Set<string> }>({ near: new Set() });

/** Which way the line runs, so node handles sit on the matching sides. */
const Flow = createContext<Direction>('LR');
const inSide = (dir: Direction) => (dir === 'TB' ? Position.Top : Position.Left);
const outSide = (dir: Direction) => (dir === 'TB' ? Position.Bottom : Position.Right);

/** Extractor counts per raw resource, shown on the ore/fluid source nodes. */
const Extraction = createContext<Map<string, ExtractionUse>>(new Map());

/** Belt colours by tier, Mk.1 to Mk.6: a ramp so faster belts read as "hotter". */
export const BELT_COLORS = ['#8b939b', '#5f95d0', '#46b5a5', '#85c35a', '#e2b53e', '#ee7a3a'];

const beltIndex = (id: string) =>
  Math.max(
    0,
    data.belts.findIndex((b) => b.id === id),
  );
const pipeIndex = (id: string) =>
  Math.max(
    0,
    data.pipes.findIndex((p) => p.id === id),
  );

const useFaded = (id: string) => {
  const f = useContext(Focus);
  return f.node !== undefined && !f.near.has(id);
};

/** Below this zoom belt labels hide, so the machines stay readable. */
const FAR_ZOOM = 0.55;

const zoomSelector = (s: { transform: [number, number, number] }) =>
  s.transform[2] < FAR_ZOOM ? 'far' : s.transform[2] < 0.8 ? 'mid' : 'near';

/** Bottom edge colour for machines holding power shards (blue), somersloops (pink) or both (half and half). */
function modBar(shards: number, sloops: number): string | undefined {
  if (shards > 0 && sloops > 0) return 'linear-gradient(90deg, var(--shard) 50%, var(--sloop) 50%)';
  if (shards > 0) return 'var(--shard)';
  if (sloops > 0) return 'var(--sloop)';
  return undefined;
}

function MachineNode({ id, data: d, selected }: NodeProps) {
  const { name, num } = useT();
  const { use } = d as MachineNodeData;
  const dir = useContext(Flow);
  const { recipe } = use;
  const faded = useFaded(id);
  const bar = modBar(use.shards, use.sloops);
  const groups = groupClocks(use.clocks);
  return (
    <div
      className={`machine-node ${recipe.kind} ${faded ? 'faded' : ''} ${selected ? 'selected' : ''}`}
      style={bar ? { ['--mod-bar' as string]: bar } : undefined}
    >
      <Handle type="target" position={inSide(dir)} />
      {/* The in-game build menu look: a coloured strip naming what it makes and what it draws, the building below. */}
      <div className="machine-strip">
        <Icon id={recipe.outputs[0].item} size={30} className="strip-icon" />
        <span className="machine-product">{recipeLabel(name(recipe), recipe.kind)}</span>
        <span className="machine-power">
          {num(use.power)}
          <small>MW</small>
        </span>
      </div>
      <div className="machine-body">
        <Icon id={recipe.machine} size={60} className="machine-icon" />
        <span className="machine-info">
          <span className="machine-type">{name(data.machines[recipe.machine])}</span>
          {/* Count and clock read as one: "3 × 83.33%" is three machines at 83.33% each. */}
          <span className="machine-run">
            {groups.map((g, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: clock groups are derived in a fixed order and never reordered.
              <span key={i} className={g.clock > 1 + 1e-6 ? 'over' : undefined}>
                {i > 0 && <span className="plus">+</span>}
                <b>{g.n}</b>
                <span className="times">×</span>
                {num(g.clock * 100)}%
              </span>
            ))}
          </span>
          {(use.shards > 0 || use.sloops > 0) && (
            <span className="machine-mods">
              {use.shards > 0 && <span className="mod-badge shard">{use.shards} ◆</span>}
              {use.sloops > 0 && <span className="mod-badge sloop">{use.sloops} ●</span>}
            </span>
          )}
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
  const [editing, setEditing] = useState(false);

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
  const label = { raw: t('rawInput'), supply: t('onHand'), missing: t('bringIn'), target: t('output'), surplus: t('surplus') }[kind];
  const it = data.items[item];
  const source = kind === 'raw' || kind === 'supply' || kind === 'missing';
  return (
    <div
      className={`endpoint-node ${kind} ${faded ? 'faded' : ''}`}
      style={it.form !== 'solid' ? { ['--fluid-color' as string]: it.color ?? 'var(--fluid)' } : undefined}
    >
      {!source && <Handle type="target" position={inSide(dir)} />}
      <Slot id={item} size={60} tone={kind === 'target' ? 'target' : 'default'} />
      <span className="endpoint-text">
        <span className="endpoint-kind">{label}</span>
        <span className="endpoint-name">{name(it)}</span>
        {kind === 'raw' && ex && (
          <span className="endpoint-extract">
            <Icon id={ex.extractor.id} size={22} />
            {ex.built}× {name(ex.extractor)}
          </span>
        )}
      </span>
      {kind === 'raw' ? (
        <PinnableRate item={item} rate={rate} />
      ) : (
        <span className="endpoint-rate">
          {num(rate)}
          <small>{t('perMin')}</small>
        </span>
      )}
      {source && <Handle type="source" position={outSide(dir)} />}
    </div>
  );
}

/**
 * A belt through the route's bends. Each stretch leaves and arrives straight along the line's
 * direction, so it never overshoots or loops where several belts meet at one input.
 */
function routePath(pts: Point[], dir: Direction): string {
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (dir === 'LR') {
      const mx = (a.x + b.x) / 2;
      d += ` C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`;
    } else {
      const my = (a.y + b.y) / 2;
      d += ` C${a.x},${my} ${b.x},${my} ${b.x},${b.y}`;
    }
  }
  return d;
}

const moved = (a: Point | undefined, b: Point) => !a || Math.abs(a.x - b.x) > 0.5 || Math.abs(a.y - b.y) > 0.5;

/** A conveyor belt (rails, bed, moving slats) or a pipe (casing, flowing fluid) along the edge. */
function FlowEdge({ source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data: d }: EdgeProps) {
  const { name, num, t } = useT();
  const focus = useContext(Focus);
  const zoom = useFlowStore(zoomSelector);
  const { item, rate, transport, lanes, route } = d as FlowEdgeData;
  const it = data.items[item];
  const dir = useContext(Flow);
  const from = useInternalNode(source)?.internals.positionAbsolute;
  const to = useInternalNode(target)?.internals.positionAbsolute;
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
  const fluid = it.form !== 'solid';
  const lit = focus.node !== undefined && (source === focus.node || target === focus.node);
  const faded = focus.node !== undefined && !lit;
  const showLabel = zoom !== 'far' || lit;
  const state = `${faded ? 'faded' : ''} ${lit ? 'lit' : ''}`;

  let body: ReactNode;
  let tierColor: string;
  if (fluid) {
    const mk = pipeIndex(transport.id);
    const w = mk === 0 ? 9 : 12;
    tierColor = it.color ?? 'var(--fluid)';
    body = (
      <g className={`pipe-edge ${state}`}>
        <path d={path} className="pipe-casing" style={{ strokeWidth: w + 4 * (lanes - 1) }} />
        <path d={path} className="pipe-fluid" style={{ stroke: tierColor, strokeWidth: w - 4 }} />
      </g>
    );
  } else {
    const mk = beltIndex(transport.id);
    tierColor = BELT_COLORS[Math.min(mk, BELT_COLORS.length - 1)];
    const w = 12 + 5 * (lanes - 1);
    body = (
      <g
        className={`belt-edge ${state}`}
        style={{ ['--belt' as string]: tierColor, ['--belt-speed' as string]: `${1.4 / Math.sqrt(mk + 1)}s` }}
      >
        <path d={path} className="belt-rails" style={{ strokeWidth: w }} />
        <path d={path} className="belt-bed" style={{ strokeWidth: w - 5 }} />
        <path d={path} className="belt-slats" style={{ strokeWidth: w - 5 }} />
      </g>
    );
  }

  return (
    <>
      {body}
      {showLabel && (
        <EdgeLabelRenderer>
          <div
            className={`edge-label ${state}`}
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
            title={name(it)}
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
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { machine: MachineNode, endpoint: EndpointNode };
const edgeTypes = { flow: FlowEdge };

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
      <button type="button" className="floor-button" title={t('fit')} onClick={() => flow.fitView({ padding: 0.04, duration: 250 })}>
        <span className="fit-icon" aria-hidden>
          ⤢
        </span>
        <span className="fit-label">{t('fit')}</span>
      </button>
    </div>
  );
}

let solveCount = 0;

/** Zoomed out further than this, fitting the whole factory at once isn't worth it. */
const MIN_FIT = 0.45;
/** Where the camera starts on a factory too big to fit: close enough to read, at the ore end. */
const START_ZOOM = 0.6;

/**
 * Opening camera: the whole factory filling the floor while that stays readable; otherwise a readable zoom from the ore end, the way the line is built.
 */
function openingViewport(nodes: Node[], width: number, height: number, dir: Direction): Viewport {
  const minX = Math.min(...nodes.map((n) => n.position.x));
  const minY = Math.min(...nodes.map((n) => n.position.y));
  const maxX = Math.max(...nodes.map((n) => n.position.x + (n.width ?? 0)));
  const maxY = Math.max(...nodes.map((n) => n.position.y + (n.height ?? 0)));
  const pad = width < 600 ? 12 : 28;
  const fit = Math.min((width - pad * 2) / (maxX - minX), (height - pad * 2) / (maxY - minY), 1.1);
  const centred = (size: number, span: number, min: number, zoom: number) => (size - span * zoom) / 2 - min * zoom;
  if (fit >= MIN_FIT) {
    return { x: centred(width, maxX - minX, minX, fit), y: centred(height, maxY - minY, minY, fit), zoom: fit };
  }
  // Too big: start from the inputs, centred the other way when that side fits.
  const zoom = START_ZOOM;
  const x = dir === 'LR' || (maxX - minX) * zoom > width ? pad - minX * zoom : centred(width, maxX - minX, minX, zoom);
  const y = dir === 'TB' || (maxY - minY) * zoom > height ? pad - minY * zoom : centred(height, maxY - minY, minY, zoom);
  return { x, y, zoom };
}

// Camera survives re-solves that keep the same machines (e.g. tweaking a clock speed).
let camera: { sig: string; viewport?: Viewport } = { sig: '' };

function Canvas({ nodes, edges, sig, dir }: { nodes: Node[]; edges: Edge[]; sig: string; dir: Direction }) {
  const inspect = useStore((s) => s.inspect);
  const set = useStore((s) => s.set);
  const [hover, setHover] = useState<string>();
  const [restore] = useState(() => (camera.sig === sig ? camera.viewport : undefined));
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

  const flow = useReactFlow();
  useEffect(() => {
    if (!inspect) return;
    const node = flow.getNode(`recipe:${inspect}`);
    if (!node) return;
    const zoom = Math.max(flow.getZoom(), 0.9);
    flow.setCenter(node.position.x + (node.width ?? 0) / 2, node.position.y + (node.height ?? 0) / 2, { zoom, duration: 300 });
  }, [inspect, flow]);

  const focusNode = hover ?? (inspect ? `recipe:${inspect}` : undefined);
  const focus = useMemo(
    () => ({ node: focusNode, near: (focusNode && neighbours.get(focusNode)) || new Set(focusNode ? [focusNode] : []) }),
    [focusNode, neighbours],
  );

  return (
    <Focus.Provider value={focus}>
      <ReactFlow
        defaultNodes={nodes}
        defaultEdges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesConnectable={false}
        nodesDraggable={!coarse}
        edgesFocusable={false}
        minZoom={0.15}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        defaultViewport={restore}
        onMoveEnd={(_, viewport) => (camera = { sig, viewport })}
        onInit={(flow) => {
          if (!restore) {
            const box = document.querySelector('.floor-view')?.getBoundingClientRect();
            if (box) flow.setViewport(openingViewport(nodes, box.width, box.height, dir));
          }
          camera = { sig, viewport: flow.getViewport() };
        }}
        onNodeMouseEnter={(_, n) => setHover(n.id)}
        onNodeMouseLeave={() => setHover(undefined)}
        onNodeClick={(_, n) => n.type === 'machine' && set({ inspect: (n.data as MachineNodeData).use.recipe.id })}
        onPaneClick={() => set({ inspect: undefined })}
      >
        {/* Foundation grid: minor lines every 8 m tile, a heavier seam every 4 tiles. */}
        <Background id="minor" variant={BackgroundVariant.Lines} gap={40} lineWidth={1} color="#2a2e33" />
        <Background id="major" variant={BackgroundVariant.Lines} gap={160} lineWidth={1} color="#383e45" />
        <FloorControls />
      </ReactFlow>
    </Focus.Provider>
  );
}

export function GraphView({ result, extraction }: { result: SolveResult; extraction: ExtractionUse[] }) {
  const tier = useStore((s) => s.tier);
  const chosen = useStore((s) => s.graphDir);
  // Uncontrolled flow remounted per solve: nodes stay draggable, and each new solve lays out fresh.
  const { nodes, edges, dir, key, sig } = useMemo(() => {
    const box = document.querySelector('.floor-view')?.getBoundingClientRect();
    const g = buildGraph(result, tier, { dir: chosen, box: box && { width: box.width, height: box.height } });
    return {
      ...g,
      key: ++solveCount,
      sig:
        g.nodes
          .map((n) => n.id)
          .sort()
          .join('|') + g.dir,
    };
  }, [result, tier, chosen]);
  const exMap = useMemo(() => new Map(extraction.map((u) => [u.item, u])), [extraction]);
  return (
    <Extraction.Provider value={exMap}>
      <Flow.Provider value={dir}>
        <ReactFlowProvider key={key}>
          <Canvas nodes={nodes} edges={edges} sig={sig} dir={dir} />
        </ReactFlowProvider>
      </Flow.Provider>
    </Extraction.Provider>
  );
}
