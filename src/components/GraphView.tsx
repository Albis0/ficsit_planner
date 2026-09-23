import {
  Background,
  BackgroundVariant,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
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
import { data } from '../lib/data';
import type { ExtractionUse } from '../lib/extraction';
import { buildGraph, type EndpointNodeData, type FlowEdgeData, type MachineNodeData } from '../lib/graph';
import { useT } from '../lib/i18n';
import type { SolveResult } from '../lib/solver';
import { usePlan, useStore } from '../store';
import { Icon } from './Icon';
import { Slot } from './Slot';

/** Hovered node and its direct neighbours; everything else fades so one line can be followed. */
const Focus = createContext<{ node?: string; near: Set<string> }>({ near: new Set() });

/** Extractor counts per raw resource, shown on the ore/fluid source nodes. */
const Extraction = createContext<Map<string, ExtractionUse>>(new Map());

/** Belt colours by tier, Mk.1 to Mk.6: a ramp so faster belts read as "hotter". */
export const BELT_COLORS = ['#8b939b', '#5f95d0', '#46b5a5', '#85c35a', '#e2b53e', '#ee7a3a'];

const beltIndex = (id: string) => Math.max(0, data.belts.findIndex((b) => b.id === id));
const pipeIndex = (id: string) => Math.max(0, data.pipes.findIndex((p) => p.id === id));

const useFaded = (id: string) => {
  const f = useContext(Focus);
  return f.node !== undefined && !f.near.has(id);
};

const zoomSelector = (s: { transform: [number, number, number] }) => (s.transform[2] < 0.45 ? 'far' : s.transform[2] < 0.8 ? 'mid' : 'near');

function MachineNode({ id, data: d, selected }: NodeProps) {
  const { name, num } = useT();
  const { use } = d as MachineNodeData;
  const { recipe } = use;
  const faded = useFaded(id);
  const tuned = use.shards > 0 || use.sloops > 0;
  return (
    <div className={`machine-node ${recipe.kind} ${faded ? 'faded' : ''} ${selected ? 'selected' : ''} ${tuned ? 'tuned' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="machine-strip">
        <span>{name(data.machines[recipe.machine])}</span>
        <span className="machine-power">{num(use.power)} MW</span>
      </div>
      <div className="machine-body">
        <Icon id={recipe.machine} size={64} className="machine-icon" />
        <span className="machine-count">
          {use.built}
          <small>×</small>
        </span>
        <span className="machine-recipe">
          <span className="machine-recipe-name">{name(recipe).replace(/^(Alternatif|Alternate): /, '')}</span>
          <span className="machine-clock">
            {groupClocks(use.clocks).map((g, i) => (
              <span key={i} className={g.clock > 1 + 1e-6 ? 'over' : undefined}>
                {groupClocks(use.clocks).length > 1 && `${g.n}× `}
                {num(g.clock * 100)}%
              </span>
            ))}
            {use.shards > 0 && <span className="mod-badge shard">{use.shards} ◆</span>}
            {use.sloops > 0 && <span className="mod-badge sloop">{use.sloops} ●</span>}
          </span>
        </span>
      </div>
      <Handle type="source" position={Position.Right} />
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
  const label = { raw: t('rawInput'), supply: t('onHand'), missing: t('bringIn'), target: t('output'), surplus: t('surplus') }[kind];
  const it = data.items[item];
  const source = kind === 'raw' || kind === 'supply' || kind === 'missing';
  return (
    <div
      className={`endpoint-node ${kind} ${faded ? 'faded' : ''}`}
      style={it.form !== 'solid' ? { ['--fluid-color' as string]: it.color ?? 'var(--fluid)' } : undefined}
    >
      {!source && <Handle type="target" position={Position.Left} />}
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
      {source && <Handle type="source" position={Position.Right} />}
    </div>
  );
}

/** A conveyor belt (rails, bed, moving slats) or a pipe (casing, flowing fluid) along the edge. */
function FlowEdge({ source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data: d }: EdgeProps) {
  const { name, num, t } = useT();
  const focus = useContext(Focus);
  const zoom = useFlowStore(zoomSelector);
  const { item, rate, transport, lanes } = d as FlowEdgeData;
  const it = data.items[item];
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const fluid = it.form !== 'solid';
  const lit = focus.node !== undefined && (source === focus.node || target === focus.node);
  const faded = focus.node !== undefined && !lit;
  const showLabel = zoom !== 'far' || lit;
  const state = `${faded ? 'faded' : ''} ${lit ? 'lit' : ''}`;

  let body;
  let tierColor;
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
    tierColor = BELT_COLORS[mk];
    const w = 12 + 5 * (lanes - 1);
    body = (
      <g className={`belt-edge ${state}`} style={{ ['--belt' as string]: tierColor, ['--belt-speed' as string]: `${1.4 / Math.sqrt(mk + 1)}s` }}>
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
            <Icon id={item} size={24} />
            {zoom === 'near' && <span className="edge-item">{name(it)}</span>}
            <span className="edge-rate">
              {num(rate)}
              {t('perMin')}
            </span>
            <span className="edge-tier" style={{ background: tierColor }}>
              {lanes > 1 && `${lanes}× `}
              {transport.name}
            </span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { machine: MachineNode, endpoint: EndpointNode };
const edgeTypes = { flow: FlowEdge };

function FitButton() {
  const { t } = useT();
  const flow = useReactFlow();
  return (
    <button type="button" className="floor-button fit" onClick={() => flow.fitView({ padding: 0.06, duration: 250 })}>
      {t('fit')}
    </button>
  );
}

let solveCount = 0;

const READABLE_ZOOM = 0.85;

/**
 * Opening camera: fit the whole factory when it stays readable; otherwise start at a readable
 * zoom from the ore end (left) so the line reads the way it's built, and let the user pan right.
 */
function openingViewport(nodes: Node[], width: number, height: number): Viewport {
  const minX = Math.min(...nodes.map((n) => n.position.x));
  const minY = Math.min(...nodes.map((n) => n.position.y));
  const maxX = Math.max(...nodes.map((n) => n.position.x + (n.width ?? 0)));
  const maxY = Math.max(...nodes.map((n) => n.position.y + (n.height ?? 0)));
  const pad = 48;
  const fit = Math.min((width - pad * 2) / (maxX - minX), (height - pad * 2) / (maxY - minY), 1.1);
  const zoom = Math.max(fit, READABLE_ZOOM);
  const x = fit >= READABLE_ZOOM ? (width - (maxX - minX) * zoom) / 2 - minX * zoom : pad - minX * zoom;
  const y = (maxY - minY) * zoom <= height - pad * 2 ? (height - (maxY - minY) * zoom) / 2 - minY * zoom : pad - minY * zoom;
  return { x, y, zoom };
}

// Camera survives re-solves that keep the same machines (e.g. tweaking a clock speed).
let camera: { sig: string; viewport?: Viewport } = { sig: '' };

function Canvas({ nodes, edges, sig }: { nodes: Node[]; edges: Edge[]; sig: string }) {
  const inspect = useStore((s) => s.inspect);
  const set = useStore((s) => s.set);
  const [hover, setHover] = useState<string>();
  const [restore] = useState(() => (camera.sig === sig ? camera.viewport : undefined));

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
        edgesFocusable={false}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        defaultViewport={restore}
        onMoveEnd={(_, viewport) => (camera = { sig, viewport })}
        onInit={(flow) => {
          if (!restore) {
            const box = document.querySelector('.floor-view')?.getBoundingClientRect();
            if (box) flow.setViewport(openingViewport(nodes, box.width, box.height));
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
        <FitButton />
      </ReactFlow>
    </Focus.Provider>
  );
}

export function GraphView({ result, extraction }: { result: SolveResult; extraction: ExtractionUse[] }) {
  const tier = useStore((s) => s.tier);
  // Uncontrolled flow remounted per solve: nodes stay draggable, and each new solve lays out fresh.
  const { nodes, edges, key, sig } = useMemo(() => {
    const g = buildGraph(result, tier);
    return { ...g, key: ++solveCount, sig: g.nodes.map((n) => n.id).sort().join('|') };
  }, [result, tier]);
  const exMap = useMemo(() => new Map(extraction.map((u) => [u.item, u])), [extraction]);
  return (
    <Extraction.Provider value={exMap}>
      <ReactFlowProvider key={key}>
        <Canvas nodes={nodes} edges={edges} sig={sig} />
      </ReactFlowProvider>
    </Extraction.Provider>
  );
}
